/**
 * #409 — SQLite-backed offline queue for location pings.
 *
 * HR requirement (Jul 2026):
 *   • Every ping generated after check-in must first be saved LOCALLY
 *     before we try to POST it. If the POST fails (offline, timeout,
 *     5xx), the row stays in the store with status='pending' and gets
 *     retried on the next sync opportunity.
 *   • On connectivity restore, pending pings are flushed in strict
 *     chronological order (`recorded_at ASC`) so the polyline HR sees
 *     on the map matches the real path the employee walked.
 *   • Only after the backend returns 2xx AND `accepted:true` (or 200
 *     with `accepted:false, reason:'duplicate-bucket'` which we treat
 *     as "server already has this row") do we mark the local row as
 *     synced.
 *   • The 2-min `bucket` on every row guarantees no duplicate uploads
 *     even if a retry storm slams the server — the backend's partial
 *     unique index rejects dupes atomically (see #403).
 *   • Tracking state (checkedIn flag, checkInAt, lastPingAt, sessionId)
 *     is also persisted here so cold-boot / bg-task-kill recoveries
 *     don't lose their spot.
 *
 * DEPENDENCIES
 *   Preferred: expo-sqlite (installed via `npx expo install expo-sqlite`).
 *   Fallback:  AsyncStorage-backed JSON queue (works today without the
 *              install; slower for very large queues but functionally
 *              identical from the caller's POV).
 *
 *   The module chooses at load time — if `expo-sqlite` require() throws
 *   we quietly fall back. Every public function is identical either way.
 *
 * PUBLIC API (kept small; all functions safe to call before init)
 *   initPingStore()                             — one-time setup
 *   savePendingPing(row)                        — enqueue a ping
 *   listPendingPings(limit?)                    — chronological pending list
 *   markPingSynced(localId)                     — remove/flag on success
 *   markPingFailed(localId, err)                — bump retry_count on failure
 *   getPendingCount()                           — for diagnostics
 *   clearSyncedOlderThan(daysAgo)               — housekeeping
 *
 *   getTrackingState() / setTrackingState(...)  — {checkedIn,checkInAt,checkOutAt,lastPingAt}
 *   markCheckIn(userId, employeeId, atMs)
 *   markCheckOut(atMs)
 *   markLastPingAt(atMs)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type PingRow = {
  /** Local autoincrement id — undefined until inserted. */
  localId?: number;
  /** ObjectId of the User (24 hex). */
  userId?: string;
  /** Human employee id ("TES080") if we know it. */
  employeeId?: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  /** True when the anti-jitter filter reported no confirmed movement. */
  isStationary?: boolean;
  /** ms epoch — the moment the fix was captured on-device. */
  recordedAt: number;
  /** floor(recordedAt / 120000) — the atomic-dedup bucket. */
  bucket: number;
  /** 'pending' | 'synced' */
  status?: 'pending' | 'synced';
  retryCount?: number;
  lastError?: string | null;
};

export type TrackingState = {
  checkedIn: boolean;
  checkInAt: number | null;    // ms epoch
  checkOutAt: number | null;
  lastPingAt: number | null;
  userId: string | null;
  employeeId: string | null;
};

// ─────────────────────────────────────────────────────────────────────
// Backend selection (SQLite preferred, AsyncStorage fallback)
// ─────────────────────────────────────────────────────────────────────

type Backend = {
  init(): Promise<void>;
  savePending(row: PingRow): Promise<number>;
  listPending(limit: number): Promise<PingRow[]>;
  markSynced(localId: number): Promise<void>;
  markPending(localId: number): Promise<void>;
  markFailed(localId: number, err: string): Promise<void>;
  pendingCount(): Promise<number>;
  purgeSyncedOlderThan(cutoffMs: number): Promise<number>;
  readState(): Promise<TrackingState>;
  writeState(patch: Partial<TrackingState>): Promise<void>;
  _readAllSince?(sinceMs: number): Promise<PingRow[]>;
  // #420 — Safe per-session cleanup on checkout. Deletes ONLY rows that
  // are already `synced` AND whose recorded_at falls inside [fromMs, toMs].
  // Pending rows are never touched (they must survive to retry).
  deleteSyncedInRange?(fromMs: number, toMs: number): Promise<number>;
};

