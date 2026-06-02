/**
 * locationTask.ts — background GPS pings via expo-task-manager.
 *
 * Why this exists
 * ───────────────
 * `setInterval` in a React Native screen pauses the moment the OS pushes
 * the app to background, so our previous "ping every 2 min" loop stopped
 * the second the employee swiped away from Tesco ERM. HR saw them turn
 * Offline within minutes even though Location was clearly still on.
 *
 * expo-location's `startLocationUpdatesAsync` API uses a native foreground
 * service (Android) / background-location capability (iOS) to keep GPS
 * deliveries flowing whether or not the JS bundle is on screen. The task
 * callback below runs in a *separate* JS context that the OS spins up on
 * each delivery — no React tree, no hooks, no AsyncStorage hook. It pulls
 * the JWT from AsyncStorage directly and POSTs the ping to the same
 * /api/attendance/location-ping endpoint the foreground loop used.
 *
 * Important: TaskManager.defineTask MUST be called at module load
 * time (top of app, before any render) so the OS can find the task by
 * name when it resurrects it after the app is killed. We import this
 * module from app/_layout.tsx for that reason.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location    from 'expo-location';
import AsyncStorage     from '@react-native-async-storage/async-storage';
import { Platform }     from 'react-native';

export const BACKGROUND_LOCATION_TASK = 'tesco-erm-location-ping';

// Resolve the API base the same way the foreground services/api.ts does.
// Hardcoded fallback matches the prod Render URL; override via .env when
// running against localhost during dev.
const BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  'https://backend-emqy.onrender.com';

type LocationTaskBody = {
  locations: Location.LocationObject[];
};

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[bg-location] task error:', error.message);
    return;
  }
  const body = data as LocationTaskBody | undefined;
  if (!body || !Array.isArray(body.locations) || body.locations.length === 0) return;

  // Use the freshest sample from the batch the OS delivered.
  const fix = body.locations[body.locations.length - 1];
  if (!fix || !fix.coords) return;
  const { latitude: lat, longitude: lng, accuracy, speed } = fix.coords;
  if (typeof lat !== 'number' || typeof lng !== 'number') return;

  // Grab the JWT the user signed in with — the foreground services/api.ts
  // stores it under the 'token' key. Without a token the ping endpoint
  // returns 401 and the OS will just retry on the next delivery.
  let token = '';
  try {
    token = (await AsyncStorage.getItem('token')) || '';
  } catch {/* AsyncStorage init failure — non-fatal */}
  if (!token) return;

  try {
    const res = await fetch(`${BASE_URL}/api/attendance/location-ping`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat,
        lng,
        accuracy: typeof accuracy === 'number' ? accuracy : undefined,
        speed:    typeof speed    === 'number' ? speed    : undefined,
      }),
    });

    // Self-healing: if the server says the token is bad (user logged out
    // from another device, account disabled, etc.) there's no point in the
    // OS continuing to wake us every 2 minutes. Stop the task — the
    // foreground service notification will disappear and the user's
    // battery stops getting drained. They'll re-arm it on next check-in.
    if (res.status === 401 || res.status === 403) {
      console.warn('[bg-location] auth rejected (', res.status, ') — stopping background task.');
      try {
        const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
        if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      } catch {/* best-effort */}
      return;
    }

    // Optional self-heal: server responded with a body that explicitly
    // tells us the user has checked out for the day. Backend doesn't do
    // this today, but if a future ping endpoint sets `{ checkedOut: true }`
    // we'll respect it and stop tracking immediately rather than running
    // till the user manually checks out.
    if (res.ok) {
      try {
        const body = await res.json().catch(() => null) as any;
        if (body && body.checkedOut === true) {
          console.log('[bg-location] server reports user has checked out — stopping task.');
          const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
          if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
      } catch {/* response body wasn't JSON — fine */}
    }
  } catch (e: any) {
    console.warn('[bg-location] ping POST failed:', e?.message || e);
    // Swallow — TaskManager doesn't have a useful retry semantic for
    // network errors, and the next delivery will try again in 2 min.
  }
});

/**
 * Start the background location task. Call this from the foreground after
 * a successful check-in. Idempotent — starts if not already running.
 *
 * Returns true on success, false if permission was denied (caller can
 * surface an alert and block check-in in that case).
 *
 * Requirements:
 *   • foreground "When in Use" permission (already requested at check-in)
 *   • "Always" permission (requested lazily here for Android Q+ / iOS)
 */
