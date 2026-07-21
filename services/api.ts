import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
// #409 — SQLite-backed offline queue. Every ping is persisted BEFORE
// hitting the network, so nothing is lost if the POST fails.
import { savePendingPing, markPingSynced, markPingFailed, markLastPingAt, bucketFor, isUploadAllowedNow } from './pingStore';

// #401 — Backend mounts every route under /api/* (see backend/src/app.js
// `app.use('/api/auth', ...)`, `app.use('/api/attendance', ...)`, etc.).
// The mobile used to point at the bare origin, which sent
// POST /auth/login → 404 "Cannot POST /auth/login". Bake the /api
// prefix into BASE_URL so every endpoint the app already declares as
// `/auth/login`, `/attendance/checkin`, `/attendance/location-ping`
// lands on `${origin}/api/...` and hits Express correctly.
export const ORIGIN   = 'https://backend-9rtc.onrender.com';
export const BASE_URL = `${ORIGIN}/api`;

/**
 * Session policy (Jun 2026):
 *   • Backend signs JWT with `expiresIn: '10d'`.
 *   • Client treats any 401 from the API as "session expired" → wipes
 *     AsyncStorage auth keys and bounces to the login screen.
 *
 * forceLogout is debounced so multiple parallel 401s don't fight each
 * other for the navigation stack.
 *
 * FIX (Jun 2026 — bug A+F):
 *   router.replace() is now deferred into a setTimeout(0) so it NEVER
 *   fires synchronously inside an Axios response interceptor — doing so
 *   caused "cannot update a component while rendering a different
 *   component" crashes on RN 0.81 / React 19.  The _navReady flag keeps
 *   us from navigating before expo-router has mounted its navigator
 *   (cold-start race that was silently crashing on background 401s).
 */
let _logoutInFlight = false;
let _navReady = false;
/** Call once from RootLayout after the navigator has mounted. */
export function markNavReady() { _navReady = true; }

// #379 — Foreground-timer burst guard. See locationPing below.
let _lastFgPingSentAt = 0;

async function forceLogout(reason: string) {
  if (_logoutInFlight) return;
  _logoutInFlight = true;
  try {
    console.warn('[API] forcing logout —', reason);
    // #423 — Wipe user-scoped caches BEFORE removing identity keys.
    // Without this, a 401 (expired token, session revoked, password
    // reset) would leave `erm-today-v1` primed with the departing
    // user's snapshot. The next successful login on the same device
    // would then briefly show that stale data before refreshToday
    // finished. Nuking here closes that race.
    try {
      const { wipeUserScopedTracking } = require('./pingStore');
      await wipeUserScopedTracking();
    } catch { /* pingStore not ready — the identity multiRemove below still helps */ }
    await AsyncStorage.multiRemove(['token', 'user', 'userId', 'erm-today-v1']).catch(() => {});
    // Defer navigation so we never call router.replace() inside a
    // render cycle or response-interceptor callback.
    setTimeout(() => {
      if (_navReady) {
        try { router.replace('/(auth)/login' as any); } catch { /* ignore */ }
      }
    }, 0);
  } finally {
    setTimeout(() => { _logoutInFlight = false; }, 2000);
  }
}

// Render free tier cold start can take 30–60s on first request after idle.
// We use a long default timeout and an even longer timeout for the warm-up call.
const DEFAULT_TIMEOUT_MS = 90_000; // 90s — survives Render wake-up
const WAKEUP_TIMEOUT_MS = 120_000; // 2 min — first contact after long sleep

const api = axios.create({
  baseURL: BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
});

