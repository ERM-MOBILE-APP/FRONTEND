/**
 * SubmitLoader — premium center-screen loading overlay used by EVERY
 * request submission across the ERM Mobile app (Leave, Permission,
 * Allowance — Petrol & Travel, Attendance Request, Payslip Request).
 *
 * Why a shared component (#298): each screen previously rendered its own
 * <ActivityIndicator size="small"/> INSIDE the submit button. On a slow
 * Render cold-start that meant the user saw a tiny spinner inside a
 * still-tappable button, and often double-tapped — generating duplicate
 * server-side rows. This component:
 *
 *   1. Mounts as a transparent Modal so it sits over everything, dead
 *      centered on the screen regardless of the form scroll position.
 *   2. Dims the whole UI with a 45% black backdrop so the form is
 *      visually disabled (no chance of a second tap).
 *   3. Uses the same animated pulse ring + accent icon the check-in
 *      loader uses (#259), so the whole app speaks one design language.
 *   4. Exposes only `visible` + optional `label/sub` props so wiring it
 *      into any screen is a one-line change.
 *
 * Usage:
 *
 *   import SubmitLoader from '../../components/SubmitLoader';
 *   ...
 *   <SubmitLoader visible={submitting} label="Submitting your request" />
 *
 * The animation uses the native driver for rotate/pulse, so it stays at
 * 60 fps even when the JS thread is busy waiting on the network — which
 * is exactly when this loader is supposed to be reassuring.
 */
import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  Animated,
  Easing,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

type Props = {
  /** Show / hide the loader. Drive this from your `submitting` state. */
  visible: boolean;
  /** Main line — defaults to "Submitting your request". */
  label?: string;
  /** Second line — defaults to a generic reassurance. */
  sub?: string;
  /** Accent colour for the ring + icon. Defaults to ERM green. */
  accent?: string;
};

export default function SubmitLoader({
  visible,
  label = 'Submitting your request',
  sub   = 'Hang tight — confirming with the server…',
  accent = '#16A34A',
}: Props) {
  const rotateRef = useRef(new Animated.Value(0)).current;
  const pulseRef  = useRef(new Animated.Value(0)).current;

  // #311 — Hold the Modal open for ~60 ms AFTER the parent flips
  // `visible` to false. That gives this loader's fade-out animation
  // time to finish before the parent screen's SuccessModal starts
  // its fade-in, which is exactly the Android WindowManager z-order
  // race that caused the lingering "flicker right after submit"
  // reports. Same trick used by #299 for the check-in/out modals.
  const [actuallyVisible, setActuallyVisible] = React.useState(visible);
  useEffect(() => {
    if (visible) {
      setActuallyVisible(true);
      return;
    }
    const t = setTimeout(() => setActuallyVisible(false), 220);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    if (!actuallyVisible) return;
    const rotate = Animated.loop(
      Animated.timing(rotateRef, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseRef, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseRef, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
      ]),
    );
    rotate.start();
    pulse.start();
    return () => {
      // #311 — Guard cleanup. On Android 9/10 if the native view has
      // already been torn down (user navigated tabs while loader was
      // up), .stop() or .setValue() can throw a no-such-tag error and
      // crash the JS engine via ErrorUtils. Each call now self-catches.
      try { rotate.stop();   } catch { /* native view gone — non-fatal */ }
      try { pulse.stop();    } catch { /* same */ }
      try { rotateRef.setValue(0); } catch { /* same */ }
      try { pulseRef.setValue(0);  } catch { /* same */ }
    };
    // refs are stable for the component lifetime — don't add them to deps,
    // it caused the effect to re-run spuriously on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actuallyVisible]);

  // Derive a paler halo + a mid ring shade from the accent so callers
  // only have to specify one colour for the whole loader.
  const isGreen = accent.toLowerCase() === '#16a34a';
  const ringSoft = isGreen ? '#86EFAC' : '#93C5FD';
  const tint     = isGreen ? '#DCFCE7' : '#DBEAFE';
  const accent2  = isGreen ? '#22C55E' : '#3B82F6';

  const rotation  = rotateRef.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const haloScale = pulseRef.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
  const haloOpac  = pulseRef.interpolate({ inputRange: [0, 1], outputRange: [0.6,  0.15] });

  return (
    <Modal
      visible={actuallyVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => { /* swallow back-press while busy */ }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.centerpiece}>
            <Animated.View
              style={[
                styles.halo,
                { backgroundColor: tint, opacity: haloOpac, transform: [{ scale: haloScale }] },
              ]}
            />
            <Animated.View
              style={[
                styles.spinRing,
                {
                  borderTopColor:    accent,
                  borderRightColor:  accent2,
                  borderBottomColor: ringSoft,
                  borderLeftColor:   'transparent',
                  transform: [{ rotate: rotation }],
                },
              ]}
            />
            <View style={[styles.iconDisc, { backgroundColor: accent }]}>
              <Feather name="send" size={24} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.sub}>{sub}</Text>
          <View style={styles.dotRow}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <View style={[styles.dot, { backgroundColor: accent2, opacity: 0.6  }]} />
            <View style={[styles.dot, { backgroundColor: ringSoft, opacity: 0.4 }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 34,
    paddingVertical: 36,
    minWidth: 300,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 32,
    elevation: 20,
  },
  centerpiece: {
    width: 110, height: 110,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
    marginBottom: 10,
  },
  halo: {
    position: 'absolute',
    width: 110, height: 110, borderRadius: 55,
  },
  spinRing: {
    position: 'absolute',
    width: 94, height: 94, borderRadius: 47,
    borderWidth: 4,
    borderStyle: 'solid',
  },
  iconDisc: {
    width: 58, height: 58, borderRadius: 29,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 8,
  },
  label: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  sub: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  dotRow: {
    flexDirection: 'row',
    marginTop: 18,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    marginHorizontal: 4,
  },
});
