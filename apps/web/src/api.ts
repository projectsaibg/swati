import axios, { AxiosError, AxiosRequestConfig } from 'axios';

export type Visibility = 'PUBLIC' | 'LOGIN';
export interface PublicFeature { key: string; visibility: Visibility; tier?: string | null }
export interface AdminFeature { key: string; module: string; tier: string; enabled: boolean; visibility: Visibility }
export interface Me { id: string; email: string; name: string; roleName?: string; rank?: number; permissions?: string[] }

export interface Permission { key: string; label: string }
export interface Role {
  id: string; name: string; rank: number; permissions: string[];
  reportsToId: string | null; reportsToName: string | null; userCount: number;
}
export interface AdminUser {
  id: string; email: string; name: string; status: 'ACTIVE' | 'DISABLED';
  roleId: string; roleName: string; roleRank: number;
  managerId: string | null; managerName: string | null;
  lastLogin: string | null; createdAt: string;
}
export type Transport = 'MQTT' | 'LORAWAN' | 'WIFI' | 'SIM' | 'RTU_MODBUS' | 'HTTP';
export interface Device {
  id: string; tag: string; name: string; type: string;
  siteId: string | null; siteName: string | null;
  latitude: number | null; longitude: number | null; status: string;
  transport: Transport | null; gatewayId: string | null;
  config: Record<string, unknown>; lastSeen: string | null;
  lastMeasurement: { ts: string; metric: string; value: number; unit: string | null } | null;
}
export interface Measurement {
  id: string; assetId: string; ts: string; metric: string;
  value: number; unit: string | null; quality: string | null; source: string;
}

export interface DashboardSummary {
  assets: { total: number; running: number; fault: number; stopped: number };
  devices: { total: number; online: number; offline: number };
  alerts: { open: number; critical: number; alarm: number; watch: number; info: number };
  health: { avg: number | null; min: number | null };
  updatedAt: string;
}
export type Severity = 'INFO' | 'WATCH' | 'ALARM' | 'CRITICAL';
export interface AlertRow {
  id: string; category: string; severity: Severity; message: string;
  metric: string | null; valueNum: number | null; status: string; createdAt: string;
  assetTag: string | null; assetName: string | null;
}
export interface MapPoint {
  id: string; tag: string; name: string; type: string;
  latitude: number; longitude: number; status: string;
  health: number | null; transport: string | null;
}

