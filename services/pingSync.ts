/**
 * #409 — Ping queue flusher + network-restore listener.
 *
 * Two entry points:
 *
 *   flushPendingPings()  — Drain pending pings to the backend in
 *                          chronological order. Marks each as synced
 *                          on 2xx; leaves them pending + bumps
 *                          retryCount on failure.
 *
 *   startPingSyncListener()  — Registers a NetInfo listener so the
 *                              queue flushes automatically the moment
 *                              connectivity is restored. Also flushes
 *                              once on registration in case pings
 *                              piled up while offline before the app
 *                              was closed.
 *
 * NEVER call flush concurrently with itself — a simple `_flushing`
 * flag guards against a NetInfo event landing while a flush is
 * already in progress.
 */

import {
  listPendingPings,
  listAllPingsSince,
  markPingSynced,
  markPingFailed,
  getPendingCount,
  deleteSyncedPingsInRange,
  getTrackingState,
  isUploadAllowedNow,
} from './pingStore';
import { attendanceAPI } from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* eslint-disable @typescript-eslint/no-explicit-any */

let _flushing = false;
let _lastFlushAt = 0;
let _listenerAttached = false;

// Max rows to send per drain cycle. Kept modest so the network
// interceptor's retry backoff doesn't monopolise the queue.
const FLUSH_BATCH = 50;
// Backoff between individual sends inside one drain — polite to Render.
const INTER_SEND_MS = 50;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Drain pending rows. Returns { sent, failed, remaining }.
 * Safe to call concurrently — will no-op if a flush is already running.
 */
export async function flushPendingPings(reason: string = 'manual'): Promise<{ sent: number; failed: number; remaining: number }> {
  if (_flushing) {
    return { sent: 0, failed: 0, remaining: await getPendingCount() };
  }
  _flushing = true;
  _lastFlushAt = Date.now();
  let sent = 0;
  let failed = 0;
  try {
    const rows = await listPendingPings(FLUSH_BATCH);
    if (rows.length === 0) {
      return { sent: 0, failed: 0, remaining: 0 };
    }
    console.log(`[pingSync] flush start (${reason}) — ${rows.length} pending`);
    for (const row of rows) {
      try {
        // The wrapper already handles auth + interceptors. We call the
        // API function directly (not the burst-guarded shorthand) so
        // queued rows never get skipped by the 110-s guard.
        const res = await attendanceAPI.locationPing(
          row.lat,
          row.lng,
          row.accuracy ?? undefined,
          row.speed ?? undefined,
          !!row.isStationary,
          // The 4th sig accepts an override options bag on some codepaths;
          // ignoring extras keeps this compatible with the current signature.
        );
        // #433 — Only count a row as SYNCED when the server actually STORED
        // it. A 200 with accepted:false (accuracy-gated / burst-guarded /
        // server bucket collision) does NOT mean the ping is in Mongo, so we
        // must NOT mark it synced — that would flag an unstored row as
        // safe-to-delete. Real success or a genuine duplicate-bucket (already
        // in Mongo) count as stored; anything else stays pending for the
        // batch reconciliation to ship.
        const d: any = (res as any)?.data || {};
        const stored = d.ok === true && (d.accepted !== false || d.reason === 'duplicate-bucket');
        if (stored) {
          if (row.localId) await markPingSynced(row.localId);
          sent += 1;
        } else {
          if (row.localId) await markPingFailed(row.localId, `not-stored:${d.reason || res?.status}`);
          failed += 1;
        }
      } catch (err: any) {
        if (row.localId) await markPingFailed(row.localId, err?.message || 'network');
        failed += 1;
        // A single failed row usually means we've lost connectivity again.
        // Stop the batch — the next NetInfo restore or scheduled flush
        // will pick up where we left off.
        break;
      }
      await sleep(INTER_SEND_MS);
    }
    const remaining = await getPendingCount();
    console.log(`[pingSync] flush done — sent=${sent} failed=${failed} remaining=${remaining}`);
    return { sent, failed, remaining };
  } finally {
    _flushing = false;
  }
}

/**
 * Wire a NetInfo listener that auto-flushes the queue whenever the
 * device transitions from offline → online. Also fires a one-shot
 * flush at listener-registration time so pings queued during the
 * previous app run (or during backend downtime) are drained on
 * cold-boot.
 */