api.interceptors.request.use(async (config) => {
  // #438 — Guard AsyncStorage: a rejecting getItem() would turn EVERY API
  // call into a rejected promise before it even hits the network, surfacing
  // as unhandled rejections across screens. Degrade to a token-less request.
  try {
    const token = await AsyncStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch (e: any) {
    console.warn('[api] token read failed — sending request without auth header:', e?.message || e);
  }
  console.log('[API REQ]', config.method?.toUpperCase(), config.baseURL + (config.url || ''));
  return config;
});

api.interceptors.response.use(
  (res) => {
    console.log('[API OK]', res.status, res.config.url);
    return res;
  },
  async (err) => {
    const cfg: any = err.config || {};

    // Multi-retry with backoff on cold-start / network errors.
    // Render free-tier cold start can take 30-60s; a single retry is not
    // enough. We try up to 3 times with increasing timeout + small delay
    // so the user never sees a cold-start error in practice.
    const MAX_RETRIES = 3;
    if (!err.response || err.code === 'ECONNABORTED') {
      cfg.__retryCount = (cfg.__retryCount || 0) + 1;
      if (cfg.__retryCount <= MAX_RETRIES) {
        cfg.timeout = WAKEUP_TIMEOUT_MS;
        // Backoff: 1s, 2s, 4s between attempts (lets Render finish booting)
        const wait = Math.min(4000, 1000 * Math.pow(2, cfg.__retryCount - 1));
        console.log(`[API RETRY ${cfg.__retryCount}/${MAX_RETRIES}] in ${wait}ms →`, cfg.url);
        await new Promise(r => setTimeout(r, wait));
        try {
          return await api.request(cfg);
        } catch (e) {
          // fall through — if final retry also failed, show short msg
        }
      }
    }

    if (!err.response) {
      // Friendly short message — no more 5-paragraph scare text.
      // After 3 silent retries (~6+ minutes of attempts) the server is
      // genuinely unreachable; user needs to just tap again.
      const networkMsg = 'Connection lost. Please check your internet and try again.';
      console.log('[API NETWORK ERROR]', err.message, err.code);
      err.response = { data: { message: networkMsg } };
      return Promise.reject(err);
    }
    console.log(
      '[API ERR]',
      err.response.status,
      err.config?.url,
      JSON.stringify(err.response.data)
    );
    // 401 → session has expired (10-day cap reached, or token revoked).
    // Wipe local auth and bounce to login. Skip the trigger on the auth
    // endpoints themselves so the wrong-password 401 stays a normal
    // error, not a "session expired" reset.
    const url: string = String(cfg?.url || '');
    const onAuthRoute = /\/auth\/(login|signup|otp|reset|forgot|verify)/i.test(url);
    if (err.response.status === 401 && !onAuthRoute) {
      forceLogout('401 ' + url);
    }
    return Promise.reject(err);
  }
);

/**
 * Fire-and-forget wake-up ping.
 * Call this when the user lands on an auth screen so the Render server is
 * already warm by the time they tap Send OTP / Log In.
 * Uses a long timeout so we don't reject prematurely.
 */
export const wakeBackend = async () => {
  try {
    const t0 = Date.now();
    await axios.get(`${BASE_URL}/health`, { timeout: WAKEUP_TIMEOUT_MS });
    console.log('[wakeBackend] ✓ warm (' + (Date.now() - t0) + 'ms)');
  } catch (e: any) {
    console.log('[wakeBackend] ✗', e?.message);
  }
};

export const pingBackend = async () => {
  try {
    const res = await api.get('/health');
    return res.data;
  } catch (e: any) {
    throw new Error(e?.response?.data?.message || e.message || 'Network error');
  }
};

export const authAPI = {
  login: (userId: string, password: string) =>
    api.post('/auth/login', { userId, password }),

  /**
   * Send OTP to user's registered email.
   * Tries real endpoint first; falls back to a mock success so the
   * UI flow works even when the backend route doesn't exist yet.
   */
  sendOtp: async (email: string) => {
    const res = await api.post('/auth/send-otp', { email });
    return res;
  },

  /**
   * Verify OTP entered by user.
   * Mock fallback accepts "123456" while backend route is missing.
   */
  verifyOtp: async (email: string, otp: string) => {
    const res = await api.post('/auth/verify-otp', { email, otp });
    return res;
  },

  /**
   * Reset password using a valid resetToken from verifyOtp.
   * NOTE: No mock fallback — if this fails the user MUST know so they
   * don't think their password was changed when it wasn't.
   */
  resetPassword: async (resetToken: string, newPassword: string) => {
    const res = await api.post('/auth/reset-password', {
      resetToken,
      newPassword,
    });
    return res;
  },

  /**
   * Logged-in user changes their own password (no OTP). Used after the
   * employee logs in with the HR-assigned default password and wants to
   * pick their own.
   */
  changePassword: async (oldPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { oldPassword, newPassword }),
};

export const attendanceAPI = {
  checkIn: (
    location: 'remote' | 'office' = 'office',
    coords?: { lat?: number; lng?: number; accuracy?: number },
  ) =>
    api.post('/attendance/checkin', {
      location,
      lat:      coords?.lat,
      lng:      coords?.lng,
      accuracy: coords?.accuracy,
    }),
  checkOut: (coords?: { lat?: number; lng?: number; accuracy?: number }) =>
    api.post('/attendance/checkout', {
      lat:      coords?.lat,
      lng:      coords?.lng,
      accuracy: coords?.accuracy,
    }),
  /** Auto-checkout fired when GPS turns off mid-day. */
  autoCheckOut: (reason?: string) =>
    api.post('/attendance/auto-checkout', { reason: reason || 'gps-off' }),
  /** Every 2 min while checked in, send the live location.
   *  isStationary: true → marker stays anchored, polyline isn't extended.
   *  isStationary: false → confirmed movement; new point added to polyline.
   *
   *  #379 — CLIENT-SIDE BURST GUARD. Before every ping, check the
   *  in-memory lastPingSentAt. If we sent one less than 110 s ago, skip
   *  this call entirely — the backend's atomic 120-s bucket would just
   *  reject it anyway with E11000, and skipping saves the network hop.
   *  This kills the "3 concurrent recovery pings after a 20-min gap"
   *  pattern at the source: only the FIRST ping in a burst hits the
   *  wire; the other 2 are dropped locally.
   *
   *  We use a module-level variable rather than AsyncStorage because
   *  bursts are always within a single JS context; the OS bg-task uses
   *  its own module context (locationTask.ts) which has its own guard.
   */
  locationPing: async (lat: number, lng: number, accuracy?: number, speed?: number, isStationary?: boolean) => {
    // #409 — SAVE-THEN-SEND. Every ping goes through the local SQLite
    // queue first (bucketed by 2-min slot for idempotency). Only after
    // a 2xx server response do we mark the row synced. On failure the
    // row stays pending and pingSync.ts will drain it on the next
    // network-restore event or 60-s periodic tick.
    //
    // Burst guard (#390/#402) still runs first so we don't send a
    // duplicate for a bucket the OS bg-task already covered.
    let priorLastSent = 0;
    try {
      const raw = await AsyncStorage.getItem('erm-bg-last-ping-sent-at');
      priorLastSent = raw ? Number(raw) || 0 : 0;
      const gapMs   = Date.now() - priorLastSent;
      if (priorLastSent > 0 && gapMs < 110_000) {
        console.log('[api] locationPing skipped — sent', Math.round(gapMs / 1000), 's ago (shared FG+BG guard)');
        return { data: { ok: true, accepted: false, reason: 'client-burst-guard', gapMs } } as any;
      }
    } catch { /* AsyncStorage hiccup — proceed */ }

    // Resolve the user's ObjectId + employeeId so the queued row can
    // be de-duped per-user and inspected in Metro logs.
    let userId: string | undefined;
    let employeeId: string | undefined;
    try {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        userId     = u?._id || u?.id || u?.userId || undefined;
        employeeId = u?.employeeId || u?.userId || undefined;
      }
    } catch {}

    const recordedAt = Date.now();
    const bucket = bucketFor(recordedAt);

    // Step 1: persist the row LOCALLY first. Even a crash between here
    // and the POST leaves us with an auditable record.
    let localId = -1;
    try {
      localId = await savePendingPing({
        userId, employeeId,
        lat, lng,
        accuracy: accuracy ?? null,
        speed:    speed    ?? null,
        isStationary: !!isStationary,
        recordedAt,
      } as any);
    } catch (e: any) {
      console.log('[api] pingStore.savePendingPing failed (non-fatal):', e?.message || e);
    }

    _lastFgPingSentAt = Date.now();
    try { await AsyncStorage.setItem('erm-bg-last-ping-sent-at', String(Date.now())); } catch {}

    // #430 — STRICT SQLite-as-source-of-truth. While the employee is
    // checked in, the ping is stored LOCALLY ONLY and is NEVER uploaded.
    // The single upload to MongoDB happens at Check Out
    // (finalCheckoutSyncAndCleanup). Return a synthetic "stored-locally"
    // result so the caller (FG timer / AppState ping / gpsWatcher) moves
    // on exactly as before. The row stays 'pending' in SQLite until the
    // checkout batch upload ships + verifies it.
    try {
      const uploadAllowed = await isUploadAllowedNow();
      if (!uploadAllowed) {
        try { await markLastPingAt(Date.now()); } catch {}
        console.log(`[api] ping stored to SQLite only (checked-in — no live upload) localId=${localId}`);
        return { data: { ok: true, accepted: false, reason: 'stored-locally-checked-in', localId } } as any;
      }
    } catch { /* if the gate errors, fall through to the normal send path */ }

    // Step 2: try to send. Success → mark synced + advance lastPingAt.
    // NOTE: this path only runs while the employee is checked OUT — it is
    // used by the leftover-batch retry (pingSync flush) after a failed
    // checkout upload, never during a working session.
    try {
      // #433 — Send the capture time so the server buckets the ping by WHEN
      // IT WAS TAKEN, not when it arrived. Without this, a late/retried ping
      // is bucketed on the server's clock, collides with a later bucket, and
      // the server drops it as a "duplicate" — silently losing that sample.
      const res = await api.post('/attendance/location-ping', {
        lat, lng, accuracy, speed, isStationary,
        recordedAt: new Date(recordedAt).toISOString(),
      });
      // #433 — Only mark the row SYNCED when the server actually STORED it.
      // The endpoint returns 200 even when it does NOT persist a ping
      // (accuracy-gated, burst-guarded, or a server-side bucket collision).
      // Marking such a row 'synced' would wrongly flag it safe-to-delete even
      // though it never reached Mongo. Treat as stored ONLY on a real success
      // or a genuine duplicate-bucket (which means it's already in Mongo).
      // Otherwise keep it PENDING so the batch reconciliation ships it — the
      // batch endpoint has no accuracy gate and reconstructs the correct
      // bucket from the capture time, so it can't collide the same way.
      const d: any = res?.data || {};
      const stored = d.ok === true && (d.accepted !== false || d.reason === 'duplicate-bucket');
      if (localId > 0) {
        if (stored) { try { await markPingSynced(localId); } catch {} }
        else { try { await markPingFailed(localId, `not-stored:${d.reason || 'unknown'}`); } catch {} }
      }
      try { await markLastPingAt(Date.now()); } catch {}
      return res;
    } catch (err: any) {
      // On any non-auth failure: LEAVE the row pending, rollback the
      // burst guard so the next tick can retry, and swallow the throw
      // so the tracker doesn't see this as a hard failure — the ping
      // is safely queued and pingSync.ts will retry it.
      const status = err?.response?.status;
      const isAuthReject = status === 401 || status === 403;
      if (localId > 0) {
        try { await markPingFailed(localId, err?.message || String(status || 'network')); } catch {}
      }
      if (!isAuthReject) {
        console.log(`[api] locationPing queued (${status || err?.message}); pingSync will retry — localId=${localId}`);
        try { await AsyncStorage.setItem('erm-bg-last-ping-sent-at', String(priorLastSent)); } catch {}
        // Return a synthetic "queued" success so the tracker moves on.
        return { data: { ok: true, accepted: false, reason: 'queued-locally', localId } } as any;
      }
      // Auth reject → let the interceptor's forceLogout do its thing.
      throw err;
    }
  },
  /**
   * #416 — Batch upload every locally-stored ping still pending. Server
   * dedups by (employeeId + date + localTime) and inserts only missing
   * rows in chronological order. Idempotent — safe to call repeatedly.
   *
   * Body shape:
   *   { pings: [{ employeeId, date, localTime, latitude, longitude, … }] }
   *
   * Response:
   *   { success, totalReceived, alreadyExisted, inserted, duplicatesSkipped,
   *     insertedBuckets, existedBuckets, status }
   */
  syncMissingPings: (pings: any[]) =>
    api.post('/attendance/location-pings/missing-pings', { pings }),

  /**
   * #434 — Fetch the set of 2-minute `bucket`s this employee already has in
   * MongoDB (optionally within a recordedAt ISO range). Used at Check-Out to
   * DIFF the local SQLite store against the server (upload only missing) and
   * to VERIFY completeness before deleting local records.
   * Response: { success, count, buckets: number[] }
   */
  getMyPingBuckets: (fromISO?: string, toISO?: string) => {
    const params: any = {};
    if (fromISO) params.from = fromISO;
    if (toISO) params.to = toISO;
    return api.get('/attendance/location-pings/mine', { params });
  },

  /**
   * #435 — Read the logged-in user's LocationPings for a date. This endpoint
   * is ALREADY deployed (/attendance/ping-history), so the client can verify
   * against the real MongoDB state without waiting for a backend redeploy.
   * Response: { count, date, pings: [{ bucket, recordedAt, ... }] }
   */
  pingHistory: (date?: string) =>
    api.get('/attendance/ping-history', { params: date ? { date } : {} }),

  /** Presence state: 'active' | 'idle' | 'offline'. */
  setPresence: async (state: 'active' | 'idle' | 'offline') => {
    // #408 — Show employee id in the Metro / device console alongside
    // the presence state, so devs can watch presence transitions from
    // the phone without needing the Render dashboard. Mirrors the
    // backend's `[presence] TES080 → active` line.
    // #408 — The mobile login response stores the employee id under
    // `user.userId` (a Mongoose virtual that maps to `employeeId` on
    // the User doc — see backend/src/models/User.js line 112). The
    // physical `employeeId` field is NOT in the login payload, which
    // is why the first cut of this log printed `unknown`. Try every
    // known alias so future backend changes don't silently break this.
    let empId = 'unknown';
    try {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        empId =
          u?.employeeId ||
          u?.userId ||          // ← this is what the login response actually populates
          u?.employee_id ||
          u?.emp_id ||
          'unknown';
      }
    } catch {}
    console.log(`[presence] ${empId} → ${state}`);
    console.warn('[attendanceAPI.setPresence] sending', { empId, state });
    return api.post('/attendance/presence', { state })
      .then((res) => {
        console.warn('[attendanceAPI.setPresence] success', { empId, ...res?.data });
        return res;
      })
      .catch((err) => {
        console.warn('[attendanceAPI.setPresence] error', { empId, err: err?.response?.data || err?.message });
        throw err;
      });
  },
  today: () => api.get('/attendance/today'),
  getMonthly: (month: number, year: number) =>
    api.get(`/attendance/monthly?month=${month}&year=${year}`),
  getCalendar: (month: number, year: number) =>
    api.get(`/attendance/calendar?month=${month}&year=${year}`),
  getSummary: (month: number, year: number) =>
    api.get(`/attendance/summary?month=${month}&year=${year}`),
  getHistory: (month: number, year: number) =>
    api.get(`/attendance/history?month=${month}&year=${year}`),
  createRequest: (data: {
    date: string;
    requestType?: 'regularize' | 'late-justification' | 'missing-checkout' | 'other';
    reason?: string;
    expectedCheckIn?: string;
    expectedCheckOut?: string;
  }) => api.post('/attendance/request', data),
  listRequests: () => api.get('/attendance/requests'),
};

