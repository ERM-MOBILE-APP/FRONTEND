import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL = 'https://backend-emqy.onrender.com/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
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
  (err) => {
    if (!err.response) {
      const networkMsg = `Cannot reach server at ${BASE_URL}.

• Is the backend running? (cd backend && npm run dev)
• Is the IP correct? Your phone must be on the same WiFi as your PC.
• Code: ${err.code || 'NETWORK'}`;
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
   * Send OTP to user's registered email for password reset.
   * Tries real endpoint first; falls back to a mock success so the
   * UI flow works even when the backend route doesn't exist yet.
   */
  sendOtp: async (email: string) => {
    try {
      const res = await api.post('/auth/send-otp', { email });
      return res;
    } catch (err: any) {
      const status = err?.response?.status;
      // 404 = endpoint not implemented yet → return mock so UI keeps working
      if (status === 404 || !err.response) {
        console.log('[authAPI.sendOtp] mock fallback for', email);
        return {
          data: {
            success: true,
            message: `OTP sent to ${email}. (mock — backend route not implemented)`,
          },
        } as any;
      }
      throw err;
    }
  },

  /**
   * Verify OTP entered by user.
   * Mock fallback accepts "123456" while backend route is missing.
   */
  verifyOtp: async (email: string, otp: string) => {
    try {
      const res = await api.post('/auth/verify-otp', { email, otp });
      return res;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || !err.response) {
        if (otp === '123456') {
          return {
            data: {
              success: true,
              message: 'OTP verified (mock)',
              resetToken: 'mock-reset-token',
            },
          } as any;
        }
      }
      throw err;
    }
  },

  /**
   * Reset password using a valid resetToken from verifyOtp.
   */
  resetPassword: async (resetToken: string, newPassword: string) => {
    try {
      const res = await api.post('/auth/reset-password', {
        resetToken,
        newPassword,
      });
      return res;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404 || !err.response) {
        // mock success when backend route missing
        return {
          data: {
            success: true,
            message: 'Password reset successful (mock)',
          },
        } as any;
      }
      throw err;
    }
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
