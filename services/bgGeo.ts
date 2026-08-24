/**
 * services/bgGeo.ts — Transistorsoft react-native-background-geolocation.
 *
 * #458 — Replaces the expo-location background tracker with Transistorsoft's
 * react-native-background-geolocation for production-grade continuous tracking
 * that survives minimise / screen-lock / device-idle far better on aggressive
 * OEMs (Xiaomi/Oppo/Vivo/Realme), which was the outstanding failure mode.
 *
 * This module exposes the SAME function names the app already imported from
 * services/locationTask.ts —
 *   startBackgroundLocationUpdates / stopBackgroundLocationUpdates /
 *   reviveBackgroundLocationUpdates
 * — so switching the tracker is a one-line import change in index.tsx, and the
 * whole ping pipeline downstream is UNCHANGED:
 *   fix → savePendingPing() to SQLite (source of truth) → pingSync uploads.
 *
 * ── "Every 2 minutes even if stationary" ────────────────────────────────
 * Transistorsoft's core is MOTION-based: when the device stops moving it
 * stops sampling to save battery. To guarantee a fix every 2 minutes even
 * while the employee sits at a desk, we use its HEARTBEAT:
 *   • heartbeatInterval: 120  + preventSuspend: true
 *   • onHeartbeat → getCurrentPosition({ persist:true }) every 120 s.
 * Combined with onLocation (which fires whenever they DO move), this yields a
 * continuous ≥1-ping-per-2-min stream from Check In to Check Out.
 *
 * ── LICENSE ─────────────────────────────────────────────────────────────
 * Transistorsoft RNBG is FREE in debug builds. RELEASE Android builds require
 * a purchased license key, set in app.json under the plugin config
 * ("license": "..."). Without it the production build won't run the plugin.
 *
 * The require() is guarded so the app still boots if the native module isn't
 * linked yet (e.g. before the next prebuild/build) — every function then
 * no-ops instead of crashing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initPingStore,
  savePendingPing,
  markPingSynced,
  bucketFor,
  getTrackingState,
  markCheckOut,
  getPendingCount,
} from './pingStore';
// #463 — midnight finalizer reuses the same verify-and-upload the debug button
// uses. bgGeo → pingSync is one-directional (pingSync never imports bgGeo), so
// there is no circular import.
import { verifyAndHealAgainstMongo } from './pingSync';

// #461 — Base URL for the direct realtime upload done from inside the RNBG
// background/headless JS callback (see persistLocation). Same origin the rest
// of the app uses.
const BGGEO_BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  'https://backend-9rtc.onrender.com';

let BGGeo: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  BGGeo = require('react-native-background-geolocation').default;
} catch {
  /* native module not linked yet — all exports below no-op */
}

// Re-exported so index.tsx's existing `BACKGROUND_LOCATION_TASK` import keeps
// resolving if it's ever pointed here. Cosmetic identifier only.
export const BACKGROUND_LOCATION_TASK = 'tesco-erm-bggeo';

const HEARTBEAT_KEY = 'erm-bg-task-last-heartbeat';

let _configured = false;
let _listenersBound = false;

// #464 — ANTI-JITTER OUTLIER GUARD. RNBG returns raw fixes, including coarse
// indoor ones (±100–200 m) that jump around and draw map "spikes" (the
// straight line on the daily route) and make a stationary employee look like
// they're moving. We remember the last GOOD (accurate) fix and substitute it
// for any coarse reading, so the plotted position stays put instead of jumping.
let _lastGoodFix: { lat: number; lng: number; accuracy: number | null; ts: number } | null = null;
const GOOD_ACCURACY_M   = 50;                 // a fix within 50 m is trusted as-is
const ANCHOR_MAX_AGE_MS = 10 * 60 * 1000;     // reuse a good fix for up to 10 min

// ─── #463 MIDNIGHT AUTO-CHECKOUT ─────────────────────────────────────────
// Requirement: if an employee forgets to check out, at IST midnight the app
// must (1) upload 100% of local pings and VERIFY them on the server, (2) only
// THEN stop background tracking, (3) if the sync fails keep tracking + keep
// the pings and retry, (4) after a successful close stop recording new pings,
// (5) start a fresh session on the next manual Check In with no cross-day
// mixing. The server's autoCloseAttendance cron closes the ATTENDANCE record
// independently (phone-off backstop); this handles the PHONE: sync + stop.

let _midnightBusy = false;