export const leaveAPI = {
  applyLeave: (data: {
    leaveType: string;
    startDate: string;
    endDate: string;
    isHalfDay: boolean;
    reason: string;
  }) => api.post('/leave/apply', data),
  applyPermission: (data: {
    permissionType: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
  }) => api.post('/leave/permission', data),
  getMyLeaves: (filters?: {
    month?: number;
    year?: number;
    type?: 'leave' | 'permission';
  }) => {
    const q: string[] = [];
    if (filters?.month) q.push(`month=${filters.month}`);
    if (filters?.year) q.push(`year=${filters.year}`);
    if (filters?.type) q.push(`type=${filters.type}`);
    const qs = q.length ? `?${q.join('&')}` : '';
    return api.get(`/leave/me${qs}`);
  },
  cancelLeave: (id: string) => api.delete(`/leave/${id}`),
  getLeaveTypes: () => api.get('/leave/types'),
  getPermissionTypes: () => api.get('/leave/permission-types'),
  getBalance: () => api.get('/leave/balance'),
};

export const allowanceAPI = {
  submit: (data: {
    type: 'travel' | 'petrol';
    fromLocation: string;
    toLocation: string;
    date: string;
    amount: number;
    distance?: number;
    notes?: string;
    purpose?: string;
    transport?: string;
    receiptUrl?: string;
  }) => api.post('/allowance/submit', data),
  getMyAllowances: (filters?: {
    month?: number;
    year?: number;
    type?: 'travel' | 'petrol';
  }) => {
    const q: string[] = [];
    if (filters?.month) q.push(`month=${filters.month}`);
    if (filters?.year) q.push(`year=${filters.year}`);
    if (filters?.type) q.push(`type=${filters.type}`);
    const qs = q.length ? `?${q.join('&')}` : '';
    return api.get(`/allowance/my${qs}`);
  },
  getSummary: (filters: {
    month: number;
    year: number;
    type?: 'travel' | 'petrol';
  }) => {
    const q = [`month=${filters.month}`, `year=${filters.year}`];
    if (filters.type) q.push(`type=${filters.type}`);
    return api.get(`/allowance/summary?${q.join('&')}`);
  },
  cancel: (id: string) => api.delete(`/allowance/${id}`),
  getById: (id: string) => api.get(`/allowance/${id}`),
};