export function startPingSyncListener(): () => void {
  if (_listenerAttached) return () => {};
  _listenerAttached = true;

  // #430 — STRICT upload gate for the always-on background sync listener.
  // Uploads are permitted ONLY while the employee is checked OUT — this is
  // the leftover-batch retry path for a checkout whose upload failed. While
  // the employee is checked in, SQLite is the sole source of truth and NO
  // ping is uploaded; every tick below no-ops. The single sanctioned
  // upload during a session's lifecycle is finalCheckoutSyncAndCleanup(),
  // which is NOT routed through this gate.
  const flushIfCheckedOut = async (reason: string) => {
    try { if (!(await isUploadAllowedNow())) { return; } } catch { return; }
    flushPendingPings(reason).catch(() => {});
  };
  const syncIfCheckedOut = async (reason: string) => {
    try { if (!(await isUploadAllowedNow())) { return; } } catch { return; }
    syncMissingPingsFromLocal(reason).catch(() => {});
  };

  let unsub: (() => void) | null = null;
  let periodic: any = null;
  let wasConnected = true;

  // Try NetInfo. If the package isn't installed yet we still fall back
  // to a plain 60-second periodic flush — the queue drains as soon as
  // connectivity is back on the very next tick.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require('@react-native-community/netinfo');
    unsub = NetInfo.addEventListener((state: any) => {
      const online = !!(state?.isConnected && state?.isInternetReachable !== false);
      if (online && !wasConnected) {
        // #430 — Only retries leftover pings while checked OUT (no-op
        // during a working session).
        console.log('[pingSync] connectivity restored — flushing queue (if checked out)');
        flushIfCheckedOut('netinfo-restore');
        // #416 — Also run the batch missing-pings sync on restore.
        // Belt-and-braces: if the per-row flush missed anything (bg-task
        // pings that never went through the SQLite queue historically),
        // the batch endpoint will pick them up.
        syncIfCheckedOut('netinfo-restore');
      }
      wasConnected = online;
    });
  } catch {
    console.log('[pingSync] @react-native-community/netinfo not installed — using periodic flush only');
  }

  // Belt-and-braces periodic drain: every 60 s try to flush. Costs
  // nothing when the queue is empty (single COUNT query).
  // #416 — Additionally run the batch missing-pings sync every 5 minutes
  // (idempotent, dedups server-side) so any ping that slipped through
  // the per-row flush eventually reaches the DB.
  periodic = setInterval(() => {
    flushIfCheckedOut('periodic');
  }, 60_000);
  const missingPingsTimer = setInterval(() => {
    syncIfCheckedOut('periodic-5min');
  }, 5 * 60_000);

  // One-shot flush on registration so cold-boot doesn't wait for the
  // first NetInfo event. #430 — gated: only retries leftover pings when
  // the employee is checked out.
  flushIfCheckedOut('startup');
  // #416 — Also run one-shot missing-pings sync on startup (gated).
  syncIfCheckedOut('startup');

  return () => {
    _listenerAttached = false;
    if (unsub) try { unsub(); } catch {}
    if (periodic) clearInterval(periodic);
    // #427 — CRITICAL. The 5-min missing-pings timer was leaking on
    // every logout. It kept firing forever, each tick POSTing to
    // /location-pings/missing-pings with a wiped token. Every response
    // interceptor 401 → forceLogout → race with the new user's login
    // in progress. On repeat logins this doubled up: two timers, two
    // 401s per cycle. Explicit clear closes the leak permanently.
    if (missingPingsTimer) clearInterval(missingPingsTimer);
  };
}

export function lastFlushAt(): number { return _lastFlushAt; }

// ─────────────────────────────────────────────────────────────────────
// #416 — Batch reconciliation with the missing-pings endpoint
// ─────────────────────────────────────────────────────────────────────

// AsyncStorage already imported at the top of this file.

/** Format an epoch ms into "YYYY-MM-DD" and "HH:mm:ss" in IST (Asia/Kolkata). */
function toIstDateAndTime(ms: number): { date: string; localTime: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const g = (t: string) => (parts.find(p => p.type === t)?.value || '').padStart(2, '0');
    let hh = g('hour');
    if (hh === '24') hh = '00';
    return { date: `${g('year')}-${g('month')}-${g('day')}`, localTime: `${hh}:${g('minute')}:${g('second')}` };
  } catch {
    const d = new Date(ms + 5.5 * 3600 * 1000);
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), localTime: iso.slice(11, 19) };
  }
}

let _syncMissingInFlight = false;

/**
 * #416 — Read EVERY pending ping from SQLite, ship them to
 * /attendance/location-pings/missing-pings as one chronologically-ordered
 * batch, then mark them synced only after the server confirms they exist
 * (either just-inserted or already-existed).
 *
 * Guarantees:
 *   • SQLite is the source of truth. A row is never removed/marked synced
 *     unless the server response confirms it (insertedBuckets ∪ existedBuckets).
 *   • Idempotent. Repeat calls upload the same buckets again; server
 *     reports them as `alreadyExisted` and the client still marks them synced.
 *   • Chronological order preserved both client-side (listPendingPings
 *     orders by recorded_at ASC) and server-side (insertMany after sort).
 *
 * Returns the server summary + local counts so callers can log verbosely.
 */
