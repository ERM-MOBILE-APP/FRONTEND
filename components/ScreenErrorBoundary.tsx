/**
 * ScreenErrorBoundary — #322
 *
 * A per-screen error boundary. If a render-tree error occurs anywhere
 * inside a single tab (Home, Attendance, Leave, Allowance, Profile,
 * Payslip), the boundary catches it and shows a friendly recovery card
 * INSIDE that tab — instead of letting the error bubble to the root
 * boundary, which would unmount the entire app and force a full reload.
 *
 * Why this matters: before this layer existed, a single bad render in
 * (say) the Leave history list would tear down the bottom-tab
 * navigator, the GPS background task, the AppState listener, and the
 * authenticated session. The user would see the whole app blink to
 * black and reopen at the login screen with all their work lost. With
 * a per-screen boundary, the failure stays contained — the broken tab
 * shows a "Something went wrong — tap to retry" card, and every other
 * tab continues to work normally.
 *
 * The boundary also writes the failure to the same persistCrash channel
 * used by the boot-level RootErrorBoundary, so the in-app Diagnostics
 * screen and any `adb logcat` filter still picks it up.
 *
 * Usage — wrap each tab screen's outer JSX with <ScreenErrorBoundary>:
 *
 *   export default function LeaveScreen() {
 *     return (
 *       <ScreenErrorBoundary name="Leave">
 *         <SafeAreaView>...</SafeAreaView>
 *       </ScreenErrorBoundary>
 *     );
 *   }
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CRASH_KEY = 'erm-last-crash-v1';

// Mirror of the persistCrash helper in app/_layout.tsx so this file
// doesn't have to import from there (avoiding a circular module load
// at boot). Writes a fresh row that the Diagnostics screen will read.
async function persistCrash(label: string, err: any) {
  try {
    const payload = {
      at: new Date().toISOString(),
      label,
      message: err?.message || String(err),
      stack:   err?.stack   || null,
    };
    await AsyncStorage.setItem(CRASH_KEY, JSON.stringify(payload));
  } catch {
    // last-ditch: if AsyncStorage itself is broken there's nothing we
    // can usefully do — the boot-level handler will still log.
  }
}

type Props = {
  /** A short label like "Home", "Leave" — used in the recovery card
   * and in the persisted crash entry so we can tell which tab failed. */
  name: string;
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export default class ScreenErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: any): State {
    return {
      hasError: true,
      message: error?.message || 'Unexpected error.',
    };
  }

  componentDidCatch(error: any, info: any) {
    const label = `screen:${this.props.name}`;
    console.warn(
      `[ScreenErrorBoundary] ${label}`,
      error?.message,
      info?.componentStack
    );
    persistCrash(label, error);
  }

  handleRetry = () => {
    // Resetting state re-mounts the child subtree. Most of the
    // crash-prone causes (stale prop, race, transient null) won't
    // recur on remount, so retry succeeds the vast majority of the
    // time.
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Feather name="alert-triangle" size={32} color="#B45309" />
          </View>
          <Text style={styles.title}>This screen ran into a problem</Text>
          <Text style={styles.body}>
            We were unable to render the {this.props.name} screen. The
            rest of the app is still working — you can try again or
            switch to another tab.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            activeOpacity={0.85}
            onPress={this.handleRetry}
          >
            <Feather name="refresh-cw" size={16} color="#FFFFFF" />
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
          {!!this.state.message && (
            <Text style={styles.errText} numberOfLines={2}>
              {this.state.message}
            </Text>
          )}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#F6F8F6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8E4',
    shadowColor: '#0F1B12',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    maxWidth: 380,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF7E6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F1B12',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: '#5A6B5E',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#2E8C2C',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 999,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 8,
  },
  errText: {
    marginTop: 14,
    fontSize: 11,
    color: '#9AA6A0',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
});
