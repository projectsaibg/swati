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
export interface MapAsset {
  id: string; tag: string; name: string; type: string;
  latitude: number; longitude: number; status: string;
  health: number | null; transport: string | null;
  siteCode: string | null; district: string | null; block: string | null; zone: string | null;
}
export interface MapSite {
  id: string; code: string | null; name: string;
  district: string | null; block: string | null; zone: string | null;
  scheme: string | null; phType: string | null;
  latitude: number; longitude: number;
  assetCount: number; pumpCount: number; fault: number;
}
export interface MapData { sites: MapSite[]; assets: MapAsset[] }

// Cascading geo filter shared by multi-site screens (Assets, Water Quality).
export interface GeoQuery { district?: string; block?: string; zone?: string }
export interface GeoTree { districts: { name: string; blocks: { name: string; zones: string[] }[] }[] }

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
  mapPoints: () => http.get('/map/points').then((r) => r.data as MapData),

  // Pump & Motor ESA
  conditionAssets: (f?: GeoQuery) => http.get('/condition/assets', { params: f }).then((r) => r.data as ConditionAsset[]),
  geoTree: () => http.get('/geo/tree').then((r) => r.data as GeoTree),
  conditionDetail: (id: string) => http.get(`/condition/assets/${id}`).then((r) => r.data as ConditionDetail),

  // GIS import
  gisImport: (assets: GisImportRow[]) =>
    http.post('/gis/import', { assets }).then((r) => r.data as { created: number; updated: number; total: number }),

  // Water Quality
  wqSummary: (f?: GeoQuery) => http.get('/water-quality/summary', { params: f }).then((r) => r.data as WqSummary),
  wqAnalysers: (f?: GeoQuery) => http.get('/water-quality/analysers', { params: f }).then((r) => r.data as WqAnalyser[]),
  wqDetail: (id: string) => http.get(`/water-quality/analysers/${id}`).then((r) => r.data as WqDetail),

  // Pump Stations
  pumpStations: (f?: GeoQuery) => http.get('/pump-stations', { params: f }).then((r) => r.data as PumpStationSummary[]),
  pumpStation: (id: string) => http.get(`/pump-stations/${id}`).then((r) => r.data as PumpStationDetail),

  // NRW Explorer
  nrwSummary: () => http.get('/nrw/summary').then((r) => r.data as NrwSummary),

  // Valve Control
  valves: (f?: GeoQuery) => http.get('/valves', { params: f }).then((r) => r.data as ValveRow[]),
  valve: (id: string) => http.get(`/valves/${id}`).then((r) => r.data as ValveDetail),
  operateValve: (id: string, dto: { action: 'OPEN' | 'CLOSE' | 'SET'; positionPct?: number }) =>
    http.post(`/valves/${id}/operate`, dto).then((r) => r.data as ValveDetail),

  // Leak Detection
  leakSummary: (f?: GeoQuery) => http.get('/leak/summary', { params: f }).then((r) => r.data as LeakSummary),
  leakCandidates: (f?: GeoQuery) => http.get('/leak/candidates', { params: f }).then((r) => r.data as LeakCandidate[]),
  flagLeak: (siteId: string) => http.post(`/leak/flag/${siteId}`).then((r) => r.data as { alertId: string; severity: string }),

  // Maintenance
  maintenanceSummary: (f?: GeoQuery) => http.get('/maintenance/summary', { params: f }).then((r) => r.data as MaintenanceSummary),
  maintenanceOrders: (f?: GeoQuery) => http.get('/maintenance/orders', { params: f }).then((r) => r.data as WorkOrder[]),
  createWorkOrder: (dto: Partial<WorkOrder> & { title: string; siteId?: string }) =>
    http.post('/maintenance/orders', dto).then((r) => r.data as WorkOrder),
  updateWorkOrder: (id: string, dto: { status?: string; priority?: string; assignee?: string; notes?: string }) =>
    http.patch(`/maintenance/orders/${id}`, dto).then((r) => r.data as WorkOrder[]),

  // Billing & Revenue
  billingSummary: (f?: GeoQuery) => http.get('/billing/summary', { params: f }).then((r) => r.data as BillingSummary),
  billingAccounts: (f?: GeoQuery) => http.get('/billing/accounts', { params: f }).then((r) => r.data as BillingAccount[]),

  // Accountability
  accountabilitySummary: (f?: GeoQuery) => http.get('/accountability/summary', { params: f }).then((r) => r.data as AccountabilitySummary),
  accountabilityScorecard: (f?: GeoQuery) => http.get('/accountability/scorecard', { params: f }).then((r) => r.data as AccountabilityRow[]),

  // Preventive (AI forecasting)
  preventiveSummary: (f?: GeoQuery) => http.get('/preventive/summary', { params: f }).then((r) => r.data as PreventiveSummary),
  preventiveForecasts: (f?: GeoQuery & { type?: string }) => http.get('/preventive/forecasts', { params: f }).then((r) => r.data as PreventiveForecast[]),

  // Sujalam Bharat integration layer
  sujalamOverview: () => http.get('/sujalam/overview').then((r) => r.data as SujalamOverview),
  sujalamFieldMappings: (system: string, entityType: string) =>
    http.get('/sujalam/field-mappings', { params: { system, entityType } }).then((r) => r.data as FieldMappingRow[]),
  sujalamValidationRules: (system: string, entityType: string) =>
    http.get('/sujalam/validation-rules', { params: { system, entityType } }).then((r) => r.data as ValidationRuleRow[]),
  sujalamMapPreview: (system: string, entityType: string, id?: string) =>
    http.get('/sujalam/map-preview', { params: { system, entityType, id } }).then((r) => r.data as MapPreview),
  sujalamValidationReport: (system: string, entityType: string) =>
    http.get('/sujalam/validation-report', { params: { system, entityType } }).then((r) => r.data as ValidationReport),
  sujalamGis: () => http.get('/sujalam/gis').then((r) => r.data as SujalamGis),

  // Command Center
  commandCenter: () => http.get('/command-center/summary').then((r) => r.data as CommandCenterData),

  // Field Instruments
  instrumentSummary: (f?: GeoQuery) => http.get('/instruments/summary', { params: f }).then((r) => r.data as InstrumentSummary),
  instrumentList: (f?: GeoQuery & { type?: string }) => http.get('/instruments/list', { params: f }).then((r) => r.data as Instrument[]),

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

