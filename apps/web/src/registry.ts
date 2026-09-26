// Maps feature keys (from the API) to nav metadata + route path.
// Keep keys in sync with apps/api/src/features.ts FEATURE_REGISTRY.
export interface NavItem {
  key: string;
  label: string;
  path: string;
  group: string;
}

export const NAV: NavItem[] = [
  { key: 'executive_overview', label: 'Executive Overview', path: '/', group: 'Overview' },
  { key: 'command_center', label: 'Command Center', path: '/command-center', group: 'Overview' },
  { key: 'interactive_map', label: 'Interactive Map', path: '/map', group: 'Overview' },
  { key: 'instrumentation', label: 'Field Instruments', path: '/instruments', group: 'Assets' },
  { key: 'condition_monitoring', label: 'Pump & Motor', path: '/condition', group: 'Assets' },
  { key: 'pump_stations', label: 'Pump Stations', path: '/pump-stations', group: 'Assets' },
  { key: 'valve_control', label: 'Valve Control', path: '/valves', group: 'Assets' },
  { key: 'network_analysis', label: 'Network Analysis', path: '/network', group: 'Assets' },
  { key: 'action_center', label: 'Action Center', path: '/action-center', group: 'Operations' },
  { key: 'maintenance', label: 'Maintenance', path: '/maintenance', group: 'Operations' },
  { key: 'leak_detection', label: 'Leak Detection', path: '/ilk', group: 'Operations' },
  { key: 'field_verification', label: 'Field Verification', path: '/field', group: 'Operations' },
  { key: 'water_quality', label: 'Water Quality', path: '/water-quality', group: 'Water' },
  { key: 'nrw_explorer', label: 'NRW Explorer', path: '/nrw', group: 'Water' },
  { key: 'billing', label: 'Billing & Revenue', path: '/billing', group: 'Commercial' },
  { key: 'accountability', label: 'Accountability', path: '/accountability', group: 'Commercial' },
  { key: 'predictive', label: 'Preventive', path: '/predictive', group: 'Intelligence' },
  { key: 'digital_twin', label: 'Digital Twin', path: '/twin', group: 'Intelligence' },
  { key: 'chatbot', label: 'AI Assistant', path: '/assistant', group: 'Intelligence' },
  { key: 'communication', label: 'Communication', path: '/communication', group: 'People' },
  { key: 'key_personnel', label: 'Key Personnel', path: '/personnel', group: 'People' },
  { key: 'reports', label: 'Reports', path: '/reports', group: 'Reports' },
  { key: 'sujalam_bharat', label: 'Sujalam Bharat', path: '/sujalam', group: 'Sujalam Bharat' },
];

// Presentation metadata for the Executive Overview "featured modules" cards.
// icon -> key in icons.tsx; accent -> modcard color class; badge optional.
export interface ModuleMeta { icon: string; desc: string; accent: string; badge?: string }
export const MODULE_META: Record<string, ModuleMeta> = {
  command_center: { icon: 'cpu', desc: 'Unified water-distribution command center — pressure, flow, quality and assets.', accent: 'cyan', badge: 'LIVE' },
  interactive_map: { icon: 'map', desc: 'Live geospatial view of every asset and IoT device.', accent: 'cyan', badge: 'LIVE' },
  action_center: { icon: 'alert', desc: 'Triage and acknowledge open operational alerts.', accent: 'red' },
  condition_monitoring: { icon: 'activity', desc: 'Pump & motor ESA health and signal analysis.', accent: 'teal', badge: 'LIVE' },
  instrumentation: { icon: 'cpu', desc: 'Flow, level, pressure, chlorine and water-quality instruments.', accent: 'cyan', badge: 'LIVE' },
  pump_stations: { icon: 'sliders', desc: 'Pump houses: duty rotation, flow, pressure and energy.', accent: 'cyan', badge: 'LIVE' },
  network_analysis: { icon: 'network', desc: 'Distribution network topology and flow analysis.', accent: 'cyan' },
  valve_control: { icon: 'sliders', desc: 'Remote valve operations and health monitoring.', accent: 'teal' },
  maintenance: { icon: 'wrench', desc: 'Preventive and corrective maintenance planning.', accent: 'amber' },
  leak_detection: { icon: 'shield', desc: 'Illegal connection and leakage detection.', accent: 'red', badge: 'NEW' },
  water_quality: { icon: 'droplet', desc: 'Residual chlorine, turbidity and quality sampling.', accent: 'cyan' },
  nrw_explorer: { icon: 'trending', desc: 'Non-revenue water tracking and loss analysis.', accent: 'amber' },
  billing: { icon: 'currency', desc: 'Revenue assurance and collection analytics.', accent: 'green', badge: 'HOT' },
  accountability: { icon: 'scale', desc: 'Scheme-wise accountability and performance.', accent: 'green' },
  field_verification: { icon: 'clipboard', desc: 'Evidence-grade field verification with GPS photos.', accent: 'teal' },
  predictive: { icon: 'chart', desc: 'AI preventive-maintenance forecasting across the asset network.', accent: 'violet', badge: 'AI' },
  digital_twin: { icon: 'cube', desc: '3D digital twin of the water network.', accent: 'violet', badge: 'NEW' },
  chatbot: { icon: 'message', desc: 'AI assistant for operations and insights.', accent: 'violet' },
  communication: { icon: 'send', desc: 'Chain-of-command messaging and escalation.', accent: 'cyan' },
  key_personnel: { icon: 'users', desc: 'Directory of key personnel and responsibilities.', accent: 'teal' },
  reports: { icon: 'file', desc: 'Operational and compliance reporting.', accent: 'cyan' },
  sujalam_bharat: { icon: 'layers', desc: 'Government integration — Sujalam Bharat / JJM ID mapping & sync.', accent: 'green', badge: 'NEW' },
};

export const GROUP_ORDER = [
  'Overview',
  'Assets',
  'Operations',
  'Water',
  'Commercial',
  'Intelligence',
  'People',
  'Reports',
  'Sujalam Bharat',
];
