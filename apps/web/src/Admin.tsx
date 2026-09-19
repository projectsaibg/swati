import { useEffect, useState } from 'react';
import { AdminFeature, Visibility, api } from './api';
import { useFeatures } from './contexts';
import { AdminUsersRoles } from './AdminUsers';
import { AdminDevices } from './AdminDevices';

const TIERS = ['BASE', 'VECTOR', 'VELOCITY', 'QUANTUM'];
type Tab = 'features' | 'people' | 'devices';

export function Admin() {
  const [tab, setTab] = useState<Tab>('features');

  return (
    <div>
      <h1 className="pagetitle">Admin panel</h1>
      <div className="tabs">
        <button className={`tab ${tab === 'features' ? 'active' : ''}`} onClick={() => setTab('features')}>Features &amp; tier</button>
        <button className={`tab ${tab === 'people' ? 'active' : ''}`} onClick={() => setTab('people')}>Users &amp; roles</button>
        <button className={`tab ${tab === 'devices' ? 'active' : ''}`} onClick={() => setTab('devices')}>Devices</button>
      </div>

      {tab === 'features' && <FeaturesTab />}
      {tab === 'people' && <AdminUsersRoles />}
      {tab === 'devices' && <AdminDevices />}
    </div>
  );
}

function FeaturesTab() {
  const { reload } = useFeatures();
  const [rows, setRows] = useState<AdminFeature[]>([]);
  const [tier, setTier] = useState('VECTOR');
  const [msg, setMsg] = useState('');

  const load = async () => setRows(await api.adminFeatures());
  useEffect(() => { load(); }, []);

  const toggle = async (key: string, enabled: boolean) => {
    setRows(await api.setFeature(key, { enabled }));
    await reload();
  };
  const setVis = async (key: string, visibility: Visibility) => {
    setRows(await api.setFeature(key, { visibility }));
    await reload();
  };
  const applyTier = async () => {
    setRows(await api.setTier(tier));
    await reload();
    setMsg(`Applied ${tier} preset.`);
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Product tier</h2>
        <p className="muted">Cumulative editions. Applying a tier sets the enabled preset; per-feature overrides below stay.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="field" style={{ width: 200 }} value={tier} onChange={(e) => setTier(e.target.value)}>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn" onClick={applyTier}>Apply tier</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Feature switchboard</h2>
        <div className="switch-row"><div className="k">FEATURE</div><div className="k">ENABLED</div><div className="k">VISIBILITY</div></div>
        {rows.map((f) => (
          <div className="switch-row" key={f.key}>
            <div>
              <div>{f.module}</div>
              <div className="k">{f.key} · {f.tier}</div>
            </div>
            <button className={`toggle ${f.enabled ? 'on' : ''}`} aria-label="toggle" onClick={() => toggle(f.key, !f.enabled)}>
              <span className="dot" />
            </button>
            <select className="field" style={{ margin: 0 }} value={f.visibility} onChange={(e) => setVis(f.key, e.target.value as Visibility)}>
              <option value="PUBLIC">Public</option>
              <option value="LOGIN">Login only</option>
            </select>
          </div>
        ))}
      </div>
    </>
  );
}
