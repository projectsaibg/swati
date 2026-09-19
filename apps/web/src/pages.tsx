import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useFeatures } from './contexts';

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

export function Dashboard() {
  const { features } = useFeatures();
  return (
    <div>
      <h1 className="pagetitle">Executive overview</h1>
      <div className="panel">
        <p className="muted">
          Welcome to SWATI. This is the M2 shell: the sidebar and routes are built
          dynamically from the {features.length} enabled feature(s). Module content
          lands in M3+.
        </p>
      </div>
      <section className="kpi-grid">
        <div className="kpi"><div className="val tnum">{features.length}</div><div className="lbl">Enabled features</div></div>
        <div className="kpi"><div className="val tnum">—</div><div className="lbl">Assets</div></div>
        <div className="kpi"><div className="val tnum">—</div><div className="lbl">Open alarms</div></div>
        <div className="kpi"><div className="val tnum">—</div><div className="lbl">Avg health</div></div>
      </section>
    </div>
  );
}

export function ModulePlaceholder({ label }: { label: string }) {
  return (
    <div>
      <h1 className="pagetitle">{label}</h1>
      <div className="panel">
        <p className="muted">This module is enabled. Its screens are built in a later milestone (M3+).</p>
      </div>
    </div>
  );
}
