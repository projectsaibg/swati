import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { DashboardSummary, api } from './api';
import { useAuth, useFeatures } from './contexts';
import { MODULE_META, NAV } from './registry';
import { Icon } from './icons';

export function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) nav('/', { replace: true });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      nav(loc.state?.from || '/', { replace: true });
    } catch {
      setErr('Invalid email or password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>SWATI</h1>
        <p className="sub">Water operations platform</p>
        {err && <div className="err">{err}</div>}
        <label className="field">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}

function KpiCard({
  accent, icon, label, value, unit, tag, fill, footL, footR,
}: {
  accent: string; icon: string; label: string; value: string; unit?: string;
  tag?: string; fill: number; footL: React.ReactNode; footR: React.ReactNode;
}) {
  return (
    <div className={`kcard ${accent}`}>
      <div className="khead">
        <div className="kicon"><Icon name={icon} /></div>
        <div className="klabel">{label}</div>
      </div>
      <div className="krow">
        <div className="kval tnum">{value}{unit && <span className="unit">{unit}</span>}</div>
        {tag && <div className="ktag">{tag}</div>}
      </div>
      <div className="kbar"><div className="kfill" style={{ width: `${fill}%` }} /></div>
      <div className="kfoot"><span>{footL}</span><span>{footR}</span></div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const { isEnabled, tierOf } = useFeatures();
  const [s, setS] = useState<DashboardSummary | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboardSummary().then(setS).catch(() => setErr('Could not load live metrics.'));
  }, []);

  const avg = s?.health.avg ?? null;
  const healthAccent = avg == null ? 'cyan' : avg >= 85 ? 'green' : avg >= 70 ? 'amber' : 'red';
  const alertAccent = !s ? 'amber' : s.alerts.critical + s.alerts.alarm > 0 ? 'red' : s.alerts.watch > 0 ? 'amber' : 'teal';

  const featured = NAV.filter((i) => i.key !== 'executive_overview' && isEnabled(i.key));
  const TIER_BANDS: { name: string; match: string[]; accent: string; tagline: string }[] = [
    { name: 'Basic', match: ['BASE'], accent: 'slate', tagline: 'Core operations' },
    { name: 'Vector', match: ['VECTOR'], accent: 'cyan', tagline: 'Connected monitoring' },
    { name: 'Velocity', match: ['VELOCITY'], accent: 'teal', tagline: 'Active control' },
    { name: 'Quantum', match: ['QUANTUM'], accent: 'violet', tagline: 'Intelligence & prediction' },
  ];

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title">EXECUTIVE OVERVIEW</h1>
          <p className="exec-sub">Real-time water operations command center{user ? ` · ${user.name}` : ''}</p>
        </div>
        <div className="statuspills">
          <span className="spill"><Icon name="shieldcheck" size={15} /> SECURE</span>
          <span className="spill live"><span className="livedot" /> LIVE</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <section className="kpihero">
        <KpiCard
          accent="cyan" icon="layers" label="Asset fleet"
          value={s ? String(s.assets.total) : '—'} tag="assets"
          fill={s ? pct(s.assets.running, s.assets.total) : 0}
          footL={<><span className="strong">{s?.assets.running ?? '—'}</span> running</>}
          footR={<><span className="strong">{s?.assets.fault ?? '—'}</span> in fault</>}
        />
        <KpiCard
          accent={alertAccent} icon="alert" label="Open alerts"
          value={s ? String(s.alerts.open) : '—'} tag="require action"
          fill={s && s.alerts.open ? pct(s.alerts.critical + s.alerts.alarm, s.alerts.open) : 0}
          footL={<><span className="strong">{s?.alerts.critical ?? '—'}</span> critical</>}
          footR={<><span className="strong">{s?.alerts.alarm ?? '—'}</span> alarm</>}
        />
        <KpiCard
          accent="teal" icon="cpu" label="Devices online"
          value={s ? String(s.devices.online) : '—'} tag={s ? `of ${s.devices.total}` : ''}
          fill={s ? pct(s.devices.online, s.devices.total) : 0}
          footL={<><span className="strong">{s?.devices.online ?? '—'}</span> online</>}
          footR={<><span className="strong">{s?.devices.offline ?? '—'}</span> offline</>}
        />
        <KpiCard
          accent={healthAccent} icon="heart" label="Avg asset health"
          value={avg == null ? '—' : String(avg)} unit={avg == null ? undefined : '%'} tag="fleet mean"
          fill={avg ?? 0}
          footL={<>min <span className="strong">{s?.health.min ?? '—'}</span></>}
          footR={s ? new Date(s.updatedAt).toLocaleTimeString() : ''}
        />
      </section>

      {TIER_BANDS.map((band) => {
        const items = featured.filter((i) => band.match.includes(tierOf(i.key) ?? ''));
        if (items.length === 0) return null;
        return (
          <section className={`tierband t-${band.accent}`} key={band.name}>
            <div className="tierband-head">
              <div className="tierband-title">
                <span className="tierband-name">{band.name}</span>
                <span className="tierband-tag">tier</span>
                <span className="tierband-tagline">{band.tagline}</span>
              </div>
              <span className="tierband-count">{items.length} module{items.length === 1 ? '' : 's'}</span>
            </div>
            <div className="modgrid">
              {items.map((i) => {
                const m = MODULE_META[i.key] ?? { icon: 'grid', desc: 'Module.', accent: 'cyan' as string };
                return (
                  <Link className={`modcard ${m.accent}`} key={i.key} to={i.path}>
                    <div className="modtop">
                      <div className="modicon"><Icon name={m.icon} size={22} /></div>
                      {m.badge && <span className="badge">{m.badge}</span>}
                    </div>
                    <h3>{i.label}</h3>
                    <p className="desc">{m.desc}</p>
                    <span className="modtrack">Open</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ModulePlaceholder({ label }: { label: string }) {
  return (
    <div>
      <h1 className="pagetitle">{label}</h1>
      <div className="panel">
        <p className="muted">This module is enabled. Its screens are built in a later milestone.</p>
      </div>
    </div>
  );
}