/** IST calendar date (YYYY-MM-DD) for an epoch-ms value. */
function istDateStr(ms: number): string {
  const IST_OFFSET_MIN = 5 * 60 + 30;
  return new Date(ms + IST_OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Returns true if the current IST day is LATER than the check-in IST day —
 * i.e. the session has crossed midnight and must be auto-closed.
 */
async function hasCrossedIstMidnight(): Promise<{ crossed: boolean; checkInDay: string }> {
  try {
    const st = await getTrackingState();
    if (!st?.checkedIn || !st.checkInAt) return { crossed: false, checkInDay: '' };
    const checkInDay = istDateStr(st.checkInAt);
    const today = istDateStr(Date.now());
    return { crossed: today > checkInDay, checkInDay };
  } catch {
    return { crossed: false, checkInDay: '' };
  }
}

/**
 * The midnight finalizer. Safe to call often (from the RNBG callback, a timer,
 * or cold-boot resume). Returns:
 *   'not-needed' — not checked in, or still the same IST day.
 *   'retry'      — boundary crossed but sync NOT 100% confirmed → tracking is
 *                  KEPT ALIVE and pings retained; call again later.
 *   'done'       — 100% synced + verified → tracking stopped, session closed.
 */
export async function maybeMidnightAutoCheckout(reason: string = 'auto'): Promise<'not-needed' | 'retry' | 'done'> {
  if (_midnightBusy) return 'retry';
  const { crossed, checkInDay } = await hasCrossedIstMidnight();
  if (!crossed) return 'not-needed';

  _midnightBusy = true;
  try {
    console.log(`[midnight] boundary crossed (checkInDay=${checkInDay}, reason=${reason}) — verifying 100% sync before stopping`);

    // STEP 1 — upload EVERYTHING and verify against MongoDB ground-truth.
    let res: any = null;
    try { res = await verifyAndHealAgainstMongo('midnight-auto-checkout'); } catch (e: any) {
      console.warn('[midnight] verify threw — will retry:', e?.message || e);
    }
    let pending = 1;
    try { pending = await getPendingCount(); } catch { pending = 1; }

    const fullySynced =
      !!res && res.status === 'Success' &&
      (res.stillMissing === 0 || res.stillMissing == null) &&
      pending === 0;

    // STEP 2 — if NOT 100% confirmed, DO NOT stop and DO NOT delete anything.
    if (!fullySynced) {
      console.warn(`[midnight] sync incomplete (pending=${pending}, stillMissing=${res?.stillMissing}) — KEEP tracking + retain pings, will retry`);
      return 'retry';
    }

    // STEP 3 — everything is confirmed on the server → stop tracking + close
    // the local session. From here persistLocation's checkedIn gate + the
    // stopped RNBG service means NO new pings are recorded until the next
    // manual Check In (which calls markCheckIn → fresh session).
    try { await stopBackgroundLocationUpdates('midnight-auto-checkout'); } catch {}
    try { await markCheckOut(); } catch {}
    console.log(`[midnight] ✓ auto-checkout complete for ${checkInDay} — all pings synced, tracking stopped`);
    return 'done';
  } finally {
    _midnightBusy = false;
  }
}

/**
 * Persist one location object to SQLite. Mirrors the save path in
 * locationTask.ts so the rest of the app (pingSync upload, bucket dedup,
 * checkout reconcile) is completely unaffected by the tracker swap.
 */
async function persistLocation(location: any): Promise<void> {
  try {
    const coords = location?.coords || {};
    const lat = coords.latitude;
    const lng = coords.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    await initPingStore();

    // #463 — SESSION GATE. Record ONLY while checked in AND on the same IST
    // day the session started.
    //   • Not checked in (already auto-closed / checked out) → skip. No pings
    //     after auto-checkout until the next manual Check In.
    //   • Day rolled over (forgot to check out) → DON'T write a new-day ping
    //     into the old session; fire the midnight finalizer instead. This is
    //     what prevents pings from two different days ever mixing.
    try {
      const st = await getTrackingState();
      if (!st?.checkedIn) return;
      if (st.checkInAt && istDateStr(st.checkInAt) < istDateStr(Date.now())) {
        maybeMidnightAutoCheckout('bg-callback').catch(() => {});
        return;
      }
    } catch { /* state unreadable — fail open and record so we never lose data */ }

    let userId = '';
    let employeeId = '';
    try {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        userId = u?._id || u?.id || u?.userId || '';
        employeeId = u?.employeeId || u?.userId || '';
      }
    } catch { /* still save with empty ids so coords survive */ }

    const recordedAtMs = Date.now();
    const rawAccuracy = typeof coords.accuracy === 'number' ? coords.accuracy : null;
    const speedVal    = typeof coords.speed === 'number' ? coords.speed : null;

    // #464 — Apply the anti-jitter guard. Decide the coordinates we actually
    // store/plot:
    //   • Accurate fix (≤ 50 m)          → trust it, and remember it as the
    //                                       last-good anchor.
    //   • Coarse fix (> 50 m) + a recent → SUBSTITUTE the last-good anchor so
    //     good anchor                       the point doesn't spike on the map;
    //                                       mark it stationary.
    //   • Coarse fix + no recent anchor  → keep it (better than nothing) so we
    //                                       never drop the only data we have.
    let outLat = lat;
    let outLng = lng;
    let outAccuracy = rawAccuracy;
    let outStationary = location?.is_moving === false;
    if (rawAccuracy != null && rawAccuracy <= GOOD_ACCURACY_M) {
      _lastGoodFix = { lat, lng, accuracy: rawAccuracy, ts: recordedAtMs };
    } else if (_lastGoodFix && (recordedAtMs - _lastGoodFix.ts) <= ANCHOR_MAX_AGE_MS) {
      outLat = _lastGoodFix.lat;
      outLng = _lastGoodFix.lng;
      outAccuracy = _lastGoodFix.accuracy;
      outStationary = true;   // held position → treat as not moving
      console.log('[bggeo] coarse fix', rawAccuracy, 'm → substituted last-good anchor (anti-spike)');
    }

    // Step 1 — ALWAYS save to SQLite first (source of truth / offline safety).
    const localId = await savePendingPing({
      userId: userId || undefined,
      employeeId: employeeId || undefined,
      lat: outLat,
      lng: outLng,
      accuracy: outAccuracy,
      speed: speedVal,
      isStationary: outStationary,
      recordedAt: recordedAtMs,
      bucket: bucketFor(recordedAtMs),
    } as any);

    // Heartbeat marker so the existing foreground guardian still sees the
    // tracker as "alive" (it reads this same AsyncStorage key).
    try { await AsyncStorage.setItem(HEARTBEAT_KEY, new Date().toISOString()); } catch {}
    console.log('[bggeo] ping stored', { lat: Number(outLat).toFixed(5), lng: Number(outLng).toFixed(5), acc: outAccuracy, moving: !outStationary });

    // Step 2 — #461 REAL-TIME LIVE TRACKING. Immediately POST this ping to the
    // realtime endpoint from inside the RNBG callback. Why this matters:
    //   • RNBG keeps this JS callback running in the background AND in the
    //     headless (app-terminated) task, so this upload fires without the app
    //     being opened — unlike the JS pingSync timers, which the OS throttles
    //     when backgrounded (that was why HRMS only refreshed on app-open).
    //   • The realtime endpoint updates User.lastLocation + presence:'active' +
    //     lastSeenAt AND appends a LocationPing, so the HRMS live map follows
    //     the newest ping and the employee stays Online while pings arrive.
    // On any failure the row simply stays 'pending' and the existing pingSync /
    // 10-min verify batch retries it — no data loss, no duplicates (server
    // dedupes by (user,date,bucket)).
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        const res = await fetch(`${BGGEO_BASE_URL}/api/attendance/location-ping`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            lat: outLat,
            lng: outLng,
            accuracy: outAccuracy,
            speed: speedVal,
            isStationary: outStationary,
            recordedAt: new Date(recordedAtMs).toISOString(),
            source: 'bggeo',
          }),
        });
        if (res.ok && typeof localId === 'number' && localId > 0) {
          try { await markPingSynced(localId); } catch {}
        }
      }
    } catch (e: any) {
      // Offline / server asleep — keep it pending for the retry path.
      console.log('[bggeo] realtime upload deferred (stays pending):', e?.message || e);
    }
  } catch (e: any) {
    console.log('[bggeo] persistLocation failed (non-fatal):', e?.message || e);
  }
}

