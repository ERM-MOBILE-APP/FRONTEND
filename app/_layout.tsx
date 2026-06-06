import React from 'react';
import { Stack } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

// Import-only side-effect: registers the background location ping task
// with TaskManager so the OS can invoke it even when the app is killed.
// Must run at module load time, before any screen renders.
import '../services/locationTask';

/**
 * Root-level error boundary.
 *
 * Why this exists
 * ───────────────
 * Users were reporting "the app comes out by itself" — i.e. an unhandled
 * exception (network blip, undefined access in a render path, expo-location
 * permission edge case) was bubbling all the way up and React Native was
 * tearing the JS root down. The OS then sees an empty bridge and kills the
 * process; on the phone it looks like the app force-closed.
 *
 * Catching errors here lets the user see a friendly "Something went wrong"
 * panel with a Reload button, instead of having the whole app vanish.
 *
 * Componenting-DidCatch covers render + lifecycle errors. Promise
 * rejections that happen outside React (e.g. background fetch) are
 * separately swallowed by the catch blocks in each screen's data loader.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the diagnostic locally — surfacing it to Sentry / a remote
    // logger would be cleaner but for go-live "print to Metro / Logcat"
    // is enough for the team to triage what crashed.
    console.warn('[RootErrorBoundary] caught render error:', error?.message, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.subtitle}>
            The app hit an unexpected error. Tap below to recover.
          </Text>
          <ScrollView style={errorStyles.detailBox}>
            <Text style={errorStyles.detail} selectable>
              {this.state.error.message || String(this.state.error)}
            </Text>
          </ScrollView>
          <TouchableOpacity style={errorStyles.btn} onPress={this.handleReload}>
            <Text style={errorStyles.btnText}>Reload app</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen
          name="(auth)/email-verify"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="(auth)/otp"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="(auth)/new-password"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="(auth)/success"
          options={{
            presentation: 'card',
            animation: 'fade',
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
        <Stack.Screen
          name="complaint"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="payslip-summary"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
      </Stack>
    </RootErrorBoundary>
  );
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 24,
  },
  detailBox: {
    maxHeight: 160,
    width: '100%',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
  },
  detail: {
    fontSize: 12,
    color: '#334155',
    fontFamily: 'Courier',
  },
  btn: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  btnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
