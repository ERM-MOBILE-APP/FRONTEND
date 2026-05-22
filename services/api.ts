import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL = 'https://backend-emqy.onrender.com/api';

// Render free tier cold start can take 30–60s on first request after idle.
// We use a long default timeout and an even longer timeout for the warm-up call.
const DEFAULT_TIMEOUT_MS = 90_000; // 90s — survives Render wake-up
const WAKEUP_TIMEOUT_MS = 120_000; // 2 min — first contact after long sleep

const api = axios.create({
  baseURL: BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
});

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
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

    // Auto-retry ONCE on network error / cold-start timeout.
    if ((!err.response || err.code === 'ECONNABORTED') && !cfg.__retried) {
      cfg.__retried = true;
      cfg.timeout = WAKEUP_TIMEOUT_MS;
      console.log('[API RETRY] cold-start retry →', cfg.url);
      try {
        return await api.request(cfg);
      } catch (e) {
        // fall through to the network-error handler below
      }
    }

    if (!err.response) {
      const networkMsg = `Server is taking too long to wake up.

This usually happens on the first request after the backend has been idle.
Please wait 30 seconds and try again — it warms up automatically.

(Code: ${err.code || 'NETWORK'})`;
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
};

export const attendanceAPI = {
  checkIn: (location: 'remote' | 'office' = 'office') =>
    api.post('/attendance/checkin', { location }),
  checkOut: () => api.post('/attendance/checkout'),
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
};

export const notificationAPI = {
  list: (params?: { limit?: number; onlyUnread?: boolean }) => {
    const q: string[] = [];
    if (params?.limit) q.push(`limit=${params.limit}`);
    if (params?.onlyUnread) q.push(`onlyUnread=true`);
    const qs = q.length ? `?${q.join('&')}` : '';
    return api.get(`/notification${qs}`);
  },
  unreadCount: () => api.get('/notification/unread-count'),
  getById: (id: string) => api.get(`/notification/${id}`),
  markAsRead: (id: string) => api.patch(`/notification/${id}/read`),
  markAllRead: () => api.patch('/notification/read-all'),
  remove: (id: string) => api.delete(`/notification/${id}`),
};

export default api;
