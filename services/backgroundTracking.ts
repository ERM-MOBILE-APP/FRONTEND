

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
// #430 — STRICT SQLite-as-source-of-truth. This react-native-background-
// actions path historically POSTed straight to the network and left NO
// local trace. Under the new policy every ping must land in SQLite first
// and must NOT be uploaded while checked in — so we now persist here too.
import {
  initPingStore,
  savePendingPing,
  bucketFor,
  isUploadAllowedNow,
} from './pingStore';

// ── Optional runtime imports ─────────────────────────────────────
// These native libs must be linked via `npx expo prebuild` + a
// fresh EAS build. In dev / Expo Go they'll be undefined; guarded
// with require() so the app still boots without them.
let BackgroundService: any;
try {
  BackgroundService = require('react-native-background-actions').default;
} catch { /* not linked yet — startTracking will no-op with warning */ }

let RNGeolocation: any;
try {
  RNGeolocation = require('react-native-geolocation-service').default;
} catch { /* not linked yet — startTracking will no-op with warning */ }

const BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  'https://backend-9rtc.onrender.com';

const TASK_ID   = 'tesco-erm-tracking';
const PING_INTERVAL_MS   = 60 * 1000;   // 2 minutes — HR spec
const CLIENT_BURST_MS    = 110 * 1000;   // must be > 100s server dedup
const GPS_TIMEOUT_MS     = 15 * 1000;    // per-request max wait for a fix
const OFFLINE_QUEUE_KEY  = 'erm-bg-ping-queue-v1';
const LAST_SENT_KEY      = 'erm-bg-last-ping-sent-at';
const ANCHOR_STATE_KEY   = 'erm-gps-anchor-v1';

// ── Anti-jitter filter (unchanged from #275/#314/#376) ──────────
const ACCURACY_GATE_M            = 30;
const MOVEMENT_THRESHOLD_M       = 45;
const STATIONARY_SPEED_MPS       = 0.5;
const CONSECUTIVE_MOVES_REQUIRED = 3;
const STATIONARY_HOLD_BUDGET_M   = 80;

type AnchorState = {
  lat: number; lng: number; accuracy: number | null;
  ts: number; pendingMoves: number;
};

type Fix = {
  lat: number; lng: number;
  accuracy: number | null;
  speed: number | null;
  isStationary: boolean;
  recordedAt: string; // ISO
};

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
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
export async function resetGpsAnchor(): Promise<void> {
  try { await AsyncStorage.removeItem(ANCHOR_STATE_KEY); } catch {}
}

/**
 * #392 — Seed the GPS anchor with the check-in coordinates.
 *
 * Called from handleCheckPress() the moment the /attendance/checkin POST
 * succeeds, before startBackgroundTracking() actually begins the 2-min
 * loop. This guarantees that from the very first tick of the tracking
 * task there is a fallback anchor available — so even if the phone's
 * GPS chip is cold or the employee is standing in a poor-signal room,
 * the task always has SOMETHING to ping with.
 *
 * The anchor is what the anti-jitter filter returns for a stationary
 * employee (isStationary: true), and it's what the trackingTask falls
 * back to when readPositionOnce() times out. Without seeding, the first
 * few ticks could silently drop and HR would see the employee as
 * "just checked in but no live updates yet" for 4-6 minutes.
 */
export async function seedGpsAnchor(lat: number, lng: number, accuracy?: number | null): Promise<void> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return;
  try {
    await saveAnchor({
      lat, lng,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      ts: Date.now(),
      pendingMoves: 0,
    });
  } catch {/* AsyncStorage hiccup — trackingTask will re-seed on first good fix */}
}