export interface ValveRow {
  id: string; tag: string; name: string; area: string | null; valveType: string | null;
  district: string | null; block: string | null; zone: string | null;
  status: string; positionPct: number | null; controllable: boolean;
  upstreamBar: number | null; downstreamBar: number | null; flowKlmin: number | null; health: string | null;
  lastOperated: string | null; lastOperator: string | null;
}
export interface ValveOp {
  id: string; action: string; positionPct: number | null; fromStatus: string | null;
  toStatus: string; operator: string; ts: string;
}
export interface ValveDetail extends Omit<ValveRow, 'lastOperator'> { ops: ValveOp[] }

export interface LeakCandidate {
  siteId: string; code: string | null; name: string;
  district: string | null; block: string | null; zone: string | null;
  scheme: string | null; latitude: number | string | null; longitude: number | string | null;
  avgFlow: number; nightFlow: number; nightRatio: number;
  leakScore: number; severity: 'High' | 'Medium' | 'Low';
  estLossKld: number; likelyCause: string;
}
export interface LeakSummary {
  totalCandidates: number; high: number; medium: number; low: number;
  totalLossKld: number; avgNrwPct: number | null;
  worst: { name: string; estLossKld: number; district: string | null; block: string | null; zone: string | null } | null;
}

export interface WorkOrder {
  id: string; code: string; title: string;
  type: string; priority: string; status: string;
  siteName: string | null; assetTag: string | null;
  district: string | null; block: string | null; zone: string | null;
  assignee: string | null; notes: string | null;
  dueAt: string | null; completedAt: string | null; createdAt: string;
}
export interface MaintenanceSummary {
  total: number; open: number; inProgress: number; done: number;
  overdue: number; preventive: number; corrective: number; highPriority: number;
}

export interface BillingSummary {
  period: string | null;
  demandInr: number; collectedInr: number; arrearsInr: number;
  connections: number; billedKl: number; collectionEfficiency: number;
  trend: { label: string; value: number }[];
  worst: { name: string; arrearsInr: number } | null;
}
export interface BillingAccount {
  siteName: string | null; district: string | null; block: string | null; zone: string | null;
  connections: number; demandInr: number; collectedInr: number; arrearsInr: number; efficiency: number;
}

export interface AccountabilityRow {
  siteName: string | null; district: string | null; block: string | null; zone: string | null;
  connections: number; inputKl: number; billedKl: number; nrwPct: number;
  collectionEff: number; revenueInr: number; score: number; grade: string;
}
export interface AccountabilitySummary {
  sites: number; totalInputKl: number; totalBilledKl: number; waterLossKl: number;
  avgNrwPct: number; avgCollectionEff: number; totalRevenueInr: number; totalConnections: number;
  avgScore: number; grades: Record<string, number>;
}

