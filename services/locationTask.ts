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
  'https://backend-9rtc.onrender.com';

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

/* ───────────────────────────────────────────────────────────────────────
 * HEARTBEAT + EVENT LOG (Jun 2026 — production fix for "tracking stops
 * randomly mid-shift").
 *
 * Problem
 * ───────
 * Even with every Android permission granted (incl. background location,
 * foreground service, battery-opt exemption), OEM battery savers on
 * Xiaomi/Oppo/Vivo/Realme/OnePlus can still SIGKILL the foreground
 * service after 4–8 hours. The OS gives no callback — the task just
 * vanishes. To detect this we maintain:
 *
 *   • lastHeartbeat — ISO timestamp of the most recent successful
 *     bg-task invocation. Foreground code can read this and, if it's
 *     stale (> 3 min for a 60-s interval), force-restart the task.
 *
 *   • event log    — circular buffer of every start / stop / kill /
 *     revival event with reason. Capped at 200 entries. Exported so
 *     HR can ask the employee to share their tracking diagnostics
 *     when investigating "you went offline for 2 hours" claims.
 * ───────────────────────────────────────────────────────────────────── */
const HEARTBEAT_KEY  = 'erm-bg-task-last-heartbeat';
const EVENT_LOG_KEY  = 'erm-bg-task-events-v1';
const EVENT_LOG_MAX  = 200;
// #315 — Tightened from 3 min → 2 min. With the bg task's 60-s
// timeInterval, a single missed tick is normal (OS batching, brief
// CPU contention). Two missed ticks (120 s of silence) is the earliest
// reliable signal that the foreground service has actually died — so
// 2 min is the sweet spot between "false-positive revives that
// briefly toggle the GPS chip" and "user loses 5 minutes of tracking
// before we notice". Pair this with the 15-s guardian cadence (#315)
// and worst-case detection is now ~135 s instead of 210 s.
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

type TrackingEvent = {
  ts: string;
  kind: 'start' | 'stop' | 'heartbeat' | 'revive' | 'error';
  reason: string;
};

async function writeHeartbeat(): Promise<void> {
  try { await AsyncStorage.setItem(HEARTBEAT_KEY, new Date().toISOString()); } catch {}
}

/** Read the last bg-task heartbeat. Returns null if never seen. */
export async function getLastHeartbeat(): Promise<Date | null> {
  try {
    const raw = await AsyncStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

/** True if no bg-task tick has been recorded in the last 3 minutes.
 *  IMPORTANT (#282 prod fix): a NULL heartbeat is NOT considered stale.
 *  Right after check-in we wipe diagnostics; the first bg-task tick is
 *  60-90s away. If we treated null as stale, the 30-s guardian would
 *  stop-and-restart the bg task on its first run, then again every
 *  30s until the first heartbeat landed — causing visible "tracking
 *  is starting/stopping" flicker and (on aggressive OEMs) actual
 *  foreground-service teardown crashes. We now return false on null
 *  so the OS gets a clean 3-minute grace period to deliver its first
 *  location. After that, normal staleness rules apply. */
export async function isHeartbeatStale(): Promise<boolean> {
  const last = await getLastHeartbeat();
  if (!last) return false;
  return (Date.now() - last.getTime()) > HEARTBEAT_STALE_MS;
}

async function appendEvent(kind: TrackingEvent['kind'], reason: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_LOG_KEY);
    let arr: TrackingEvent[] = [];
    if (raw) {
      try { arr = JSON.parse(raw) || []; } catch { arr = []; }
    }
    arr.push({ ts: new Date().toISOString(), kind, reason });
    if (arr.length > EVENT_LOG_MAX) arr = arr.slice(arr.length - EVENT_LOG_MAX);
    await AsyncStorage.setItem(EVENT_LOG_KEY, JSON.stringify(arr));
  } catch {/* non-fatal — diagnostics shouldn't ever break tracking */}
}

/** Export the event log so a Profile→Diagnostics screen can render it. */
export async function getTrackingEvents(): Promise<TrackingEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Wipe the event log + heartbeat at check-in so each shift starts clean. */
export async function resetTrackingDiagnostics(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HEARTBEAT_KEY);
    await AsyncStorage.removeItem(EVENT_LOG_KEY);
  } catch {}
}

