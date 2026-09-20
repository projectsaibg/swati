import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider, FeaturesProvider, useAuth, useFeatures } from './contexts';
import { Layout, RequireAdmin, RequireAuth } from './ui';
import { Dashboard, Login, ModulePlaceholder } from './pages';
import { ActionCenter } from './ActionCenter';
import { MapPage } from './MapPage';
import { ConditionMonitoring } from './ConditionMonitoring';
import { WaterQuality } from './WaterQuality';
import { PumpStations } from './PumpStations';
import { FieldVerification } from './FieldVerification';
import { Admin } from './Admin';
import { NAV } from './registry';
import { ReactNode } from 'react';

// Feature keys that have real screens; everything else uses the placeholder.
const PAGE_COMPONENTS: Record<string, ReactNode> = {
  interactive_map: <MapPage />,
  action_center: <ActionCenter />,
  condition_monitoring: <ConditionMonitoring />,
  water_quality: <WaterQuality />,
  pump_stations: <PumpStations />,
  field_verification: <FieldVerification />,
};

function AppRoutes() {
  const { loading: aLoading } = useAuth();
  const { isEnabled, visibility, loading: fLoading } = useFeatures();

  if (aLoading || fLoading) {
    return <div className="login-wrap"><div className="muted">Loading…</div></div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Executive overview at root */}
      <Route path="/" element={<Layout><Dashboard /></Layout>} />

      {/* One route per enabled feature (skip root, handled above) */}
      {NAV.filter((i) => i.path !== '/' && isEnabled(i.key)).map((i) => {
        const content = PAGE_COMPONENTS[i.key] ?? <ModulePlaceholder label={i.label} />;
        const page = <Layout>{content}</Layout>;
        const element = visibility(i.key) === 'LOGIN' ? <RequireAuth>{page}</RequireAuth> : page;
        return <Route key={i.key} path={i.path} element={element} />;
      })}

      {/* Admin */}
      <Route path="/admin" element={<RequireAdmin><Layout><Admin /></Layout></RequireAdmin>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <FeaturesProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </FeaturesProvider>
    </AuthProvider>
  );
}
