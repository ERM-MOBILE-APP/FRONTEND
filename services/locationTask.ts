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

/**
 * Offline ping queue (Jun 2026 — Requirement #7 prod fix).
 *
 * When the device has no internet, the location-ping POST fails. Earlier
 * versions just dropped the sample and moved on — net effect: HR saw a
 * straight line on the map between the last pre-outage ping and the
 * first post-outage ping, masking that the employee had genuinely
 * travelled across town during the outage.
 *
 * New behaviour: on POST failure (network error, timeout, 5xx) we push
 * the sample into AsyncStorage under PING_QUEUE_KEY. On the next
 * successful ping (i.e. once the network is back) we drain the queue
 * by replaying each saved sample, preserving its original timestamp.
 *
 * Queue is capped at 200 entries (~3 hours at the 60 s cadence) to
 * prevent unbounded growth if a phone is offline for an entire shift.
 * When the cap is hit, the oldest entries are dropped first so we keep
 * the freshest 200 samples.
 */
const PING_QUEUE_KEY = 'erm-bg-ping-queue-v1';
const PING_QUEUE_MAX = 200;

type QueuedPing = {
  lat: number; lng: number;
  accuracy?: number | null;
  speed?: number | null;
  recordedAt: string; // ISO, the time the sample was COLLECTED, not posted
};

async function loadQueue(): Promise<QueuedPing[]> {
  try {
    const raw = await AsyncStorage.getItem(PING_QUEUE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function saveQueue(q: QueuedPing[]): Promise<void> {
  try {
    // Keep only the freshest PING_QUEUE_MAX.
    const trimmed = q.length > PING_QUEUE_MAX ? q.slice(q.length - PING_QUEUE_MAX) : q;
    await AsyncStorage.setItem(PING_QUEUE_KEY, JSON.stringify(trimmed));
  } catch {/* storage full — best-effort */}
}
async function enqueueFailedPing(p: QueuedPing): Promise<void> {
  const q = await loadQueue();
  q.push(p);
  await saveQueue(q);
}

/**
 * Drain the offline queue by replaying each saved sample through the
 * SAME location-ping endpoint. Each replayed sample carries its
 * original recordedAt so the backend stamps the polyline with the
 * actual time the employee was at that spot — not the time the network
 * came back. Stops early on any failure so we don't churn through
 * the queue if the network is still flaky.
 */
async function drainQueue(token: string): Promise<void> {
  const q = await loadQueue();
  if (q.length === 0) return;
  console.log('[bg-location] draining', q.length, 'queued pings');
  const remaining: QueuedPing[] = [];
  let drained = 0;
  for (const p of q) {
    try {
      const res = await fetch(`${BASE_URL}/api/attendance/location-ping`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          lat:        p.lat,
          lng:        p.lng,
          accuracy:   p.accuracy ?? undefined,
          speed:      p.speed    ?? undefined,
          recordedAt: p.recordedAt,   // backend honours this if supplied
        }),
      });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        // Server error — stop draining and re-queue the rest.
        remaining.push(p);
        const idx = q.indexOf(p);
        if (idx >= 0) remaining.push(...q.slice(idx + 1));
        break;
      }
      drained++;
    } catch {
      // Network error — keep this one and everything after.
      remaining.push(p);
      const idx = q.indexOf(p);
      if (idx >= 0) remaining.push(...q.slice(idx + 1));
      break;
    }
  }
  await saveQueue(remaining);
  if (drained > 0) console.log('[bg-location] drained', drained, 'pings; remaining', remaining.length);
}

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

  const recordedAt = new Date().toISOString();
  const payload = {
    lat, lng,
    accuracy: typeof accuracy === 'number' ? accuracy : undefined,
    speed:    typeof speed    === 'number' ? speed    : undefined,
  };

  try {
    const res = await fetch(`${BASE_URL}/api/attendance/location-ping`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    // IMPORTANT — DO NOT STOP THE TASK ON 401 / 403.
    // A transient auth hiccup (Render cold-start, brief proxy glitch)
    // must not silently kill tracking. The task keeps firing every
    // 60s; the next ping will succeed and tracking resumes seamlessly.
    if (res.status === 401 || res.status === 403) {
      console.warn('[bg-location] ping rejected (' + res.status + ') — skipping but keeping task alive.');
      return;
    }

    // 5xx → server is up but unhealthy. Treat as a network failure
    // and enqueue so the sample isn't lost.
    if (!res.ok) {
      console.warn('[bg-location] ping HTTP', res.status, '— enqueuing for replay');
      await enqueueFailedPing({ ...payload, recordedAt });
      return;
    }

    // POST succeeded → try to drain any queued samples from a previous
    // network outage. Best-effort, non-blocking on errors.
    await drainQueue(token);
  } catch (e: any) {
    // Network error — queue the sample so it survives until the
    // device gets back online. The OS will keep firing the task.
    console.warn('[bg-location] ping POST failed (network):', e?.message || e);
    await enqueueFailedPing({ ...payload, recordedAt });
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
  // Production-tuned config (Jun 2026): Highest accuracy + 60-sec interval.
  // We upgraded from High → Highest because HR complained about pin
  // jitter on the map — employees standing still appeared to drift 20-50 m
  // because High accuracy mode mixes GPS + cell-tower + Wi-Fi triangulation
  // and the latter two have huge error radii. Highest forces pure GPS
  // (or Fused with GPS preferred) so urban-canyon accuracy drops from
  // ±50 m to ±5-10 m typical.
  //
  // Interval tightened from 90 s → 60 s. With the new 10-min stale
  // window on the backend we have less headroom, and "Highest" doesn't
  // cost meaningfully more battery than "High" once GPS is already on.
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy:         Location.Accuracy.Highest,
    timeInterval:     60 * 1000,
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