/* ────────────────────────────────────────────────────────────────────────
 * Anti-jitter filter (Jun 2026 — production fix for "stationary user
 * appears to move" complaints).
 *
 * Problem: GPS reports a noisy position every 60 s. Even a phone sitting
 * on a desk shows the lat/lng drifting 5-15 m every minute, and once or
 * twice an hour a single bad sample jumps 50+ m (urban canyon, satellite
 * geometry change). On HR's Live Tracking map this looks like the
 * employee is constantly fidgeting — and worse, "travelling" to the
 * coffee shop next door.
 *
 * Solution: client-side filter with three layers of defence:
 *   1) HARD ACCURACY GATE — any fix worse than 30 m is dropped before
 *      it touches the server.
 *   2) ANCHOR PERSISTENCE   — when stationary, we keep sending the same
 *      anchored lat/lng so the map marker doesn't twitch. Anchor is
 *      saved in AsyncStorage so it survives the OS spinning up a fresh
 *      JS context for each bg delivery.
 *   3) CONFIRMED-MOVE RULE  — a single fix that "moved" >20 m does NOT
 *      yet update the anchor. We require N consecutive moving fixes
 *      before adopting the new position, killing single outliers.
 *
 * The filter outputs:
 *   • Stationary  → send anchor coords (server polyline stays put)
 *   • Moving      → adopt new anchor, send new coords
 *   • null        → drop (accuracy too poor)
 * ──────────────────────────────────────────────────────────────────── */
// #314 — Tuned for "marker doesn't twitch when sitting at a desk".
// HR feedback: stationary employees were appearing as "moving" on the
// map because GPS chips routinely drift 15-25 m even when the device
// is physically still (urban-canyon multipath, satellite constellation
// rotation, cold-start re-acquisition). Old thresholds (20 m / 2 fixes)
// were just under that natural drift band, so genuine stillness kept
// nudging the anchor by 20+ m every few minutes.
//
// New thresholds:
//   • ACCURACY_GATE_M unchanged — backend now matches at 35 m (#310).
//   • MOVEMENT_THRESHOLD_M    20 → 45 m. Must drift 45 m before counting
//                             as motion. Covers normal urban GPS noise.
//   • CONSECUTIVE_MOVES_REQUIRED 2 → 3. Three consecutive 45 m fixes
//                             before adopting a new anchor. With a 60 s
//                             ping cadence that's a 3-min commit window
//                             — still imperceptible for a walking user,
//                             but immune to "one bad sample drove the
//                             pin halfway down the street" jitter.
//   • STATIONARY_HOLD_BUDGET_M (new) 80 m. Even if the pendingMoves
//                             counter never reaches 3, if the new fix
//                             is within 80 m of the anchor we treat it
//                             as definitely-still and RESET the counter
//                             so a slow drift series can't accumulate.
const ACCURACY_GATE_M           = 30;
const MOVEMENT_THRESHOLD_M      = 45;
const STATIONARY_SPEED_MPS      = 0.5;  // ~1.8 km/h. Anything below = still.
const CONSECUTIVE_MOVES_REQUIRED = 3;
const STATIONARY_HOLD_BUDGET_M   = 80;
const ANCHOR_STATE_KEY          = 'erm-gps-anchor-v1';

type AnchorState = {
  lat: number;
  lng: number;
  accuracy: number | null;
  ts: number;
  pendingMoves: number;
};

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000; // metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function loadAnchor(): Promise<AnchorState | null> {
  try {
    const raw = await AsyncStorage.getItem(ANCHOR_STATE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (typeof a?.lat !== 'number' || typeof a?.lng !== 'number') return null;
    return a as AnchorState;
  } catch { return null; }
}

async function saveAnchor(s: AnchorState): Promise<void> {
  try { await AsyncStorage.setItem(ANCHOR_STATE_KEY, JSON.stringify(s)); } catch {}
}

/** Reset the anchor — called on check-in so a new shift starts clean. */
export async function resetGpsAnchor(): Promise<void> {
  try { await AsyncStorage.removeItem(ANCHOR_STATE_KEY); } catch {}
}

