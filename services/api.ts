import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// LAN IP — phone must be on the same WiFi as this PC.
// Find your IP with `ipconfig` (Windows). Port 5000 is now open in Windows Firewall.
export const BASE_URL = 'http://10.14.224.63:5000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

// Attach token
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  console.log('[API REQ]', config.method?.toUpperCase(), config.baseURL + (config.url || ''));
  return config;
});

// Detailed error reporting
api.interceptors.response.use(
  (res) => {
    console.log('[API OK]', res.status, res.config.url);
    return res;
  },
  (err) => {
    // Network / CORS / server-down failures don't have err.response
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

// Quick reachability test — call from any screen
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
};

export const attendanceAPI = {
  checkIn: (location: 'remote' | 'office' = 'office') =>
    api.post('/attendance/checkin', { location }),
  checkOut: () => api.post('/attendance/checkout'),
  today: () => api.get('/attendance/today'),
  getMonthly: (month: number, year: number) =>
    api.get(`/attendance/monthly?month=${month}&year=${year}`),
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
  getMyLeaves: () => api.get('/leave/me'),
};

export const allowanceAPI = {
  submit: (data: any) => api.post('/allowance/submit', data),
  getMyAllowances: () => api.get('/allowance/my'),
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

export default api;