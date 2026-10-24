import axios from 'axios';

// Get base path dynamically for sub-folder deployments (e.g. /bus-operator-dev/)
const getBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  const pathname = window.location.pathname;
  if (pathname.includes('/bus-operator-dev')) {
    return '/bus-operator-dev/api2';
  }
  return '/api2';
};

const BASE_URL = getBaseUrl();

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

const passengerApi = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

passengerApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('passenger_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Request interceptor - attach access token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const resp = await axios.post(`${BASE_URL}/auth/refresh-token`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = resp.data.data;
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', newRefresh);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.replace(import.meta.env.BASE_URL);
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ── Typed API Helpers ──────────────────────────────────────
export const authAPI = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }),
  changePassword: (currentPassword: string, newPassword: string) => api.post('/auth/change-password', { currentPassword, newPassword }),
  refreshToken: (refreshToken: string) => api.post('/auth/refresh-token', { refreshToken }),
};

export const dashboardAPI = {
  stats: (params?: object) => api.get('/dashboard/stats', { params }),
  boardedPassengers: (params?: object) => api.get('/dashboard/boarded-passengers', { params }),
  revenueReport: (params?: object) => api.get('/dashboard/revenue-report', { params }),
  auditLogs: (params?: object) => api.get('/dashboard/audit-logs', { params }),
};

export const locationsAPI = {
  dashboard: () => api.get('/locations/dashboard'),
  getHistoryList: (params?: object) => api.get('/locations/history', { params }),
  getTripHistory: (tripId: number, params?: object) => api.get(`/locations/trips/${tripId}`, { params }),
  getTripStoppages: (tripId: number) => api.get(`/locations/trips/${tripId}/stoppages`),
  getStoppageLogs: (params?: object) => api.get('/locations/stoppages/logs', { params }),
};

export const rateChartsAPI = {
  list: () => api.get('/rate-charts'),
  create: (data: object) => api.post('/rate-charts', data),
  update: (id: number, data: object) => api.put(`/rate-charts/${id}`, data),
  delete: (id: number) => api.delete(`/rate-charts/${id}`),
};

export const usersAPI = {
  list: (params?: object) => api.get('/users', { params }),
  show: (id: number) => api.get(`/users/${id}`),
  create: (data: object) => api.post('/users', data),
  update: (id: number, data: object) => api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  toggleStatus: (id: number) => api.patch(`/users/${id}/toggle-status`),
};

export const rolesAPI = {
  list: () => api.get('/roles'),
  create: (data: object) => api.post('/roles', data),
  update: (id: number, data: object) => api.put(`/roles/${id}`, data),
  delete: (id: number) => api.delete(`/roles/${id}`),
  listPermissions: () => api.get('/roles/permissions'),
  assignPermissions: (id: number, permission_ids: number[]) => api.put(`/roles/${id}/permissions`, { permission_ids }),
};

export const driversAPI = {
  list: (params?: object) => api.get('/drivers', { params }),
  show: (id: number) => api.get(`/drivers/${id}`),
  create: (data: object) => api.post('/drivers', data),
  update: (id: number, data: object) => api.put(`/drivers/${id}`, data),
  delete: (id: number) => api.delete(`/drivers/${id}`),
  updateStatus: (id: number, data: object) => api.patch(`/drivers/${id}/status`, data),
};

export const vehiclesAPI = {
  list: (params?: object) => api.get('/vehicles', { params }),
  show: (id: number) => api.get(`/vehicles/${id}`),
  create: (data: object) => api.post('/vehicles', data),
  update: (id: number, data: object) => api.put(`/vehicles/${id}`, data),
  delete: (id: number) => api.delete(`/vehicles/${id}`),
  addDocument: (id: number, data: object) => api.post(`/vehicles/${id}/documents`, data),
  updateDocument: (id: number, documentId: number, data: object) => api.put(`/vehicles/${id}/documents/${documentId}`, data),
  expiringDocs: (days?: number) => api.get('/vehicles/expiring-documents', { params: { days } }),
  busTypes: () => api.get('/vehicles/bus-types'),
};

