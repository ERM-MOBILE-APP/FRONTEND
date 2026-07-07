import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
  Modal,
  Pressable,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Linking, AppState } from 'react-native';
import { attendanceAPI, announcementAPI, notificationAPI, wakeBackend } from '../../services/api';
import SideDrawer from '../../components/SideDrawer';
// #377 — Per-screen error boundary. Every OTHER tab already wraps its
// JSX with this so a single render error is contained to that screen.
// HomeScreen was the ONLY tab without it — meaning any null-access,
// bad Ionicons name, or malformed announcement `_id` bubbled all the
// way to the RootErrorBoundary and unmounted the ENTIRE app (killing
// the GPS task, AppState listener, and session). This was the biggest
// remaining "app comes out by itself" source. HomeScreen is the most
// complex tab in the app; it MUST have per-screen protection.
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
  reviveBackgroundLocationUpdates,
  requestBatteryOptimizationExemption,
  openOemAutostartSettings,
  getOemLabel,
  getOemAutostartHint,
  BACKGROUND_LOCATION_TASK,
  filterFix,
  resetGpsAnchor,
  isHeartbeatStale,
  resetTrackingDiagnostics,
} from '../../services/locationTask';

type WorkLocation = 'remote' | 'office';

type TodayData = {
  shiftName?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  workedHours?: number;
  location?: WorkLocation;
  // #336 Multi-session support
  // firstCheckIn       — snapshot of the day's very first arrival
  // accumulatedSeconds — total worked time from all COMPLETED sessions
  // isOnBreak          — true when the day has at least one closed session
  //                      and no open session (i.e. Resume-Work state)
  firstCheckIn?: string | null;
  accumulatedSeconds?: number;
  isOnBreak?: boolean;
};

type Announcement = {
  _id: string;
  title: string;
  body: string;
  postedBy: string;
  createdAt: string;
};

/* ────────────────────────────────────────────────────────────────────
 * Premium animated check-in/out loader (Jun 2026 — #276).
 *
 * Replaces the prior static ring + ActivityIndicator combo with a
 * fully animated centerpiece:
 *   • Outer ring rotates at a continuous 1.4 s cadence (Animated rotate)
 *   • Middle ring pulses opacity + scale to create a breathing halo
 *   • Inner disc holds the action icon with a soft drop-shadow
 *   • Three sequential progress dots advance underneath the label
 *
 * Pure RN Animated API — no extra deps, no native modules, runs at
 * 60 fps on every Android we support. Variant ('in' | 'out') flips the
 * accent palette green (check-in) vs blue (check-out).
 * ────────────────────────────────────────────────────────────────── */
function PremiumLoader({ variant }: { variant: 'in' | 'out' }) {
  const rotateRef = React.useRef(new Animated.Value(0)).current;
  const pulseRef  = React.useRef(new Animated.Value(0)).current;
  const dotsRef   = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const rotate = Animated.loop(
      Animated.timing(rotateRef, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true })
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseRef, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulseRef, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad),  useNativeDriver: true }),
      ])
    );
    const dots = Animated.loop(
      Animated.timing(dotsRef, { toValue: 3, duration: 1350, easing: Easing.linear, useNativeDriver: false })
    );
    rotate.start(); pulse.start(); dots.start();
    return () => {
      // #311 — Guard cleanup. On Android 9/10 the native Animated view
      // can be torn down before this cleanup runs (rapid mount/unmount
      // during the check-in modal swap). Calls to .stop() or
      // .setValue(0) on a gone view throw a no-such-tag error that
      // propagates to ErrorUtils and SIGTERMs the app. Each call now
      // self-catches so the crash chain stops here.
      try { rotate.stop();  } catch { /* native view gone — non-fatal */ }
      try { pulse.stop();   } catch { /* same */ }
      try { dots.stop();    } catch { /* same */ }
      try { rotateRef.setValue(0); } catch { /* same */ }
      try { pulseRef.setValue(0);  } catch { /* same */ }
      try { dotsRef.setValue(0);   } catch { /* same */ }
    };
  }, []);

  const isIn = variant === 'in';
  // Palette
  const accent    = isIn ? '#16A34A' : '#1D4ED8'; // primary
  const accent2   = isIn ? '#22C55E' : '#3B82F6'; // mid
  const tint      = isIn ? '#DCFCE7' : '#DBEAFE'; // pale halo
  const ringSoft  = isIn ? '#86EFAC' : '#93C5FD'; // soft ring color
  const iconBg    = isIn ? '#16A34A' : '#1D4ED8';

  const rotation  = rotateRef.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const haloScale = pulseRef.interpolate ({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
  const haloOpac  = pulseRef.interpolate ({ inputRange: [0, 1], outputRange: [0.6,  0.15] });

  return (
    <View style={loaderStyles.centerpiece}>
      {/* Pulsing halo behind everything */}
      <Animated.View
        style={[
          loaderStyles.halo,
          { backgroundColor: tint, opacity: haloOpac, transform: [{ scale: haloScale }] },
        ]}
      />
      {/* Spinning outer arc — 3/4 colored, 1/4 transparent creates
          the "race-track" look without any gradient library */}
      <Animated.View
        style={[
          loaderStyles.spinRing,
          {
            borderTopColor:    accent,
            borderRightColor:  accent2,
            borderBottomColor: ringSoft,
            borderLeftColor:   'transparent',
            transform: [{ rotate: rotation }],
          },
        ]}
      />
      {/* Static inner disc + icon */}
      <View style={[loaderStyles.iconDisc, { backgroundColor: iconBg }]}>
        <Feather
          name={isIn ? 'log-in' : 'log-out'}
          size={26}
          color="#FFFFFF"
        />
      </View>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * LiveClock — Fix G (Jun 2026 flicker fix).
 *
 * Previously `now` was in HomeScreen state, so setInterval fired every
 * second and re-rendered the ENTIRE 1510-line HomeScreen including all
 * API-fetched lists, modals, and the PremiumLoader animations. Isolating
 * the clock into its own memoized component means only the two <Text>
 * nodes that display the time ever update. HomeScreen re-renders ONLY
 * when real data changes (today, user, announcements, etc.).
 *
 * Props:
 *   onNowChange — optional callback so HomeScreen can still read the
 *   current Date for computeWorkedHours (once per second via ref,
 *   never via state so no extra renders).
 * ─────────────────────────────────────────────────────────────────── */
const LiveClock = memo(function LiveClock({
  nowRef,
}: {
  nowRef: React.MutableRefObject<Date>;
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      nowRef.current = d;
      setNow(d);
    }, 1000);
    return () => clearInterval(t);
  }, [nowRef]);

  const hours   = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const ampm    = hours >= 12 ? 'PM' : 'AM';
  const h       = hours % 12 === 0 ? 12 : hours % 12;
  const timeStr =
    String(h).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + ' ' + ampm;

  return <Text style={styles.bigTime}>{timeStr}</Text>;
});

/* ───────────────────────────────────────────────────────────────────────
 * LiveWorkedHours — Fix #316.
 *
 * Sibling of <LiveClock>. Owns its own 1-second tick so the "Working HR's"
 * counter advances in real time. Before this fix the value was computed
 * inside HomeScreen.render() via computeWorkedHours(), but Fix G isolated
 * the clock into <LiveClock> so HomeScreen no longer re-renders every
 * second — meaning the worked-hours value froze at whatever it was on
 * the last data-driven re-render (a poll cycle, an announcement refresh,
 * etc.). Vivek's screenshot showed 00:07 at 5:44 PM with a 5:25 PM
 * check-in — a 12-minute drift.
 *
 * This component re-renders ONLY itself every second, mirroring the
 * LiveClock pattern. No HomeScreen-wide re-renders, no flicker.
 * ─────────────────────────────────────────────────────────────────── */
const LiveWorkedHours = memo(function LiveWorkedHours({
  checkIn,
  checkOut,
  accumulatedSeconds = 0,
  firstCheckIn,
  workedHours = 0,
}: {
  checkIn?: string | null;
  checkOut?: string | null;
  accumulatedSeconds?: number;
  firstCheckIn?: string | null;
  workedHours?: number;
}) {
  const [, setTick] = useState(0);

  // Working iff there's an open session (checkIn set, no closing
  // checkOut). On break / done: static value = accumulated.
  const isWorking = !!(checkIn && !checkOut);

  useEffect(() => {
    // Only tick while actively working — no point burning a 1 Hz
    // interval when the value is frozen (on break or nothing to show).
    if (!isWorking) return;
    const t = setInterval(() => setTick((x) => (x + 1) % 1_000_000), 1000);
    return () => clearInterval(t);
  }, [isWorking]);

  // #336/#337 — Total = accumulated (rolled up from all closed sessions)
  //                    + current session running time (if actively working).
  // This is what makes the timer RESUME from 03:00 instead of restarting
  // at 00:00 after an accidental check-out.
  //
  // Fallback cascade (#337):
  //   1. accumulatedSeconds prop (new backend)
  //   2. workedHours * 3600 (legacy backend, whole-day total)
  //   3. checkOut − checkIn (single-session row)
  const value = (() => {
    let base = Math.max(0, Number(accumulatedSeconds || 0));
    if (base === 0 && Number(workedHours || 0) > 0) {
      base = Math.round(Number(workedHours) * 3600);
    }
    let running = 0;
    if (isWorking && checkIn) {
      const start = new Date(checkIn).getTime();
      if (Number.isFinite(start) && Date.now() > start) {
        running = Math.floor((Date.now() - start) / 1000);
      }
    }
    let total = base + running;
    // Final safety net — a completed session pair on the row directly.
    if (total === 0 && checkIn && checkOut) {
      const s = new Date(checkIn).getTime();
      const e = new Date(checkOut).getTime();
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
        total = Math.floor((e - s) / 1000);
      }
    }
    // Nothing to show yet AND nothing to hint at → keep zeros.
    if (!isWorking && total <= 0 && !firstCheckIn) return '00:00:00';
    // #344 — HH:MM:SS so the counter visibly ticks every second (per the
    // original multi-session spec: 03:00:00, 03:01:00, 04:00:00, ...).
    const totalSec = Math.max(0, total);
    const hh  = Math.floor(totalSec / 3600);
    const mm  = Math.floor((totalSec % 3600) / 60);
    const ss  = totalSec % 60;
    return String(hh).padStart(2, '0') + ':' +
           String(mm).padStart(2, '0') + ':' +
           String(ss).padStart(2, '0');
  })();

  return (
    <StatItem
      icon={<Feather name="activity" size={20} color="#6A1B9A" />}
      value={value}
      label="Working HR's"
      color="#6A1B9A"
    />
  );
});

