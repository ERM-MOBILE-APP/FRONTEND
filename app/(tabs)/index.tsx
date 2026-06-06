import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Linking, AppState } from 'react-native';
import { attendanceAPI, announcementAPI, notificationAPI } from '../../services/api';
import SideDrawer from '../../components/SideDrawer';
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
  requestBatteryOptimizationExemption,
  BACKGROUND_LOCATION_TASK,
} from '../../services/locationTask';

type WorkLocation = 'remote' | 'office';

type TodayData = {
  shiftName?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  workedHours?: number;
  location?: WorkLocation;
};

type Announcement = {
  _id: string;
  title: string;
  body: string;
  postedBy: string;
  createdAt: string;
};

export default function HomeScreen() {
  const [user, setUser] = useState<any>(null);
  const [now, setNow] = useState(new Date());
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

  const refreshToday = useCallback(async () => {
    try {
      const res = await attendanceAPI.today();
      const data = res?.data || {};
      setToday({
        shiftName: data.shiftName || 'General Shift',
        checkIn: data.checkIn || null,
        checkOut: data.checkOut || null,
        workedHours: data.workedHours || 0,
        location: data.location || 'office',
      });
    } catch {
      setToday({ shiftName: 'General Shift' });
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

    const t = setInterval(() => setNow(new Date()), 1000);
    refreshToday();
    refreshAnnouncements();
    refreshUnread();
    return () => clearInterval(t);
  }, [refreshToday, refreshAnnouncements, refreshUnread]);

  // Re-poll unread count every time the user comes back to the home tab —
  // catches the "user just opened Notifications screen which auto-marks
  // them read" case so the bell dot disappears without a manual reload.
  useFocusEffect(
    useCallback(() => {
      refreshUnread();
    }, [refreshUnread])
  );

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
      const ampm = hours >= 12 ? 'Pm' : 'Am';
      const h = hours % 12 === 0 ? 12 : hours % 12;
      return String(h).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ' ' + ampm;
    } catch {
      return '--:--';
    }
  };

  const computeWorkedHours = (): string => {
    if (!today.checkIn) return '00:00';
    const start = new Date(today.checkIn).getTime();
    const end = today.checkOut ? new Date(today.checkOut).getTime() : now.getTime();
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
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        accuracy: fix.coords.accuracy ?? undefined,
      };
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

  const stopTracking = () => {
    if (pingTimerRef.current)  { clearInterval(pingTimerRef.current);  pingTimerRef.current  = null; }
    if (gpsWatcherRef.current) { clearInterval(gpsWatcherRef.current); gpsWatcherRef.current = null; }
    if (bgGuardianRef.current) { clearInterval(bgGuardianRef.current); bgGuardianRef.current = null; }
    gpsOffWarnedRef.current = false;
    // Tell the OS to stop the background location task too — otherwise
    // it keeps pinging after check-out, which is privacy-bad and burns
    // the user's battery for no reason.
    stopBackgroundLocationUpdates().catch(() => {});
    console.log('[tracking] stopped');
  };

  /**
   * Mid-shift GPS turned off. The user is STILL checked in — we just stop
   * sending pings until they re-enable it. Show a single prompt to nudge
   * them, and mark their presence as "idle" on the backend so the HRMS
   * Live Tracking page reflects "Location off" instead of fake-active.
   */
  const handleGpsOffWarn = async () => {
    try { await attendanceAPI.setPresence('idle'); } catch {}
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

    // Kick the OS-driven background task off so pings keep flowing even
    // when the user backgrounds the app or locks their phone. The
    // foreground timers below run in PARALLEL — they catch the "app is
    // open" case immediately (no need to wait the full 2 min) and gate
    // the GPS-off-warn UX. The two paths share the same backend endpoint
    // so duplicate pings are harmless (each is just an upsert).
    startBackgroundLocationUpdates().catch(() => {});

    const PING_MS = 2 * 60 * 1000;   // 2 minutes — full location ping
    const WATCH_MS = 30 * 1000;      // 30 seconds — fast GPS-on/off check

    const ping = async () => {
      try {
        const servicesOn = await Location.hasServicesEnabledAsync();
        if (!servicesOn) { await handleGpsOffWarn(); return; }

        // Get a fix. On Indian OEM phones with aggressive radios,
        // getCurrentPositionAsync can hang for 30+s indoors — race it
        // against an 8-second timeout and fall back to the last-known
        // position so a ping STILL goes out every cycle. A slightly
        // stale fix is dramatically better than nothing because the
        // backend's 25-min stale clock resets on each ping, even if
        // the coords are 30s old.
        let fix: Location.LocationObject | null = null;
        try {
          fix = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
          ]) as Location.LocationObject | null;
        } catch { fix = null; }
        if (!fix) {
          // Fallback — accept a cached fix up to 5 minutes old.
          fix = await Location.getLastKnownPositionAsync({
            maxAge: 5 * 60 * 1000,
            requiredAccuracy: 200,
          }).catch(() => null);
        }
        if (!fix) {
          console.warn('[tracking] no fix available this cycle — skipping ping');
          return;
        }

        await attendanceAPI.locationPing(
          fix.coords.latitude,
          fix.coords.longitude,
          fix.coords.accuracy ?? undefined,
          fix.coords.speed    ?? undefined,
        );
        // GPS came back on after being off — clear the warning latch so the
        // next disable-event can show the prompt again, and flip presence
        // back to active.
        if (gpsOffWarnedRef.current) {
          gpsOffWarnedRef.current = false;
          attendanceAPI.setPresence('active').catch(() => {});
        }
        console.log('[tracking] ✔ ping', fix.coords.latitude.toFixed(5), fix.coords.longitude.toFixed(5));
      } catch (err: any) {
        console.warn('[tracking] ping failed:', err?.message || err);
      }
    };

    const watchGps = async () => {
      try {
        const on = await Location.hasServicesEnabledAsync();
        if (!on) {
          await handleGpsOffWarn();
          return;
        }
        // GPS is on. Two recovery paths converge here:
        //   1. The user just toggled GPS back on after turning it off
        //      mid-shift (gpsOffWarnedRef latch is set).
        //   2. GPS was always on but the bg task got killed by an OEM
        //      battery saver while the app was offscreen.
        // Either way, the safe move is: send a fresh ping AND make sure
        // the OS task is alive again. startBackgroundLocationUpdates is
        // idempotent — if the task is already running it's a no-op.
        if (gpsOffWarnedRef.current) {
          gpsOffWarnedRef.current = false;
          ping();   // fire one fresh ping right away
          startBackgroundLocationUpdates().catch(() => {});   // re-arm OS task
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
        const taskAlive = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
        if (!taskAlive) {
          console.warn('[tracking] bg task died — restarting');
          await startBackgroundLocationUpdates().catch(() => {});
        }
      } catch (err: any) {
        console.warn('[tracking] guardian error:', err?.message || err);
      }
    };

    // Fire one ping immediately, schedule all three intervals.
    ping();
    pingTimerRef.current  = setInterval(ping,     PING_MS);
    gpsWatcherRef.current = setInterval(watchGps, WATCH_MS);
    bgGuardianRef.current = setInterval(guardian, 60 * 1000);
    console.log('[tracking] started (ping 2 min, gpsWatcher 30s, bgGuardian 60s)');
  };

  // Clean up intervals if the home component unmounts (e.g. logout).
  useEffect(() => () => stopTracking(), []);

  // If the user is already checked-in when the home screen mounts (e.g.
  // they killed the app and re-opened it later), resume the loop.
  useEffect(() => {
    if (checkedIn && !checkedOut && !pingTimerRef.current) {
      startTracking();
    }
    if ((!checkedIn || checkedOut) && pingTimerRef.current) {
      stopTracking();
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
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      // Only relevant while we should be tracking.
      if (!checkedIn || checkedOut) return;

      if (state === 'background' || state === 'inactive') {
        // Final foreground ping — gives the backend a fresh timestamp to
        // measure staleness from. Also make sure the OS-level task is
        // alive so pings keep flowing while we're gone.
        try {
          const on = await Location.hasServicesEnabledAsync();
          if (on) {
            const fix = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            await attendanceAPI.locationPing(
              fix.coords.latitude,
              fix.coords.longitude,
              fix.coords.accuracy ?? undefined,
              fix.coords.speed    ?? undefined,
            );
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
              startBackgroundLocationUpdates().catch(() => {});
              try {
                const fix = await Location.getCurrentPositionAsync({
                  accuracy: Location.Accuracy.Balanced,
                });
                await attendanceAPI.locationPing(
                  fix.coords.latitude,
                  fix.coords.longitude,
                  fix.coords.accuracy ?? undefined,
                  fix.coords.speed    ?? undefined,
                );
                await attendanceAPI.setPresence('active').catch(() => {});
              } catch { /* best-effort */ }
            }
          }
        } catch (err: any) {
          console.warn('[tracking] AppState re-check failed:', err?.message || err);
        }
      }
    });
    return () => sub.remove();
  }, [checkedIn, checkedOut]);

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
    setActionBusy(true);
    try {
      if (!checkedIn) {
        // Mandatory location check before check-in. ensureLocationOn now
        // returns the actual fix so we can include lat/lng in the request.
        // Cap at 25s so a flaky GPS chip can't strand the button.
        const coords = await withTimeout(ensureLocationOn(), 25_000, 'Location fix');
        if (!coords) return;

        // Require "Allow all the time" location permission BEFORE
        // letting the check-in go through. Without it the OS won't
        // deliver pings while the app is offscreen, which is what
        // makes HR's Live Tracking flip to "Location off" the moment
        // the employee switches apps. We surface a clear prompt and
        // block the check-in rather than letting them get marked
        // Offline mid-shift through a silent permission denial.
        const bgOk = await startBackgroundLocationUpdates();
        if (!bgOk) {
          Alert.alert(
            'Background location required',
            'Tesco ERM needs "Allow all the time" location access so HR can see ' +
            'your live status even when the app is in the background. ' +
            'Open Settings → Permissions → Location → "Allow all the time".',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
            ]
          );
          return;
        }

        await attendanceAPI.checkIn(today.location || 'office', coords);
        await attendanceAPI.setPresence('active').catch(() => {});

        // One-time battery-optimization exemption prompt (Android only,
        // first successful check-in only). Saved to AsyncStorage so we
        // don't pester the user every day. The exemption is what stops
        // Xiaomi / Oppo / Vivo / Realme / OnePlus battery savers from
        // killing the foreground location service mid-shift — which is
        // the single biggest cause of "Location on but showing Offline".
        try {
          const alreadyAsked = await AsyncStorage.getItem('battery_exempt_asked');
          if (!alreadyAsked) {
            await AsyncStorage.setItem('battery_exempt_asked', '1');
            Alert.alert(
              'Keep tracking running',
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
        } catch {/* best-effort */}

        setCheckResult({ kind: 'in', time: formatLiveTime(new Date()) });
        startTracking();
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
              const fix = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              outCoords = {
                lat:      fix.coords.latitude,
                lng:      fix.coords.longitude,
                accuracy: fix.coords.accuracy ?? undefined,
              };
            }
          }
        } catch {/* best-effort, ignore */}
        await attendanceAPI.checkOut(outCoords);
        await attendanceAPI.setPresence('offline').catch(() => {});
        stopTracking();
        setCheckResult({ kind: 'out', time: formatLiveTime(new Date()) });
      } else {
        setCheckResult({ kind: 'done', time: formatLiveTime(new Date()) });
      }
      refreshToday();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Could not record attendance');
    } finally {
      setActionBusy(false);
    }
  };

  const buttonLabel = !checkedIn ? 'Check In' : !checkedOut ? 'Check Out' : 'Done';

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    // After 8:00 PM (20:00) until midnight → Good Night.
    if (h >= 20) return 'Good Night';
    return 'Good Evening';
  })();

  const firstName =
    (user?.name && String(user.name).split(' ')[0]) || 'Vijay';

  return (
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
              <Text style={styles.bigTime}>{formatLiveTime(now)}</Text>
              {!checkedOut && (
                <TouchableOpacity
                  onPress={handleCheckPress}
                  activeOpacity={0.85}
                  disabled={actionBusy}
                  style={[
                    styles.checkBtn,
                    checkedIn && !checkedOut && { backgroundColor: '#1565C0', shadowColor: '#1565C0' },
                    actionBusy && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.checkBtnText}>
                    {actionBusy ? 'Please wait...' : buttonLabel}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.divider} />

            <View style={styles.statsRow}>
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
              <StatItem
                icon={<Feather name="activity" size={20} color="#6A1B9A" />}
                value={computeWorkedHours()}
                label="Working HR's"
                color="#6A1B9A"
              />
            </View>
          </View>

          {/* ANNOUNCEMENT */}
          <View style={styles.annSection}>
            <View style={styles.annHeaderRow}>
              <View style={styles.annTitleRow}>
                <Text style={styles.annTitle}>Announcement</Text>
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
              announcements.slice(0, 4).map((a) => (
                <TouchableOpacity
                  key={a._id}
                  style={styles.annCard}
                  activeOpacity={0.85}
                  onPress={() => router.push('/announcement' as any)}
                >
                  <Text style={styles.annCardTitle}>{a.title}</Text>
                  <Text style={styles.annCardBody} numberOfLines={2}>
                    {a.body}
                  </Text>
                  <Text style={styles.annCardMeta}>
                    Posted by {a.postedBy}  •  {formatRelative(a.createdAt)}
                  </Text>
                </TouchableOpacity>
              ))
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
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6EDE7',
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