export const routesAPI = {
  list: (params?: object) => api.get('/routes', { params }),
  show: (id: number) => api.get(`/routes/${id}`),
  create: (data: object) => api.post('/routes', data),
  update: (id: number, data: object) => api.put(`/routes/${id}`, data),
  delete: (id: number) => api.delete(`/routes/${id}`),
  duplicate: (id: number, data?: object) => api.post(`/routes/${id}/duplicate`, data),
  reverse: (id: number, data?: object) => api.post(`/routes/${id}/reverse`, data),
  addStop: (routeId: number, data: object) => api.post(`/routes/${routeId}/stops`, data),
  updateStop: (routeId: number, stopId: number, data: object) => api.put(`/routes/${routeId}/stops/${stopId}`, data),
  deleteStop: (routeId: number, stopId: number) => api.delete(`/routes/${routeId}/stops/${stopId}`),
};

export const stopsAPI = {
  list: (params?: object) => api.get('/routes/stops', { params }),
  show: (id: number) => api.get(`/routes/stops/${id}`),
  search: (q: string) => api.get('/routes/stops/search', { params: { q } }),
  nearbyCheck: (lat: number, lng: number, radius = 100) => api.get('/routes/stops/nearby-check', { params: { lat, lng, radius } }),
  create: (data: object) => api.post('/routes/stops', data),
  update: (id: number, data: object) => api.put(`/routes/stops/${id}`, data),
  delete: (id: number) => api.delete(`/routes/stops/${id}`),
};

export const tripsAPI = {
  list: (params?: object) => api.get('/trips', { params }),
  assignmentOptions: () => api.get('/trips/assignment-options'),
  show: (id: number) => api.get(`/trips/${id}`),
  create: (data: object) => api.post('/trips', data),
  update: (id: number, data: object) => api.put(`/trips/${id}`, data),
  delete: (id: number) => api.delete(`/trips/${id}`),
  updateStatus: (id: number, status: string) => api.patch(`/trips/${id}/status`, { status }),
  assignDriver: (id: number, driver_id: number) => api.patch(`/trips/${id}/assign-driver`, { driver_id }),
  assignVehicle: (id: number, vehicle_id: number) => api.patch(`/trips/${id}/assign-vehicle`, { vehicle_id }),
  assignRoute: (id: number, route_id: number) => api.patch(`/trips/${id}/assign-route`, { route_id }),
  generateFuture: (data?: object) => api.post('/trips/generate-future', data || {}),
};

export const ownerApprovalAPI = {
  submit: (data: object) => api.post('/owner-approval-requests', data),
  mine: () => api.get('/owner-approval-requests/mine'),
  list: (params?: object) => api.get('/owner-approval-requests', { params }),
  review: (id: number, decision: 'approve' | 'reject', admin_note?: string) =>
    api.patch(`/owner-approval-requests/${id}/review`, { decision, admin_note }),
};

export const ownerKycAPI = {
  getProfile: () => api.get('/owner-kyc/profile'),
  submit: (data: object) => api.post('/owner-kyc', data),
  getMine: () => api.get('/owner-kyc/mine'),
  list: (params?: object) => api.get('/owner-kyc', { params }),
  updateStatus: (id: number, data: { status: 'verified' | 'rejected'; admin_note?: string }) =>
    api.patch(`/owner-kyc/${id}/status`, data),
};

export const settlementsAPI = {
  list: (params?: object) => api.get('/owner-settlements', { params }),
  getConfig: () => api.get('/owner-settlements/config'),
  getTripRates: () => api.get('/owner-settlements/trip-rates'),
  getPreviousWeekSummary: (params?: { owner_id?: number }) => api.get('/owner-settlements/previous-week-summary', { params }),
  get: (id: number) => api.get(`/owner-settlements/${id}`),
  create: (data: object) => api.post('/owner-settlements', data),
  updateStatus: (id: number, data: { status: 'approved' | 'rejected' | 'pending'; utr_number?: string; admin_note?: string }) =>
    api.patch(`/owner-settlements/${id}/status`, data),
  delete: (id: number) => api.delete(`/owner-settlements/${id}`),
};


