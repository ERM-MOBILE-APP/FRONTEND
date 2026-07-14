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

import { listPendingPings, listAllPingsSince, markPingSynced, markPingFailed, getPendingCount } from './pingStore';
import { attendanceAPI } from './api';

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
        // Any 2xx (including accepted:false / duplicate-bucket) means the
        // server has this row. Mark synced locally.
        if (res && (res.status === undefined || res.status >= 200) && res.status < 300) {
          if (row.localId) await markPingSynced(row.localId);
          sent += 1;
        } else {
          if (row.localId) await markPingFailed(row.localId, `status=${res?.status}`);
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
        console.log('[pingSync] connectivity restored — flushing queue');
        flushPendingPings('netinfo-restore').catch(() => {});
        // #416 — Also run the batch missing-pings sync on restore.
        // Belt-and-braces: if the per-row flush missed anything (bg-task
        // pings that never went through the SQLite queue historically),
        // the batch endpoint will pick them up.
        syncMissingPingsFromLocal('netinfo-restore').catch(() => {});
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
    flushPendingPings('periodic').catch(() => {});
  }, 60_000);
  const missingPingsTimer = setInterval(() => {
    syncMissingPingsFromLocal('periodic-5min').catch(() => {});
  }, 5 * 60_000);

  // One-shot flush on registration so cold-boot doesn't wait for the
  // first NetInfo event.
  flushPendingPings('startup').catch(() => {});
  // #416 — Also run one-shot missing-pings sync on startup.
  syncMissingPingsFromLocal('startup').catch(() => {});

  return () => {
    _listenerAttached = false;
    if (unsub) try { unsub(); } catch {}
    if (periodic) clearInterval(periodic);
  };
}

export function lastFlushAt(): number { return _lastFlushAt; }

// ─────────────────────────────────────────────────────────────────────
// #416 — Batch reconciliation with the missing-pings endpoint
// ─────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

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
    // Step 1 — Read every locally-stored ping in the last 3 days (both
    // `pending` AND `synced`). We ship them all to the server so the
    // backend can detect gaps a previous realtime POST may have missed
    // (Render mid-flight process kill, brief connectivity flap, etc.)
    // and heal them. The backend dedups by (user, date, bucket) so
    // sending synced rows is safe — they land as `alreadyExisted`.
    const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
    let rows = await listAllPingsSince(threeDaysAgo);
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