export type FilteredFix = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  isStationary: boolean;
};

/**
 * filterFix — the gatekeeper for every ping.
 *
 * Returns:
 *   • { isStationary: true, lat/lng = anchor coords } — keep marker put
 *   • { isStationary: false, lat/lng = new coords }   — confirmed move
 *   • null                                            — drop entirely
 */
export async function filterFix(opts: {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
}): Promise<FilteredFix | null> {
  const lat = opts.lat;
  const lng = opts.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
    return null;
  }
  const accuracy = typeof opts.accuracy === 'number' ? opts.accuracy : null;
  const speed    = typeof opts.speed    === 'number' ? opts.speed    : null;

  // 1) HARD ACCURACY GATE. A fix with radius > 30 m is so coarse it's
  //    worse than no data — drop it. The OS will deliver another in 60 s.
  if (accuracy != null && accuracy > ACCURACY_GATE_M) {
    console.log('[gps-filter] drop: accuracy', accuracy.toFixed(0), '> gate', ACCURACY_GATE_M);
    return null;
  }

  const anchor = await loadAnchor();

  // 2) FIRST-EVER FIX — adopt as anchor, report as stationary.
  if (!anchor) {
    await saveAnchor({ lat, lng, accuracy, ts: Date.now(), pendingMoves: 0 });
    return { lat, lng, accuracy, speed: speed ?? 0, isStationary: true };
  }

  // 3) Compute physical displacement from the held anchor.
  const dist          = haversineMeters(anchor.lat, anchor.lng, lat, lng);
  const movingBySpeed = speed != null && speed > STATIONARY_SPEED_MPS;
  const movingByDist  = dist >= MOVEMENT_THRESHOLD_M;

  // 4) STATIONARY: small delta AND slow → reset pending counter,
  //    keep marker on anchor.
  if (!movingByDist && !movingBySpeed) {
    if (anchor.pendingMoves !== 0) {
      await saveAnchor({ ...anchor, pendingMoves: 0 });
    }
    return {
      lat: anchor.lat,
      lng: anchor.lng,
      accuracy: anchor.accuracy,
      speed: 0,
      isStationary: true,
    };
  }

  // 5) Saw motion — but FIRST check the stationary-hold budget. If
  //    the new fix is still within 80 m of the anchor, treat it as
  //    drift regardless of how it compared to MOVEMENT_THRESHOLD_M.
  //    Without this guard a series of 45-55 m drift samples could
  //    quietly accumulate three "moves" in a row and adopt a new
  //    anchor 50 m away even though the employee never left the
  //    building. With it, an employee sitting at their desk produces
  //    a stable anchor for the entire shift unless they truly walk
  //    out of an 80 m radius — which means the dist would be ≥ 80 m,
  //    not just ≥ 45 m.
  if (dist < STATIONARY_HOLD_BUDGET_M && !movingBySpeed) {
    if (anchor.pendingMoves !== 0) {
      await saveAnchor({ ...anchor, pendingMoves: 0 });
    }
    console.log('[gps-filter] within hold budget', dist.toFixed(0), '<', STATIONARY_HOLD_BUDGET_M, '— anchor held');
    return {
      lat: anchor.lat,
      lng: anchor.lng,
      accuracy: anchor.accuracy,
      speed: 0,
      isStationary: true,
    };
  }

  // 6) Saw motion outside the hold budget — but we need N consecutive
  //    such fixes before committing. A single outlier (one bad sample)
  //    is held back so the map doesn't teleport.
  const newPending = anchor.pendingMoves + 1;
  if (newPending < CONSECUTIVE_MOVES_REQUIRED) {
    await saveAnchor({ ...anchor, pendingMoves: newPending });
    console.log('[gps-filter] pending move', newPending, '/', CONSECUTIVE_MOVES_REQUIRED, 'dist', dist.toFixed(0));
    // Still hold the marker on the anchor.
    return {
      lat: anchor.lat,
      lng: anchor.lng,
      accuracy: anchor.accuracy,
      speed: 0,
      isStationary: true,
    };
  }

  // 6) CONFIRMED MOVE — adopt new position as the anchor.
  console.log('[gps-filter] CONFIRMED MOVE', dist.toFixed(0), 'm — new anchor');
  await saveAnchor({ lat, lng, accuracy, ts: Date.now(), pendingMoves: 0 });
  return { lat, lng, accuracy, speed, isStationary: false };
}