export const bookingsAPI = {
  list: (params?: object) => api.get('/bookings', { params }),
  show: (id: number) => api.get(`/bookings/${id}`),
  create: (data: object) => api.post('/bookings', data),
  cancel: (id: number, reason?: string) => api.patch(`/bookings/${id}/cancel`, { cancellation_reason: reason }),
  updatePayment: (id: number, data: object) => api.patch(`/bookings/${id}/payment`, data),
  cancelled: (params?: object) => api.get('/bookings/cancelled', { params }),
  track: (id: number) => api.get(`/bookings/${id}/track`),
};

export const refundsAPI = {
  list: (params?: object) => api.get('/refunds', { params }),
  failed: (params?: object) => api.get('/refunds/failed', { params }),
  completed: (params?: object) => api.get('/refunds/completed', { params }),
  process: (id: number, data: object) => api.patch(`/refunds/${id}/process`, data),
  verifyPayU: (id: number) => api.patch(`/refunds/${id}/verify-payu`),
  retry: (id: number) => api.patch(`/refunds/${id}/retry`),
  markFailed: (id: number, reason: string) => api.patch(`/refunds/${id}/mark-failed`, { failure_reason: reason }),
  resyncPayU: (id: number) => api.post(`/payu/refunds/${id}/resync`),
};

export const payuWebhooksAPI = {
  list: (params?: object) => api.get('/payu/logs', { params }),
};

export const passengersAPI = {
  list: (params?: object) => api.get('/passengers', { params }),
  show: (id: number) => api.get(`/passengers/${id}`),
  create: (data: object) => api.post('/passengers', data),
  update: (id: number, data: object) => api.put(`/passengers/${id}`, data),
  delete: (id: number) => api.delete(`/passengers/${id}`),
  toggleBlock: (id: number) => api.patch(`/passengers/${id}/toggle-block`),
};

export const passesAPI = {
  list: (params?: object) => api.get('/passes', { params }),
  show: (id: number) => api.get(`/passes/${id}`),
  create: (data: object) => api.post('/passes', data),
  update: (id: number, data: object) => api.put(`/passes/${id}`, data),
  delete: (id: number) => api.delete(`/passes/${id}`),
  expiringSoon: (days?: number) => api.get('/passes/expiring', { params: { days } }),
};

export const packagesAPI = {
  list: (params?: object) => api.get('/packages', { params }),
  show: (id: number | string) => api.get(`/packages/${id}`),
  create: (data: object) => api.post('/packages', data),
  update: (id: number | string, data: object) => api.put(`/packages/${id}`, data),
  delete: (id: number | string) => api.delete(`/packages/${id}`),
  toggleStatus: (id: number | string) => api.patch(`/packages/${id}/toggle-status`),
};

export const packagePurchasesAPI = {
  list: (params?: object) => api.get('/package-purchases', { params }),
  show: (purchaseId: number | string) => api.get(`/package-purchases/${purchaseId}`),
};

export type RidePackageBookingRequest = {
  passenger_id: number;
  passenger_name: string;
  passenger_mobile: string;
  passenger_email?: string;
  origin_stop_id: number;
  destination_stop_id: number;
  travel_date: string;
  seat_numbers?: number[];
  total_seats?: number;
  payment_method?: string;
} & (
  | { trip_id: number | string; schedule_id?: number | string }
  | { schedule_id: number | string; trip_id?: number | string }
) & (
  | { package_id: number | string; package_code?: never }
  | { package_code: string; package_id?: never }
);

export type PackageRideBookingRequest = {
  package_purchase_id: number;
  idempotency_key: string;
  passenger_name?: string;
  passenger_mobile?: string;
  passenger_email?: string;
  origin_stop_id: number;
  destination_stop_id: number;
  travel_date: string;
  seat_numbers?: number[];
  total_seats?: number;
} & (
  | { trip_id: number | string; schedule_id?: number | string }
  | { schedule_id: number | string; trip_id?: number | string }
);