async function filterFix(opts: {
  lat: number; lng: number;
  accuracy?: number | null; speed?: number | null;
  remarks?: string | null;
}): Promise<Omit<Fix, 'recordedAt'> | null> {
  const { lat, lng } = opts;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
    // No usable current fix — fall back to anchor if we have one so the
    // 2-min cadence is never broken. Only return null on the very first
    // tick when no anchor has ever been seeded (rare — the check-in
    // handler seeds the anchor via seedGpsAnchor() as a safety net).
    const a = await loadAnchor();
    if (a) return { lat: a.lat, lng: a.lng, accuracy: a.accuracy, speed: 0, isStationary: true };
    return null;
  }
  const accuracy = typeof opts.accuracy === 'number' ? opts.accuracy : null;
  const speed    = typeof opts.speed    === 'number' ? opts.speed    : null;

  // #392 — PURE-TIME-BASED PING GUARANTEE.
  //
  // Previously: `if (accuracy > 30m) return null;` — an indoor phone with
  // ±40-80 m accuracy would have EVERY tick silently dropped, resulting
  // in zero rows in the DB for the whole shift even though the 2-min
  // timer was ticking correctly. That was the "not recording continuously"
  // root cause for stationary employees sitting indoors.
  //
  // New behaviour: if accuracy is poor AND we have an anchor from an
  // earlier good fix, send the anchor position as a stationary ping so
  // the DB always receives a row every 2 min. Only when we've never
  // captured a decent fix (no anchor at all) do we still hold back this
  // tick — but seedGpsAnchor() at check-in normally guarantees the
  // anchor is present from tick 0.
  if (accuracy != null && accuracy > ACCURACY_GATE_M) {
    const a = await loadAnchor();
    if (a) return { lat: a.lat, lng: a.lng, accuracy: a.accuracy, speed: 0, isStationary: true };
    return null;
  }

  const anchor = await loadAnchor();
  if (!anchor) {
    await saveAnchor({ lat, lng, accuracy, ts: Date.now(), pendingMoves: 0 });
    return { lat, lng, accuracy, speed: speed ?? 0, isStationary: true };
  }
  const dist = haversineMeters(anchor.lat, anchor.lng, lat, lng);
  const movingBySpeed = speed != null && speed > STATIONARY_SPEED_MPS;
  const movingByDist  = dist >= MOVEMENT_THRESHOLD_M;
  if (!movingByDist && !movingBySpeed) {
    if (anchor.pendingMoves !== 0) await saveAnchor({ ...anchor, pendingMoves: 0 });
    return { lat: anchor.lat, lng: anchor.lng, accuracy: anchor.accuracy, speed: 0, isStationary: true };
  }
  if (dist < STATIONARY_HOLD_BUDGET_M && !movingBySpeed) {
    if (anchor.pendingMoves !== 0) await saveAnchor({ ...anchor, pendingMoves: 0 });
    return { lat: anchor.lat, lng: anchor.lng, accuracy: anchor.accuracy, speed: 0, isStationary: true };
  }
  const newPending = anchor.pendingMoves + 1;
  if (newPending < CONSECUTIVE_MOVES_REQUIRED) {
    await saveAnchor({ ...anchor, pendingMoves: newPending });
    return { lat: anchor.lat, lng: anchor.lng, accuracy: anchor.accuracy, speed: 0, isStationary: true };
  }
  await saveAnchor({ lat, lng, accuracy, ts: Date.now(), pendingMoves: 0 });
  return { lat, lng, accuracy, speed, isStationary: false };
}