export const profileAPI = {
  getProfile: () => api.get('/profile'),
  updateProfile: (data: any) => api.put('/profile/update', data),
};

export const payslipAPI = {
  getLatest: () => api.get('/payslip/latest'),
  getHistory: (year?: number) =>
    api.get('/payslip/history', { params: year ? { year } : {} }),
  getById: (id: string) => api.get(`/payslip/${id}`),
  // Employee asks HR to upload a payslip for { month, year }
  request: (month: number, year: number) =>
    api.post('/payslip/request', { month, year }),
};

export const complaintAPI = {
  list:   ()                        => api.get('/complaint'),
  getOne: (id: string)              => api.get(`/complaint/${id}`),
  create: (data: {
    subject: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    description?: string;
  }) => api.post('/complaint', data),
};

export const announcementAPI = {
  list: (limit = 20) => api.get(`/announcement?limit=${limit}`),
  getById: (id: string) => api.get(`/announcement/${id}`),
  create: (data: {
    title: string;
    body: string;
    category?: 'holiday' | 'policy' | 'event' | 'general';
    postedBy?: string;
    audience?: 'all' | 'department' | 'team';
  }) => api.post('/announcement', data),
  // Per-user read tracking — same shape as notificationAPI so the
  // Announcements screen can reuse the Notifications pattern.
  markAsRead:  (id: string) => api.patch(`/announcement/${id}/read`),
  markAllRead: ()           => api.patch('/announcement/read-all'),
};

// #454 — ROUTE PATH FIX: was '/notifications' (plural), backend mounts
// '/api/notification' (SINGULAR — see backend src/app.js). Every call 404'd
// with "Cannot GET /api/notifications/unread-count" (visible on every app
// open in logcat), so the bell badge never updated and the employee never
// saw HR's changes.
//
// This is why an HR attendance override appeared to "not send a
// notification": the backend DOES create it (adminMarkStatus calls
// notify(userRef, …)), the row is written to MongoDB — the app simply could
// never read it back off the wrong URL.
export const notificationAPI = {
  list:       (params?: { limit?: number }) => api.get('/notification', { params }),
  markAsRead: (id: string) => api.patch(`/notification/${id}/read`),
  markAllRead: () => api.patch('/notification/read-all'),
  unreadCount: () => api.get('/notification/unread-count'),
};
