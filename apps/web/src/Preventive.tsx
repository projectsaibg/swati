import { useEffect, useState } from 'react';
import { GeoQuery, PreventiveForecast, PreventiveSummary, api } from './api';
import { GeoFilter } from './GeoFilter';

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All asset types' },
  { value: 'MOTOR_PUMP', label: 'Pumps / Motors' },
  { value: 'OHT', label: 'Overhead Reservoirs' },
  { value: 'PIPELINE', label: 'Pipelines' },
  { value: 'FLOW_METER', label: 'Flow Meters' },
  { value: 'WATER_LEVEL', label: 'Level Transmitters' },
  { value: 'PRESSURE_SENSOR', label: 'Pressure Transmitters' },
  { value: 'WQ_ANALYSER', label: 'Water Quality Analysers' },
  { value: 'CHLORINATOR', label: 'Chlorinators' },
];
const prioPill = (p: string) => (p === 'High' ? 'alarm' : p === 'Medium' ? 'watch' : 'ok');
const riskColor = (r: number) => (r >= 75 ? 'var(--alarm)' : r >= 50 ? 'var(--watch)' : 'var(--ok)');
const inrC = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`);

export function Preventive() {
  const [summary, setSummary] = useState<PreventiveSummary | null>(null);
  const [rows, setRows] = useState<PreventiveForecast[]>([]);
  const [geo, setGeo] = useState<GeoQuery>({});
  const [type, setType] = useState('');
  const [urgency, setUrgency] = useState<'ALL' | 'Overdue' | 'Due <=30d' | 'Due <=90d'>('ALL');
  const [err, setErr] = useState('');

  useEffect(() => { api.preventiveSummary(geo).then(setSummary).catch(() => setErr('Could not load forecasts.')); }, [geo]);
  useEffect(() => { api.preventiveForecasts({ ...geo, type: type || undefined }).then(setRows).catch(() => setErr('Could not load forecasts.')); }, [geo, type]);

  const shown = (urgency === 'ALL' ? rows : rows.filter((r) => r.urgency === urgency)).slice(0, 150);
  const totalShown = urgency === 'ALL' ? rows.length : rows.filter((r) => r.urgency === urgency).length;

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>PREVENTIVE</h1>
          <p className="exec-sub">AI preventive-maintenance forecasting across the asset network</p>
        </div>
        <div className="statuspills">
          <span className="spill"><span style={{ color: 'var(--accent2)' }}>AI</span>&nbsp;model {summary ? `${summary.avgConfidence}%` : '—'}</span>
          <span className="spill live"><span className="livedot" /> LIVE</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Filters */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="muted">{rows.length} asset{rows.length === 1 ? '' : 's'} forecast</span>
      </div>

      {/* KPI hero */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum">{summary?.total ?? '—'}</div><div className="lbl">Assets analysed</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--critical)' }}>{summary?.overdue ?? '—'}</div><div className="lbl">Overdue</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary?.due30 ?? '—'}</div><div className="lbl">Due &le; 30 days</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--watch)' }}>{summary?.due90 ?? '—'}</div><div className="lbl">Due &le; 90 days</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary?.predictedFailures30 ?? '—'}</div><div className="lbl">Predicted failures (30d)</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{summary ? inrC(summary.estCostAvoidedInr) : '—'}</div><div className="lbl">Est. cost avoided</div></div>
      </section>

      {/* By-type mix */}
      {summary && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="cc-legend row" style={{ fontSize: 12 }}>
            {Object.entries(summary.byType).map(([t, n]) => (
              <div key={t}><span className="dot" style={{ background: 'var(--accent2)' }} /> {t} <b>{n}</b></div>
            ))}
          </div>
        </div>
      )}

      {/* Urgency chips */}
      <div className="vchips">
        {(['ALL', 'Overdue', 'Due <=30d', 'Due <=90d'] as const).map((u) => (
          <button key={u} className={`vchip ${urgency === u ? 'active' : ''}`} onClick={() => setUrgency(u)}>{u === 'ALL' ? 'All' : u.replace('<=', '≤')}</button>
        ))}
      </div>

      {/* Forecast table */}
      <div className="panel">
        <table className="tbl">
          <thead>
            <tr><th>Asset</th><th>Type</th><th>Zone</th><th>Age</th><th>Risk</th><th>Recommended action</th><th>Due</th><th>Priority</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.assetTag}>
                <td>{r.name}</td>
                <td>{r.typeLabel}</td>
                <td className="muted">{[r.district, r.block, r.zone].filter(Boolean).join(' · ') || '—'}</td>
                <td className="tnum muted">{r.ageMonths}mo</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, minWidth: 54, background: 'var(--surface2)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${r.riskPct}%`, height: '100%', background: riskColor(r.riskPct) }} />
                    </div>
                    <span className="tnum muted" style={{ fontSize: 12 }}>{r.riskPct}%</span>
                  </div>
                </td>
                <td className="muted">{r.action}</td>
                <td className="tnum" style={{ color: r.dueInDays <= 0 ? 'var(--critical)' : r.dueInDays <= 30 ? 'var(--alarm)' : undefined, fontWeight: r.dueInDays <= 30 ? 700 : 400 }}>{r.dueInDays <= 0 ? 'Overdue' : `${r.dueInDays}d`}</td>
                <td><span className={`pill ${prioPill(r.priority)}`}>{r.priority}</span></td>
                <td className="tnum muted">{r.confidence}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No forecasts in this scope.</p>}
        {totalShown > 150 && <p className="muted">Showing the 150 most urgent. Narrow the filters to see more.</p>}
      </div>
    </div>
  );
}