export async function syncMissingPingsFromLocal(reason: string = 'manual'): Promise<{
  status: 'Success' | 'Failed' | 'Idle';
  totalLocal: number;
  totalReceived: number;
  alreadyExisted: number;
  inserted: number;
  duplicatesSkipped: number;
  markedSynced: number;
}> {
  if (_syncMissingInFlight) {
    console.log(`[missing-pings] ${reason}: already running — skipping`);
    return { status: 'Idle', totalLocal: 0, totalReceived: 0, alreadyExisted: 0, inserted: 0, duplicatesSkipped: 0, markedSynced: 0 };
  }
  _syncMissingInFlight = true;
  try {
    // Step 1 — Read every locally-stored ping in the last 30 days (both
    // `pending` AND `synced`). We ship them all to the server so the
    // backend can detect gaps a previous realtime POST may have missed
    // (Render mid-flight process kill, brief connectivity flap, or a row a
    // live POST optimistically marked 'synced' but the server never actually
    // stored) and heal them. The backend dedups by (user, date, bucket) so
    // re-sending synced rows is safe — already-stored ones land as
    // `alreadyExisted`, genuinely-missing ones get INSERTED.
    // #433 — Widened 3d → 30d so it matches the checkout/reconcile delete
    // window: a row must be re-verified (re-shipped) before it can ever be
    // deleted, even from a session left un-checked-out for weeks.
    const windowStart = Date.now() - 30 * 24 * 3600 * 1000;
    let rows = await listAllPingsSince(windowStart);
    // Belt-and-braces: if the backend fallback returned nothing (e.g.
    // AsyncStorage-only mode), still send the pending queue.
    if (rows.length === 0) {
      rows = await listPendingPings(1000);
    }
    const totalLocal = rows.length;
    const pendingCount = rows.filter(r => r.status !== 'synced').length;
    console.log(
      `[missing-pings] ${reason}: total pings found in local storage = ${totalLocal} ` +
      `(pending=${pendingCount}, synced=${totalLocal - pendingCount})`
    );
    if (totalLocal === 0) {
      return { status: 'Success', totalLocal: 0, totalReceived: 0, alreadyExisted: 0, inserted: 0, duplicatesSkipped: 0, markedSynced: 0 };
    }

    // Step 2 — Resolve employeeId from AsyncStorage `user` object.
    let employeeId = '';
    try {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        employeeId = u?.employeeId || u?.userId || '';
      }
    } catch { /* non-fatal */ }

    // Step 3 — Build the payload. Each ping carries the fields the
    // endpoint expects: employeeId + date + localTime + latitude +
    // longitude. Extra fields (accuracy/speed/isStationary/bucket) are
    // forwarded verbatim so HR's polyline data is preserved.
    const payload = rows.map(r => {
      const { date, localTime } = toIstDateAndTime(r.recordedAt);
      return {
        employeeId: r.employeeId || employeeId,
        date,
        localTime,
        latitude:  r.lat,
        longitude: r.lng,
        accuracy:     r.accuracy ?? null,
        speed:        r.speed ?? null,
        isStationary: r.isStationary === true,
        bucket:       r.bucket,
        // #434 — Mark rows uploaded from the device's local SQLite store.
        source:       'sqlite',
      };
    });

    // Step 4 — Call the API.
    let res: any;
    try {
      res = await attendanceAPI.syncMissingPings(payload);
    } catch (err: any) {
      console.log(`[missing-pings] ${reason}: FAILED network — ${err?.message || err}`);
      return { status: 'Failed', totalLocal, totalReceived: 0, alreadyExisted: 0, inserted: 0, duplicatesSkipped: 0, markedSynced: 0 };
    }
    const body = res?.data || {};
    if (!body?.success || body?.status !== 'Success') {
      console.log(`[missing-pings] ${reason}: server rejected — status=${body?.status || 'unknown'}`);
      return { status: 'Failed', totalLocal, totalReceived: 0, alreadyExisted: 0, inserted: 0, duplicatesSkipped: 0, markedSynced: 0 };
    }

    // Step 5 — Mark local rows synced. Server-confirmed buckets are the
    // union of `insertedBuckets` (just written) + `existedBuckets` (dedup
    // hits — server already has them). Any row whose bucket isn't in
    // that union stays pending and will retry on the next sync tick.
    const okBuckets = new Set<number>([
      ...(Array.isArray(body.insertedBuckets) ? body.insertedBuckets : []),
      ...(Array.isArray(body.existedBuckets)  ? body.existedBuckets  : []),
    ].map(Number));

    let markedSynced = 0;
    for (const row of rows) {
      if (row.localId && okBuckets.has(row.bucket)) {
        try { await markPingSynced(row.localId); markedSynced += 1; } catch {}
      }
    }

    console.log(
      `[missing-pings] ${reason}: DONE ` +
      `local=${totalLocal} received=${body.totalReceived ?? '?'} ` +
      `existing=${body.alreadyExisted ?? 0} uploaded=${body.inserted ?? 0} ` +
      `dup-skipped=${body.duplicatesSkipped ?? 0} marked-synced=${markedSynced} ` +
      `status=Success`
    );

    return {
      status:            'Success',
      totalLocal,
      totalReceived:     Number(body.totalReceived) || 0,
      alreadyExisted:    Number(body.alreadyExisted) || 0,
      inserted:          Number(body.inserted) || 0,
      duplicatesSkipped: Number(body.duplicatesSkipped) || 0,
      markedSynced,
    };
  } finally {
    _syncMissingInFlight = false;
  }
}

