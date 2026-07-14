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
  markFailed(localId: number, err: string): Promise<void>;
  pendingCount(): Promise<number>;
  purgeSyncedOlderThan(cutoffMs: number): Promise<number>;
  readState(): Promise<TrackingState>;
  writeState(patch: Partial<TrackingState>): Promise<void>;
  _readAllSince?(sinceMs: number): Promise<PingRow[]>;
};

let _backend: Backend | null = null;
let _initPromise: Promise<void> | null = null;

function selectBackend(): Backend {
  try {
    // Try SQLite. On Expo Go this may fail (no native module) — fall through.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLite = require('expo-sqlite');
    if (SQLite && (SQLite.openDatabaseSync || SQLite.openDatabaseAsync || SQLite.openDatabase)) {
      return makeSqliteBackend(SQLite);
    }
  } catch { /* fall through */ }
  console.log('[pingStore] expo-sqlite unavailable — using AsyncStorage fallback');
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
      await exec(`
        CREATE TABLE IF NOT EXISTS tracking_state (
          k TEXT PRIMARY KEY,
          v TEXT
        );
      `);
    },

    async savePending(row: PingRow) {
      const now = Date.now();
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
        // Unique-bucket collision → row already queued/synced for this bucket.
        // Look up the existing local_id and return it.
        const existing: any = await exec(
          `SELECT local_id FROM pings WHERE user_id = ? AND bucket = ? LIMIT 1`,
          [row.userId || null, row.bucket]
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
      const raw = await AsyncStorage.getItem(AS_PENDING_KEY);
      const rows: PingRow[] = raw ? JSON.parse(raw) : [];
      // Recompute sequence so new inserts don't collide.
      for (const r of rows) if (r.localId && r.localId > seq) seq = r.localId;
    },

    async savePending(row: PingRow) {
      // Idempotency: if this bucket is already synced OR already queued,
      // return the existing localId rather than duplicating.
      if (await alreadySynced(row.userId, row.bucket)) return -1;
      const rows = await readQueue();
      const existing = rows.find(r => r.userId === row.userId && r.bucket === row.bucket);
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
    _backend = selectBackend();
    await _backend.init();
    console.log('[pingStore] ready');
  })();
  return _initPromise;
}

async function ensure(): Promise<Backend> {
  if (!_backend) await initPingStore();
  return _backend!;
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
 * #415 — Wipe every piece of user-scoped local state (SQLite tracking_state,
 * pending pings, and every erm-bg-* / erm-today-* AsyncStorage key). Called
 * on logout, on login (belt-and-braces), and on Home mount when the stored
 * tracking_state.userId doesn't match the current logged-in user.
 */
export async function wipeUserScopedTracking(): Promise<void> {
  try {
    await setTrackingState({
      checkedIn: false, checkInAt: null, checkOutAt: null,
      lastPingAt: null, userId: null, employeeId: null,
    });
  } catch {}
  try {
    const b = await ensure();
    const pending = await b.listPending(500);
    for (const row of pending) {
      if (row.localId) await b.markSynced(row.localId).catch(() => {});
    }
  } catch {}
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
