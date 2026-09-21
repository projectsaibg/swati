import { useEffect, useState } from 'react';
import { GeoQuery, LeakCandidate, LeakSummary, api } from './api';
import { useAuth } from './contexts';
import { GeoFilter } from './GeoFilter';

const sevPill = (s: string) => (s === 'High' ? 'alarm' : s === 'Medium' ? 'watch' : 'ok');
const errMsg = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Request failed';

export function LeakDetection() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<LeakSummary | null>(null);
  const [rows, setRows] = useState<LeakCandidate[]>([]);
  const [geo, setGeo] = useState<GeoQuery>({});
  const [sev, setSev] = useState<'ALL' | 'High' | 'Medium' | 'Low'>('ALL');
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const canFlag = !!user?.permissions?.some((p) => p === 'data.enter' || p === '*');

  useEffect(() => {
    const load = () => Promise.all([api.leakSummary(geo), api.leakCandidates(geo)])
      .then(([s, c]) => { setSummary(s); setRows(c); })
      .catch(() => setErr('Could not load leak analysis.'));
    load();
    const t = setInterval(load, 45000); // live refresh
    return () => clearInterval(t);
  }, [geo]);

  const flag = async (siteId: string) => {
    setBusy(siteId); setErr('');
    try { await api.flagLeak(siteId); setFlagged((f) => ({ ...f, [siteId]: true })); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };

  const shown = (sev === 'ALL' ? rows : rows.filter((r) => r.severity === sev)).slice(0, 100);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>LEAK DETECTION</h1>
          <p className="exec-sub">Night-flow &amp; NRW leakage analysis · likely leaks and illegal connections</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Geo filter */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
        <span className="muted">{rows.length} site{rows.length === 1 ? '' : 's'} analysed</span>
      </div>

      {/* KPI hero */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary ? summary.totalLossKld.toLocaleString() : '—'}<span className="muted" style={{ fontSize: 14 }}> kL/day</span></div><div className="lbl">Estimated water loss</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary?.high ?? '—'}</div><div className="lbl">High severity</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--watch)' }}>{summary?.medium ?? '—'}</div><div className="lbl">Medium severity</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{summary?.low ?? '—'}</div><div className="lbl">Low severity</div></div>
        <div className="kpi"><div className="val tnum">{summary?.avgNrwPct != null ? `${summary.avgNrwPct}%` : '—'}</div><div className="lbl">Avg NRW (context)</div></div>
      </section>

      {summary?.worst && (
        <div className="flash" style={{ marginBottom: 14 }}>
          <span>Worst offender: <strong>{summary.worst.name}</strong> — est. loss <strong>{summary.worst.estLossKld} kL/day</strong>
            <span className="muted"> · {[summary.worst.district, summary.worst.block, summary.worst.zone].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
      )}

      {/* Severity chips */}
      <div className="vchips">
        {(['ALL', 'High', 'Medium', 'Low'] as const).map((f) => (
          <button key={f} className={`vchip ${sev === f ? 'active' : ''}`} onClick={() => setSev(f)}>{f === 'ALL' ? 'All' : f}</button>
        ))}
      </div>

      {!canFlag && <p className="muted">You can view the leak analysis; raising an inspection requires the <code>data.enter</code> permission.</p>}

      {/* Ranked candidate list */}
      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th>Severity</th><th>Site</th><th>District</th><th>Block</th><th>Zone</th>
              <th>Night ratio</th><th>Est. loss</th><th>Likely cause</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.siteId}>
                <td><span className={`pill ${sevPill(c.severity)}`}>{c.severity}</span></td>
                <td>{c.name}</td>
                <td className="muted">{c.district}</td>
                <td className="muted">{c.block}</td>
                <td className="muted">{c.zone ?? '—'}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, minWidth: 60, background: 'var(--surface2)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${c.nightRatio}%`, height: '100%', background: c.nightRatio >= 70 ? 'var(--alarm)' : c.nightRatio >= 55 ? 'var(--watch)' : 'var(--ok)' }} />
                    </div>
                    <span className="tnum muted" style={{ fontSize: 12 }}>{c.nightRatio}%</span>
                  </div>
                </td>
                <td className="tnum">{c.estLossKld} <span className="muted" style={{ fontSize: 12 }}>kL/d</span></td>
                <td className="muted">{c.likelyCause}</td>
                <td>
                  {canFlag && (
                    flagged[c.siteId]
                      ? <span className="pill ok">Flagged</span>
                      : <button className="btn sm" disabled={busy === c.siteId} onClick={() => flag(c.siteId)}>{busy === c.siteId ? '…' : 'Flag'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No leak candidates in this scope.</p>}
        {(sev === 'ALL' ? rows.length : rows.filter((r) => r.severity === sev).length) > 100 && (
          <p className="muted">Showing the 100 worst by estimated loss. Narrow the filters to see more.</p>
        )}
      </div>
    </div>
  );
}