/** Bind the event listeners exactly once. */
function bindListeners(): void {
  if (!BGGeo || _listenersBound) return;
  try {
    // Fires on every real movement sample.
    BGGeo.onLocation(
      (loc: any) => { persistLocation(loc); },
      (err: any) => { console.log('[bggeo] onLocation error:', err); },
    );
    // Fires every heartbeatInterval seconds while stationary — this is what
    // guarantees a ping every 2 min even when the employee doesn't move.
    BGGeo.onHeartbeat(async () => {
      try {
        const loc = await BGGeo.getCurrentPosition({ samples: 1, persist: true, timeout: 30 });
        await persistLocation(loc);
      } catch (e: any) {
        console.log('[bggeo] heartbeat getCurrentPosition failed:', e?.message || e);
      }
    });
    _listenersBound = true;
  } catch (e: any) {
    console.log('[bggeo] bindListeners threw:', e?.message || e);
  }
}

/** Configure the plugin once. Safe to call repeatedly. */
async function configure(): Promise<boolean> {
  if (!BGGeo) return false;
  if (_configured) return true;
  bindListeners();
  return new Promise<boolean>((resolve) => {
    try {
      BGGeo.ready(
        {
          // ── Geolocation ────────────────────────────────────────────
          desiredAccuracy: BGGeo.DESIRED_ACCURACY_HIGH,
          distanceFilter: 0,                    // report every sample, even stationary
          locationUpdateInterval: 120000,       // Android: 2-min cadence (needs distanceFilter:0)
          fastestLocationUpdateInterval: 120000,
          // #462 — CONTINUOUS STATIONARY TRACKING.
          // RNBG is motion-based by default: when the device stops moving it
          // drops into a "stationary" state and STOPS sampling GPS, relying
          // only on the heartbeat. On aggressive OEMs the heartbeat gets
          // deferred by Doze, producing the multi-minute GAPS seen in
          // ping-debug (e.g. 17:14 → 17:25). disableStopDetection keeps the
          // location engine RUNNING continuously so locationUpdateInterval
          // fires every 2 min whether or not the employee is moving — no
          // reliance on the heartbeat surviving Doze. Costs more battery, but
          // that's the trade for a guaranteed 2-min cadence.
          disableStopDetection: true,
          // Don't let RNBG auto-pause when it *thinks* you're stationary.
          pausesLocationUpdatesAutomatically: false,
          // Activity-recognition was the crash source and adds no value here
          // (we track continuously, not by motion type) — disable its polling.
          disableMotionActivityUpdates: true,
          // Keep GPS warm between fixes so a stationary sample isn't a cold
          // start every 2 min.
          stationaryRadius: 25,
          // ── Stationary 2-min guarantee (belt-and-braces heartbeat) ─────
          heartbeatInterval: 120,               // seconds
          preventSuspend: true,                 // keep firing heartbeats when idle
          // ── Activity / lifecycle ───────────────────────────────────
          stopTimeout: 5,
          stopOnTerminate: false,               // keep tracking if the app is swiped away
          startOnBoot: true,                    // resume after device reboot
          enableHeadless: true,                 // run when JS/app is terminated (Android)
          foregroundService: true,              // required for background location on Android
          backgroundPermissionRationale: {
            title: 'Allow Tesco ERM to access location in the background?',
            message: 'HR needs your live location between Check In and Check Out, even when the app is closed.',
            positiveAction: 'Allow',
            negativeAction: 'Cancel',
          },
          notification: {
            title: 'Tesco ERM · Live tracking active',
            text: 'Sharing your location with HR until you check out.',
            sticky: true,
          },
          // ── Misc ───────────────────────────────────────────────────
          debug: false,
          logLevel: BGGeo.LOG_LEVEL_OFF,
        },
        (_state: any) => { _configured = true; resolve(true); },
        (err: any) => { console.log('[bggeo] ready failed:', err); resolve(false); },
      );
    } catch (e: any) {
      console.log('[bggeo] configure threw:', e?.message || e);
      resolve(false);
    }
  });
}