/**
 * #420 — CHECKOUT FINAL-SYNC + SAFE PER-SESSION CLEANUP.
 *
 * HR requirement (Jul 2026):
 *   • SQLite is the source of truth WHILE the employee is checked in.
 *     Every 2-min ping lands there first, POSTs to the server, and is
 *     flipped to `synced` once the server 2xx-confirms receipt.
 *   • ON CHECKOUT the app MUST run one last reconciliation sync so any
 *     ping still stuck as `pending` (bg-task tick that lost network,
 *     Render 5xx, cold-start 401, etc.) reaches the server before the
 *     shift closes.
 *   • ONLY after the server confirms every ping is stored may the client
 *     delete those confirmed rows from SQLite. Pending rows STAY — they
 *     retry on their own next connectivity restore.
 *   • The delete is SCOPED to the current session: rows recorded between
 *     the last checkInAt and now. A future check-in's pings must not be
 *     touched (in the unusual case someone races the buttons).
 *   • If the sync fails / is interrupted / device is offline → nothing
 *     is deleted. All rows remain in SQLite and will be retried by the
 *     periodic sync listener or the next cold-boot resume.
 *   • Only after the cleanup phase succeeds (or is explicitly skipped
 *     because sync failed) do we stop background location tracking.
 *
 * The caller is responsible for stopping the FG/BG task after this
 * function returns `status: 'Success'` (or after logging & retaining
 * data on `status: 'Failed'`). This split keeps the sync concern
 * separate from the OS-service teardown concern.
 *
 * Detailed logs are emitted at every step so HR / on-call can trace
 * exactly what happened on any given checkout.
 */
