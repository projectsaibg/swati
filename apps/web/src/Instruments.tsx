import { useEffect, useState } from 'react';
import { GeoQuery, Instrument, InstrumentSummary, api } from './api';
import { GeoFilter } from './GeoFilter';

const TYPE_ORDER = ['FLOW_METER', 'WATER_LEVEL', 'PRESSURE_SENSOR', 'CHLORINATOR', 'WQ_ANALYSER'] as const;
const TYPE_LABEL: Record<string, string> = {
  FLOW_METER: 'Flow Meter', WATER_LEVEL: 'Level Transmitter', PRESSURE_SENSOR: 'Pressure Transmitter',
  CHLORINATOR: 'Chlorinator', WQ_ANALYSER: 'Water Quality Analyser',
};
const fmtVal = (v: number | null, unit: string) => (v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(2)}${unit ? ` ${unit}` : ''}`);
const ago = (ts: string | null) => {
  if (!ts) return '—';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

export function Instruments() {
  const [summary, setSummary] = useState<InstrumentSummary | null>(null);
  const [rows, setRows] = useState<Instrument[]>([]);
  const [geo, setGeo] = useState<GeoQuery>({});
  const [type, setType] = useState<string>('ALL');
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => Promise.all([api.instrumentSummary(geo), api.instrumentList(geo)])
      .then(([s, l]) => { setSummary(s); setRows(l); })
      .catch(() => setErr('Could not load instruments.'));
    load();
    const t = setInterval(load, 45000); // live refresh
    return () => clearInterval(t);
  }, [geo]);

  const shown = (type === 'ALL' ? rows : rows.filter((r) => r.type === type)).slice(0, 150);
  const totalShown = type === 'ALL' ? rows.length : rows.filter((r) => r.type === type).length;

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>FIELD INSTRUMENTS</h1>
          <p className="exec-sub">Primary water-monitoring assets · flow, level, pressure, chlorine &amp; quality</p>
        </div>
        <div className="statuspills">
          <span className="spill"><span style={{ color: 'var(--ok)' }}>{summary?.online ?? '—'}</span>&nbsp;online</span>
          <span className="spill live"><span className="livedot" /> LIVE</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Geo filter */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
        <span className="muted">{rows.length} instrument{rows.length === 1 ? '' : 's'} in scope</span>
      </div>

      {/* KPI hero: total + online/offline + per-type counts */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum">{summary?.total ?? '—'}</div><div className="lbl">Total instruments</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{summary?.online ?? '—'}</div><div className="lbl">Online</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary?.offline ?? '—'}</div><div className="lbl">Offline</div></div>
        {TYPE_ORDER.map((t) => (
          <div className="kpi" key={t}><div className="val tnum">{summary?.byType?.[t] ?? '—'}</div><div className="lbl">{TYPE_LABEL[t]}s</div></div>
        ))}
      </section>

      {/* Type chips */}
      <div className="vchips">
        <button className={`vchip ${type === 'ALL' ? 'active' : ''}`} onClick={() => setType('ALL')}>All types</button>
        {TYPE_ORDER.map((t) => (
          <button key={t} className={`vchip ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>
        ))}
      </div>

      {/* Instrument table */}
      <div className="panel">
        <table className="tbl">
          <thead>
            <tr><th>Tag</th><th>Instrument</th><th>Type</th><th>Latest reading</th><th>Site</th><th>Zone</th><th>Transport</th><th>Last seen</th><th>Status</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="muted tnum">{r.tag}</td>
                <td>{r.name}</td>
                <td>{r.typeLabel}</td>
                <td className="tnum">{fmtVal(r.value, r.unit)}</td>
                <td className="muted">{r.siteName ?? '—'}</td>
                <td className="muted">{[r.district, r.block, r.zone].filter(Boolean).join(' · ') || '—'}</td>
                <td className="muted">{r.transport ?? '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{ago(r.lastSeen)}</td>
                <td><span className={`pill ${r.online ? 'ok' : 'alarm'}`}>{r.online ? 'Online' : 'Offline'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No instruments in this scope.</p>}
        {totalShown > 150 && <p className="muted">Showing 150 of {totalShown}. Narrow the filters to see more.</p>}
      </div>
    </div>
  );
}