// #462 — OEM RELIABILITY PROMPT. On Xiaomi/Oppo/Vivo/Realme the OS will freeze
// the app (Doze / battery manager) and cut background tracking regardless of
// code — the multi-minute gaps you saw. RNBG's deviceSettings API detects the
// exact OEM and opens the precise screen the user must toggle:
//   • Ignore Battery Optimizations (all Android)
//   • the OEM "Power Manager" / Auto-start screen (Xiaomi/Oppo/Vivo/etc.)
// We show each at most ONCE per install (RNBG's request.seen already tracks
// this, and we add our own flag as a backstop) so employees aren't nagged
// every Check In. Fully guarded: any API difference just logs and continues.
const OEM_PROMPT_DONE_KEY = 'erm-bggeo-oem-prompt-done-v1';
async function promptDeviceReliability(): Promise<void> {
  if (!BGGeo || !BGGeo.deviceSettings) return;
  try {
    const already = await AsyncStorage.getItem(OEM_PROMPT_DONE_KEY);
    if (already === '1') return;
    // 1) Battery optimization exemption.
    try {
      const ignoring = await BGGeo.deviceSettings.isIgnoringBatteryOptimizations();
      if (!ignoring) {
        const req = await BGGeo.deviceSettings.showIgnoreBatteryOptimizations();
        if (req && !req.seen) { await BGGeo.deviceSettings.show(req); }
      }
    } catch (e: any) { console.log('[bggeo] battery-opt prompt skipped:', e?.message || e); }
    // 2) OEM power-manager / auto-start screen (no-op on stock Android).
    try {
      const req = await BGGeo.deviceSettings.showPowerManager();
      if (req && !req.seen) { await BGGeo.deviceSettings.show(req); }
    } catch (e: any) { console.log('[bggeo] power-manager prompt skipped:', e?.message || e); }
    try { await AsyncStorage.setItem(OEM_PROMPT_DONE_KEY, '1'); } catch {}
  } catch (e: any) {
    console.log('[bggeo] promptDeviceReliability failed (non-fatal):', e?.message || e);
  }
}