export async function finalCheckoutSyncAndCleanup(sessionStartMsHint?: number): Promise<{
  status: 'Success' | 'Failed' | 'PartialFailure';
  pendingBefore: number;
  uploaded: number;
  alreadyExisted: number;
  markedSynced: number;
  deletedFromLocal: number;
  retainedForRetry: number;
  errorReason?: string;
  sessionFromMs: number;
  sessionToMs: number;
}> {
  const sessionToMs = Date.now();

  // Step 0 — Log checkout initiated.
  console.log(`[checkout-sync] ⇢ Checkout initiated at ${new Date(sessionToMs).toISOString()}`);

  // Step 1 — Resolve the session window. Prefer the caller's hint (the
  // Home screen knows the exact checkInAt of the session being closed).
  // Fallback: read the persisted tracking state. Ultimate fallback: use
  // 24 h ago so we still cover any reasonable single-day session.
  let sessionFromMs = 0;
  if (Number.isFinite(sessionStartMsHint) && (sessionStartMsHint as number) > 0) {
    sessionFromMs = sessionStartMsHint as number;
  } else {
    try {
      const st = await getTrackingState();
      if (st && st.checkInAt) sessionFromMs = Number(st.checkInAt) || 0;
    } catch { /* non-fatal */ }
  }
  if (!Number.isFinite(sessionFromMs) || sessionFromMs <= 0) {
    sessionFromMs = sessionToMs - 24 * 3600 * 1000;
  }
  // Guard: if session range is inverted (clock skew, wrong hint), fall
  // back to the safe 24-h window rather than deleting nothing.
  if (sessionFromMs >= sessionToMs) sessionFromMs = sessionToMs - 24 * 3600 * 1000;

  console.log(
    `[checkout-sync] session window: ` +
    `${new Date(sessionFromMs).toISOString()} → ${new Date(sessionToMs).toISOString()}`
  );

  // Step 2 — Count pending pings BEFORE we do anything, so we can log
  // exactly how many rows were still owed to the server at checkout.
  let pendingBefore = 0;
  try { pendingBefore = await getPendingCount(); } catch {}
  console.log(`[checkout-sync] pending pings found in SQLite = ${pendingBefore}`);

  // Step 3 — Upload every pending ping to MongoDB, RETRYING until the
  // local pending count reaches 0 or we exhaust the attempt budget. The
  // batch endpoint is idempotent (server dedups by bucket), so re-sending
  // is always safe. Each attempt ships the full local view and marks
  // server-confirmed rows synced; a row only stays pending if the server
  // did NOT confirm its bucket that round.
  //
  // Bounded here (won't block checkout forever). Any rows still pending
  // after the budget are RETAINED — the checked-out background sync
  // listener keeps retrying them on every 60s tick / connectivity restore
  // until they all land, so nothing is ever lost.
  console.log(`[checkout-sync] ⇢ Upload started — retrying until every pending ping is synced`);
  const MAX_ATTEMPTS = 5;
  const BACKOFF_MS = [0, 1500, 3000, 5000, 8000];
  let syncRes: Awaited<ReturnType<typeof syncMissingPingsFromLocal>> | null = null;
  let pendingNow = pendingBefore;
  let attempt = 0;
  let lastError = '';

  while (attempt < MAX_ATTEMPTS) {
    if (BACKOFF_MS[attempt]) await sleep(BACKOFF_MS[attempt]);
    attempt += 1;
    console.log(`[checkout-sync] ⇢ Upload attempt ${attempt}/${MAX_ATTEMPTS} (pending=${pendingNow})`);
    try {
      syncRes = await syncMissingPingsFromLocal('checkout-final');
    } catch (err: any) {
      lastError = err?.message || String(err || 'unknown');
      console.log(`[checkout-sync] ✘ attempt ${attempt} threw: ${lastError} — will retry`);
      continue;
    }
    // Re-measure the authoritative pending count after this attempt.
    try { pendingNow = await getPendingCount(); } catch {}
    if (syncRes.status === 'Success' && pendingNow === 0) {
      console.log(`[checkout-sync] ✔ every pending ping synced on attempt ${attempt}`);
      break;
    }
    console.log(
      `[checkout-sync] attempt ${attempt} incomplete — status=${syncRes?.status} ` +
      `uploaded=${syncRes?.inserted ?? 0} existing=${syncRes?.alreadyExisted ?? 0} ` +
      `stillPending=${pendingNow} — retrying`
    );
  }

  // If we never got any usable server response, retain everything and let
  // the background retry loop (checked-out only) finish the job later.
  if (!syncRes) {
    console.log(`[checkout-sync] ✘ Upload failed after ${MAX_ATTEMPTS} attempts — retaining ALL ${pendingNow} local row(s) for retry.`);
    return {
      status: 'Failed',
      pendingBefore,
      uploaded: 0,
      alreadyExisted: 0,
      markedSynced: 0,
      deletedFromLocal: 0,
      retainedForRetry: pendingNow,
      errorReason: lastError || 'upload-failed-all-attempts',
      sessionFromMs,
      sessionToMs,
    };
  }

  // Got a response. Log the spec-mandated counts.
  //   • uploaded          = rows the server just INSERTed              (syncRes.inserted)
  //   • storedInMongo     = rows the server CONFIRMS it holds for this
  //                         batch = inserted + already-existed         (serverConfirmed)
  const serverConfirmed = syncRes.inserted + syncRes.alreadyExisted;
  console.log(`[checkout-sync] ▸ Upload started`);
  console.log(`[checkout-sync] ▸ Pings uploaded (newly inserted)      = ${syncRes.inserted}`);
  console.log(`[checkout-sync] ▸ Pings confirmed stored in MongoDB    = ${serverConfirmed} (inserted ${syncRes.inserted} + alreadyExisted ${syncRes.alreadyExisted})`);

  // ─── Step 4: VERIFY BEFORE DELETING (spec requirements 4 + 5) ───────
  // All-or-nothing gate. We only delete local rows if EVERY ping that was
  // pending before checkout is now server-confirmed. We measure that two
  // independent ways and require BOTH to agree:
  //   (a) the mark-synced loop flipped at least `pendingBefore` rows, and
  //   (b) a fresh SQLite pending count is now 0.
  // If either check fails → DELETE NOTHING and retain every row for retry.
  let pendingAfterSync = pendingBefore;
  try { pendingAfterSync = await getPendingCount(); } catch {}

  const countsMatch    = pendingAfterSync === 0 && syncRes.markedSynced >= pendingBefore;
  const verificationOk = syncRes.status === 'Success' && countsMatch;

  console.log(
    `[checkout-sync] ▸ Verification (SQLite vs MongoDB): ` +
    `pendingBefore=${pendingBefore}, serverConfirmed=${serverConfirmed}, ` +
    `markedSynced=${syncRes.markedSynced}, pendingAfter=${pendingAfterSync} → ` +
    `${verificationOk ? 'PASS ✅ (safe to delete)' : 'FAIL ❌ (retain all)'}`
  );

  if (!verificationOk) {
    // Spec #5 — counts don't match / not every ping confirmed. Delete
    // NOTHING; keep all pending pings in SQLite for a future retry
    // (which runs only while checked out).
    console.log(
      `[checkout-sync] ✘ Verification FAILED — NOT deleting any local records. ` +
      `${pendingAfterSync} ping(s) retained in SQLite for retry.`
    );
    console.log(`[checkout-sync] ▸ Remaining records in SQLite after cleanup = ${pendingAfterSync}`);
    return {
      status: 'PartialFailure',
      pendingBefore,
      uploaded: syncRes.inserted,
      alreadyExisted: syncRes.alreadyExisted,
      markedSynced: syncRes.markedSynced,
      deletedFromLocal: 0,
      retainedForRetry: pendingAfterSync,
      errorReason: 'verification-mismatch',
      sessionFromMs,
      sessionToMs,
    };
  }

  // Verification passed — every pending ping is confirmed in MongoDB.
  // Now (and ONLY now) delete this session's synced rows from SQLite.
  let deletedFromLocal = 0;
  try {
    deletedFromLocal = await deleteSyncedPingsInRange(sessionFromMs, sessionToMs);
    console.log(`[checkout-sync] ✔ Local records deleted = ${deletedFromLocal} row(s) purged from session window`);
  } catch (err: any) {
    const reason = err?.message || String(err || 'unknown');
    console.log(`[checkout-sync] ⚠ Local delete failed (non-fatal): ${reason}`);
    console.log(`[checkout-sync] rows will be purged by purgeSyncedOlderThanDays on a later cycle`);
    let remaining = 0;
    try { remaining = await getPendingCount(); } catch {}
    return {
      status: 'PartialFailure',
      pendingBefore,
      uploaded: syncRes.inserted,
      alreadyExisted: syncRes.alreadyExisted,
      markedSynced: syncRes.markedSynced,
      deletedFromLocal: 0,
      retainedForRetry: remaining,
      errorReason: 'delete-failed: ' + reason,
      sessionFromMs,
      sessionToMs,
    };
  }

  let remainingAfter = 0;
  try { remainingAfter = await getPendingCount(); } catch {}
  console.log(`[checkout-sync] ▸ Remaining records in SQLite after cleanup = ${remainingAfter}`);
  console.log(
    `[checkout-sync] ✔ Checkout sync complete: ` +
    `storedBefore=${pendingBefore} uploaded=${syncRes.inserted} ` +
    `confirmedInMongo=${serverConfirmed} deletedFromLocal=${deletedFromLocal} ` +
    `remaining=${remainingAfter}`
  );

  return {
    status: 'Success',
    pendingBefore,
    uploaded: syncRes.inserted,
    alreadyExisted: syncRes.alreadyExisted,
    markedSynced: syncRes.markedSynced,
    deletedFromLocal,
    retainedForRetry: remainingAfter,
    sessionFromMs,
    sessionToMs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// #432 — PREVIOUS-SESSION RECONCILIATION
//
// Handles pings left behind by a session that was never manually checked
// out (e.g. employee forgot to check out on July 15). Called from CHECKED-
// OUT contexts — app startup, login, and immediately BEFORE a new tracking
// session starts — so it's always safe to upload + delete here.
//
// Contract:
//   • If pending pings exist → upload them (retrying until synced),
//     verify against MongoDB, and delete ONLY server-confirmed rows.
//   • If none pending but old SYNCED rows are lingering → purge them
//     (already in MongoDB, so lossless) so local storage doesn't grow
//     without bound.
//   • On any failure, everything is retained and retried later — no data
//     is ever deleted before MongoDB confirms it.
// ─────────────────────────────────────────────────────────────────────
export async function reconcilePreviousSessions(reason: string = 'startup'): Promise<{
  status: 'Success' | 'Failed' | 'PartialFailure' | 'Idle';
  pending: number;
  uploaded: number;
  deleted: number;
  retained: number;
}> {
  try {
    const pending = await getPendingCount();
    if (pending > 0) {
      // Ownership guard — only upload pings that belong to the CURRENTLY
      // logged-in user. The batch endpoint attributes rows by the caller's
      // JWT, so uploading a previous user's leftover pings under a new
      // user's token would misattribute them. If they belong to someone
      // else, retain them untouched (they'll upload when their owner logs
      // back in) rather than mis-sending or dropping them.
      let currentEmp = '';
      try {
        const raw = await AsyncStorage.getItem('user');
        if (raw) { const u = JSON.parse(raw); currentEmp = String(u?.employeeId || u?.userId || '').toUpperCase(); }
      } catch {}
      let sampleEmp = '';
      try { const s = (await listPendingPings(1))[0]; sampleEmp = String(s?.employeeId || '').toUpperCase(); } catch {}
      if (currentEmp && sampleEmp && sampleEmp !== currentEmp) {
        console.warn(`[reconcile:${reason}] ${pending} pending ping(s) belong to ${sampleEmp} but current user is ${currentEmp} — NOT uploading (ownership mismatch); retained for their owner.`);
        return { status: 'Idle', pending, uploaded: 0, deleted: 0, retained: pending };
      }
    }
    // Is there anything at all in local storage to reconcile (pending OR
    // lingering synced rows from a prior session)?
    let total = 0;
    try { total = (await listAllPingsSince(0)).length; } catch { total = pending; }
    if (total === 0) {
      return { status: 'Success', pending: 0, uploaded: 0, deleted: 0, retained: 0 };
    }

    console.log(`[reconcile:${reason}] ${pending} pending + ${Math.max(0, total - pending)} synced local row(s) — diff + verify against MongoDB before any delete`);
    // #434 — Use the explicit fetch-diff-upload-verify flow: fetch what Mongo
    // already has, upload only the missing rows (tagged source:'sqlite',
    // oldest→newest), re-fetch to verify every local ping exists in Mongo,
    // and delete ONLY after that verify. Wide 30-day window covers a session
    // left un-checked-out for weeks. Falls back to the batch reconcile if the
    // /mine endpoint isn't deployed. Nothing is deleted before it's in Mongo.
    const r = await checkoutSyncWithDiffAndVerify(Date.now() - 30 * 24 * 3600 * 1000);
    console.log(
      `[reconcile:${reason}] result: status=${r.status} uploaded=${r.uploaded} ` +
      `deleted=${r.deletedFromLocal} retained=${r.retainedForRetry}`
    );
    return { status: r.status, pending, uploaded: r.uploaded, deleted: r.deletedFromLocal, retained: r.retainedForRetry };
  } catch (e: any) {
    console.warn(`[reconcile:${reason}] failed (data retained for retry):`, e?.message || e);
    let retained = 0;
    try { retained = await getPendingCount(); } catch {}
    return { status: 'Failed', pending: retained, uploaded: 0, deleted: 0, retained };
  }
}

/**
 * #432 — Purge SYNCED rows recorded BEFORE the current session started.
 * Used from the checked-IN cold-boot resume path, where we must NOT upload
 * or touch the active session's pending rows, but we DO want to clear out a
 * previous session's already-uploaded (synced) rows so they don't linger.
 * Pending rows and current-session rows (recorded >= sessionStartMs) are
 * never touched.
 */
export async function purgePreviousSyncedBefore(sessionStartMs: number, reason: string = 'resume'): Promise<number> {
  try {
    if (!Number.isFinite(sessionStartMs) || sessionStartMs <= 0) return 0;
    const n = await deleteSyncedPingsInRange(0, Math.max(0, sessionStartMs - 1));
    if (n > 0) console.log(`[reconcile:${reason}] purged ${n} synced ping(s) from previous session(s) (before current check-in)`);
    return n;
  } catch (e: any) {
    console.warn(`[reconcile:${reason}] purge-previous-synced failed:`, e?.message || e);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// #434 — CHECK-OUT SYNC WITH EXPLICIT MONGO DIFF + VERIFY
//
// The exact HR-requested flow:
//   1. FETCH the employee's existing ping buckets from MongoDB.
//   2. COMPARE with the local SQLite rows for this session → find the ones
//      MISSING in MongoDB.
//   3. UPLOAD only the missing rows, OLDEST → NEWEST, tagged source:'sqlite'.
//   4. RE-FETCH from MongoDB and VERIFY every local ping now exists there.
//   5. Only after a clean verify, DELETE those rows from SQLite.
//   6. If anything fails / verify is incomplete → delete NOTHING, retain, and
//      RETRY (bounded here; the checked-out background listener + next open
//      keep retrying after).
//
// Guarantees: zero data loss (delete only after MongoDB confirms every row),
// no duplicates (server bucket dedup + we upload only what's missing),
// chronological order (missing rows sorted by recorded_at ASC).
//
// Falls back to the batch reconcile (finalCheckoutSyncAndCleanup) if the
// /location-pings/mine endpoint isn't available yet (backend not redeployed).
// ─────────────────────────────────────────────────────────────────────
export async function checkoutSyncWithDiffAndVerify(sessionStartMsHint?: number): Promise<{
  status: 'Success' | 'Failed' | 'PartialFailure';
  localCount: number;
  missingBefore: number;
  uploaded: number;
  deletedFromLocal: number;
  retainedForRetry: number;
  usedFallback?: boolean;
  errorReason?: string;
}> {
  const toMs = Date.now();
  let fromMs = 0;
  if (Number.isFinite(sessionStartMsHint) && (sessionStartMsHint as number) > 0) {
    fromMs = sessionStartMsHint as number;
  } else {
    try { const st = await getTrackingState(); if (st?.checkInAt) fromMs = Number(st.checkInAt) || 0; } catch {}
  }
  if (!Number.isFinite(fromMs) || fromMs <= 0 || fromMs >= toMs) fromMs = toMs - 24 * 3600 * 1000;

  console.log(`[checkout-diff] ⇢ Check-Out sync started (window ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()})`);

  // Read the local rows for this session (recorded within the window).
  const cutoffHi = toMs + 5 * 60 * 1000; // small grace for a lagging final tick
  let localRows = (await listAllPingsSince(fromMs)).filter(r => r.recordedAt <= cutoffHi);
  const localCount = localRows.length;
  if (localCount === 0) {
    console.log('[checkout-diff] no local rows in session window — nothing to sync');
    return { status: 'Success', localCount: 0, missingBefore: 0, uploaded: 0, deletedFromLocal: 0, retainedForRetry: 0 };
  }
  const localBuckets = localRows.map(r => r.bucket);

  let employeeId = '';
  try { const raw = await AsyncStorage.getItem('user'); if (raw) { const u = JSON.parse(raw); employeeId = u?.employeeId || u?.userId || ''; } } catch {}

  const fromISO = new Date(fromMs).toISOString();
  const toISO   = new Date(cutoffHi).toISOString();

  // Fetch the set of buckets MongoDB already has for this user+window.
  const fetchMongoBuckets = async (): Promise<Set<number>> => {
    const res: any = await attendanceAPI.getMyPingBuckets(fromISO, toISO);
    const body = res?.data || {};
    if (!body?.success || !Array.isArray(body.buckets)) throw new Error('bad-response');
    return new Set(body.buckets.map(Number));
  };

  // Step 1 — Fetch existing from Mongo (fallback if endpoint not deployed).
  let mongoBuckets: Set<number>;
  try {
    mongoBuckets = await fetchMongoBuckets();
    console.log(`[checkout-diff] Mongo already has ${mongoBuckets.size} ping(s) in window; local has ${localCount}`);
  } catch (e: any) {
    console.log('[checkout-diff] /mine endpoint unavailable — falling back to batch reconcile:', e?.message || e);
    const r = await finalCheckoutSyncAndCleanup(fromMs);
    return {
      status: r.status === 'Success' ? 'Success' : (r.status === 'PartialFailure' ? 'PartialFailure' : 'Failed'),
      localCount, missingBefore: r.pendingBefore, uploaded: r.uploaded,
      deletedFromLocal: r.deletedFromLocal, retainedForRetry: r.retainedForRetry,
      usedFallback: true, errorReason: r.errorReason,
    };
  }

  const missingBefore = localBuckets.filter(b => !mongoBuckets.has(b)).length;

  const MAX = 5;
  const BACKOFF = [0, 1500, 3000, 5000, 8000];
  let attempt = 0;
  let lastErr = '';
  let uploadedTotal = 0;

  while (attempt < MAX) {
    if (BACKOFF[attempt]) await sleep(BACKOFF[attempt]);
    attempt += 1;

    // Step 2 — DIFF: local rows whose bucket isn't in Mongo, OLDEST → NEWEST.
    const missingRows = localRows
      .filter(r => !mongoBuckets.has(r.bucket))
      .sort((a, b) => a.recordedAt - b.recordedAt);
    console.log(`[checkout-diff] attempt ${attempt}/${MAX}: local=${localCount} inMongo=${localCount - missingRows.length} missing=${missingRows.length}`);

    // Step 3 — UPLOAD only the missing ones, oldest first, tagged source.
    if (missingRows.length > 0) {
      const payload = missingRows.map(r => {
        const { date, localTime } = toIstDateAndTime(r.recordedAt);
        return {
          employeeId: r.employeeId || employeeId,
          date, localTime,
          latitude: r.lat, longitude: r.lng,
          accuracy: r.accuracy ?? null, speed: r.speed ?? null,
          isStationary: r.isStationary === true,
          bucket: r.bucket,
          source: 'sqlite',
        };
      });
      try {
        const up: any = await attendanceAPI.syncMissingPings(payload);
        uploadedTotal += Number(up?.data?.inserted) || 0;
        console.log(`[checkout-diff] uploaded ${up?.data?.inserted ?? '?'} / ${missingRows.length} missing (oldest→newest)`);
      } catch (e: any) {
        lastErr = e?.message || String(e);
        console.log(`[checkout-diff] upload attempt ${attempt} failed: ${lastErr} — retrying`);
        continue;
      }
    }

    // Step 4 — RE-FETCH + VERIFY every local ping now exists in Mongo.
    try { mongoBuckets = await fetchMongoBuckets(); }
    catch (e: any) { lastErr = e?.message || String(e); console.log(`[checkout-diff] verify fetch failed: ${lastErr} — retrying`); continue; }

    const stillMissing = localBuckets.filter(b => !mongoBuckets.has(b));
    if (stillMissing.length === 0) {
      // Step 5 — VERIFIED. Mark synced + delete this session's rows.
      for (const r of localRows) { if (r.localId) { try { await markPingSynced(r.localId); } catch {} } }
      let deleted = 0;
      try {
        deleted = await deleteSyncedPingsInRange(fromMs, Date.now());
      } catch (e: any) {
        let retained = 0; try { retained = await getPendingCount(); } catch {}
        console.log('[checkout-diff] ⚠ verified but local delete failed:', e?.message || e);
        return { status: 'PartialFailure', localCount, missingBefore, uploaded: uploadedTotal, deletedFromLocal: 0, retainedForRetry: retained, errorReason: 'delete-failed' };
      }
      console.log(`[checkout-diff] ✔ VERIFIED all ${localCount} ping(s) exist in MongoDB — deleted ${deleted} local row(s). Zero data loss.`);
      return { status: 'Success', localCount, missingBefore, uploaded: uploadedTotal, deletedFromLocal: deleted, retainedForRetry: 0 };
    }

    console.log(`[checkout-diff] attempt ${attempt}: ${stillMissing.length} ping(s) still not in Mongo — retrying`);
  }

  // Exhausted retries — DELETE NOTHING, retain everything for later retry.
  let retained = 0; try { retained = await getPendingCount(); } catch {}
  console.log(`[checkout-diff] ✘ Could not verify all pings after ${MAX} attempts — retaining ALL local rows for retry.`);
  return { status: 'Failed', localCount, missingBefore, uploaded: uploadedTotal, deletedFromLocal: 0, retainedForRetry: retained || localCount, errorReason: lastErr || 'verify-incomplete' };
}