type QueuedPing = {
  lat: number; lng: number;
  accuracy?: number | null;
  speed?: number | null;
  isStationary?: boolean;
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
          lat:          p.lat,
          lng:          p.lng,
          accuracy:     p.accuracy ?? undefined,
          speed:        p.speed    ?? undefined,
          isStationary: p.isStationary === true,
          recordedAt:   p.recordedAt,   // backend honours this if supplied
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
  // ═══════════════════════════════════════════════════════════════════
  // CRASH GUARD — ROOT CAUSE OF "APP EXITS UNEXPECTEDLY" (#279 Jun 2026)
  //
  // The bg-task callback runs in a SEPARATE JS context that the OS
  // spins up just to deliver location events. If ANY async error
  // escapes this function (an AsyncStorage write throws, a fetch
  // rejects synchronously, a JSON.parse on bad data, etc.) the OS
  // sees an unhandled rejection inside the task context. On Android
  // newer than 12 this commonly triggers `SIGTERM` against the entire
  // app process — which manifests to the user as "the app just exited
  // by itself" with no crash dialog and no error boundary triggered.
  //
  // Wrapping the whole body in try/catch is the single most impactful
  // fix for the "app comes out by itself" complaint. NOTHING inside
  // this function is allowed to throw to the OS.
  // ═══════════════════════════════════════════════════════════════════
  try {
    // CRITICAL: write the heartbeat *unconditionally* at the top.
    // Even if we get bad data or skip the ping for accuracy reasons,
    // the fact that the OS just invoked our task is itself the most
    // valuable signal: "yes, tracking is alive." Without this, the
    // foreground watchdog had no way to distinguish "task running
    // but no fix yet" from "task is dead." Now any task tick — for
    // any reason — refreshes the heartbeat.
    try { await writeHeartbeat(); } catch {/* AsyncStorage hiccup */}

    if (error) {
      console.warn('[bg-location] task error:', error.message);
      try { await appendEvent('error', 'task callback err: ' + error.message); } catch {}
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

  // Anti-jitter filter — turns a noisy GPS sample into either a stationary
  // anchor reading or a confirmed-move reading. Drops sub-quality fixes.
  const filtered = await filterFix({ lat, lng, accuracy, speed });
  if (!filtered) {
    console.log('[bg-location] fix filtered out (poor accuracy) — no ping');
    return;
  }

  const payload = {
    lat: filtered.lat,
    lng: filtered.lng,
    accuracy: filtered.accuracy ?? undefined,
    speed:    filtered.speed    ?? undefined,
    isStationary: filtered.isStationary,
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
    try { await enqueueFailedPing({ ...payload, recordedAt }); } catch {}
  }
  // ═══════════════════════════════════════════════════════════════════
  // END OF CRASH GUARD. The outer catch below absorbs ANY remaining
  // exception so the OS task context never sees an unhandled rejection.
  // ═══════════════════════════════════════════════════════════════════
  } catch (fatal: any) {
    console.error('[bg-location] FATAL caught inside task — swallowed to keep app alive:', fatal?.message || fatal);
    try { await appendEvent('error', 'FATAL swallowed: ' + (fatal?.message || String(fatal))); } catch {}
    // SWALLOW. Do not re-throw. The next 60-s OS tick will re-enter
    // the callback with a clean stack.
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
  // Production-tuned config (Jul 2026 — #373): Highest accuracy + 120-sec
  // interval. HR's target cadence is exactly one ping every 2 minutes
  // from check-in to check-out. Aligning the OS-level task interval to
  // 120s means the OS itself paces us instead of relying on backend
  // dedup to swallow every-other tick. Battery + network cost is halved,
  // dedup becomes a safety net instead of primary gating, and the actual
  // ping timeline in the DB reads cleanly at 2-minute intervals.
  //
  // Highest accuracy stays (pure GPS ±5-10 m) so the pin doesn't jitter
  // on the map when employees are stationary.
  await appendEvent('start', 'startLocationUpdatesAsync invoked');
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy:         Location.Accuracy.Highest,
    timeInterval:     120 * 1000,
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

/* ────────────────────────────────────────────────────────────────────────
 * OEM AUTOSTART HELPER (#289 — Jun 2026 prod fix)
 *
 * Chinese OEMs (Xiaomi, Oppo, Vivo, Realme, OnePlus) layer a SECOND
 * permission on top of Android's standard battery optimization: an
 * "Autostart" / "Background Auto-launch" / "Background Activity"
 * toggle. Without it ENABLED, no app — even with foreground service +
 * battery-exempt — survives more than ~5 minutes in the background.
 *
 * Each OEM hides this toggle behind its own SecurityCenter activity.
 * The intents below are the canonical entry points; we try them in
 * order until one resolves. If none works (newer MIUI versions hide
 * activity names), we fall back to opening the app's standard
 * settings page so the user can navigate from there.
 *
 * Detection uses Application.android.brand which is set on every
 * modern device. The brand string lower-cased makes "Xiaomi", "POCO",
 * and "Redmi" all map to the same Xiaomi path.
 * ──────────────────────────────────────────────────────────────────── */
function detectOem(): 'xiaomi' | 'oppo' | 'vivo' | 'realme' | 'oneplus' | 'samsung' | 'other' {
  if (Platform.OS !== 'android') return 'other';
  // Platform.constants.Brand is populated on Android 7+
  // @ts-ignore — type def doesn't include Brand
  const brand = String((Platform.constants as any)?.Brand || (Platform.constants as any)?.Manufacturer || '').toLowerCase();
  if (brand.includes('xiaomi') || brand.includes('redmi') || brand.includes('poco')) return 'xiaomi';
  if (brand.includes('oppo')) return 'oppo';
  if (brand.includes('vivo') || brand.includes('iqoo')) return 'vivo';
  if (brand.includes('realme')) return 'realme';
  if (brand.includes('oneplus')) return 'oneplus';
  if (brand.includes('samsung')) return 'samsung';
  return 'other';
}

/**
 * Try to open the OEM's Autostart / Background Activity page. Returns
 * true if an intent fired (settings page opened), false if we fell back
 * to generic app settings. UI should follow up with on-screen
 * instructions in case the intent landed on the wrong page.
 */
export async function openOemAutostartSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const IntentLauncher = await import('expo-intent-launcher').catch(() => null);
  if (!IntentLauncher) return false;

  const oem = detectOem();
  const PKG = 'com.tescodigitals26.tescoerm';

  // Each OEM's autostart manager activity. Try each candidate in order;
  // the first one that resolves wins.
  const candidates: Array<{ action?: string; component?: { packageName: string; className: string } }> = [];

  switch (oem) {
    case 'xiaomi':
      candidates.push({ component: { packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' } });
      candidates.push({ component: { packageName: 'com.miui.securitycenter', className: 'com.miui.appmanager.ApplicationsDetailsActivity' } });
      break;
    case 'oppo':
      candidates.push({ component: { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' } });
      candidates.push({ component: { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' } });
      candidates.push({ component: { packageName: 'com.oppo.safe',          className: 'com.oppo.safe.permission.startup.StartupAppListActivity' } });
      break;
    case 'vivo':
      candidates.push({ component: { packageName: 'com.iqoo.secure',  className: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' } });
      candidates.push({ component: { packageName: 'com.iqoo.secure',  className: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' } });
      candidates.push({ component: { packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' } });
      break;
    case 'realme':
      candidates.push({ component: { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' } });
      candidates.push({ component: { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' } });
      break;
    case 'oneplus':
      candidates.push({ component: { packageName: 'com.oneplus.security', className: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' } });
      break;
    case 'samsung':
      // Samsung uses a generic battery-usage page; opening it lets the user
      // toggle "Allow background activity" + "Unrestricted battery usage".
      candidates.push({ component: { packageName: 'com.samsung.android.lool', className: 'com.samsung.android.sm.ui.battery.BatteryActivity' } });
      break;
  }

  // Fallback for all OEMs — generic app-info page where the user can
  // dig into Battery / Permissions themselves.
  candidates.push({ action: 'android.settings.APPLICATION_DETAILS_SETTINGS' });

  for (const c of candidates) {
    try {
      if (c.component) {
        await IntentLauncher.startActivityAsync(c.action || 'android.intent.action.MAIN', {
          // @ts-ignore — extra is supported
          extra: undefined,
          // @ts-ignore — component is supported but not in type defs
          packageName: c.component.packageName,
          // @ts-ignore
          className:   c.component.className,
        });
        return true;
      }
      if (c.action) {
        await IntentLauncher.startActivityAsync(c.action, { data: 'package:' + PKG });
        return true;
      }
    } catch {
      // Intent didn't resolve on this device — try next candidate.
      continue;
    }
  }
  return false;
}

/** Returns the human-readable name for the OEM, for use in alert text. */
export function getOemLabel(): string {
  const m: Record<ReturnType<typeof detectOem>, string> = {
    xiaomi: 'Xiaomi / Redmi / POCO',
    oppo:    'Oppo',
    vivo:    'Vivo / iQOO',
    realme:  'Realme',
    oneplus: 'OnePlus',
    samsung: 'Samsung',
    other:   'your phone',
  };
  return m[detectOem()];
}

/** Returns a short OEM-specific instruction the user can follow. */
export function getOemAutostartHint(): string {
  switch (detectOem()) {
    case 'xiaomi':
      return 'Security app → Permissions → Autostart → enable Tesco ERM. Also: Settings → Apps → Tesco ERM → Battery saver → No restrictions.';
    case 'oppo':
      return 'Settings → Battery → App Battery Management → Tesco ERM → enable "Allow background activity" + disable "Sleep" + "Deep sleep".';
    case 'vivo':
      return 'Settings → Battery → Background power consumption management → Tesco ERM → Allow. Also: i-Manager → App Manager → Autostart → enable Tesco ERM.';
    case 'realme':
      return 'Settings → Battery → App Battery Management → Tesco ERM → enable "Allow background activity" + disable "Deep sleep".';
    case 'oneplus':
      return 'Settings → Battery → Battery optimization → Tesco ERM → Don\'t optimize. Also: Advanced → Recent apps management → Normal.';
    case 'samsung':
      return 'Settings → Battery → Battery usage → Tesco ERM → enable "Allow background activity" and choose "Unrestricted".';
    default:
      return 'Open phone Settings → Apps → Tesco ERM → enable Autostart / Background Activity / Battery: Unrestricted.';
  }
}

/** Stop the background task. Call on check-out / logout. Idempotent. */
export async function stopBackgroundLocationUpdates(reason: string = 'manual'): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (!running) return;
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    await appendEvent('stop', reason);
    console.log('[bg-location] background updates stopped (' + reason + ')');
  } catch (e: any) {
    console.warn('[bg-location] stop failed:', e?.message || e);
    await appendEvent('error', 'stop failed: ' + (e?.message || ''));
  }
}

/**
 * Watchdog revival — force-restart the bg task even if the OS still
 * reports it as "running" (which it can lie about — once OEMs SIGKILL
 * the foreground service, hasStartedLocationUpdatesAsync sometimes
 * stays true until the next reboot). Called by the foreground guardian
 * whenever the heartbeat is stale.
 *
 * Strategy: stop first (idempotent — silently no-ops if nothing's
 * running), then start fresh. Old task instance is fully torn down so
 * the OS can't re-use a zombie service handle.
 */
export async function reviveBackgroundLocationUpdates(reason: string): Promise<boolean> {
  try {
    await appendEvent('revive', 'starting revival: ' + reason);
    // Force stop first — handles the zombie-task case.
    try {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch { /* not running — fine */ }
    const ok = await startBackgroundLocationUpdates();
    await appendEvent(ok ? 'revive' : 'error', ok ? 'revival ok' : 'revival failed (perm?)');
    return ok;
  } catch (e: any) {
    await appendEvent('error', 'revive crash: ' + (e?.message || ''));
    return false;
  }
}