/**
 * Start continuous tracking. Called at Check In (and cold-boot resume /
 * guardian). Idempotent — configure()+start() are safe to re-invoke.
 * Returns true on success, false if the native module isn't linked.
 */
export async function startBackgroundLocationUpdates(): Promise<boolean> {
  if (!BGGeo) { console.log('[bggeo] library not linked — tracking unavailable'); return false; }
  try {
    const ok = await configure();
    if (!ok) return false;
    const state = await BGGeo.getState();
    if (!state.enabled) {
      await BGGeo.start();
    }
    // Force it out of the stationary state so tracking begins immediately even
    // if the employee is sitting still at Check In.
    try { await BGGeo.changePace(true); } catch {}
    console.log('[bggeo] tracking started');
    // #462 — walk the user to the OEM battery/auto-start screens once, so the
    // OS stops freezing the tracker. Fire-and-forget; never blocks tracking.
    promptDeviceReliability().catch(() => {});
    return true;
  } catch (e: any) {
    console.log('[bggeo] start failed:', e?.message || e);
    return false;
  }
}

/** Stop tracking. Called ONLY at Check Out / logout. Idempotent. */
export async function stopBackgroundLocationUpdates(reason: string = 'manual'): Promise<void> {
  if (!BGGeo) return;
  try {
    const state = await BGGeo.getState();
    if (state.enabled) {
      await BGGeo.stop();
    }
    console.log('[bggeo] tracking stopped (' + reason + ')');
  } catch (e: any) {
    console.log('[bggeo] stop failed:', e?.message || e);
  }
}

/**
 * Revive tracking (called by the foreground guardian). With RNBG's own
 * foreground service + startOnBoot this is rarely needed, but keeping the
 * same signature means the guardian code in index.tsx is untouched.
 */
export async function reviveBackgroundLocationUpdates(_reason: string): Promise<boolean> {
  return startBackgroundLocationUpdates();
}

// ── HEADLESS TASK (Android, app terminated) ──────────────────────────────
// When `stopOnTerminate:false` + `enableHeadless:true`, the OS wakes the app
// in a headless JS context (no UI) to deliver location/heartbeat events after
// the app has been swiped away. RNBG requires a HeadlessTask to be REGISTERED
// AT BUNDLE LOAD (module scope), not inside a component — otherwise those
// terminated-state events are dropped. This module is imported at startup by
// app/_layout.tsx so this runs early enough.
if (BGGeo && typeof BGGeo.registerHeadlessTask === 'function') {
  try {
    BGGeo.registerHeadlessTask(async (event: any) => {
      try {
        const name = event?.name;
        const params = event?.params;
        if (name === 'location' && params?.location) {
          await persistLocation(params.location);
        } else if (name === 'heartbeat') {
          // In headless heartbeat, request a fresh fix and store it — this is
          // the 2-min stationary ping while the app is fully terminated.
          try {
            const loc = await BGGeo.getCurrentPosition({ samples: 1, persist: true, timeout: 30 });
            await persistLocation(loc);
          } catch { /* no fix this cycle — next heartbeat retries */ }
        }
      } catch (e: any) {
        console.log('[bggeo] headless task error (non-fatal):', e?.message || e);
      }
    });
  } catch (e: any) {
    console.log('[bggeo] registerHeadlessTask failed (non-fatal):', e?.message || e);
  }
}