export async function startBackgroundLocationUpdates(): Promise<boolean> {
  // Ask for background permission. On Android < 10 this resolves to the
  // foreground permission already granted; on Android 10+ / iOS it pops
  // the "Allow all the time" prompt. Without it, the OS never delivers
  // pings while the app is offscreen — which is exactly what HR was
  // hitting as "Location off" on Live Tracking.
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      console.warn('[bg-location] background permission denied — only foreground pings will fire, so HR will see "Location off" within ~20 min of the user backgrounding the app.');
      return false;
    }
  } catch (e: any) {
    console.warn('[bg-location] permission request failed:', e?.message || e);
    return false;
  }

  // No-op if the task is already running (e.g. screen remounted).
  const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (running) return true;

  // The config below is tuned for maximum durability on Indian OEM phones
  // (Xiaomi MIUI, Oppo ColorOS, Vivo FunTouch, Realme, OnePlus OxygenOS).
  // These OEMs ship aggressive battery-killer apps that suspend background
  // services even WITH all the right permissions. Each flag below pushes
  // back on a specific OEM behaviour:
  //
  //   • accuracy: Balanced              — high enough to be useful, low
  //                                       enough that the OS won't claim
  //                                       "too expensive" and throttle.
  //   • timeInterval: 2 min             — matches the foreground cadence
  //                                       so HRMS sees a consistent stream.
  //   • distanceInterval: 0             — deliver every tick even if
  //                                       stationary; lots of office work
  //                                       happens at one desk.
  //   • pausesUpdatesAutomatically: F   — iOS would otherwise auto-pause
  //                                       when motion stops.
  //   • showsBackgroundLocationIndicator: T — iOS legal requirement.
  //   • activityType: OtherNavigation   — tells iOS this is a
  //                                       location-critical app; raises
  //                                       priority in the bg location
  //                                       scheduler.
  //   • deferredUpdatesInterval: 0      — disable OS-level batching that
  //                                       would otherwise hold 6+ pings
  //                                       and deliver them in a burst
  //                                       every 12 minutes.
  //   • deferredUpdatesDistance: 0      — same, for the distance variant.
  //   • mayShowUserSettingsDialog: T    — if Android disables high-accuracy
  //                                       mid-shift the OS pops its own
  //                                       prompt to re-enable it.
  //   • foregroundService.notification* — Android: the ongoing notification
  //                                       is the ONLY thing that legally
  //                                       keeps the service alive when the
  //                                       app is offscreen. We make it a
  //                                       persistent low-priority sticky
  //                                       notification (cannot be swiped
  //                                       away by accident).
  // Production-tuned config (Jun 2026): switched to High accuracy and a
  // 90-second interval. The OS WILL throttle this on most OEM phones —
  // but asking for "high + 90s" effectively gives us "balanced + 2min"
  // delivery in practice, which is exactly what the backend's 25-min
  // stale window needs. Asking for the original "balanced + 2min" was
  // letting OEM doze rules push real delivery out to 6–12 minutes and
  // bumping users to Offline mid-shift.
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy:         Location.Accuracy.High,
    timeInterval:     90 * 1000,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically:       false,
    activityType:                     Location.ActivityType.OtherNavigation,
    deferredUpdatesInterval:          0,
    deferredUpdatesDistance:          0,
    mayShowUserSettingsDialog:        true,
    foregroundService: Platform.OS === 'android' ? {
      // Sticky notification keeps the foreground service alive even
      // through Doze and app-swipe-away on most Android OEMs.
      notificationTitle: 'Tesco ERM · Live tracking active',
      notificationBody:  'Sharing your location with HR until you check out. Do not swipe away.',
      notificationColor: '#4CAF50',
      // killServiceOnDestroy: false — keep the foreground service alive
      // even if the user swipes the task away from "Recent apps". The OS
      // will resurrect the background task callback on the next location
      // delivery. (Defaults to false in expo-location ≥ 16, but we set
      // it explicitly so a future default-change doesn't silently break.)
      killServiceOnDestroy: false,
    } : undefined,
  });
  console.log('[bg-location] background updates started');
  return true;
}

/**
 * Open the Android battery-optimization-exempt settings page so the
 * user can whitelist Tesco ERM from being killed by Doze + OEM battery
 * savers. This is the single biggest reason the foreground service
 * dies mid-shift on Xiaomi / Oppo / Vivo / Realme / OnePlus.
 *
 * No-op on iOS (Apple doesn't expose this and isn't required there).
 *
 * We don't *require* the user to grant the exemption — denying just
 * means the background task may die earlier. The check-in flow calls
 * this once after a successful check-in so the prompt only fires
 * during active onboarding, not every app open.
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const IntentLauncher = await import('expo-intent-launcher').catch(() => null);
    if (!IntentLauncher) return;
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: 'package:com.tescodigitals26.tescoerm' }
    ).catch(() => {});
  } catch {
    /* best-effort — silent fail keeps check-in flowing */
  }
}

/** Stop the background task. Call on check-out / logout. Idempotent. */
export async function stopBackgroundLocationUpdates(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (!running) return;
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    console.log('[bg-location] background updates stopped');
  } catch (e: any) {
    console.warn('[bg-location] stop failed:', e?.message || e);
  }
}
