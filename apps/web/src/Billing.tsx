import { useEffect, useState } from 'react';
import { BillingAccount, BillingSummary, GeoQuery, api } from './api';
import { GeoFilter } from './GeoFilter';
import { AxisChart } from './charts';

const CSS = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;
// Compact INR: crore / lakh for large sums.
function inrC(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
const effColor = (e: number) => (e >= 90 ? 'ok' : e >= 75 ? 'watch' : 'alarm');

export function Billing() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [rows, setRows] = useState<BillingAccount[]>([]);
  const [geo, setGeo] = useState<GeoQuery>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api.billingSummary(geo), api.billingAccounts(geo)])
      .then(([s, a]) => { setSummary(s); setRows(a); })
      .catch(() => setErr('Could not load billing data.'));
  }, [geo]);

  const shown = rows.slice(0, 100);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>BILLING &amp; REVENUE</h1>
          <p className="exec-sub">Revenue assurance · demand, collections, arrears &amp; collection efficiency{summary?.period ? ` · ${summary.period}` : ''}</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Geo filter */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
        <span className="muted">{rows.length} site{rows.length === 1 ? '' : 's'} in scope</span>
      </div>

      {/* KPI hero */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{summary ? inrC(summary.collectedInr) : '—'}</div><div className="lbl">Collected (this month)</div></div>
        <div className="kpi"><div className="val tnum">{summary ? inrC(summary.demandInr) : '—'}</div><div className="lbl">Demand raised</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: summary ? `var(--${effColor(summary.collectionEfficiency)})` : undefined }}>{summary ? `${summary.collectionEfficiency}%` : '—'}</div><div className="lbl">Collection efficiency</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary ? inrC(summary.arrearsInr) : '—'}</div><div className="lbl">Outstanding arrears</div></div>
        <div className="kpi"><div className="val tnum">{summary ? summary.connections.toLocaleString('en-IN') : '—'}</div><div className="lbl">Connections</div></div>
        <div className="kpi"><div className="val tnum">{summary ? summary.billedKl.toLocaleString('en-IN') : '—'}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">Billed volume</div></div>
      </section>

      {/* Efficiency trend */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Collection efficiency over time <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· last {summary?.trend.length ?? 0} months</span></h3>
        {summary && summary.trend.length > 0
          ? <AxisChart data={summary.trend} color={CSS('--ok')} name="Collection efficiency" unit="%" type="area" yMin={0} yMax={100} />
          : <p className="muted">No data yet.</p>}
      </div>

      {summary?.worst && (
        <div className="flash" style={{ marginBottom: 14 }}>
          <span>Highest arrears: <strong>{summary.worst.name}</strong> — <strong>{inrC(summary.worst.arrearsInr)}</strong> outstanding</span>
        </div>
      )}

      {/* Per-site arrears table */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Accounts by arrears</h3>
        <table className="tbl">
          <thead>
            <tr><th>Site</th><th>District</th><th>Block</th><th>Zone</th><th>Connections</th><th>Demand</th><th>Collected</th><th>Efficiency</th><th>Arrears</th></tr>
          </thead>
          <tbody>
            {shown.map((a, i) => (
              <tr key={i}>
                <td>{a.siteName}</td>
                <td className="muted">{a.district}</td>
                <td className="muted">{a.block}</td>
                <td className="muted">{a.zone ?? '—'}</td>
                <td className="tnum">{a.connections.toLocaleString('en-IN')}</td>
                <td className="tnum muted">{inrC(a.demandInr)}</td>
                <td className="tnum">{inrC(a.collectedInr)}</td>
                <td><span className={`pill ${effColor(a.efficiency)}`}>{a.efficiency}%</span></td>
                <td className="tnum" style={{ color: 'var(--alarm)' }}>{inrC(a.arrearsInr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No billing accounts in this scope.</p>}
        {rows.length > 100 && <p className="muted">Showing the 100 highest-arrears accounts. Narrow the filters to see more.</p>}
      </div>
    </div>
  );
}