let _backend: Backend | null = null;
let _initPromise: Promise<void> | null = null;
// #430 — Which storage engine is actually live (surfaced on the in-app
// debug screen so you can tell at a glance whether SQLite is in use).
let _backendKind: 'sqlite' | 'asyncstorage' = 'asyncstorage';

/** The physical SQLite database filename this app writes pings into. */
export const PING_DB_NAME = 'erm_pings.db';

function selectBackend(): Backend {
  try {
    // Try SQLite. On Expo Go this may fail (no native module) — fall through.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLite = require('expo-sqlite');
    if (SQLite && (SQLite.openDatabaseSync || SQLite.openDatabaseAsync || SQLite.openDatabase)) {
      _backendKind = 'sqlite';
      return makeSqliteBackend(SQLite);
    }
  } catch { /* fall through */ }
  console.log('[pingStore] expo-sqlite unavailable — using AsyncStorage fallback');
  _backendKind = 'asyncstorage';
  return makeAsyncStorageBackend();
}

// ─────────────────────────────────────────────────────────────────────
// SQLite backend (preferred)
// ─────────────────────────────────────────────────────────────────────

function makeSqliteBackend(SQLite: any): Backend {
  let db: any = null;

  async function open() {
    if (db) return db;
    if (SQLite.openDatabaseSync) {
      db = SQLite.openDatabaseSync('erm_pings.db');
    } else if (SQLite.openDatabaseAsync) {
      db = await SQLite.openDatabaseAsync('erm_pings.db');
    } else if (SQLite.openDatabase) {
      db = SQLite.openDatabase('erm_pings.db');
    }
    return db;
  }

  async function exec(sql: string, params: any[] = []): Promise<any> {
    const d = await open();
    // Modern expo-sqlite (v13+) exposes runAsync / getAllAsync on the db handle.
    if (d.runAsync && /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|REPLACE|PRAGMA)/i.test(sql)) {
      return d.runAsync(sql, ...params);
    }
    if (d.getAllAsync && /^\s*SELECT/i.test(sql)) {
      return d.getAllAsync(sql, ...params);
    }
    // Legacy API fallback.
    return new Promise((resolve, reject) => {
      d.transaction(
        (tx: any) => tx.executeSql(sql, params,
          (_t: any, r: any) => resolve(r),
          (_t: any, e: any) => { reject(e); return false; }),
        (e: any) => reject(e),
      );
    });
  }

  return {
    async init() {
      await exec(`PRAGMA journal_mode = WAL;`).catch(() => {});
      await exec(`
        CREATE TABLE IF NOT EXISTS pings (
          local_id     INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id      TEXT,
          employee_id  TEXT,
          lat          REAL    NOT NULL,
          lng          REAL    NOT NULL,
          accuracy     REAL,
          speed        REAL,
          is_stationary INTEGER DEFAULT 0,
          recorded_at  INTEGER NOT NULL,
          bucket       INTEGER NOT NULL,
          status       TEXT    NOT NULL DEFAULT 'pending',
          retry_count  INTEGER NOT NULL DEFAULT 0,
          last_error   TEXT,
          created_at   INTEGER NOT NULL,
          synced_at    INTEGER
        );
      `);
      await exec(`CREATE INDEX IF NOT EXISTS idx_pings_status_rec ON pings(status, recorded_at);`).catch(() => {});
      await exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_pings_bucket ON pings(user_id, bucket) WHERE user_id IS NOT NULL;`).catch(() => {});
      // #430 — Collapse any pre-existing duplicate buckets (rows created
      // before device-level bucket dedup shipped). Keep exactly ONE row per
      // bucket: prefer a 'synced' row so a server-confirmed one is never
      // dropped, otherwise the lowest local_id. The removed rows are the
      // same 2-min slot / same location, so this is lossless in practice and
      // matches the server's one-row-per-bucket rule. Idempotent — a clean
      // table deletes nothing. Wrapped in try/catch: if the SQLite build
      // lacks window functions it simply no-ops (future dedup still holds).
      await exec(`
        DELETE FROM pings
         WHERE local_id NOT IN (
           SELECT keep_id FROM (
             SELECT local_id AS keep_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY bucket
                      ORDER BY (status = 'synced') DESC, local_id ASC
                    ) AS rn
               FROM pings
           ) WHERE rn = 1
         );
      `).catch((e: any) => { console.log('[pingStore] dup-bucket cleanup skipped:', e?.message || e); });
      // #430 — Bulletproof enforcement: a unique index on `bucket` ALONE
      // (single-user device). Created AFTER the cleanup above so no existing
      // duplicates block it. From now on a second insert for a taken slot —
      // even with a NULL user_id — trips this index, and savePending's catch
      // returns the existing row instead of writing a duplicate. If the
      // table still had dups (cleanup no-op'd on an old SQLite build), this
      // create simply fails and we rely on the app-level bucket pre-check.
      await exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_pings_bucket_only ON pings(bucket);`)
        .catch((e: any) => { console.log('[pingStore] bucket-only unique index skipped:', e?.message || e); });
      await exec(`
        CREATE TABLE IF NOT EXISTS tracking_state (
          k TEXT PRIMARY KEY,
          v TEXT
        );
      `);
    },

    async savePending(row: PingRow) {
      const now = Date.now();
      // #430 — DEVICE-LEVEL BUCKET DEDUP. The phone only ever has ONE
      // logged-in user, so a 2-min bucket may hold at most ONE ping. We
      // dedup on `bucket` ALONE here. The DB unique index is
      // (user_id, bucket) WHERE user_id IS NOT NULL — it silently permits
      // duplicates whenever a collector saves a NULL user_id (e.g. the bg
      // task couldn't resolve the id from AsyncStorage). Three collectors
      // (FG timer + 2 bg tasks) run concurrently, so without this a slot
      // could get two rows (one with user_id, one NULL). Bucket-only dedup
      // closes that hole regardless of how each path resolved user_id.
      const dup: any = await exec(
        `SELECT local_id FROM pings WHERE bucket = ? LIMIT 1`,
        [row.bucket]
      ).catch(() => null);
      if (dup && dup[0]) return Number(dup[0].local_id);
      try {
        const r: any = await exec(
          `INSERT INTO pings
             (user_id, employee_id, lat, lng, accuracy, speed, is_stationary,
              recorded_at, bucket, status, retry_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
          [
            row.userId || null,
            row.employeeId || null,
            row.lat, row.lng,
            row.accuracy ?? null,
            row.speed ?? null,
            row.isStationary ? 1 : 0,
            row.recordedAt,
            row.bucket,
            now,
          ]
        );
        return Number(r?.lastInsertRowId || r?.insertId || 0);
      } catch (e: any) {
        // Unique-bucket collision (or the race lost to a concurrent insert)
        // → the slot is already taken. Return that row's local_id. Look up
        // by bucket ALONE so a NULL-user_id winner is still found.
        const existing: any = await exec(
          `SELECT local_id FROM pings WHERE bucket = ? LIMIT 1`,
          [row.bucket]
        ).catch(() => null);
        if (existing && existing[0]) return Number(existing[0].local_id);
        throw e;
      }
    },

    async listPending(limit: number) {
      const rows: any = await exec(
        `SELECT * FROM pings WHERE status = 'pending'
           ORDER BY recorded_at ASC LIMIT ?`,
        [limit]
      );
      return (rows || []).map((r: any) => ({
        localId:     Number(r.local_id),
        userId:      r.user_id || undefined,
        employeeId:  r.employee_id || undefined,
        lat: r.lat, lng: r.lng,
        accuracy:    r.accuracy,
        speed:       r.speed,
        isStationary: !!r.is_stationary,
        recordedAt:  Number(r.recorded_at),
        bucket:      Number(r.bucket),
        status:      r.status,
        retryCount:  Number(r.retry_count || 0),
        lastError:   r.last_error,
      }));
    },

    async markSynced(localId: number) {
      await exec(
        `UPDATE pings SET status='synced', synced_at=?, last_error=NULL WHERE local_id=?`,
        [Date.now(), localId]
      );
    },

    // #435 — Reset a row back to 'pending' (used to correct a row that was
    // marked synced but a fresh MongoDB read shows it isn't actually there).
    async markPending(localId: number) {
      await exec(
        `UPDATE pings SET status='pending', synced_at=NULL WHERE local_id=?`,
        [localId]
      );
    },

    async markFailed(localId: number, err: string) {
      await exec(
        `UPDATE pings SET retry_count = retry_count + 1, last_error = ? WHERE local_id = ?`,
        [String(err || '').slice(0, 400), localId]
      );
    },

    async pendingCount() {
      const rows: any = await exec(`SELECT COUNT(*) AS c FROM pings WHERE status='pending'`);
      return Number(rows?.[0]?.c || 0);
    },

    async purgeSyncedOlderThan(cutoffMs: number) {
      const r: any = await exec(
        `DELETE FROM pings WHERE status='synced' AND synced_at < ?`,
        [cutoffMs]
      );
      return Number(r?.changes || 0);
    },

    // #420 — Delete synced rows recorded within [fromMs, toMs]. Pending
    // rows in the range are LEFT ALONE — they must retry later. Used at
    // checkout to clean up a completed session's confirmed pings.
    async deleteSyncedInRange(fromMs: number, toMs: number) {
      const r: any = await exec(
        `DELETE FROM pings
           WHERE status = 'synced'
             AND recorded_at >= ?
             AND recorded_at <= ?`,
        [fromMs, toMs]
      );
      return Number(r?.changes || 0);
    },

    // #418 — Exposed on the backend object so listAllPingsSince can
    // read pending + synced in one shot.
    async _readAllSince(sinceMs: number) {
      const rows: any = await exec(
        `SELECT * FROM pings WHERE recorded_at >= ? ORDER BY recorded_at ASC LIMIT 5000`,
        [sinceMs]
      );
      return (rows || []).map((r: any) => ({
        localId:     Number(r.local_id),
        userId:      r.user_id || undefined,
        employeeId:  r.employee_id || undefined,
        lat: r.lat, lng: r.lng,
        accuracy:    r.accuracy,
        speed:       r.speed,
        isStationary: !!r.is_stationary,
        recordedAt:  Number(r.recorded_at),
        bucket:      Number(r.bucket),
        status:      r.status,
        retryCount:  Number(r.retry_count || 0),
        lastError:   r.last_error,
      }));
    },

    async readState() {
      const rows: any = await exec(`SELECT k, v FROM tracking_state`);
      const map: Record<string, string> = {};
      (rows || []).forEach((r: any) => { map[r.k] = r.v; });
      return normaliseState(map);
    },

    async writeState(patch: Partial<TrackingState>) {
      const now = await this.readState();
      const merged = { ...now, ...patch };
      const kv: Record<string, string> = {
        checkedIn:   merged.checkedIn ? '1' : '0',
        checkInAt:   merged.checkInAt   == null ? '' : String(merged.checkInAt),
        checkOutAt:  merged.checkOutAt  == null ? '' : String(merged.checkOutAt),
        lastPingAt:  merged.lastPingAt  == null ? '' : String(merged.lastPingAt),
        userId:      merged.userId ?? '',
        employeeId:  merged.employeeId ?? '',
      };
      for (const [k, v] of Object.entries(kv)) {
        await exec(
          `INSERT INTO tracking_state (k, v) VALUES (?, ?)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
          [k, v]
        );
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// AsyncStorage fallback (works today without any native install)
// ─────────────────────────────────────────────────────────────────────

const AS_PENDING_KEY = 'erm-ping-queue-v1';
const AS_SYNCED_KEY  = 'erm-ping-synced-v1';   // small ring buffer for last N synced buckets
const AS_STATE_KEY   = 'erm-tracking-state-v1';
const AS_SYNCED_KEEP = 500;                    // dedup memory

function makeAsyncStorageBackend(): Backend {
  let seq = 0;

  async function readQueue(): Promise<PingRow[]> {
    try {
      const raw = await AsyncStorage.getItem(AS_PENDING_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  async function writeQueue(rows: PingRow[]): Promise<void> {
    await AsyncStorage.setItem(AS_PENDING_KEY, JSON.stringify(rows));
  }

  async function readSyncedBuckets(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(AS_SYNCED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  async function noteSyncedBucket(userId: string | undefined, bucket: number) {
    if (!userId) return;
    const key = `${userId}|${bucket}`;
    const list = await readSyncedBuckets();
    if (!list.includes(key)) {
      list.push(key);
      while (list.length > AS_SYNCED_KEEP) list.shift();
      await AsyncStorage.setItem(AS_SYNCED_KEY, JSON.stringify(list));
    }
  }

  async function alreadySynced(userId: string | undefined, bucket: number) {
    if (!userId) return false;
    const list = await readSyncedBuckets();
    return list.includes(`${userId}|${bucket}`);
  }

  return {
    async init() {
      // Nothing to bootstrap — AsyncStorage is always ready.
      // #438 — Guard the parse: a single corrupted `erm-ping-queue-v1` value
      // must not throw out of init() (which would poison _initPromise).
      let rows: PingRow[] = [];
      try {
        const raw = await AsyncStorage.getItem(AS_PENDING_KEY);
        rows = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(rows)) rows = [];
      } catch (e: any) {
        console.warn('[pingStore] corrupt pending queue — resetting:', e?.message || e);
        rows = [];
        try { await AsyncStorage.removeItem(AS_PENDING_KEY); } catch {}
      }
      // Recompute sequence so new inserts don't collide.
      for (const r of rows) if (r.localId && r.localId > seq) seq = r.localId;
    },

    async savePending(row: PingRow) {
      // Idempotency: if this bucket is already synced OR already queued,
      // return the existing localId rather than duplicating.
      if (await alreadySynced(row.userId, row.bucket)) return -1;
      const rows = await readQueue();
      // #430 — Dedup by bucket ALONE (single-user device). Matches the
      // SQLite backend so a NULL/mismatched user_id can't create a second
      // row in the same 2-min slot.
      const existing = rows.find(r => r.bucket === row.bucket);
      if (existing) return existing.localId!;
      seq += 1;
      const insert: PingRow = {
        ...row,
        localId: seq,
        status: 'pending',
        retryCount: 0,
        lastError: null,
      };
      rows.push(insert);
      await writeQueue(rows);
      return seq;
    },

    async listPending(limit: number) {
      const rows = await readQueue();
      // #419 — Queue now retains BOTH pending + recently-synced rows so
      // listAllPingsSince can see them. Filter pending here explicitly.
      const pending = rows.filter(r => (r.status || 'pending') === 'pending');
      pending.sort((a, b) => a.recordedAt - b.recordedAt);
      return pending.slice(0, limit);
    },

    async markSynced(localId: number) {
      const rows = await readQueue();
      const row = rows.find(r => r.localId === localId);
      if (row) {
        await noteSyncedBucket(row.userId, row.bucket);
        // #419 — Instead of deleting, mark the row 'synced' and keep it.
        // The missing-pings scanner needs to see synced rows too (so it
        // can heal server-side gaps caused by lost writes). We cap the
        // queue at 2000 rows below to prevent unbounded growth.
        row.status = 'synced';
        row.lastError = null;
        // Keep the queue bounded — drop the oldest synced rows once we
        // exceed the cap. Pending rows are never dropped (retry safety).
        const cap = 2000;
        if (rows.length > cap) {
          rows.sort((a, b) => {
            const aP = (a.status || 'pending') === 'pending' ? 1 : 0;
            const bP = (b.status || 'pending') === 'pending' ? 1 : 0;
            if (aP !== bP) return bP - aP;               // pending first
            return (b.recordedAt || 0) - (a.recordedAt || 0); // newest first
          });
          rows.length = cap;
        }
        await writeQueue(rows);
      }
    },

    async markPending(localId: number) {
      const rows = await readQueue();
      const row = rows.find(r => r.localId === localId);
      if (row) { row.status = 'pending'; await writeQueue(rows); }
    },

    async markFailed(localId: number, err: string) {
      const rows = await readQueue();
      const row = rows.find(r => r.localId === localId);
      if (row) {
        row.retryCount = (row.retryCount || 0) + 1;
        row.lastError = String(err || '').slice(0, 400);
        await writeQueue(rows);
      }
    },

    async pendingCount() {
      const rows = await readQueue();
      // #419 — Only count pending rows (queue now retains synced ones too).
      return rows.filter(r => (r.status || 'pending') === 'pending').length;
    },

    async purgeSyncedOlderThan(cutoffMs: number) {
      const rows = await readQueue();
      const keep = rows.filter(r =>
        (r.status || 'pending') === 'pending' || (r.recordedAt || 0) >= cutoffMs
      );
      if (keep.length !== rows.length) await writeQueue(keep);
      return rows.length - keep.length;
    },

    // #419 — Expose a since-scan for listAllPingsSince (SQLite parity).
    async _readAllSince(sinceMs: number) {
      const rows = await readQueue();
      return rows
        .filter(r => (r.recordedAt || 0) >= sinceMs)
        .sort((a, b) => a.recordedAt - b.recordedAt);
    },

    // #420 — Delete synced rows recorded within [fromMs, toMs]. Pending
    // rows in the range are LEFT ALONE — they must retry later. Used at
    // checkout to clean up a completed session's confirmed pings.
    async deleteSyncedInRange(fromMs: number, toMs: number) {
      const rows = await readQueue();
      const keep = rows.filter(r => {
        const rec = r.recordedAt || 0;
        const inRange = rec >= fromMs && rec <= toMs;
        const isSynced = (r.status || 'pending') === 'synced';
        return !(inRange && isSynced);   // drop only synced-in-range
      });
      if (keep.length !== rows.length) await writeQueue(keep);
      return rows.length - keep.length;
    },

    async readState() {
      try {
        const raw = await AsyncStorage.getItem(AS_STATE_KEY);
        return normaliseState(raw ? JSON.parse(raw) : {});
      } catch { return normaliseState({}); }
    },

    async writeState(patch: Partial<TrackingState>) {
      const cur = await this.readState();
      const next = { ...cur, ...patch };
      await AsyncStorage.setItem(AS_STATE_KEY, JSON.stringify(next));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// State normaliser (shared)
// ─────────────────────────────────────────────────────────────────────

function normaliseState(raw: any): TrackingState {
  const toNum = (v: any) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    checkedIn:   raw?.checkedIn === true || raw?.checkedIn === '1' || raw?.checkedIn === 1,
    checkInAt:   toNum(raw?.checkInAt),
    checkOutAt:  toNum(raw?.checkOutAt),
    lastPingAt:  toNum(raw?.lastPingAt),
    userId:      raw?.userId || null,
    employeeId:  raw?.employeeId || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export async function initPingStore(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      _backend = selectBackend();
      await _backend.init();
      console.log('[pingStore] ready');
    } catch (e: any) {
      // #438 — Do NOT leave a REJECTED promise cached: `_initPromise` would
      // be returned forever and every later ensure() would re-reject,
      // permanently poisoning the store for the process lifetime. Reset it so
      // the next call can retry a fresh init (e.g. after a transient locked-DB
      // or corrupted-key error). If SQLite init itself failed, fall back to
      // the AsyncStorage backend so pings can still be buffered.
      console.warn('[pingStore] init failed, will retry on next use:', e?.message || e);
      _initPromise = null;
      // One-shot fallback to the AsyncStorage backend (no native module) so
      // pings can still be buffered even if SQLite init failed.
      try {
        _backend = makeAsyncStorageBackend();
        await _backend.init();
        console.log('[pingStore] recovered on AsyncStorage backend');
        return;
      } catch (e2: any) {
        console.warn('[pingStore] AsyncStorage fallback also failed:', e2?.message || e2);
        _backend = null;
      }
      throw e;
    }
  })();
  return _initPromise;
}

async function ensure(): Promise<Backend> {
  if (!_backend) {
    try { await initPingStore(); }
    catch { /* init already logged; return whatever backend we have (may retry next call) */ }
  }
  if (!_backend) {
    // Last-resort: never return undefined (callers do _backend!). Use the
    // AsyncStorage backend which needs no native module.
    _backend = makeAsyncStorageBackend();
    try { await _backend.init(); } catch {}
  }
  return _backend;
}

/** Compute the 2-min bucket from a ms epoch. */
export function bucketFor(ms: number): number {
  return Math.floor(ms / 120_000);
}

export async function savePendingPing(row: Omit<PingRow, 'bucket' | 'status'> & { bucket?: number }): Promise<number> {
  const b = await ensure();
  const recordedAt = row.recordedAt || Date.now();
  const bucket = row.bucket ?? bucketFor(recordedAt);
  return b.savePending({ ...row, recordedAt, bucket });
}

export async function listPendingPings(limit = 200): Promise<PingRow[]> {
  const b = await ensure();
  return b.listPending(limit);
}

export async function markPingSynced(localId: number): Promise<void> {
  if (!Number.isFinite(localId) || localId <= 0) return;
  const b = await ensure();
  await b.markSynced(localId);
}

export async function markPingPending(localId: number): Promise<void> {
  if (!Number.isFinite(localId) || localId <= 0) return;
  const b = await ensure();
  await b.markPending(localId);
}

export async function markPingFailed(localId: number, err: any): Promise<void> {
  if (!Number.isFinite(localId) || localId <= 0) return;
  const b = await ensure();
  const msg = err?.message || String(err || 'unknown');
  await b.markFailed(localId, msg);
}

export async function getPendingCount(): Promise<number> {
  const b = await ensure();
  return b.pendingCount();
}

export async function purgeSyncedOlderThanDays(days: number): Promise<number> {
  const b = await ensure();
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  return b.purgeSyncedOlderThan(cutoff);
}

// ─── Tracking state ─────────────────────────────────────────────────

export async function getTrackingState(): Promise<TrackingState> {
  const b = await ensure();
  return b.readState();
}

export async function setTrackingState(patch: Partial<TrackingState>): Promise<void> {
  const b = await ensure();
  await b.writeState(patch);
}

export async function markCheckIn(userId: string, employeeId: string, atMs: number = Date.now()): Promise<void> {
  await setTrackingState({
    checkedIn:  true,
    checkInAt:  atMs,
    checkOutAt: null,
    userId,
    employeeId,
  });
}

export async function markCheckOut(atMs: number = Date.now()): Promise<void> {
  await setTrackingState({ checkedIn: false, checkOutAt: atMs });
}

export async function markLastPingAt(atMs: number = Date.now()): Promise<void> {
  await setTrackingState({ lastPingAt: atMs });
}

/**
 * #449 — LIVE TRACKING (reverses the earlier "upload only at Check Out" rule).
 *
 * New HR requirement: the employee's location must be visible in HRMS in REAL
 * TIME during the shift — not only after Check Out. So uploading is now allowed
 * at all times and this gate returns true.
 *
 * This does NOT weaken the no-data-loss guarantee. The pipeline is still:
 *   1. Every ping is written to SQLite FIRST (savePendingPing) — source of truth.
 *   2. The collection path then uploads it live; on success it's marked 'synced'.
 *   3. If the upload fails (offline / server down) the row stays 'pending' and
 *      is retried by the pingSync listener (on reconnect + on a periodic timer).
 *   4. Check Out still runs finalCheckoutSyncAndCleanup() as a final safety net
 *      to sweep up any stragglers.
 * Net effect: live visibility during the shift AND the same guarantee that no
 * ping is ever lost.
 *
 * This helper is the ONE gate every collection/sync path consults before
 * hitting the network. It now returns true unconditionally (live upload).
 * The former "store-to-SQLite-only" branches in each caller simply never run.
 */
export async function isUploadAllowedNow(): Promise<boolean> {
  return true;
}

/**
 * #415 — Wipe every piece of user-scoped local state (SQLite tracking_state,
 * pending pings, and every erm-bg-* / erm-today-* AsyncStorage key). Called
 * on logout, on login (belt-and-braces), and on Home mount when the stored
 * tracking_state.userId doesn't match the current logged-in user.
 */
export async function wipeUserScopedTracking(opts: { dropPendingPings?: boolean } = {}): Promise<void> {
  try {
    await setTrackingState({
      checkedIn: false, checkInAt: null, checkOutAt: null,
      lastPingAt: null, userId: null, employeeId: null,
    });
  } catch {}
  // #432 — DATA-LOSS FIX. This previously marked EVERY pending ping as
  // 'synced' (without ever uploading it), which silently dropped un-uploaded
  // pings whenever an employee who forgot to check out logged out / back in —
  // exactly the data loss the "no ping is ever lost" requirement forbids.
  //
  // We now PRESERVE pending pings by default. They survive login/logout and
  // are uploaded by the previous-session reconciliation on the next app open
  // / check-in (which is guarded by employee-id ownership, so one user's
  // pings can never be misattributed to another). Only an explicit
  // dropPendingPings flag discards them.
  if (opts.dropPendingPings) {
    try {
      const b = await ensure();
      const pending = await b.listPending(500);
      for (const row of pending) {
        if (row.localId) await b.markSynced(row.localId).catch(() => {});
      }
    } catch {}
  }
  const keys = [
    'erm-today-v1',
    'erm-bg-last-ping-sent-at',
    'erm-gps-anchor-v1',
    'erm-bg-task-last-heartbeat',
    'erm-bg-task-events-v1',
    'erm-bg-ping-queue-v1',
    'erm-bg-fix-log-last-at',
    'erm-ping-queue-v1',
    'erm-ping-synced-v1',
    'erm-tracking-state-v1',
  ];
  try { await AsyncStorage.multiRemove(keys); } catch {}
}

/**
 * #418 — Return EVERY ping stored locally in the last `sinceMs` window,
 * regardless of sync status. Used by the missing-pings reconciliation
 * so the client can ship its full local view to the server and let the
 * server-side dedup index decide what's new.
 *
 * Default window: 3 days. Safe upper bound: 30 days.
 */
export async function listAllPingsSince(sinceMs: number): Promise<PingRow[]> {
  const b = await ensure();
  const _any: any = b as any;
  try {
    if (_any._readAllSince) {
      return _any._readAllSince(sinceMs);
    }
  } catch { /* fall through */ }
  const pending = await b.listPending(2000);
  return pending.filter(r => r.recordedAt >= sinceMs);
}

/**
 * #420 — Delete SYNCED pings recorded within [fromMs, toMs]. Pending
 * rows are never touched. Returns the number of rows deleted. Safe to
 * call from the checkout flow only AFTER the server has confirmed the
 * synced rows landed — never before.
 *
 * The range is inclusive on both ends. `toMs` should be `Date.now()` at
 * the moment of checkout so any late-arriving ping from a lagging bg
 * task tick isn't accidentally wiped.
 */
export async function deleteSyncedPingsInRange(fromMs: number, toMs: number): Promise<number> {
  const b = await ensure();
  const _any: any = b as any;
  if (typeof _any.deleteSyncedInRange === 'function') {
    return _any.deleteSyncedInRange(fromMs, toMs);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// #430 — Read-only debug snapshot (powers app/ping-debug.tsx)
// ─────────────────────────────────────────────────────────────────────

export type PingDebugSnapshot = {
  /** Which storage engine is live: 'sqlite' (device DB) or 'asyncstorage' (fallback). */
  backend: 'sqlite' | 'asyncstorage';
  /** The SQLite database filename on the device. */
  dbName: string;
  /** Total rows scanned (capped — see `capped`). */
  total: number;
  /** Rows still awaiting upload. */
  pending: number;
  /** Rows already confirmed on the server. */
  synced: number;
  /** True if the scan hit the 5000-row cap (older rows not counted). */
  capped: boolean;
  /** Current check-in / tracking state. */
  tracking: TrackingState;
  /** The most recent `latestLimit` pings, newest first. */
  latest: PingRow[];
};

/**
 * Read a full read-only snapshot of the local ping store for the in-app
 * debug screen. Never mutates anything. Safe to call on any build.
 */
export async function getPingDebugSnapshot(latestLimit = 50): Promise<PingDebugSnapshot> {
  await ensure();
  // Pull every locally-stored row (pending + synced) since epoch 0. The
  // SQLite backend caps this at 5000 rows (recorded_at ASC).
  const all = await listAllPingsSince(0);
  const capped = all.length >= 5000;
  let pending = 0;
  let synced = 0;
  for (const r of all) {
    if (r.status === 'synced') synced += 1; else pending += 1;
  }
  // Prefer the authoritative pending COUNT(*) when available (not capped).
  try { pending = await getPendingCount(); synced = Math.max(0, all.length - pending); } catch {}

  const tracking = await getTrackingState();
  // `all` is ASC (oldest→newest); take the tail and reverse for newest-first.
  const latest = all.slice(-latestLimit).reverse();

  return {
    backend: _backendKind,
    dbName: PING_DB_NAME,
    total: all.length,
    pending,
    synced,
    capped,
    tracking,
    latest,
  };
}