export interface EsaResult {
  supplyIndex: number | null; statorIndex: number | null; rotorIndex: number | null;
  eccentricityIndex: number | null; bearingIndex: number | null; loadIndex: number | null;
  healthScore: number | null; severity: Severity; drivers: string[];
}
export interface ConditionAsset {
  id: string; tag: string; name: string; type: string; status: string;
  ratedPowerKw: number | null; lastReadingTs: string | null; esa: EsaResult | null;
}
export interface ConditionDetail {
  id: string; tag: string; name: string; type: string; status: string;
  rated: { powerKw: number | null; voltageV: number | null; currentA: number | null; speedRpm: number | null };
  latest: Record<string, number | string | null> | null;
  esa: EsaResult | null;
  trend: { ts: string; healthScore: number | null }[];
  recent: { ts: string; healthScore: number | null; loadPct: number | null; vibrationMmS: number | null; bearingTempC: number | null; source: string }[];
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

export const http = axios.create({ baseURL: '/api', withCredentials: true });

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing: Promise<string | null> | null = null;
async function tryRefresh(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post('/api/auth/refresh', {}, { withCredentials: true })
      .then((r) => { setAccessToken(r.data.accessToken); return r.data.accessToken as string; })
      .catch(() => { setAccessToken(null); return null; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true;
      const t = await tryRefresh();
      if (t) {
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${t}` };
        return http(original);
      }
    }
    return Promise.reject(error);
  },
);

// ---- typed calls ----
export const api = {
  login: (email: string, password: string) =>
    http.post('/auth/login', { email, password }).then((r) => r.data as { accessToken: string; user: Me }),
  logout: () => http.post('/auth/logout').then(() => undefined),
  me: () => http.get('/auth/me').then((r) => r.data as Me),
  publicFeatures: () => http.get('/public/features').then((r) => r.data as PublicFeature[]),
  adminFeatures: () => http.get('/admin/features').then((r) => r.data as AdminFeature[]),
  setFeature: (key: string, dto: { enabled?: boolean; visibility?: Visibility }) =>
    http.patch(`/admin/features/${key}`, dto).then((r) => r.data as AdminFeature[]),
  setTier: (tier: string) => http.put('/admin/tier', { tier }).then((r) => r.data as AdminFeature[]),

  // Roles
  permissions: () => http.get('/admin/roles/permissions').then((r) => r.data as Permission[]),
  roles: () => http.get('/admin/roles').then((r) => r.data as Role[]),
  createRole: (dto: { name: string; rank: number; permissions?: string[]; reportsToId?: string | null }) =>
    http.post('/admin/roles', dto).then((r) => r.data as Role[]),
  updateRole: (id: string, dto: Partial<{ name: string; rank: number; permissions: string[]; reportsToId: string | null }>) =>
    http.patch(`/admin/roles/${id}`, dto).then((r) => r.data as Role[]),
  deleteRole: (id: string) => http.delete(`/admin/roles/${id}`).then((r) => r.data as Role[]),

  // Users
  users: () => http.get('/admin/users').then((r) => r.data as AdminUser[]),
  createUser: (dto: { email: string; name: string; roleId: string; managerId?: string | null; password?: string }) =>
    http.post('/admin/users', dto).then((r) => r.data as { users: AdminUser[]; generatedPassword?: string }),
  updateUser: (id: string, dto: Partial<{ name: string; roleId: string; managerId: string | null; status: 'ACTIVE' | 'DISABLED' }>) =>
    http.patch(`/admin/users/${id}`, dto).then((r) => r.data as AdminUser[]),
  resetUserPassword: (id: string) =>
    http.post(`/admin/users/${id}/reset-password`).then((r) => r.data as { generatedPassword: string }),
  deleteUser: (id: string) => http.delete(`/admin/users/${id}`).then((r) => r.data as AdminUser[]),

  // Devices / IoT
  devices: () => http.get('/devices').then((r) => r.data as Device[]),
  registerDevice: (dto: {
    tag: string; name: string; type: string; transport: Transport;
    latitude?: number; longitude?: number; gatewayId?: string | null; config?: Record<string, unknown>;
  }) => http.post('/devices', dto).then((r) => r.data as { id: string; devices: Device[] }),
  updateDevice: (id: string, dto: Partial<{
    name: string; transport: Transport; latitude: number; longitude: number;
    gatewayId: string | null; config: Record<string, unknown>;
  }>) => http.patch(`/devices/${id}`, dto).then((r) => r.data as Device[]),
  deviceMeasurements: (id: string, metric?: string, limit = 100) =>
    http.get(`/devices/${id}/measurements`, { params: { metric, limit } }).then((r) => r.data as Measurement[]),

  // M3 base screens
  dashboardSummary: () => http.get('/dashboard/summary').then((r) => r.data as DashboardSummary),
  alerts: (status = 'OPEN') => http.get('/alerts', { params: { status } }).then((r) => r.data as AlertRow[]),
  ackAlert: (id: string) => http.post(`/alerts/${id}/ack`).then((r) => r.data as AlertRow[]),
  mapPoints: () => http.get('/map/points').then((r) => r.data as MapPoint[]),

  // Pump & Motor ESA
  conditionAssets: () => http.get('/condition/assets').then((r) => r.data as ConditionAsset[]),
  conditionDetail: (id: string) => http.get(`/condition/assets/${id}`).then((r) => r.data as ConditionDetail),

  // GIS import
  gisImport: (assets: GisImportRow[]) =>
    http.post('/gis/import', { assets }).then((r) => r.data as { created: number; updated: number; total: number }),

  // Water Quality
  wqSummary: () => http.get('/water-quality/summary').then((r) => r.data as WqSummary),
  wqAnalysers: () => http.get('/water-quality/analysers').then((r) => r.data as WqAnalyser[]),
  wqDetail: (id: string) => http.get(`/water-quality/analysers/${id}`).then((r) => r.data as WqDetail),

  // Pump Stations
  pumpStations: () => http.get('/pump-stations').then((r) => r.data as PumpStationSummary[]),
  pumpStation: (id: string) => http.get(`/pump-stations/${id}`).then((r) => r.data as PumpStationDetail),

  // Field Verification
  fieldVerifications: () => http.get('/field-verification').then((r) => r.data as FieldVerificationRow[]),
  createFieldVerification: (form: FormData) =>
    http.post('/field-verification', form).then((r) => r.data as { fieldVerification: FieldVerificationRow; attachmentId: string }),
  fieldPhoto: (attId: string) =>
    http.get(`/field-verification/${attId}/image`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data as Blob)),
};

export interface GisImportRow { tag: string; name: string; type?: string; latitude: number; longitude: number }

export type WqStatus = 'safe' | 'warn' | 'breach';
export interface WqParam { key: string; label: string; unit: string; value: number | null; status: WqStatus | null; ts: string | null }
export interface WqAnalyser {
  id: string; tag: string; name: string; dmaId: string | null; dmaName: string;
  transport: string | null; lastSeen: string | null; status: WqStatus; params: WqParam[];
}
export interface WqParamSummary {
  key: string; label: string; unit: string; avg: number | null; status: WqStatus | null;
  breach: number; warn: number; total: number; trend: 'up' | 'down' | 'flat'; good: boolean;
}
export interface WqSummary {
  analyserCount: number; dmaCount: number;
  parameters: WqParamSummary[];
  dmas: { id: string; name: string; analyserCount: number; status: WqStatus; worstParam: string | null }[];
  compliance: { compliant: number; nonCompliant: number; underReview: number; pending: number };
  compliancePct: number;
  pollutionPct: number;
  overTime: { label: string; pct: number }[];
}
export interface WqDetail {
  id: string; tag: string; name: string; dmaName: string; transport: string | null; lastSeen: string | null;
  status: WqStatus; params: WqParam[]; trends: Record<string, { ts: string; value: number }[]>;
}

export interface FieldPhoto {
  attachmentId: string; uploadedAt: string; exifTakenAt: string | null;
  gpsLat: number | null; gpsLng: number | null; watermarked: boolean;
}
export interface FieldVerificationRow {
  id: string; ref: string; location: string | null; category: string | null; verifier: string | null;
  status: string; notes: string | null; latitude: number | null; longitude: number | null;
  verifiedAt: string | null; createdAt: string; photos: FieldPhoto[];
}

export interface Series { ts: string; value: number }
export interface PumpStationSummary {
  id: string; name: string; pumpCount: number; running: number; tripped: number;
  storageM3: number | null; levelPct: number | null; pressureBar: number | null; netFlowKlh: number | null;
}
export type PumpState = 'RUN' | 'REST' | 'TRIP';
export interface StationPump {
  id: string; tag: string; name: string; state: PumpState; health: number | null;
  dutyPct: number; runtimeH: number; powerKw: number | null; flowKlh: number | null;
  timeline: { ts: string; on: boolean }[]; powerTrend: Series[];
}
export interface PumpStationDetail {
  id: string; name: string;
  kpis: { storageM3: number | null; levelPct: number | null; pressureBar: number | null; netFlowKlh: number | null;
    running: number; resting: number; tripped: number; totalPowerKw: number };
  pumps: StationPump[];
  charts: { flow: Series[]; energy: Series[]; tank: Series[] };
}
