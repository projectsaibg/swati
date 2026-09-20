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
  { key: 'interactive_map', label: 'Interactive Map', path: '/map', group: 'Overview' },
  { key: 'condition_monitoring', label: 'Pump & Motor', path: '/condition', group: 'Assets' },
  { key: 'valve_control', label: 'Valve Control', path: '/valves', group: 'Assets' },
  { key: 'network_analysis', label: 'Network Analysis', path: '/network', group: 'Assets' },
  { key: 'action_center', label: 'Action Center', path: '/action-center', group: 'Operations' },
  { key: 'maintenance', label: 'Maintenance', path: '/maintenance', group: 'Operations' },
  { key: 'leak_detection', label: 'ILK Hunter', path: '/ilk', group: 'Operations' },
  { key: 'field_verification', label: 'Field Verification', path: '/field', group: 'Operations' },
  { key: 'water_quality', label: 'Water Quality', path: '/water-quality', group: 'Water' },
  { key: 'nrw_explorer', label: 'NRW Explorer', path: '/nrw', group: 'Water' },
  { key: 'billing', label: 'Billing & Revenue', path: '/billing', group: 'Commercial' },
  { key: 'accountability', label: 'Accountability', path: '/accountability', group: 'Commercial' },
  { key: 'predictive', label: 'Predictive', path: '/predictive', group: 'Intelligence' },
  { key: 'digital_twin', label: 'Digital Twin', path: '/twin', group: 'Intelligence' },
  { key: 'chatbot', label: 'AI Assistant', path: '/assistant', group: 'Intelligence' },
  { key: 'communication', label: 'Communication', path: '/communication', group: 'People' },
  { key: 'key_personnel', label: 'Key Personnel', path: '/personnel', group: 'People' },
  { key: 'reports', label: 'Reports', path: '/reports', group: 'Reports' },
];

export const GROUP_ORDER = [
  'Overview',
  'Assets',
  'Operations',
  'Water',
  'Commercial',
  'Intelligence',
  'People',
  'Reports',
];