export default function HomeScreen() {
  const [user, setUser] = useState<any>(null);
  // nowRef: mutable reference to the current Date, updated by LiveClock
  // every second. Used in computeWorkedHours() WITHOUT being in component
  // state, so reading it never triggers a HomeScreen re-render (fix G).
  const nowRef = useRef(new Date());
  // #339 — Wall-clock ms of the most recent Check In Again tap. For
  // 30 s afterwards, refreshToday() ignores the server's checkOut (it
  // is stale while the old backend hasn't been redeployed OR the write
  // hasn't propagated yet) and keeps the local "back to working" state
  // so the button stays as "Check Out" instead of flipping back.
  const resumeAtRef = useRef(0);
  // #340 — Freeze the loader copy/color to the user's INTENT for the
  // full duration of actionBusy=true. Prevents the "1-sec Checking
  // you out" flash during a Check In Again tap (which optimistically
  // clears checkOut mid-await and briefly changes the derived state).
  const [pendingKind, setPendingKind] = useState<'in' | 'out' | null>(null);
  const [today, setToday] = useState<TodayData>({});
  // Start empty — only show real announcements from the API. If the API
  // returns nothing we render an empty-state below instead of fake data.
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Count of unread notifications — drives the red dot on the bell icon.
  // Refreshed on mount AND every time the home tab comes back into focus,
  // so visiting the Notifications screen (which auto-marks them read) makes
  // the dot disappear without needing a manual reload here.
  const [unreadCount, setUnreadCount] = useState(0);
  // Professional check-in/out modal (Jun 2026). Replaces the native
  // Alert.alert pop-ups so success looks branded instead of like a
  // system error dialog. `null` = closed; otherwise { kind, time }.
  const [checkResult, setCheckResult] = useState<
    null | { kind: 'in' | 'out' | 'done'; time: string }
  >(null);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await notificationAPI.unreadCount();
      // The mobile backend serialises the count as `unreadCount` (see
      // controllers/notificationController.js). An older build of this
      // app read `res.data.count` which always evaluated to undefined
      // → 0 → no badge ever appeared. We now accept either shape so a
      // schema change doesn't silently break the bell again.
      const n = Number(
        res?.data?.unreadCount ??
        res?.data?.count       ??
        res?.data?.unread      ??
        0
      );
      setUnreadCount(Number.isFinite(n) ? n : 0);
    } catch {
      // Network error — leave whatever the previous value was.
    }
  }, []);

  const checkedIn = !!today.checkIn;
  const checkedOut = !!today.checkOut;

  const STORAGE_KEY_TODAY = 'erm-today-v1';

  const refreshToday = useCallback(async () => {
    try {
      const res = await attendanceAPI.today();
      const data = res?.data || {};
      const fresh: TodayData = {
        shiftName:   data.shiftName  || 'General Shift',
        checkIn:     data.checkIn    || null,
        checkOut:    data.checkOut   || null,
        workedHours: data.workedHours || 0,
        location:    data.location   || 'office',
        // #336 Multi-session fields — used to resume the timer after
        // an accidental check-out. The server rolls session durations
        // into `accumulatedSeconds` at each checkout, and the client
        // reads that base and adds the running session on top.
        firstCheckIn:       data.firstCheckIn       || null,
        accumulatedSeconds: Number(data.accumulatedSeconds || 0),
        isOnBreak:          !!data.isOnBreak,
      };
      // FIX (Jun 2026 — optimistic-state guard):
      // refreshToday() was previously always calling setToday(fresh),
      // which wiped the optimistic checkIn/checkOut we set immediately
      // after check-in — if the server returned stale data (Render write
      // hadn't committed yet, or the GET fired before the POST's DB write
      // was durable), the UI flickered back to "Check In".
      //
      // New rule: if we already have a checkIn in local state but the
      // server returned null for checkIn, keep the local value — the
      // server is lying (stale read). Once the server catches up and
      // returns the real checkIn, subsequent polls will update correctly.
      // Same logic applies to checkOut.
      //
      // #336: never let accumulatedSeconds go BACKWARDS during a race —
      // if the local value is greater than the server's (e.g. the
      // client optimistically added the current session on Check Out
      // before the server responded), keep the max so the timer never
      // rolls back visibly.
      setToday(prev => {
        // #339 Resume-window guard: within 30 s of the user tapping
        // Check In Again, treat local state as truth for checkIn /
        // checkOut / isOnBreak so a stale server payload (old backend
        // or slow write propagation) doesn't flip the button back to
        // "Check In Again" moments after the user resumed.
        // #346 — Override lasts until real checkout (clears resumeAtRef=0) or
        // 24 h from the last resume/checkin, so a fresh check-in isn't
        // wiped by a stale server poll 30 s later.
        const inResumeWindow = (Date.now() - Number(resumeAtRef.current || 0)) < 86_400_000;
        const useLocalOverride = inResumeWindow && !prev.checkOut;
        const mergedCheckIn  = useLocalOverride
          ? (prev.checkIn || fresh.checkIn || null)
          : (fresh.checkIn  || prev.checkIn  || null);
        const mergedCheckOut = useLocalOverride
          ? null
          : (fresh.checkOut || prev.checkOut || null);
        // #337 Legacy-backend fallback — if the server hasn't been
        // redeployed with the multi-session upgrade, accumulatedSeconds
        // will be missing but workedHours (the day total) is still
        // authoritative. Convert to seconds so the timer doesn't reset
        // to 00:00 after a Home-tab remount / app relaunch on a
        // same-day post-checkout row.
        const derivedFromWorked = Math.round(Number(fresh.workedHours || 0) * 3600);
        const mergedAccum    = Math.max(
          Number(fresh.accumulatedSeconds || 0),
          Number(prev.accumulatedSeconds  || 0),
          derivedFromWorked,
        );
        const mergedFirst    = fresh.firstCheckIn || prev.firstCheckIn || mergedCheckIn;
        // isOnBreak fallback — a same-day row with both a checkIn AND a
        // checkOut is a break state, regardless of whether the server
        // sent the flag explicitly.
        const derivedBreak   = !!(mergedCheckIn && mergedCheckOut);
        const merged: TodayData = {
          ...fresh,
          checkIn:  mergedCheckIn,
          checkOut: mergedCheckOut,
          accumulatedSeconds: mergedAccum,
          firstCheckIn:       mergedFirst,
          isOnBreak:          useLocalOverride
            ? false
            : (!!fresh.isOnBreak || derivedBreak),
        };
        // Persist the merged truth to AsyncStorage.
        AsyncStorage.setItem(STORAGE_KEY_TODAY, JSON.stringify(merged)).catch(() => {});
        return merged;
      });
    } catch {
      // Fix 3: Network error during poll — DON'T wipe checkIn/checkOut.
      // Previously this branch did `setToday({ shiftName: 'General Shift' })`
      // which cleared today.checkIn, making checkedIn === false, so the
      // button flickered back to "Check In" on any transient network blip.
      // Now we preserve whatever is already in state (via functional update)
      // and only fill in shiftName if it was missing.
      setToday(prev => ({ shiftName: 'General Shift', ...prev }));
    }
  }, []);

  const refreshAnnouncements = useCallback(async () => {
    try {
      const res = await announcementAPI.list();
      // Always trust the server — set whatever it returned (even if empty)
      // so deleted announcements actually disappear.
      setAnnouncements(Array.isArray(res?.data) ? res.data : []);
    } catch {
      // network/server error → leave the current list alone
    }
  }, []);

  useEffect(() => {
    // 1. Restore user identity from cache.
    AsyncStorage.getItem('user')
      .then((u) => {
        if (u) {
          try {
            setUser(JSON.parse(u));
          } catch {
            setUser(null);
          }
        }
      })
      .catch(() => {});

    // Sequenced cache restore → refreshToday (#287 prod fix).
    //
    // Previously this was fire-and-forget. AsyncStorage.getItem() raced
    // refreshToday(); whichever resolved first won setToday. On a
    // post-crash relaunch with a warm backend, the API response often
    // beat the cache — server returned checkIn: null (race with the
    // POST's DB write OR a different timezone day on the server) and
    // the optimistic-merge had no prev state to fall back on → button
    // showed "Check In" again for several minutes.
    //
    // New shape: AWAIT the cache, paint it synchronously, THEN call
    // refreshToday. The merge in refreshToday now ALWAYS has a real
    // prev.checkIn to fall back on if the server lies. Result: the
    // correct button shows within ~50 ms of launch and never flips back
    // until check-out actually happens.
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('erm-today-v1');
        if (!raw) return;
        const cached: TodayData = JSON.parse(raw);
        if (!cached?.checkIn) return;
        // Stale-day guard: only restore if the cached check-in is from today.
        const cachedDate = new Date(cached.checkIn).toDateString();
        const todayDate  = new Date().toDateString();
        if (cachedDate === todayDate) {
          setToday(cached);
        } else {
          await AsyncStorage.removeItem('erm-today-v1').catch(() => {});
        }
      } catch {/* malformed cache — ignore */}
    })();

    // Fire-and-forget backend warm-up. Render free-tier sleeps after 15
    // minutes idle; if the user opens the app after lunch / overnight
    // the first request would otherwise cold-start. By pinging /health
    // the moment the home screen mounts, the backend is awake by the
    // time the user taps Check In. Silent — failures don't surface.
    wakeBackend();

    // Last-crash sniffer (#282). If the previous session terminated via
    // the persistent crash log (ErrorUtils handler / Hermes rejection
    // tracker / render-tree error), surface it ONCE to the console so
    // a developer can read it via adb logcat, then clear the key. This
    // is silent for the user — no scary modal — but turns "the app
    // exited and we have no idea why" into "we have the stack trace."
    AsyncStorage.getItem('erm-last-crash-v1').then((raw) => {
      if (raw) {
        console.warn('[last-session-crash]', raw);
        AsyncStorage.removeItem('erm-last-crash-v1').catch(() => {});
      }
    }).catch(() => {});

    // Fix J: batch all three data loads so they complete together and
    // trigger ONE combined re-render instead of three separate ones.
    // Previously each resolved independently → three render cycles on
    // mount, visible as a multi-frame flash (the "flickering" on open).
    Promise.all([
      refreshToday(),
      refreshAnnouncements(),
      refreshUnread(),
    ]).catch(() => {});
    // NOTE: the 1-second clock is now owned by <LiveClock> (fix G).
    // No setInterval or cleanup needed here.
  }, [refreshToday, refreshAnnouncements, refreshUnread]);

  // Also re-ping on AppState 'active' — covers the "phone was locked
  // for hours, user unlocks straight to the already-running app" path.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') wakeBackend();
    });
    return () => sub?.remove?.();
  }, []);

  // Fix J: batch focus re-poll — all data refreshes fire together so
  // the tab-switch produces ONE re-render instead of three sequential ones.
  // #296: announcements were NOT being refreshed on focus, so a new HRMS
  // post wouldn't appear on the home until the user fully restarted the
  // app. Adding refreshAnnouncements() here makes the dashboard widget
  // pick up new HR posts as soon as the user returns to the Home tab.
  useFocusEffect(
    useCallback(() => {
      Promise.all([
        refreshUnread(),
        refreshToday(),
        refreshAnnouncements(),
      ]).catch(() => {});
    }, [refreshUnread, refreshToday, refreshAnnouncements])
  );

  // formatLiveTime is still used inside check-in/out result modal
  // to capture the exact moment of the action. It reads the current
  // time once (not from state) so it is safe even after the 1-second
  // interval was moved to LiveClock.
  const formatLiveTime = (d: Date) => {
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const seconds = d.getSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 === 0 ? 12 : hours % 12;
    return (
      String(h).padStart(2, '0') + ':' +
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0') + ' ' + ampm
    );
  };

  const formatHourMin = (iso?: string | null) => {
    if (!iso) return '--:--';
    try {
      const d = new Date(iso);
      const hours = d.getHours();
      const minutes = d.getMinutes();
      // #306 — uppercase AM/PM to match the rest of the app (the live
      // clock above already uses uppercase, so the check-in / check-out
      // times next to it shouldn't read "08:30 Pm" / "09:15 Am").
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const h = hours % 12 === 0 ? 12 : hours % 12;
      return String(h).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ' ' + ampm;
    } catch {
      return '--:--';
    }
  };

  // Fix G: computeWorkedHours now reads nowRef.current (updated by
  // LiveClock every second via the shared ref) so the timer still ticks
  // without triggering a HomeScreen re-render.
  const computeWorkedHours = (): string => {
    if (!today.checkIn) return '00:00';
    const start = new Date(today.checkIn).getTime();
    const end = today.checkOut ? new Date(today.checkOut).getTime() : nowRef.current.getTime();
    if (end <= start) return '00:00';
    const totalMin = Math.floor((end - start) / 60000);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  };

  const formatRelative = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      const days = Math.floor(hrs / 24);
      return days + 'd ago';
    } catch {
      return '';
    }
  };

  /**
   * Verify mobile location services + permission BEFORE allowing check-in.
   *
   * Order of checks:
   *   1. Are device location services ON? (system-level toggle)
   *   2. Has the app been granted foreground location permission?
   *   3. Can we actually obtain a fix?
   *
   * Returns true on success, false on any failure (alert already shown).
   * Check-OUT does NOT call this — the user can leave the building without
   * GPS, and we don't want to trap them in a checked-in state.
   */
  /**
   * Verify GPS + permission AND obtain a location fix. Returns the coords
   * on success (so the caller can send them to checkin), or null on any
   * failure (alert already shown to the user).
   */
  const ensureLocationOn = async (): Promise<{
    lat: number; lng: number; accuracy?: number;
  } | null> => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert(
          'Turn on Location',
          'Location services are OFF on your device. Please enable Location (GPS) in your phone settings and try again — check-in is not allowed without it.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
        return null;
      }
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }
      if (status !== 'granted') {
        Alert.alert(
          'Location permission required',
          'Tesco ERM needs location access to record your check-in.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
        return null;
      }
      // FAST PATH (Jun 2026 — speed-up #276, tightened #310 for accuracy).
      // Strategy: prefer a HIGH-quality fresh GPS fix; only fall back to
      // a cached fix if it's both very recent AND already at GPS-grade
      // accuracy. The previous version accepted a 60-second-old fix at
      // 100-metre accuracy — that's why HR saw check-in markers up to
      // 100 m away from the employee's actual location.
      //
      // New ordering:
      //   1. CACHED fix — only if ≤ 20 s old AND ≤ 30 m accuracy.
      //   2. FRESH fix — Location.Accuracy.Highest (pure GPS), 4-s deadline.
      //      Highest gives ~5-15 m accuracy outdoors vs Balanced's
      //      ~50-100 m. The slight extra latency (1.5 s) is well worth
      //      the precision for the office-radius geofence to work.
      //   3. If both fail, submit check-in WITHOUT coords — the backend
      //      will record office attendance using the employee's profile
      //      default. Better to let the user clock in than make them
      //      stare at a spinner.
      const fastFix = await Promise.race<Location.LocationObject | null>([
        Location.getLastKnownPositionAsync({ maxAge: 20 * 1000, requiredAccuracy: 30 }).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 600)),
      ]);
      if (fastFix && typeof fastFix.coords.accuracy === 'number' && fastFix.coords.accuracy <= 30) {
        return {
          lat: fastFix.coords.latitude,
          lng: fastFix.coords.longitude,
          accuracy: fastFix.coords.accuracy ?? undefined,
        };
      }
      const fresh = await Promise.race<Location.LocationObject | null>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
      if (fresh) {
        return {
          lat: fresh.coords.latitude,
          lng: fresh.coords.longitude,
          accuracy: fresh.coords.accuracy ?? undefined,
        };
      }
      // No fix in time — proceed without coords. Mark "ok but no coords"
      // so the caller still proceeds (returning null here would cancel
      // the check-in, which is worse than checking in without GPS).
      return { lat: undefined as any, lng: undefined as any, accuracy: undefined };
    } catch (err: any) {
      Alert.alert(
        'Could not read location',
        'Make sure GPS is on and you have a clear view of the sky, then try again.\n\n(' +
          (err?.message || 'unknown') + ')'
      );
      return null;
    }
  };

  // ─── Live location tracking while checked in ──────────────────────
  // TWO timers:
  //   pingTimer   — every 2 min, sends a full location ping to the backend
  //   gpsWatcher  — every 30 sec, checks if GPS is still on; if it just
  //                 flipped off we WARN the user (instead of auto-checking
  //                 them out) and mark their presence as 'idle' on the
  //                 server so HRMS Live Tracking can show "Location off".
  //                 Pings simply pause; the moment GPS comes back on we
  //                 resume and tell the server they're 'active' again.
  // Also: AppState listener re-verifies the moment the app comes back to
  // foreground (covers the "open Settings, toggle GPS, return to app"
  // case).
  const pingTimerRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsWatcherRef   = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // The guardian timer re-checks every 60 sec whether the OS background
  // task is still actually running. OEM battery savers (Xiaomi MIUI, Oppo
  // ColorOS, Vivo FunTouch, Realme, OnePlus) routinely kill the foreground
  // service even though we asked the OS to keep it alive — when that
  // happens, hasStartedLocationUpdatesAsync flips to false and we have
  // to call startLocationUpdatesAsync again to bring the task back. Without
  // this loop, OEM-killed tasks stay dead until the user opens the app.
  const bgGuardianRef   = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether we've already warned the user this GPS-off episode so
  // we don't spam them with an alert every 30 seconds.
  const gpsOffWarnedRef = React.useRef(false);

  // #374 — Clears ONLY the JS foreground timers. Does NOT touch the OS-level
  // background location task. The BG task must survive foreground remounts,
  // startTracking() re-invocations, and any transient state re-renders —
  // otherwise the OS teardown+restart introduces a 1-2 second gap in the
  // ping stream every time. The BG task is stopped in exactly ONE place:
  // stopContinuousTracking() below, which is called only at check-out.
  const stopTracking = () => {
    if (pingTimerRef.current)  { clearInterval(pingTimerRef.current);  pingTimerRef.current  = null; }
    if (gpsWatcherRef.current) { clearInterval(gpsWatcherRef.current); gpsWatcherRef.current = null; }
    if (bgGuardianRef.current) { clearInterval(bgGuardianRef.current); bgGuardianRef.current = null; }
    gpsOffWarnedRef.current = false;
    console.log('[tracking] fg timers cleared (bg task untouched)');
  };

  // #374 — Full teardown for check-out / logout / auto-checkout. Clears FG
  // timers AND stops the OS BG task. This is the ONLY entry point that
  // stops the background location service.
  const stopContinuousTracking = (reason: string) => {
    stopTracking();
    stopBackgroundLocationUpdates('checkout: ' + reason).catch(() => {});
    console.log('[tracking] continuous tracking fully stopped (' + reason + ')');
  };

  /**
   * Mid-shift GPS turned off. The user is STILL checked in — we just stop
   * sending pings until they re-enable it. Show a single prompt to nudge
   * them, and mark their presence as "offline" on the backend so the HRMS
   * Live Tracking page flips to "Offline" immediately on the next 45 sec
   * poll (no 25-min grace window).
   *
   * Policy change (Jun 2026, HR request): the moment device location goes
   * off, the row goes Offline. No "Location off / Idle" middle state —
   * HR didn't want the ambiguous yellow status, only the clear red one.
   * When the user re-enables GPS, the next ping flips them back to
   * 'active' / 'office' / 'travelling' automatically.
   */
  const handleGpsOffWarn = async () => {
    try { await attendanceAPI.setPresence('offline'); } catch {}
    if (gpsOffWarnedRef.current) return;
    gpsOffWarnedRef.current = true;
    Alert.alert(
      'Turn on Location',
      'Live tracking is paused — your phone Location is OFF. You are still checked in. ' +
      'Please turn Location ON so HR can see your live status. Tracking will resume automatically.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
      ]
    );
  };

  const startTracking = () => {
    stopTracking();   // never double-up

    // NOTE (Jun 2026 — Fix 3): startBackgroundLocationUpdates() is NO
    // LONGER called here. It is called once in handleCheckPress AFTER
    // the success modal is shown, so the native permission dialog fires
    // at the right UX moment. startTracking() only manages the
    // FOREGROUND timers. Calling startBackgroundLocationUpdates() here
    // caused a double-call (once in handleCheckPress, once here) which
    // raced the background permission dialog on some devices.

    // #374 production polish — the OS-scheduled expo-location background
    // task is the PRIMARY source of pings (every 2 min while the app is
    // in ANY state). This foreground timer is a fallback: it fires every
    // 3 minutes and only sends a ping if the native task appears dead.
    // On healthy devices the FG timer never actually POSTs — the native
    // task has always beaten it. Net effect: zero wasted HTTP on healthy
    // devices, guaranteed 2-min cadence on unhealthy ones.
    const PING_MS = 3 * 60 * 1000;   // 3 minutes — fallback cadence (fires only if native task dead)
    const WATCH_MS = 30 * 1000;      // 30 seconds — fast GPS-on/off check

    const ping = async (isImmediate = false) => {
      try {
        // #374 — Fallback gate. If this is a scheduled tick (not the
        // check-in immediate ping), only fire if the native background
        // task is not running. On healthy devices the OS task handles
        // every scheduled ping; FG timer is a hot backup.
        if (!isImmediate) {
          const taskAlive = await Location
            .hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
            .catch(() => false);
          if (taskAlive) {
            // Native task is delivering — skip the redundant FG ping.
            return;
          }
        }
        const servicesOn = await Location.hasServicesEnabledAsync();
        if (!servicesOn) { await handleGpsOffWarn(); return; }

        // Get a fix. Use HIGHEST accuracy (pure GPS) so the reported
        // accuracy radius is small enough to pass our 30 m gate. The old
        // 'Balanced' setting mixed in Wi-Fi/cell-tower triangulation with
        // ±50–80 m error, which made every foreground ping drift on the
        // map. Indoor / urban-canyon worst case still falls back to
        // last-known if Highest takes too long.
        let fix: Location.LocationObject | null = null;
        try {
          fix = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
          ]) as Location.LocationObject | null;
        } catch { fix = null; }
        if (!fix) {
          // Fallback — accept a cached fix up to 5 minutes old, but
          // require it to already be at least 50m accurate (anything
          // coarser would just get rejected by the filter anyway).
          fix = await Location.getLastKnownPositionAsync({
            maxAge: 5 * 60 * 1000,
            requiredAccuracy: 50,
          }).catch(() => null);
        }
        if (!fix) {
          console.warn('[tracking] no fix available this cycle — skipping ping');
          return;
        }

        // Apply the shared anti-jitter filter. Returns null if the fix
        // is too coarse to send; otherwise returns either the held anchor
        // (stationary) or a confirmed-move position.
        const filtered = await filterFix({
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracy: fix.coords.accuracy ?? undefined,
          speed:    fix.coords.speed    ?? undefined,
        });
        if (!filtered) {
          console.log('[tracking] fix dropped by jitter filter — skip');
          return;
        }

        await attendanceAPI.locationPing(
          filtered.lat,
          filtered.lng,
          filtered.accuracy ?? undefined,
          filtered.speed    ?? undefined,
          filtered.isStationary,
        );
        // GPS came back on after being off — clear the warning latch so the
        // next disable-event can show the prompt again, and flip presence
        // back to active.
        if (gpsOffWarnedRef.current) {
          gpsOffWarnedRef.current = false;
          attendanceAPI.setPresence('active').catch(() => {});
        }
        console.log(
          '[tracking] ✔ ping',
          filtered.lat.toFixed(5), filtered.lng.toFixed(5),
          filtered.isStationary ? '(STATIONARY)' : '(MOVING)',
        );
      } catch (err: any) {
        console.warn('[tracking] ping failed:', err?.message || err);
      }
    };

    const watchGps = async () => {
      try {
        // Permission check first (Jun 2026 — Requirement #6).
        // If the user revoked location permission in Settings (or never
        // granted it), `hasServicesEnabledAsync` can still return true
        // because device location is on — but our app can't read it.
        // Treat permission-denied as GPS-off so HR sees them as Offline,
        // and re-arm the bg task the moment permission is granted.
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          await handleGpsOffWarn();
          return;
        }
        const on = await Location.hasServicesEnabledAsync();
        if (!on) {
          await handleGpsOffWarn();
          return;
        }
        // GPS is on AND permission is granted. Three recovery paths
        // converge here:
        //   1. User toggled GPS back on after turning it off mid-shift.
        //   2. User just granted location permission they had revoked.
        //   3. Bg task got killed by an OEM battery saver while offscreen.
        // Safe move: send a fresh ping AND make sure the OS task is
        // alive again. startBackgroundLocationUpdates is idempotent —
        // if the task is already running it's a no-op.
        if (gpsOffWarnedRef.current) {
          gpsOffWarnedRef.current = false;
          ping();                                                // fresh ping
          startBackgroundLocationUpdates().catch(() => {});      // re-arm OS task
          attendanceAPI.setPresence('active').catch(() => {});   // flip Offline→Online on HR's map
        }
      } catch (err: any) {
        console.warn('[tracking] gpsWatcher error:', err?.message || err);
      }
    };

    // Guardian: every 60 sec while foreground is alive, verify the OS
    // background task is still registered + running. If the task was
    // killed (OEM battery saver, force-stop from settings, system OOM,
    // etc.) the call to hasStartedLocationUpdatesAsync returns false —
    // and we silently restart it so HRMS doesn't see a stale-pings gap.
    // This is the single biggest reliability win on Xiaomi/Oppo/Vivo
    // phones, where the foreground service can be killed even with the
    // app whitelisted.
    const guardian = async () => {
      try {
        const on = await Location.hasServicesEnabledAsync();
        if (!on) return;   // GPS off — handled by watchGps + handleGpsOffWarn

        // Layer 1: does the OS think the task is registered?
        const taskAlive = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);

        // Layer 2: heartbeat freshness. Even when the OS REPORTS the
        // task as registered, OEM battery savers (MIUI/ColorOS/etc.)
        // can SIGKILL the foreground service so the task callback
        // never fires. The heartbeat is the only ground truth that
        // says "yes, ticks are actually arriving." If heartbeat is
        // stale (> 3 min for a 60-s interval) we know the OS is lying
        // about the task being alive — force a hard revive.
        const stale = await isHeartbeatStale();

        if (!taskAlive) {
          console.warn('[tracking] bg task not registered — reviving');
          await reviveBackgroundLocationUpdates('guardian: !taskAlive');
        } else if (stale) {
          console.warn('[tracking] bg task is zombie (heartbeat stale) — reviving');
          await reviveBackgroundLocationUpdates('guardian: heartbeat stale');
        }
      } catch (err: any) {
        console.warn('[tracking] guardian error:', err?.message || err);
      }
    };

    // Fix 4: Wrap the immediate ping() and guardian() calls so a one-time
    // GPS startup error (seen on Samsung/Realme when the location chip is
    // still initialising right after check-in) doesn't escape startTracking()
    // and crash the handleCheckPress finally block. The scheduled intervals
    // below still run on time — a single failed warm-up ping is irrelevant.
    // #374 — Immediate ping at check-in: pass `true` so it bypasses the
    // task-alive gate. This is the ONLY ping we want to fire on the
    // foreground path unconditionally — everything else is fallback.
    try { ping(true).catch((e) => console.warn('[tracking] ping warm-up rejection:', e?.message || e)); }
    catch (e: any) { console.warn('[tracking] initial ping failed:', e?.message || e); }
    try { guardian().catch((e) => console.warn('[tracking] guardian warm-up rejection:', e?.message || e)); }
    catch (e: any) { console.warn('[tracking] initial guardian failed:', e?.message || e); }

    // ════════════════════════════════════════════════════════════════
    // CRITICAL (#287 prod fix): setInterval does NOT await the async
    // callback's return value. If ping/watchGps/guardian reject, the
    // unhandled rejection bubbles to Hermes and can SIGTERM the app —
    // exactly 30 seconds after check-in when these timers first fire.
    // The user-reported "app exits 20-30 sec after check-in" matched
    // this timing perfectly. Each callback is now wrapped so any
    // rejection is swallowed locally — the timer keeps running, the
    // app stays up, and the next tick proceeds normally.
    // ════════════════════════════════════════════════════════════════
    const safe = (fn: () => Promise<any>, label: string) => () => {
      try {
        const p = fn();
        if (p && typeof (p as any).catch === 'function') {
          (p as Promise<any>).catch((e) => {
            console.warn('[tracking]', label, 'tick rejected:', e?.message || e);
          });
        }
      } catch (e: any) {
        console.warn('[tracking]', label, 'tick threw:', e?.message || e);
      }
    };

    pingTimerRef.current  = setInterval(safe(ping,     'ping'),     PING_MS);
    gpsWatcherRef.current = setInterval(safe(watchGps, 'watchGps'), WATCH_MS);
    // #315 — Cadence tightened 30 → 15 s. The guardian's only job is to
    // detect "bg task died" and re-arm it. With Android OEM battery
    // savers (MIUI/ColorOS/RealmeUI/etc.) able to SIGKILL the
    // foreground service at any moment, halving the detection window
    // halves the worst-case "tracking off" gap a user can experience
    // — 30 s instead of 60 s — at a negligible battery cost since the
    // body is mostly a 1-call hasStartedLocationUpdatesAsync().
    bgGuardianRef.current = setInterval(safe(guardian, 'guardian'), 15 * 1000);
    console.log('[tracking] started (ping 2 min, gpsWatcher 30s, bgGuardian 30s) — wrapped against unhandled rejections');
  };

  // #374 — Component unmount (logout / navigation out of tabs). Full
  // teardown: FG timers + OS BG task. If the user was still checked in,
  // they'll need to re-check-in on next login, so stopping the BG task
  // here is correct — no orphaned service after logout.
  useEffect(() => () => stopContinuousTracking('component unmount'), []);

  // If the user is already checked-in when the home screen mounts (e.g.
  // they killed the app and re-opened it later), resume the loop.
  useEffect(() => {
    if (checkedIn && !checkedOut && !pingTimerRef.current) {
      startTracking();
    }
    if ((!checkedIn || checkedOut) && pingTimerRef.current) {
      // #374 — Full teardown when the session ends via state change
      // (checked-out flag flipped, or logout). Both FG timers and OS BG
      // task stop here — the only other place is user check-out tap.
      stopContinuousTracking('session state change');
    }
  }, [checkedIn, checkedOut]);

  // AppState listener — fires on every foreground/background transition.
  //
  // On going BACKGROUND:
  //   • Send one final foreground ping right now, so the backend's
  //     "stale ping" clock starts from this exact moment. Without it
  //     the user appeared Offline as soon as the foreground 2-minute
  //     interval missed a tick + the backend's 20-minute stale window
  //     elapsed. With it, the user has up to 20 minutes of credit even
  //     if the background task is throttled by the OS.
  //   • Make sure the background location task is running so OS-driven
  //     pings keep flowing while the app is offscreen.
  //   • Do NOT touch presence — leaving the app does not mean GPS is off.
  //
  // On returning to FOREGROUND:
  //   • Re-check if GPS is on; warn if it's been toggled off.
  //   • Restart the foreground ping loop if it got cleared.
  // Fix H (Jun 2026 — AppState listener recreation crash).
  //
  // The original effect had `[checkedIn, checkedOut]` as its dep array.
  // During a check-in both values flip in quick succession, so the effect
  // unmounted and remounted twice — briefly leaving NO AppState listener
  // and causing a stale closure to call setState after the component had
  // moved on. We now read the latest values through refs so the effect can
  // safely use an empty dep array (mount/unmount only).
  const checkedInRef  = useRef(checkedIn);
  const checkedOutRef = useRef(checkedOut);
  useEffect(() => { checkedInRef.current  = checkedIn;  }, [checkedIn]);
  useEffect(() => { checkedOutRef.current = checkedOut; }, [checkedOut]);

  // #299 — mounted ref. The AppState callback below is async and can
  // resolve LONG after the HomeScreen has unmounted (e.g. user logged
  // out while a Location.getCurrentPositionAsync race was still pending
  // its 8 s timeout). Without this gate the callback's final setState /
  // attendanceAPI.setPresence calls happen against a torn-down component,
  // and Hermes on Android 9/10 has been observed to SIGTERM the bridge.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      // #299 — bail immediately if the component has been unmounted in
      // the interval between the AppState event firing and this async
      // callback being scheduled by the JS runtime.
      if (!mountedRef.current) return;

      // Read live values from refs — safe even though the dep array is [].
      const isCheckedIn  = checkedInRef.current;
      const isCheckedOut = checkedOutRef.current;

      // Only relevant while we should be tracking.
      if (!isCheckedIn || isCheckedOut) return;

      if (state === 'background' || state === 'inactive') {
        // Final foreground ping — gives the backend a fresh timestamp to
        // measure staleness from. Also make sure the OS-level task is
        // alive so pings keep flowing while we're gone.
        try {
          const on = await Location.hasServicesEnabledAsync();
          if (on) {
            // Fix C: hard 8-second timeout on GPS — prevents the Highest
            // accuracy request from hanging indefinitely when the phone's
            // GPS chip is cold (seen on Samsung/Xiaomi). Without the race,
            // the async callback keeps a stale closure alive for minutes
            // and then tries to call setState on an unmounted component.
            const fix = await Promise.race<Location.LocationObject | null>([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
              new Promise<null>((r) => setTimeout(() => r(null), 8000)),
            ]);
            if (fix) {
              const filtered = await filterFix({
                lat: fix.coords.latitude,
                lng: fix.coords.longitude,
                accuracy: fix.coords.accuracy ?? undefined,
                speed:    fix.coords.speed    ?? undefined,
              });
              if (filtered) {
                await attendanceAPI.locationPing(
                  filtered.lat,
                  filtered.lng,
                  filtered.accuracy ?? undefined,
                  filtered.speed    ?? undefined,
                  filtered.isStationary,
                );
              }
            }
            // Belt-and-braces: make sure the bg task is still active.
            startBackgroundLocationUpdates().catch(() => {});
            console.log('[tracking] AppState → background, sent final ping');
          }
        } catch (err: any) {
          console.warn('[tracking] AppState background ping failed:', err?.message || err);
        }
        return;
      }

      if (state === 'active') {
        try {
          const on = await Location.hasServicesEnabledAsync();
          if (!on) {
            await handleGpsOffWarn();
          } else {
            // App is back foreground with GPS on. Three things to do:
            //   1. If our foreground intervals were cleared (cold-start
            //      after force-kill), restart them.
            //   2. Re-arm the OS background task — on aggressive OEMs it
            //      may have died while we were offscreen.
            //   3. Send a fresh ping so HRMS sees us active immediately,
            //      without waiting another 2 minutes.
            if (!pingTimerRef.current) {
              startTracking();
            } else {
              // #315 — ALWAYS revive on foreground resume, don't gate on
              // heartbeat staleness. Previously we'd only fully tear-down
              // and restart when isHeartbeatStale() returned true, which
              // missed the case where the OS killed the foreground
              // service silently but Location.hasStartedLocationUpdatesAsync
              // still reported it as running (the "zombie task" pattern).
              // reviveBackgroundLocationUpdates() is idempotent — if the
              // task is genuinely alive, the stop is a no-op and the start
              // is also a no-op (expo-location's internal check). If it's
              // a zombie, this clean stops + restarts it. Net cost: one
              // extra round-trip to the native module on each foreground
              // resume — negligible vs. the cost of a user discovering
              // mid-shift that tracking died hours ago.
              await reviveBackgroundLocationUpdates('AppState→active: unconditional re-arm').catch(() => {});
              try {
                // Fix C: 8-second timeout on foreground-resume GPS fix too.
                const fix = await Promise.race<Location.LocationObject | null>([
                  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
                  new Promise<null>((r) => setTimeout(() => r(null), 8000)),
                ]);
                if (fix) {
                  const filtered = await filterFix({
                    lat: fix.coords.latitude,
                    lng: fix.coords.longitude,
                    accuracy: fix.coords.accuracy ?? undefined,
                    speed:    fix.coords.speed    ?? undefined,
                  });
                  if (filtered) {
                    await attendanceAPI.locationPing(
                      filtered.lat,
                      filtered.lng,
                      filtered.accuracy ?? undefined,
                      filtered.speed    ?? undefined,
                      filtered.isStationary,
                    );
                  }
                  await attendanceAPI.setPresence('active').catch(() => {});
                }
              } catch { /* best-effort */ }
            }
          }
        } catch (err: any) {
          console.warn('[tracking] AppState re-check failed:', err?.message || err);
        }
      }
    });
    return () => sub.remove();
  // Fix H: empty dep array — listener is registered once (mount) and
  // torn down once (unmount). State is read via refs above.
  }, []);


  // Locks the button while a check-in/out is in flight. Without this,
  // a quick double-tap fired two parallel checkIn requests, the second
  // got "Already checked in" and the user saw the success modal flicker
  // then the error toast — confusing, looked like the button was broken.
  const [actionBusy, setActionBusy] = useState(false);

  // Wrap any promise that could hang (GPS fix, permission prompt that the
  // user never answered, slow Render cold-start) in a hard time-out. If
  // it doesn't resolve in `ms` we reject — handleCheckPress's catch then
  // surfaces a friendly error and `finally` releases the actionBusy lock
  // so the user can tap again. Without this guard the GPS chain could
  // silently sit forever, leaving the button frozen in "Please wait..."
  // — which is exactly what users described as "button not working".
  const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race<T>([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`${label} timed out — please try again`)), ms)
      ),
    ]);

  const handleCheckPress = async () => {
    if (actionBusy) return;
    // #340 — Capture intent NOW so the loader's copy/color stays stable
    // even after the optimistic setToday(checkOut=null) fires during
    // Check In Again. Fresh check-in and resume both count as 'in'.
    const wantsCheckInAtTap = !checkedIn || (checkedIn && checkedOut);
    setPendingKind(wantsCheckInAtTap ? 'in' : 'out');
    setActionBusy(true);
    try {
      // #336 Resume Work — an employee who has already checked out
      // (checkedIn && checkedOut) taps this button to start a new
      // session. The backend's /checkin endpoint detects the closed
      // session on the same-day row and treats it as a resume: it
      // does NOT create a new attendance record, does NOT reset the
      // accumulated timer, and does NOT re-evaluate late/on-time.
      // On the client, the loader / success modal / tracking side
      // effects reuse the check-in path, so this collapses cleanly
      // into the existing `!checkedIn` branch.
      const wantsCheckIn = !checkedIn || (checkedIn && checkedOut);
      // #339 — When the user's intent is Resume (Check In Again), mark
      // the moment so refreshToday keeps the "back to working" state
      // for 30 s even if the server response is stale.
      if (wantsCheckIn && checkedIn && checkedOut) {
        resumeAtRef.current = Date.now();
      }
      if (wantsCheckIn) {
        // ── STEP 1: Get a GPS fix.
        //
        // Fix B (Jun 2026): REMOVED the outer withTimeout() wrapper.
        // ensureLocationOn() already has its own internal races:
        //   • 1s  race for a cached last-known fix
        //   • 2.5s race for a fresh balanced fix
        // Wrapping it in an ADDITIONAL 6s timeout created a bug where
        // the outer timeout could fire, run the `finally` block and
        // release actionBusy, and THEN the inner promise settled and
        // tried to call setToday() on a component that had already
        // moved on — causing a cascade that crashed the JS engine on
        // some devices. Call ensureLocationOn() directly; it is already
        // self-bounded and self-healing.
        const coords = await ensureLocationOn();
        if (!coords) return;

        // ═══════════════════════════════════════════════════════════════
        // CHECK-IN ATOMIC CORE (#282 prod fix — Jun 2026)
        //
        // The ONLY thing that must succeed inside the inner try is the
        // checkIn API call itself. Everything after — presence flag,
        // anchor reset, diagnostics reset, battery prompt, tracking
        // start — was previously chained linearly, so a single failure
        // anywhere in the chain (e.g. expo-intent-launcher native crash
        // during the battery prompt) tore down the app BEFORE the
        // success modal rendered. The user saw their check-in saved on
        // HRMS but their app vanished.
        //
        // Fix D (Jun 2026): startBackgroundLocationUpdates() has been
        // moved OUT of this critical path and into a non-blocking
        // side-effect AFTER the success modal is shown. Previously it
        // was awaited BEFORE the API call — if the permission dialog
        // took too long (> withTimeout limit) the check-in was silently
        // cancelled and the user got an error toast instead of success.
        // ═══════════════════════════════════════════════════════════════
        const checkInResp = await attendanceAPI.checkIn(today.location || 'office', coords);
        // #346 — Stamp resume window on every successful check-in so the
        // next refreshToday poll can't wipe our fresh checkIn with a
        // stale row the old backend still has cached.
        resumeAtRef.current = Date.now();

        // ── (a) OPTIMISTIC LOCAL STATE — fixes the "button doesn't flip
        //         immediately" complaint. The button label is derived
        //         from `today.checkIn`; setting it locally NOW makes
        //         the UI flip the instant the API returns, instead of
        //         waiting for the round-trip refreshToday() call.
        //
        // FIX (Jun 2026 — stale closure bug):
        // MUST use functional update `setToday(prev => ...)` to avoid
        // capturing the stale `today` closure from the render when
        // handleCheckPress was called. The old code spread `...today`
        // which could have checkIn: null from the previous render,
        // losing the optimistic update on the next render cycle.
        // SAME FIX for AsyncStorage: capture via functional updater
        // pattern so we get the real previous state, not the closure.
        const nowIso = new Date().toISOString();
        const serverCheckIn = checkInResp?.data?.record?.checkIn || checkInResp?.data?.checkIn || nowIso;
        // #341 — Preserve firstCheckIn (day's very first arrival) so
        // the Check In tile stays stable across resume cycles while
        // today.checkIn advances to the current session start for the
        // running-time formula.
        const serverFirst =
          checkInResp?.data?.record?.firstCheckIn ||
          checkInResp?.data?.firstCheckIn ||
          null;
        let optimisticToday: TodayData = {};
        setToday(prev => {
          optimisticToday = {
            ...prev,
            checkIn: serverCheckIn,
            checkOut: null,
            firstCheckIn: serverFirst || prev.firstCheckIn || serverCheckIn,
            isOnBreak: false,
          };
          return optimisticToday;
        });
        // Persist immediately so a crash-restart restores Check-Out button.
        // We use a small delay so optimisticToday is set by the setState call above.
        setTimeout(() => {
          AsyncStorage.setItem('erm-today-v1', JSON.stringify(optimisticToday)).catch(() => {});
        }, 0);

        // ── (b) SUCCESS MODAL — fired AFTER the loader has had a frame
        //         to fade out (#299). Two transparent <Modal> components
        //         with animationType="fade" visible in the SAME render
        //         tick trigger an Android WindowManager z-order race on
        //         Android 9/10 that can SIGTERM the native bridge; the
        //         user sees the app vanish 200-400 ms after a successful
        //         check-in. Deferring this until the next macrotask lets
        //         the PremiumLoader's fade-out complete first.
        //
        //         Capture the time NOW (not inside the setTimeout) so the
        //         displayed time is the actual moment the user tapped,
        //         not 60 ms later.
        const checkInTime = formatLiveTime(new Date());
        setTimeout(() => {
          try { setCheckResult({ kind: 'in', time: checkInTime }); }
          catch (e: any) { console.warn('[handleCheckPress] setCheckResult failed:', e?.message || e); }
        }, 60);

        // ── (c) SIDE-EFFECTS — each in its own guard. None of these
        //         can prevent the success modal from showing or stop
        //         the user from interacting with the app.
        try { await attendanceAPI.setPresence('active'); } catch {}
        try { await resetGpsAnchor(); } catch {}
        try { await resetTrackingDiagnostics(); } catch {}

        // Start the foreground tracking timers first (no native dialogs,
        // no blocking ops — pure JS interval setup).
        try { startTracking(); } catch (e: any) {
          console.warn('[handleCheckPress] startTracking failed:', e?.message || e);
        }

        // FIX (Jun 2026 — Fix 5): startBackgroundLocationUpdates() and
        // battery prompt are now fully deferred via setTimeout(fn, 0).
        // This moves them OUT of the async chain entirely — they run
        // AFTER the `finally { setActionBusy(false) }` block completes,
        // AFTER the success modal is visible, and in a fresh macrotask
        // so any native exception they throw (permission dialog crash on
        // Android 12+) cannot propagate up to handleCheckPress and
        // cause an unhandled rejection that crashes the JS engine.
        // #299 — Belt-and-braces outer guard. setTimeout(async () => …)
        // returns a Promise that nothing awaits. If ANY uncaught rejection
        // escapes the inner try blocks (e.g. AsyncStorage I/O failure, an
        // Alert.alert callback throw, an OEM intent crash from
        // expo-intent-launcher on Android 13+), Hermes treats it as an
        // unhandled rejection on a SIGTERMable macrotask. We wrap the
        // whole function body in an IIFE-style try and attach an explicit
        // `.catch()` so the JS engine never sees a stray rejection.
        const deferredPostCheckin = async () => {
          try {
            const bgOk = await startBackgroundLocationUpdates();
            if (!bgOk) {
              Alert.alert(
                'Background location — optional',
                'For the best experience, go to Settings → Permissions → Location → "Allow all the time". ' +
                'Without it, HR may see you as "Offline" when the app is in the background.',
                [
                  { text: 'OK', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
                ]
              );
            }
          } catch (e: any) {
            console.warn('[handleCheckPress] startBackgroundLocationUpdates failed:', e?.message || e);
          }

          // One-time battery-optimization + Autostart prompts (#289).
          //
          // TWO STEPS — both are required for reliable tracking. Standard
          // battery-optimization exemption is the Android-defined toggle;
          // OEM Autostart is a SEPARATE permission gate added by Chinese
          // OEMs (Xiaomi/Oppo/Vivo/Realme/OnePlus). Without BOTH:
          //   • Battery exempt only → MIUI/ColorOS still kill the foreground
          //     service after 5 min via their own SecurityCenter daemon.
          //   • Autostart only → standard Android Doze suspends location.
          //
          // We chain the prompts so the user sees them in order. Each is
          // saved separately so a partial completion (user did one, not
          // the other) still resumes correctly on the next check-in.
          try {
            const askedBattery = await AsyncStorage.getItem('battery_exempt_asked');
            if (!askedBattery) {
              await AsyncStorage.setItem('battery_exempt_asked', '1');
              Alert.alert(
                'Keep tracking running (Step 1 of 2)',
                'Android battery savers can kill location updates while you\'re working. ' +
                'On the next screen, tap "Allow" to let Tesco ERM keep running in the background. ' +
                'Without this, HR may see you as "Offline" even when your location is on.',
                [
                  { text: 'Maybe later', style: 'cancel' },
                  {
                    text: 'Open settings',
                    onPress: () => { requestBatteryOptimizationExemption().catch(() => {}); },
                  },
                ]
              );
            }
          } catch {/* best-effort — must not crash check-in */}

          // Step 2: OEM-specific Autostart prompt. ONLY surfaces on
          // OEMs known to require this (Xiaomi/Oppo/Vivo/Realme/OnePlus/
          // Samsung). Stock Android, Pixel, Motorola etc. won't see it.
          try {
            const oemLabel = getOemLabel();
            const isOemWithAutostart =
              oemLabel.includes('Xiaomi') || oemLabel.includes('Oppo') ||
              oemLabel.includes('Vivo')   || oemLabel.includes('Realme') ||
              oemLabel.includes('OnePlus')|| oemLabel.includes('Samsung');
            const askedAutostart = await AsyncStorage.getItem('autostart_asked');
            if (isOemWithAutostart && !askedAutostart) {
              await AsyncStorage.setItem('autostart_asked', '1');
              Alert.alert(
                'Enable Autostart (Step 2 of 2)',
                `${oemLabel} phones need a separate "Autostart" permission for ` +
                `live tracking to keep running while the app is in the background.\n\n` +
                `Open the settings, find "Tesco ERM" in the list, and turn the ` +
                `toggle ON.\n\nQuick path: ${getOemAutostartHint()}`,
                [
                  { text: 'Skip', style: 'cancel' },
                  {
                    text: 'Open settings',
                    onPress: () => { openOemAutostartSettings().catch(() => {}); },
                  },
                ]
              );
            }
          } catch {/* best-effort */}
        };
        setTimeout(() => {
          // #299: bare setTimeout cannot await, so we must attach a
          // .catch() on the returned promise. Without this an inner
          // throw escapes the function and lands on the Hermes
          // unhandled-rejection tracker — which on a non-tracked build
          // SIGTERMs the app a few hundred ms later. The user sees an
          // unexpected exit immediately after a successful check-in.
          deferredPostCheckin().catch((e) => {
            console.warn('[handleCheckPress] deferred post-checkin rejected:', (e as any)?.message || e);
          });
        }, 0);

      } else if (!checkedOut) {
        // Manual check-out doesn't require GPS, but if it's currently on
        // we capture the spot too so the Attendance row has both
        // (checkInLat, checkInLng) AND (checkOutLat, checkOutLng). Failing
        // to grab a fix is fine — we still complete the checkout.
        let outCoords: { lat: number; lng: number; accuracy?: number } | undefined;
        try {
          const servicesOn = await Location.hasServicesEnabledAsync();
          if (servicesOn) {
            const { status } = await Location.getForegroundPermissionsAsync();
            if (status === 'granted') {
              // #310 — checkout coords now use Location.Accuracy.Highest
              // for the same reason as check-in: HR sees a marker that
              // matches the employee's actual exit point instead of a
              // Wi-Fi-triangulated approximation. 8-s deadline kept so
              // a cold GPS chip can't hang the button indefinitely.
              const fix = await Promise.race<Location.LocationObject | null>([
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
                new Promise<null>((r) => setTimeout(() => r(null), 8000)),
              ]);
              if (fix) {
                outCoords = {
                  lat:      fix.coords.latitude,
                  lng:      fix.coords.longitude,
                  accuracy: fix.coords.accuracy ?? undefined,
                };
              }
            }
          }
        } catch {/* best-effort, ignore */}
        const checkOutResp = await attendanceAPI.checkOut(outCoords);
        // #340 — user just did an authoritative Check Out, so end the
        // #339 resume-window guard: refreshToday should trust the
        // server's checkOut from here on so the button correctly
        // flips to "Check In Again" for the next cycle.
        resumeAtRef.current = 0;
        // Optimistic local state — flip "Check Out" → "Check In Again" instantly.
        // FIX (Jun 2026 — stale closure bug): use functional update
        // to capture prev state safely, not the stale `today` closure.
        //
        // #336 — On optimistic checkout, also fold the CURRENT session's
        // running seconds into accumulatedSeconds. Without this, the
        // Working HR's tile would visibly DROP (e.g. from 03:15 to
        // 03:00) at the instant of checkout, because LiveWorkedHours
        // stops ticking once checkOut is set and shows only the base
        // `accumulatedSeconds` — which the client's optimistic state
        // hadn't updated yet. Prefer the server's returned
        // accumulatedSeconds when present; otherwise compute the delta
        // locally from prev.checkIn + prev.accumulatedSeconds.
        const nowIsoOut = new Date().toISOString();
        const serverCheckOut = checkOutResp?.data?.checkOut || nowIsoOut;
        // Backend returns { message, record } — accumulatedSeconds lives
        // inside the record. Fall back to a bare top-level field just in
        // case a future middleware unwraps it.
        const serverAccum    = Number(
          checkOutResp?.data?.record?.accumulatedSeconds ??
          checkOutResp?.data?.accumulatedSeconds ?? 0
        );
        let optimisticTodayOut: TodayData = {};
        setToday(prev => {
          const startMs = prev.checkIn ? new Date(prev.checkIn).getTime() : NaN;
          const nowMs   = new Date(serverCheckOut).getTime();
          const currentSec = Number.isFinite(startMs) && nowMs > startMs
            ? Math.max(0, Math.round((nowMs - startMs) / 1000))
            : 0;
          const localAccum = Math.max(0, Number(prev.accumulatedSeconds || 0)) + currentSec;
          const finalAccum = Math.max(serverAccum, localAccum);
          optimisticTodayOut = {
            ...prev,
            checkOut: serverCheckOut,
            accumulatedSeconds: finalAccum,
            isOnBreak: true,
          };
          return optimisticTodayOut;
        });
        // Persist checkout state for crash-restart recovery.
        setTimeout(() => {
          AsyncStorage.setItem('erm-today-v1', JSON.stringify(optimisticTodayOut)).catch(() => {});
        }, 0);
        // Defer success modal one macrotask (#299) — see check-in branch
        // above for the full Android-modal-overlap rationale.
        const checkOutTime = formatLiveTime(new Date());
        setTimeout(() => {
          try { setCheckResult({ kind: 'out', time: checkOutTime }); }
          catch (e: any) { console.warn('[handleCheckPress] setCheckResult(out) failed:', e?.message || e); }
        }, 60);
        try { await attendanceAPI.setPresence('offline'); } catch {}
        // #374 — Full teardown: FG timers + OS BG task. Only place we
        // stop the OS background location service outside of auto-checkout.
        try { stopContinuousTracking('user check-out'); } catch (e: any) {
          console.warn('[handleCheckPress] stopContinuousTracking failed:', e?.message || e);
        }
      } else {
        const doneTime = formatLiveTime(new Date());
        setTimeout(() => {
          try { setCheckResult({ kind: 'done', time: doneTime }); }
          catch (e: any) { console.warn('[handleCheckPress] setCheckResult(done) failed:', e?.message || e); }
        }, 60);
      }
      // FIX (Jun 2026 — delayed sync): increased from 3s → 8s.
      // The optimistic state + AsyncStorage persist above are accurate.
      // Render free-tier cold-start takes 30-60s, but even a warm Render
      // instance can take 2-5s to commit a MongoDB write and make it
      // visible to a subsequent GET. 3s was too short — a GET at t+3s
      // would return stale data, the optimistic-state guard in refreshToday
      // now prevents it from wiping checkIn, but 8s is still a safer
      // margin so the first sync returns real data.
      setTimeout(() => refreshToday().catch(() => {}), 8000);
    } catch (err: any) {
      // #337 — "Already checked in today" / "Already checked out today"
      // is not really an error for the user. It shows up when the
      // (still-old) backend rejects a Resume Work re-checkin, or when
      // a duplicate tap slips through. Treat both as a silent
      // "server is already in the state you wanted" and just refetch.
      const msg = err?.response?.data?.message || err?.message || 'Could not record attendance';
      if (/already checked in/i.test(msg) || /already checked out/i.test(msg)) {
        // #339 — Old backend rejected the resume; still flip the local
        // UI so the user isn't stuck staring at the same "Check In
        // Again" button. Stamp resumeAtRef so refreshToday preserves
        // the optimistic state for 30 s.
        if (/already checked in/i.test(msg)) {
          // #341 — Old backend rejected the resume. Locally advance
          // checkIn to NOW so the timer's running-time formula measures
          // only the new session; keep firstCheckIn pinned so the
          // Check In tile still shows the day's original arrival.
          resumeAtRef.current = Date.now();
          const nowIso = new Date().toISOString();
          setToday(prev => ({
            ...prev,
            checkIn: nowIso,
            checkOut: null,
            isOnBreak: false,
            firstCheckIn: prev.firstCheckIn || prev.checkIn || nowIso,
          }));
        } else if (/already checked out/i.test(msg)) {
          // #340 — user tapped Check Out but old backend rejects because
          // its checkOut is already set from the previous cycle. Locally
          // we want the button to flip to "Check In Again", so end the
          // resume-window guard and roll the running session into the
          // accumulated total.
          resumeAtRef.current = 0;
          setToday(prev => {
            const startMs = prev.checkIn ? new Date(prev.checkIn).getTime() : NaN;
            const nowMs   = Date.now();
            const currentSec = Number.isFinite(startMs) && nowMs > startMs
              ? Math.max(0, Math.round((nowMs - startMs) / 1000))
              : 0;
            return {
              ...prev,
              checkOut: new Date().toISOString(),
              accumulatedSeconds: Number(prev.accumulatedSeconds || 0) + currentSec,
              isOnBreak: true,
            };
          });
        }
        try { await refreshToday(); } catch { /* keep going */ }
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setActionBusy(false);
      setPendingKind(null);
    }
  };

  // #338 Multi-session button label:
  //   • No open session and no closed session today → "Check In"
  //   • Currently working (checkIn set, checkOut null) → "Check Out"
  //   • On break (both checkIn AND checkOut set = last session closed
  //     but the workday isn't over) → "Check In Again"
  // The Resume state used to render "Done" and hide the tap area, so
  // an accidental checkout locked the employee out for the rest of the
  // day. Now they can tap once and pick right back up where they left
  // off — the timer keeps their accumulated total.
  const isOnBreak = checkedIn && checkedOut;
  const buttonLabel = !checkedIn
    ? 'Check In'
    : isOnBreak
      ? 'Check In Again'
      : 'Check Out';

  const greeting = (() => {
    const h = nowRef.current.getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    // After 8:00 PM (20:00) until midnight → Good Night.
    if (h >= 20) return 'Good Night';
    return 'Good Evening';
  })();

  const firstName =
    (user?.name && String(user.name).split(' ')[0]) || 'Vijay';

  return (
    // #377 — Per-screen boundary. Every OTHER tab already had this.
    // HomeScreen was unprotected — any render error here would bubble
    // to the RootErrorBoundary and tear down the ENTIRE app (killing
    // the GPS bg task, AppState listener, and auth session). Now a
    // single bad render is contained to this screen with a "Try again"
    // recovery card; the other tabs, tracking, and session stay alive.
    <ScreenErrorBoundary name="Home">
    <View style={styles.root}>
      {/* Solid green status bar so the safe-area strip never shows the
          page background through the translucent OS layer (caused the
          attCard to look like it was overlapping the device clock when
          the green header scrolled out of view). */}
      <StatusBar barStyle="light-content" backgroundColor={GREEN} translucent={false} />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* GREEN HEADER */}
          <View style={styles.greenHeader}>
            <View style={styles.topRow}>
              <TouchableOpacity
                style={styles.menuBtn}
                activeOpacity={0.7}
                onPress={() => setDrawerOpen(true)}
              >
                <Ionicons name="menu" size={22} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={styles.greetingWrap}>
                <Text style={styles.greetingTitle}>
                  Hey {firstName} <Text style={styles.wave}>👋</Text>
                </Text>
                <Text style={styles.greetingSub}>
                  {greeting}! Mark Your Attendance{' '}
                  <Text style={styles.wave}>🎯</Text>
                </Text>
              </View>

              <TouchableOpacity
                style={styles.bellBtn}
                activeOpacity={0.7}
                onPress={() => router.push('/notifications' as any)}
              >
                <Ionicons name="notifications" size={20} color="#1A1A1A" />
                {/* Only show the red badge when there are unread notifications.
                    Disappears as soon as the user opens /notifications (which
                    auto-marks them read), refreshed via useFocusEffect above. */}
                {unreadCount > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>
                      {unreadCount > 9 ? '9+' : String(unreadCount)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* ATTENDANCE CARD */}
          <View style={styles.attCard}>
            <View style={styles.shiftPillWrap}>
              <View style={styles.shiftPill}>
                <Text style={styles.shiftPillText}>
                  {(today.shiftName || 'General Shift').toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={styles.timeRow}>
              {/* Fix G: LiveClock owns its own 1-second interval so only
                  the clock Text re-renders, not the entire HomeScreen. */}
              <LiveClock nowRef={nowRef} />
              {/* #336 — Button is now ALWAYS visible while it's the same
                  attendance day. States:
                    • Check In     — fresh (green)
                    • Check Out    — actively working (blue)
                    • Resume Work  — on break after an accidental /
                                     intentional check-out (green again)
                  This lets an employee who mis-tapped Check Out at
                  12:00 tap Resume Work at 12:05 and continue their day
                  with the accumulated 3-hour total preserved. */}
              <TouchableOpacity
                onPress={handleCheckPress}
                activeOpacity={0.85}
                disabled={actionBusy}
                style={[
                  styles.checkBtn,
                  // Actively working → blue (matches Check Out palette).
                  checkedIn && !checkedOut && { backgroundColor: '#1565C0', shadowColor: '#1565C0' },
                  actionBusy && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.checkBtnText}>{buttonLabel}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            <View style={styles.statsRow}>
              {/* #343 — Show the CURRENT session's exact check-in time
                  (which advances on every Check In / Check In Again
                  tap) so the user immediately sees when they just
                  clocked in. firstCheckIn stays available in state
                  for HRMS reports + attendance history, but not for
                  the live dashboard tile. */}
              <StatItem
                icon={<Feather name="log-in" size={20} color="#2E7D32" />}
                value={formatHourMin(today.checkIn)}
                label="Check In"
                color="#2E7D32"
              />
              <View style={styles.vDivider} />
              <StatItem
                icon={<Feather name="log-out" size={20} color="#1565C0" />}
                value={formatHourMin(today.checkOut)}
                label="Check Out"
                color="#1565C0"
              />
              <View style={styles.vDivider} />
              {/* #316 — LiveWorkedHours owns its own 1-second ticker, so
                  the counter advances every second without re-rendering
                  the whole HomeScreen (which Fix G prevents to kill the
                  flicker). computeWorkedHours() is left in place above
                  in case any other code path still needs the snapshot
                  value. */}
              <LiveWorkedHours
                checkIn={today.checkIn}
                checkOut={today.checkOut}
                accumulatedSeconds={today.accumulatedSeconds || 0}
                firstCheckIn={today.firstCheckIn}
                workedHours={today.workedHours || 0}
              />
            </View>
          </View>

          {/* ANNOUNCEMENTS (#296 — renamed to plural to match the dedicated
              screen and the Figma) */}
          <View style={styles.annSection}>
            <View style={styles.annHeaderRow}>
              <View style={styles.annTitleRow}>
                <Text style={styles.annTitle}>Announcements</Text>
                <Ionicons
                  name="megaphone-outline"
                  size={16}
                  color="#1B5E20"
                  style={{ marginLeft: 6 }}
                />
              </View>
              {/* "View All" button removed per HR — the announcement
                  cards themselves still tap through to the full screen. */}
            </View>
            <Text style={styles.annSub}>
              Latest company updates and important notices
            </Text>

            {announcements.length === 0 ? (
              <View style={[styles.annCard, { alignItems: 'center' }]}>
                <Text style={[styles.annCardBody, { textAlign: 'center' }]}>
                  No announcements yet.
                </Text>
              </View>
            ) : (
              // Sort by createdAt DESC defensively — the backend already
              // returns newest-first but a stale cache or a race during
              // poll could leave the list out of order. Then take the top 4.
              [...announcements]
                .sort((a, b) => {
                  const ta = new Date(a?.createdAt || 0).getTime();
                  const tb = new Date(b?.createdAt || 0).getTime();
                  return tb - ta;
                })
                .slice(0, 4)
                .map((a) => {
                  // Mirror the announcement.tsx fallback: prefer body,
                  // then description, then content. Without this, an
                  // HRMS post whose `body` field wasn't persisted (pre-
                  // #295 schema fix) shows a blank card body here too.
                  const bodyTxt = String(
                    (a as any).body ?? (a as any).description ?? (a as any).content ?? ''
                  ).trim();
                  const poster = (a as any).postedBy
                    || (a as any).createdByName
                    || 'HR';
                  return (
                    <TouchableOpacity
                      key={a._id}
                      style={styles.annCard}
                      activeOpacity={0.85}
                      onPress={() => router.push('/announcement' as any)}
                    >
                      {/* Title: wrap to 3 lines so long subjects ("ERM is
                          live from today. Please make use of it. …") are
                          fully readable instead of being cut to 1 line. */}
                      <Text style={styles.annCardTitle} numberOfLines={3}>
                        {a.title}
                      </Text>
                      {!!bodyTxt && (
                        <Text style={styles.annCardBody} numberOfLines={3}>
                          {bodyTxt}
                        </Text>
                      )}
                      <Text style={styles.annCardMeta}>
                        {/* #316 — Always show "HR" instead of the raw
                            postedBy/createdByName value. HR's user
                            account is named "tescostructures" in the
                            DB, which read as the company name in the
                            UI. From the employee's perspective every
                            announcement is from HR — that's the only
                            label that matters. */}
                        Posted by HR  •  {formatRelative(a.createdAt)}
                      </Text>
                    </TouchableOpacity>
                  );
                })
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* SIDE DRAWER */}
      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user || undefined}
      />

      {/* Premium centered check-in / check-out loader. Floats above
          every screen element via a transparent Modal. Designed with a
          pulsing accent ring, a branded action icon, and polished
          typography so a GPS-cold-start wait feels intentional and
          professional rather than a frozen UI. */}
      <Modal
        visible={actionBusy}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { /* swallow back-press while busy */ }}
      >
        {/* #340 — Loader driven by pendingKind (frozen at tap time in
            handleCheckPress). Prevents the "1-sec Checking you out"
            flash during a Check In Again tap — the derived
            checkedIn/checkedOut/isOnBreak flips MID-await when the
            optimistic setToday(checkOut=null) fires, but pendingKind
            stays stable for the full duration of actionBusy. Falls
            back to the derived value if pendingKind is null (initial
            mount / never tapped). */}
        <View style={loaderStyles.backdrop}>
          <View style={loaderStyles.card}>
            {(() => {
              const derivedKind: 'in' | 'out' =
                (!checkedIn || (checkedIn && checkedOut)) ? 'in' : 'out';
              const loaderShowsIn = (pendingKind ?? derivedKind) === 'in';
              return (
                <>
                  <PremiumLoader variant={loaderShowsIn ? 'in' : 'out'} />
                  <Text style={loaderStyles.label}>
                    {loaderShowsIn ? 'Checking you in' : 'Checking you out'}
                  </Text>
                  <Text style={loaderStyles.sub}>
                    {loaderShowsIn
                      ? 'Confirming your location with HR…'
                      : 'Saving today\'s log and stopping live tracking…'}
                  </Text>
                  <View style={loaderStyles.dotRow}>
                    <View style={[loaderStyles.dot, { backgroundColor: loaderShowsIn ? '#16A34A' : '#1D4ED8' }]} />
                    <View style={[loaderStyles.dot, { backgroundColor: loaderShowsIn ? '#22C55E' : '#3B82F6', opacity: 0.6 }]} />
                    <View style={[loaderStyles.dot, { backgroundColor: loaderShowsIn ? '#86EFAC' : '#93C5FD', opacity: 0.35 }]} />
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Professional check-in / check-out result modal (Jun 2026).
          Replaces the bare native Alert.alert so the moment of clocking
          in or out feels branded — green circle for check-in, blue for
          check-out, with the recorded time and a single OK button. */}
      <Modal
        visible={!!checkResult}
        transparent
        animationType="fade"
        onRequestClose={() => setCheckResult(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onPress={() => setCheckResult(null)}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: '100%', maxWidth: 340,
              backgroundColor: '#FFFFFF', borderRadius: 18,
              paddingTop: 28, paddingBottom: 18, paddingHorizontal: 22,
              alignItems: 'center',
              shadowColor: '#000', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 10 }, shadowRadius: 24, elevation: 10,
            }}
          >
            {/* Status circle */}
            <View style={{
              width: 76, height: 76, borderRadius: 38,
              backgroundColor:
                checkResult?.kind === 'in'  ? '#E8F5E9' :
                checkResult?.kind === 'out' ? '#E3F2FD' :
                '#F1F5F9',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 14,
            }}>
              <Feather
                name={
                  checkResult?.kind === 'in'  ? 'log-in' :
                  checkResult?.kind === 'out' ? 'log-out' :
                  'check-circle'
                }
                size={36}
                color={
                  checkResult?.kind === 'in'  ? '#2E7D32' :
                  checkResult?.kind === 'out' ? '#1565C0' :
                  '#64748B'
                }
              />
            </View>

            <Text style={{ fontSize: 19, fontWeight: '800', color: '#0F172A', marginBottom: 6, textAlign: 'center' }}>
              {checkResult?.kind === 'in'  ? 'Checked In Successfully' :
               checkResult?.kind === 'out' ? 'Checked Out Successfully' :
               "You're all done for today"}
            </Text>

            <Text style={{ fontSize: 13, color: '#475569', textAlign: 'center', lineHeight: 19, marginBottom: 6 }}>
              {checkResult?.kind === 'in'  ? 'Have a productive day. We’ll keep your location pinged with HR until you check out.' :
               checkResult?.kind === 'out' ? 'See you tomorrow! Your hours have been recorded.' :
               'Both check-in and check-out are recorded for today.'}
            </Text>

            <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F172A', marginBottom: 18 }}>
              {checkResult?.kind === 'in'  ? 'Check-in: ' :
               checkResult?.kind === 'out' ? 'Check-out: ' :
               ''}
              {checkResult?.time || ''}
            </Text>

            <TouchableOpacity
              onPress={() => setCheckResult(null)}
              style={{
                alignSelf: 'stretch',
                paddingVertical: 12,
                borderRadius: 999,
                backgroundColor:
                  checkResult?.kind === 'in'  ? '#2E7D32' :
                  checkResult?.kind === 'out' ? '#1565C0' :
                  '#0F172A',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
    </ScreenErrorBoundary>
  );
}

function StatItem({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.statItem}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </View>
  );
}

const GREEN = '#4CAF50';
const PAGE_BG = '#F5F7F6';

const styles = StyleSheet.create({
  // Root is the GREEN behind the safe-area inset (status-bar strip).
  // .safe sits on top with the page colour, so the rest of the screen
  // (including the part that becomes visible when the header scrolls
  // out of view) doesn't bleed white into the OS clock area.
  root: { flex: 1, backgroundColor: GREEN },
  safe: { flex: 1, backgroundColor: PAGE_BG },

  greenHeader: {
    backgroundColor: GREEN,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 90,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  menuBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  greetingWrap: { flex: 1, marginLeft: 10 },
  greetingTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  greetingSub: { color: 'rgba(255,255,255,0.95)', fontSize: 12, marginTop: 2 },
  wave: { fontSize: 14 },

  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  bellDot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#F44336',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#F44336',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 12,
  },

  attCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: -65,
    borderRadius: 18,
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 5,
  },
  shiftPillWrap: { alignItems: 'center', marginBottom: 14 },
  shiftPill: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 14,
  },
  shiftPillText: {
    color: '#2E7D32',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bigTime: { fontSize: 22, fontWeight: '800', color: '#111', letterSpacing: 0.5 },
  checkBtn: {
    backgroundColor: GREEN,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 22,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  checkBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#EEEEEE', marginTop: 18, marginBottom: 14 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statIcon: { marginBottom: 4 },
  statValue: { fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginTop: 2 },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  vDivider: { width: 1, height: 36, backgroundColor: '#EEEEEE' },

  annSection: { marginTop: 22, marginHorizontal: 16 },
  annHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  annTitleRow: { flexDirection: 'row', alignItems: 'center' },
  annTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  viewAll: { color: '#2E7D32', fontSize: 12, fontWeight: '700' },
  annSub: { color: '#7A7A7A', fontSize: 12, marginTop: 4, marginBottom: 14 },

  annCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  annCardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  annCardBody: { fontSize: 12, color: '#666', marginTop: 4, lineHeight: 17 },
  annCardMeta: { fontSize: 10.5, color: '#9A9A9A', marginTop: 8 },
});

// Premium overlay loader used by the centered Check-In / Check-Out modal.
// Layout: halo behind spinner behind icon disc, then label + subtitle + dots.
const loaderStyles = StyleSheet.create({
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
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 10,
  },
  halo: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  spinRing: {
    position: 'absolute',
    width: 94,
    height: 94,
    borderRadius: 47,
    borderWidth: 4,
    borderStyle: 'solid',
  },
  iconDisc: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
});