export const shuttleAPI = {
  getPackages: (params?: object) => api.get('/shuttle/packages', { params }),
  getPackageDetails: (id: number | string) => api.get(`/shuttle/packages/${id}`),
  search: (data: object) => api.post('/shuttle/search', data),
  book: (data: object) => api.post('/shuttle/book', data),
  cancel: (data: object) => api.post('/shuttle/cancel-booking', data),
  initiatePayu: (data: { booking_id: number; passenger_mobile: string }) =>
    api.post('/shuttle/payment/payu/initiate', data),
  getAvailablePackages: (params?: { route_id?: number }) => api.get('/bus/packages', { params }),
  getAvailablePackage: (id: number | string) => api.get(`/bus/packages/${id}`),
  createPackageBooking: (data: RidePackageBookingRequest) => api.post('/bus/create-booking', data),
  initiatePackagePayment: (data: { booking_id: number; passenger_mobile: string }) =>
    api.post('/bus/payment/payu/initiate', data),
};

export const passengerPackagesAPI = {
  createPurchase: (data: { package_id?: number | string; package_code?: string }) =>
    passengerApi.post('/bus/package-purchases', data),
  listMine: () => passengerApi.get('/bus/my-packages'),
  getTransactions: (params?: { page?: number; limit?: number }) =>
    passengerApi.get('/bus/my-package-transactions', { params }),
  getMine: (purchaseId: number | string) => passengerApi.get(`/bus/my-packages/${purchaseId}`),
  getUsage: (purchaseId: number | string) => passengerApi.get(`/bus/my-packages/${purchaseId}/usage`),
  createBooking: (data: PackageRideBookingRequest) => passengerApi.post('/bus/create-booking', data),
  initiatePayment: (purchaseId: number | string) =>
    passengerApi.post('/bus/payment/payu/initiate', { package_purchase_id: purchaseId }),
  getBooking: (bookingId: number | string) => passengerApi.get(`/bus/bookings/${bookingId}`),
  cancelBooking: (bookingId: number | string, reason?: string) =>
    passengerApi.post(`/bus/bookings/${bookingId}/cancel`, { cancellation_reason: reason }),
};

export const couponsAPI = {
  available: (params?: object) => api.get('/bus/coupons', { params }),
  list: (params?: object) => api.get('/coupons', { params }),
  show: (id: number) => api.get(`/coupons/${id}`),
  usages: (id: number, params?: object) => api.get(`/coupons/${id}/usages`, { params }),
  create: (data: object) => api.post('/coupons', data),
  update: (id: number, data: object) => api.put(`/coupons/${id}`, data),
  delete: (id: number) => api.delete(`/coupons/${id}`),
  validate: (code: string, amount: number) => api.post('/coupons/validate', { code, amount }),
};

export const notificationsAPI = {
  list: (params?: object) => api.get('/notifications', { params }),
  send: (data: object) => api.post('/notifications', data),
  markRead: (id: number) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
  delete: (id: number) => api.delete(`/notifications/${id}`),
};

export const paymentsAPI = {
  list: (params?: object) => api.get('/payments', { params }),
  show: (id: number) => api.get(`/payments/${id}`),
};

export const settingsAPI = {
  list: (group?: string) => api.get('/settings', { params: { group } }),
  get: (key: string) => api.get(`/settings/${key}`),
  update: (data: object) => api.post('/settings', data),
  bulkUpdate: (settings: object[]) => api.put('/settings/bulk', { settings }),
};

export const bannersAPI = {
  list: (params?: object) => api.get('/banners', { params }),
  show: (id: number) => api.get(`/banners/${id}`),
  create: (data: FormData | object) => {
    if (typeof FormData !== 'undefined' && data instanceof FormData) {
      return api.post('/banners', data, { headers: { 'Content-Type': 'multipart/form-data' } });
    }
    return api.post('/banners', data);
  },
  update: (id: number, data: FormData | object) => {
    if (typeof FormData !== 'undefined' && data instanceof FormData) {
      return api.put(`/banners/${id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
    }
    return api.put(`/banners/${id}`, data);
  },
  delete: (id: number) => api.delete(`/banners/${id}`),
  toggleStatus: (id: number) => api.patch(`/banners/${id}/toggle-status`),
  reorder: (items: { id: number; display_order: number }[]) => api.patch('/banners/reorder', { items }),
  trackClick: (id: number) => api.post(`/banners/${id}/click`),
};
