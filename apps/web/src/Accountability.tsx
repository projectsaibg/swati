import { useEffect, useState } from 'react';
import { AccountabilityRow, AccountabilitySummary, GeoQuery, api } from './api';
import { GeoFilter } from './GeoFilter';

const gradePill = (g: string) => (g === 'A' ? 'ok' : g === 'B' ? 'watch' : g === 'C' ? 'watch' : 'alarm');
const gradeColor = (g: string) => (g === 'A' ? 'var(--ok)' : g === 'B' ? 'var(--accent)' : g === 'C' ? 'var(--watch)' : 'var(--alarm)');
function inrC(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
const klC = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

export function Accountability() {
  const [summary, setSummary] = useState<AccountabilitySummary | null>(null);
  const [rows, setRows] = useState<AccountabilityRow[]>([]);
  const [geo, setGeo] = useState<GeoQuery>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api.accountabilitySummary(geo), api.accountabilityScorecard(geo)])
      .then(([s, r]) => { setSummary(s); setRows(r); })
      .catch(() => setErr('Could not load accountability data.'));
  }, [geo]);

  const shown = rows.slice(0, 150);
  const billedPct = summary && summary.totalInputKl > 0 ? Math.round((summary.totalBilledKl / summary.totalInputKl) * 100) : 0;

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>ACCOUNTABILITY</h1>
          <p className="exec-sub">Scheme-wise water balance, collection efficiency &amp; performance grading</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
        <span className="muted">{rows.length} site{rows.length === 1 ? '' : 's'} in scope</span>
      </div>

      {/* KPI hero */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum" style={{ color: summary ? gradeColor(summary.avgScore >= 85 ? 'A' : summary.avgScore >= 70 ? 'B' : summary.avgScore >= 55 ? 'C' : 'D') : undefined }}>{summary?.avgScore ?? '—'}</div><div className="lbl">Avg accountability score</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary ? `${summary.avgNrwPct}%` : '—'}</div><div className="lbl">Avg NRW</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{summary ? `${summary.avgCollectionEff}%` : '—'}</div><div className="lbl">Collection efficiency</div></div>
        <div className="kpi"><div className="val tnum">{summary ? klC(summary.waterLossKl) : '—'}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">Water loss</div></div>
        <div className="kpi"><div className="val tnum">{summary ? inrC(summary.totalRevenueInr) : '—'}</div><div className="lbl">Revenue realized</div></div>
        <div className="kpi"><div className="val tnum">{summary ? summary.totalConnections.toLocaleString('en-IN') : '—'}</div><div className="lbl">Connections</div></div>
      </section>

      {/* Water balance + grade mix */}
      <div className="panel">
        <div className="acct-balance">
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="ccp-h" style={{ marginBottom: 8 }}>Water Balance</div>
            <div className="acct-bar">
              <div className="acct-bar-billed" style={{ width: `${billedPct}%` }} />
            </div>
            <div className="cc-legend row" style={{ marginTop: 8, fontSize: 12 }}>
              <div><span className="dot" style={{ background: 'var(--ok)' }} /> Billed {summary ? klC(summary.totalBilledKl) : '—'} kL ({billedPct}%)</div>
              <div><span className="dot" style={{ background: 'var(--alarm)' }} /> Loss / NRW {summary ? klC(summary.waterLossKl) : '—'} kL</div>
              <div className="muted">Input {summary ? klC(summary.totalInputKl) : '—'} kL</div>
            </div>
          </div>
          <div className="acct-grades">
            <div className="ccp-h" style={{ marginBottom: 8 }}>Grade distribution</div>
            <div className="acct-grade-row">
              {(['A', 'B', 'C', 'D'] as const).map((g) => (
                <div className="acct-grade" key={g}>
                  <div className="acct-grade-n" style={{ color: gradeColor(g) }}>{summary?.grades?.[g] ?? 0}</div>
                  <div className="acct-grade-g" style={{ background: gradeColor(g) }}>{g}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Scorecard */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Scorecard <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· lowest score first</span></h3>
        <table className="tbl">
          <thead>
            <tr><th>Site</th><th>District</th><th>Block</th><th>Zone</th><th>Conns</th><th>Input</th><th>Billed</th><th>NRW</th><th>Collection</th><th>Revenue</th><th>Score</th><th>Grade</th></tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td>{r.siteName}</td>
                <td className="muted">{r.district}</td>
                <td className="muted">{r.block}</td>
                <td className="muted">{r.zone ?? '—'}</td>
                <td className="tnum">{r.connections.toLocaleString('en-IN')}</td>
                <td className="tnum muted">{klC(r.inputKl)}</td>
                <td className="tnum">{klC(r.billedKl)}</td>
                <td className="tnum" style={{ color: r.nrwPct >= 30 ? 'var(--alarm)' : r.nrwPct >= 20 ? 'var(--watch)' : 'var(--ok)' }}>{r.nrwPct}%</td>
                <td className="tnum">{r.collectionEff}%</td>
                <td className="tnum muted">{inrC(r.revenueInr)}</td>
                <td className="tnum">{r.score}</td>
                <td><span className={`pill ${gradePill(r.grade)}`}>{r.grade}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No accountability data in this scope.</p>}
        {rows.length > 150 && <p className="muted">Showing the 150 lowest-scoring sites. Narrow the filters to see more.</p>}
      </div>
    </div>
  );
}