// ── Offline queue (unchanged) ────────────────────────────────────
type QueuedPing = {
  lat: number; lng: number;
  accuracy?: number | null; speed?: number | null;
  isStationary?: boolean;
  recordedAt: string;
};
async function loadQueue(): Promise<QueuedPing[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) || []) : [];
  } catch { return []; }
}
async function saveQueue(q: QueuedPing[]): Promise<void> {
  try {
    const trimmed = q.length > 200 ? q.slice(q.length - 200) : q;
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(trimmed));
  } catch {}
}
async function enqueue(p: QueuedPing): Promise<void> {
  const q = await loadQueue();
  q.push(p);
  await saveQueue(q);
}
async function drainQueue(token: string): Promise<void> {
  const q = await loadQueue();
  if (q.length === 0) return;
  const remaining: QueuedPing[] = [];
  let drained = 0;
  for (const p of q) {
    try {
      const res = await fetch(`${BASE_URL}/api/attendance/location-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(p),
      });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        remaining.push(p);
        const idx = q.indexOf(p);
        if (idx >= 0) remaining.push(...q.slice(idx + 1));
        break;
      }
      drained++;
    } catch {
      remaining.push(p);
      const idx = q.indexOf(p);
      if (idx >= 0) remaining.push(...q.slice(idx + 1));
      break;
    }
  }
  await saveQueue(remaining);
  if (drained > 0) console.log('[bg-track] drained', drained, 'queued pings');
}

// ── GPS read via react-native-geolocation-service ────────────────
async function readPositionOnce(): Promise<{ lat: number; lng: number; accuracy: number | null; speed: number | null } | null> {
  if (!RNGeolocation) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: any) => { if (!done) { done = true; resolve(v); } };
    try {
      RNGeolocation.getCurrentPosition(
        (pos: any) => finish({
          lat:      pos?.coords?.latitude,
          lng:      pos?.coords?.longitude,
          accuracy: typeof pos?.coords?.accuracy === 'number' ? pos.coords.accuracy : null,
          speed:    typeof pos?.coords?.speed    === 'number' ? pos.coords.speed    : null,
        }),
        () => finish(null),
        {
          enableHighAccuracy: true,
          timeout: GPS_TIMEOUT_MS,
          maximumAge: 30_000,
          distanceFilter: 0,
          forceRequestLocation: true,
          forceLocationManager: false,
          showLocationDialog: true,
        }
      );
    } catch { finish(null); }
    // hard safety timeout
    setTimeout(() => finish(null), GPS_TIMEOUT_MS + 1_000);
  });
}

// ── POST helper with burst guard + queue-on-failure ──────────────
//
// #391 — RESERVATION-STYLE burst guard.
// Previously the sequence was:
//   1. read last-sent from AsyncStorage
//   2. if gap < 110 s → skip
//   3. do the fetch (network I/O — tens to hundreds of ms)
//   4. only THEN write "sent-at = now" back to AsyncStorage
//
// That left a wide race window between step-1 and step-4 during which
// a second tracker (the legacy expo-task-manager task, or the FG timer,
// or an AppState-triggered ping) could read the SAME stale last-sent,
// pass the same guard, and race to POST. Result: two rows in the DB
// within a few hundred ms — exactly what was observed for TES080 at
// 06:10:12.977 and 06:10:13.307.
//
// Now the sequence is:
//   1. read last-sent
//   2. if gap < 110 s → skip
//   3. WRITE "sent-at = now" BEFORE the fetch — reserves the slot
//   4. do the fetch
// Any concurrent tracker that runs between steps 3 and 4 will read the
// fresh reservation and skip. The window shrinks from ~fetch-latency
// (100–500 ms) to a single JS event-loop tick (~1 ms) — effectively
// zero in a single-threaded JS runtime.
//
// The backend unique compound index on (user, date, bucket) — #379 —
// remains the final backstop: even if this guard somehow lets two
// requests through, only one can persist.
async function postPing(token: string, f: Fix): Promise<void> {
  // #430 — STRICT SQLite-as-source-of-truth. Persist EVERY ping to the
  // local SQLite queue FIRST so no sample is ever lost, then decide
  // whether we're allowed to upload. While the employee is checked in we
  // store locally ONLY and RETURN without any network POST — the single
  // upload to MongoDB happens at Check Out (finalCheckoutSyncAndCleanup).
  try {
    await initPingStore();
    let uId = '';
    let eId = '';
    try {
      const rawUser = await AsyncStorage.getItem('user');
      if (rawUser) {
        const u = JSON.parse(rawUser);
        uId = u?._id || u?.id || u?.userId || '';
        eId = u?.employeeId || u?.userId || '';
      }
    } catch { /* still save with empty ids so the coords survive */ }
    const recMs = Date.now();
    await savePendingPing({
      userId:       uId || undefined,
      employeeId:   eId || undefined,
      lat:          f.lat,
      lng:          f.lng,
      accuracy:     f.accuracy ?? null,
      speed:        f.speed ?? null,
      isStationary: !!f.isStationary,
      recordedAt:   recMs,
      bucket:       bucketFor(recMs),
    } as any);
  } catch (e: any) {
    console.log('[bg-actions] savePendingPing failed (non-fatal):', e?.message || e);
  }

  try {
    if (!(await isUploadAllowedNow())) {
      console.log('[bg-actions] ✔ ping stored to SQLite only (checked-in — no live upload):', { lat: f.lat, lng: f.lng });
      return;
    }
  } catch { /* gate error — fall through to the normal (checked-out retry) send path */ }

  // #402 — Burst guard with ROLLBACK ON FAILURE.
  //
  // The reservation-style guard (#391) writes LAST_SENT_KEY before the
  // fetch to close a race between the FG timer and this bg task. But
  // when the server returned 500 or the network dropped, the reserved
  // timestamp stayed put and blocked the NEXT 110 s of retries — so
  // one bad ping silently killed 2-3 subsequent good ones. We now
  // capture the previous timestamp and, on any failure that puts the
  // ping in the offline queue, restore it. The 30-second offline
  // queue drain from a healthy tick will still catch up the queued
  // payload later, and meanwhile the next 2-min tick can fire fresh.
  let priorLastSent = 0;
  try {
    const raw = await AsyncStorage.getItem(LAST_SENT_KEY);
    priorLastSent = raw ? Number(raw) || 0 : 0;
    if (priorLastSent > 0 && Date.now() - priorLastSent < CLIENT_BURST_MS) return;
    // Reserve the slot BEFORE the network call so a concurrent tracker
    // that runs while our fetch is in flight sees us as "just sent".
    try { await AsyncStorage.setItem(LAST_SENT_KEY, String(Date.now())); } catch {}
  } catch {}

  const payload = {
    lat: f.lat, lng: f.lng,
    accuracy: f.accuracy ?? undefined,
    speed:    f.speed    ?? undefined,
    isStationary: f.isStationary,
    recordedAt: f.recordedAt,
  };
  // Rollback helper — restore whatever timestamp was there before we
  // reserved the slot, so the next 2-min tick can retry immediately.
  const rollback = async () => {
    try { await AsyncStorage.setItem(LAST_SENT_KEY, String(priorLastSent)); } catch {}
  };
  try {
    const res = await fetch(`${BASE_URL}/api/attendance/location-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 || res.status === 403) {
      // Auth failure isn't a network problem; don't retry-flood the server.
      // The next login/token refresh will fix things. Keep the reservation
      // so we don't hammer the auth path.
      return;
    }
    if (!res.ok) {
      // 5xx or 4xx (other than auth): server rejected — enqueue for replay
      // AND roll back the guard so the next 2-min tick can fire fresh.
      console.log('Ping HTTP ' + res.status + ' — enqueue + rollback guard');
      await enqueue(payload);
      await rollback();
      return;
    }
    // Log the successful ping — plain, no prefix.
    console.log('Ping sent:', { lat: payload.lat, lng: payload.lng, accuracy: payload.accuracy, recordedAt: payload.recordedAt });
    await drainQueue(token);
  } catch (e: any) {
    // Network error (timeout, DNS, connection refused, etc.) — same
    // treatment: enqueue for replay and roll back the guard.
    console.log('Ping failed:', e?.message || e, '— enqueue + rollback guard');
    await enqueue(payload);
    await rollback();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── The headless BG task ─────────────────────────────────────────
//
// Runs inside the foreground service that react-native-background-
// actions spins up. Loops until BackgroundService.stop() is called.
// Every 2 minutes: read GPS → filter → post.
//
// EVERY branch is wrapped in try/catch — an escape here would crash
// the JS engine inside the service context and OEMs would SIGTERM
// the entire app process ("app comes out by itself" symptom).
async function trackingTask(_taskData: any): Promise<void> {
  const state = { alive: true };
  console.warn("started trackingTask — alive:", state.alive);
  while (state.alive) {
    try {
      const token = (await AsyncStorage.getItem('token')) || '';
      if (!token) {
        await sleep(PING_INTERVAL_MS);
        continue;
      }

      // #392 — Purely time-based ping. Every 2 min, unconditionally.
      // Order of preference for what we send:
      //   1. Fresh raw GPS fix, passed through the anti-jitter filter.
      //   2. If GPS returned null (timeout, indoor, chip cold), send
      //      the last known anchor as a stationary ping.
      //   3. If there's no anchor either (only possible on the very
      //      first tick of a session where check-in didn't seed one),
      //      skip this single tick — the next 2 min it'll retry.
      //
      // This guarantees exactly one row per 2-min bucket in the DB
      // from check-in to check-out, regardless of whether the user has
      // moved or whether the phone can see the sky. The backend's
      // (user, date, bucket) unique index keeps it to exactly one row.
      const raw = await readPositionOnce();
      let filtered: Omit<Fix, 'recordedAt'> | null = null;
      if (raw && typeof raw.lat === 'number' && typeof raw.lng === 'number') {
        console.log('Location:', raw);
        filtered = await filterFix(raw);
      } else {
        // GPS unavailable this tick — fall back to the anchor so the
        // DB still gets a row for this 2-min slot.
        const a = await loadAnchor();
        console.warn("anchor fallback ping will be sent (GPS unavailable this tick) ");


        if (a) {
          console.log('Location: (GPS unavailable, using last known anchor)', { lat: a.lat, lng: a.lng });
          filtered = { lat: a.lat, lng: a.lng, accuracy: a.accuracy, speed: 0, isStationary: true };
        } else {
          console.log('Location: (GPS unavailable, no anchor yet — skipping this tick)');
        }
      }
      if (filtered) {
        await postPing(token, { ...filtered, recordedAt: new Date().toLocaleString() });
      }
    } catch (e: any) {
      // Absolute swallow. The task MUST stay alive.
      console.log('Location error:', e?.message || e);
    }

    try { await sleep(PING_INTERVAL_MS); } catch {}
  }
}

const options = {
  taskName:       'Tesco ERM',
  taskTitle:      'Tesco ERM · Live tracking active',
  taskDesc:       'Sharing your location with HR until you check out.',
  taskIcon:       { name: 'ic_launcher', type: 'mipmap' },
  color:          '#4CAF50',
  linkingURI:     'tescoerm://home',
  parameters:     {},
  // #421 — Explicit FGS type. Android 14+ requires this both here AND in
  // the manifest (via config plugin); without either the OS refuses to
  // start the service. The manifest side is handled by expo-build-properties
  // / a small config plugin — see app.json.
  foregroundServiceType: 'location',
  // #421 — Attach to the LOW-importance channel we created above so the
  // persistent notification actually renders on Android 13+ (killer of
  // background tracking on every modern device without this).
  progressBar: undefined,      // hide progress spinner in notif
  // r-n-b-a picks up the channelId when present. If the constant doesn't
  // exist on the installed version, the option is silently ignored.
  channelId: 'tesco-erm-tracking',
};

/** Start the background-actions foreground service. */
export async function startBackgroundTracking(): Promise<boolean> {
  if (!BackgroundService || !RNGeolocation) {
    console.log('Tracking not available — native libs not linked');
    return false;
  }
  try {
    const alreadyRunning = typeof BackgroundService.isRunning === 'function'
      ? BackgroundService.isRunning()
      : false;
    if (alreadyRunning) return true;
    await BackgroundService.start(trackingTask, options);
    try { await AsyncStorage.setItem(LAST_SENT_KEY, '0'); } catch {}
    console.warn('Tracking started');
    return true;
  } catch (e: any) {
    console.warn('Tracking start failed:', e?.message || e);
    return false;
  }
}

/** Stop the background-actions foreground service. Idempotent. */
export async function stopBackgroundTracking(reason: string = 'manual'): Promise<void> {
  if (!BackgroundService) return;
  try {
    const running = typeof BackgroundService.isRunning === 'function'
      ? BackgroundService.isRunning()
      : true;
    if (!running) return;
    await BackgroundService.stop();
    console.log('Tracking stopped (' + reason + ')');
  } catch (e: any) {
    console.log('Tracking stop failed:', e?.message || e);
  }
}

/** True if the background service is currently running. */
export function isBackgroundTrackingRunning(): boolean {
  if (!BackgroundService) return false;
  try {
    return typeof BackgroundService.isRunning === 'function'
      ? BackgroundService.isRunning()
      : false;
  } catch { return false; }
}

/** Request Android runtime permissions the task needs. Safe on iOS. */
export async function requestTrackingPermissions(): Promise<'granted' | 'denied' | 'never_ask'> {
  if (Platform.OS !== 'android') return 'granted';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PermissionsAndroid } = require('react-native');
    const fg = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      { title: 'Location', message: 'Tesco ERM needs location access to record your live work status.', buttonPositive: 'Allow' }
    );
    if (fg !== PermissionsAndroid.RESULTS.GRANTED) {
      return fg === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'never_ask' : 'denied';
    }
    try {
      const bg = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        { title: 'Background location', message: 'Allow all the time so HR can see your live status while the app is closed.', buttonPositive: 'Allow' }
      );
      if (bg !== PermissionsAndroid.RESULTS.GRANTED) return 'denied';
    } catch { /* not required on Android < 10 */ }
    // #421 — CRITICAL FIX. Without POST_NOTIFICATIONS on Android 13+ the
    // foreground service's persistent notification cannot be shown, and
    // the OS SIGKILLs the FGS ~10 seconds after start. This was the #1
    // reason bg tracking was dying the moment the app went to background.
    try {
      if (PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
        const notif = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Notification',
            message: 'Tesco ERM needs to show a small notification while tracking so Android does not stop location updates.',
            buttonPositive: 'Allow',
          }
        );
        if (notif !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('[permissions] POST_NOTIFICATIONS denied — FGS may be killed by Android after ~10s');
        }
      }
    } catch { /* POST_NOTIFICATIONS not present on older RN — noop */ }
    // #421 — Create the LOW-importance notification channel r-n-b-a will
    // attach its notification to. Without the channel on Android 8+ the
    // notification silently fails and the FGS is torn down.
    try {
      const Notifications = require('expo-notifications');
      if (Notifications && typeof Notifications.setNotificationChannelAsync === 'function') {
        await Notifications.setNotificationChannelAsync('tesco-erm-tracking', {
          name: 'Tesco ERM · Live tracking',
          importance: Notifications.AndroidImportance
            ? Notifications.AndroidImportance.LOW
            : 2,
          lockscreenVisibility: 1,
          sound: null,
          vibrationPattern: null,
          enableVibrate: false,
          enableLights: false,
          bypassDnd: false,
          showBadge: false,
        }).catch(() => {});
      }
    } catch { /* expo-notifications not installed — fallback to r-n-b-a default */ }
    return 'granted';
  } catch { return 'denied'; }
}
