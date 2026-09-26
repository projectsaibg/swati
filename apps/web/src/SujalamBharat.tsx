import { useEffect, useState } from 'react';
import { SujalamOverview, api } from './api';

const SYS_LABEL: Record<string, string> = {
  SUJALAM_BHARAT: 'Sujalam Bharat',
  JJM_1_0: 'JJM 1.0 (legacy)',
};
const STATUS_COLOR: Record<string, string> = {
  SYNCED: 'var(--ok)',
  READY_FOR_SYNC: 'var(--ok)',
  IN_PROGRESS: 'var(--watch)',
  VALIDATION_PENDING: 'var(--watch)',
  NOT_MAPPED: 'var(--muted)',
  SUSPENDED: 'var(--muted)',
  CONFLICT: 'var(--alarm)',
  SYNC_FAILED: 'var(--alarm)',
};

function readinessColor(pct: number): string {
  return pct >= 80 ? 'var(--ok)' : pct >= 40 ? 'var(--watch)' : 'var(--alarm)';
}

export function SujalamBharat() {
  const [ov, setOv] = useState<SujalamOverview | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.sujalamOverview()
      .then(setOv)
      .catch(() => setErr('Could not load Sujalam Bharat integration data.'));
  }, []);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>SUJALAM BHARAT INTEGRATION</h1>
          <p className="exec-sub">Government scheme &amp; asset ID mapping, integration readiness and sync status</p>
        </div>
        <div className="statuspills">
          <span className="spill" style={{ color: 'var(--watch)', borderColor: 'var(--watch)' }}>DEMO / MOCK</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Demo / mock banner — this layer is architectural preparation, not an official integration. */}
      <div className="panel" style={{ marginBottom: 12, borderLeft: '3px solid var(--watch)' }}>
        <strong style={{ color: 'var(--watch)' }}>Demonstration data — not a government system.</strong>
        <p className="muted" style={{ margin: '6px 0 0', maxWidth: 780 }}>
          {ov?.disclaimer ??
            'SWATI is architecturally prepared for Sujalam Bharat integration. Official production integration is subject to government API specifications, authorization, credentials, security requirements and data-sharing protocols.'}
        </p>
      </div>

      {/* Readiness + counts */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="val tnum" style={{ color: ov ? readinessColor(ov.readinessPct) : undefined }}>{ov ? `${ov.readinessPct}%` : '—'}</div>
          <div className="lbl">Mapping readiness</div>
        </div>
        <div className="kpi">
          <div className="val tnum">{ov ? ov.schemes.total : '—'}</div>
          <div className="lbl">Schemes ({ov ? ov.schemes.mapped : 0} mapped)</div>
        </div>
        <div className="kpi">
          <div className="val tnum">{ov ? ov.serviceAreas.total : '—'}</div>
          <div className="lbl">Service areas</div>
        </div>
        <div className="kpi">
          <div className="val tnum">{ov ? ov.sujalGaon.total : '—'}</div>
          <div className="lbl">Sujal Gaon villages ({ov ? ov.sujalGaon.mapped : 0} mapped)</div>
        </div>
        <div className="kpi">
          <div className="val tnum">{ov ? ov.infrastructure.total : '—'}</div>
          <div className="lbl">Infrastructure assets ({ov ? ov.infrastructure.mapped : 0} mapped)</div>
        </div>
      </section>

      {/* Providers */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Integration providers</h3>
        <table className="tbl">
          <thead>
            <tr><th>System</th><th>Name</th><th>Status</th><th>Mode</th><th>Push</th><th>Pull</th></tr>
          </thead>
          <tbody>
            {(ov?.providers ?? []).map((p, i) => (
              <tr key={i}>
                <td>{SYS_LABEL[p.system] ?? p.system}</td>
                <td className="muted">{p.name}</td>
                <td><span className={`pill ${p.enabled ? 'ok' : 'watch'}`}>{p.enabled ? 'ENABLED' : 'DISABLED'}</span></td>
                <td>{p.mockMode ? <span className="pill watch">MOCK</span> : <span className="pill ok">LIVE</span>}</td>
                <td>{p.supportsPush ? '✓' : '—'}</td>
                <td>{p.supportsPull ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!ov || ov.providers.length === 0) && <p className="muted">No integration providers configured.</p>}
      </div>

      {/* Mapping status breakdown */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Scheme mapping status</h3>
        <div className="cc-legend row" style={{ fontSize: 13, flexWrap: 'wrap', gap: 16 }}>
          {ov && Object.keys(ov.status).length > 0 ? (
            Object.entries(ov.status).map(([k, v]) => (
              <div key={k}>
                <span className="dot" style={{ background: STATUS_COLOR[k] ?? 'var(--muted)' }} /> {k}: <strong>{v}</strong>
              </div>
            ))
          ) : (
            <span className="muted">No mapping records yet.</span>
          )}
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          Last sync: {ov?.lastSync ? `${SYS_LABEL[ov.lastSync.provider] ?? ov.lastSync.provider} · ${ov.lastSync.direction} · ${ov.lastSync.state}` : 'none yet'}
        </p>
      </div>
    </div>
  );
}