export interface PreventiveForecast {
  assetTag: string; name: string; type: string; typeLabel: string;
  site: string | null; district: string | null; block: string | null; zone: string | null;
  ageMonths: number; riskPct: number; action: string;
  dueInDays: number; urgency: string; priority: string; confidence: number; estCostInr: number;
}
export interface PreventiveSummary {
  total: number; overdue: number; due30: number; due90: number; scheduled: number;
  predictedFailures30: number; estCostAvoidedInr: number; avgConfidence: number; byType: Record<string, number>;
}

export interface SujalamOverview {
  schemes: { total: number; mapped: number; unmapped: number };
  serviceAreas: { total: number };
  sujalGaon: { total: number; mapped: number; unmapped: number };
  infrastructure: { total: number; mapped: number; unmapped: number };
  status: Record<string, number>;
  readinessPct: number;
  providers: { system: string; name: string; enabled: boolean; mockMode: boolean; supportsPush: boolean; supportsPull: boolean }[];
  lastSync: { provider: string; direction: string; state: string; at: string } | null;
  mock: boolean;
  disclaimer: string;
}

export interface FieldMappingRow {
  id: string; externalSystem: string; entityType: string;
  internalField: string; externalField: string; transform: string;
  transformArg: string | null; required: boolean; enabled: boolean; notes: string | null;
}
export interface ValidationRuleRow {
  id: string; externalSystem: string | null; entityType: string;
  field: string; ruleType: string; param: string | null; severity: string; message: string; enabled: boolean;
}
export interface MapPreview {
  system: string; entityType: string; mappingCount: number;
  entity: { id: string; label: string } | null;
  internal: Record<string, unknown>; external: Record<string, unknown>;
  missingRequired: string[]; mock: boolean; disclaimer: string;
}
export interface ValidationIssueRow {
  id: string; label: string; valid: boolean; errors: number; warnings: number;
  details: { field: string; ruleType: string; severity: string; message: string }[];
}
export interface ValidationReport {
  system: string; entityType: string; ruleCount: number;
  summary: { total: number; valid: number; invalid: number; withWarnings: number; readyForSync: number };
  issues: ValidationIssueRow[]; mock: boolean; disclaimer: string;
}
export interface GisPoint { id: string; label: string; lat: number; lng: number; mapped: boolean }
export interface GisBoundary { id: string; label: string; kind: 'SERVICE_AREA' | 'SUJAL_GAON'; geojson: unknown }
export interface SujalamGis {
  points: GisPoint[];
  boundaries: GisBoundary[];
  counts: {
    assets: number; assetsGeolocated: number;
    serviceAreas: number; serviceAreasWithBoundary: number;
    villages: number; villagesWithBoundary: number;
  };
  mock: boolean; disclaimer: string;
}

export interface Instrument {
  id: string; tag: string; name: string; type: string; typeLabel: string;
  siteName: string | null; district: string | null; block: string | null; zone: string | null;
  transport: string | null; lastSeen: string | null; online: boolean;
  value: number | null; unit: string; metric: string | null; ts: string | null;
}
export interface InstrumentSummary {
  total: number; byType: Record<string, number>; online: number; offline: number;
}

export interface CommandCenterData {
  pressure: { psi: number; gpm: number };
  consumption: { label: string; value: number }[];
  pipeCondition: { good: number; fair: number; poor: number; critical: number; overallHealth: number };
  assets: { treatmentPlants: number; pumpStations: number; valves: number; customers: number; networkMiles: number };
  supplyDemand: { supplyPsi: number; totalDemandGpm: number; systemDemandGpm: number; supplyReserveMld: number };
  plantStation: { label: string; production: number; leakage: number; wamr: number; ami: number }[];
  maintenance: { code: string; title: string; site: string | null; priority: string; due: string | null }[];
  waterMainBreaks: { label: string; breaks: number; prev: number }[];
  pumpStatus: { name: string; district: string; cells: number[] }[];
  leaks: { lat: number; lng: number; severity: string }[];
  updatedAt: string;
}

export interface NrwSummary {
  period: string | null;
  totalInputKl: number; totalBilledKl: number; nrwKl: number; nrwPct: number;
  physicalKl: number; commercialKl: number; physicalPct: number; commercialPct: number;
  dmas: { area: string; inputKl: number; billedKl: number; nrwKl: number; nrwPct: number }[];
  trend: { period: string; nrwPct: number }[];
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
