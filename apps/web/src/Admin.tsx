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

const TIER_TAGLINE: Record<string, string> = {
  BASE: 'Core operations', VECTOR: 'Connected monitoring', VELOCITY: 'Active control', QUANTUM: 'Intelligence & prediction',
};

function FeaturesTab() {
  const { reload } = useFeatures();
  const [rows, setRows] = useState<AdminFeature[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const load = async () => setRows(await api.adminFeatures());
  useEffect(() => { load(); }, []);

  // The open tier is the highest tier that has enabled modules (tiers are
  // cumulative, so opening one activates it and every tier below).
  const activeIdx = rows.reduce((mx, r) => (r.enabled ? Math.max(mx, TIERS.indexOf(r.tier)) : mx), -1);

  const openTier = async (t: string) => {
    setBusy(true); setMsg('');
    try {
      setRows(await api.setTier(t));
      await reload();
      setMsg(`${t} tier is now open — its modules are active for the customer automatically.`);
      setTimeout(() => setMsg(''), 3500);
    } finally { setBusy(false); }
  };
  const setVis = async (key: string, visibility: Visibility) => {
    setRows(await api.setFeature(key, { visibility }));
    await reload();
  };

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Product tier</h2>
        <p className="muted">Open a tier for the customer. Opening a tier activates all of its modules — and every lower tier — automatically; you don't switch modules on one by one.</p>
        <div className="tierswitch">
          {TIERS.map((t, i) => {
            const included = i <= activeIdx;
            const current = i === activeIdx;
            return (
              <button key={t} className={`tierseg ${included ? 'on' : ''} ${current ? 'current' : ''}`} disabled={busy} onClick={() => openTier(t)}>
                <span className="tierseg-name">{t}</span>
                <span className="tierseg-tag">{TIER_TAGLINE[t]}</span>
                <span className="tierseg-state">{current ? 'CURRENT' : included ? 'included' : 'locked'}</span>
              </button>
            );
          })}
        </div>
        {msg && <div className="flash" style={{ marginTop: 12 }}><span>{msg}</span></div>}
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Modules by tier</h2>
          <button className="btn ghost sm" onClick={() => setAdvanced((v) => !v)}>{advanced ? 'Hide' : 'Show'} visibility overrides</button>
        </div>
        <p className="muted">Activation follows the open tier above. Visibility (public vs login) is an independent override.</p>
        {TIERS.map((t) => {
          const mods = rows.filter((f) => f.tier === t);
          if (mods.length === 0) return null;
          const open = TIERS.indexOf(t) <= activeIdx;
          return (
            <div key={t} style={{ marginTop: 14, opacity: open ? 1 : 0.55 }}>
              <div className="tierrow-head"><strong>{t}</strong> <span className="muted">· {open ? 'active' : 'locked'}</span></div>
              <div className="modtiles">
                {mods.map((f) => (
                  <div className={`modtile ${f.enabled ? 'on' : ''}`} key={f.key}>
                    <div>
                      <div>{f.module}</div>
                      <div className="k muted">{f.key}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {advanced && (
                        <select className="input" style={{ padding: '4px 8px' }} value={f.visibility} onChange={(e) => setVis(f.key, e.target.value as Visibility)}>
                          <option value="PUBLIC">Public</option>
                          <option value="LOGIN">Login</option>
                        </select>
                      )}
                      <span className={`pill ${f.enabled ? 'ok' : 'watch'}`}>{f.enabled ? 'Active' : 'Off'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
