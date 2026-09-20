import { useEffect, useState } from 'react';
import { PumpStationDetail, PumpStationSummary, Series, StationPump, api } from './api';

const statePill = (s: string) => (s === 'RUN' ? 'ok' : s === 'TRIP' ? 'alarm' : 'watch');
const fmt = (v: number | null, dp = 1) => (v == null ? '—' : Number(v).toFixed(dp));

function LineArea({ data, color }: { data: Series[]; color: string }) {
  if (data.length < 2) return <p className="muted" style={{ textAlign: 'center' }}>No data</p>;
  const w = 340, h = 110, pad = 6;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => [pad + i * step, h - pad - ((d.value - min) / span) * (h - pad * 2)] as [number, number]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ maxHeight: 120 }}>
      <path d={area} fill={color} opacity={0.16} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function Timeline({ pump }: { pump: StationPump }) {
  const segs = pump.timeline.slice(-60);
  return (
    <div className="ptrow">
      <span className="lbl">{pump.tag}</span>
      <div className="segbar">
        {segs.length === 0
          ? <div className="seg off" />
          : segs.map((s, i) => <div key={i} className={`seg ${pump.state === 'TRIP' ? 'trip' : s.on ? 'on' : 'off'}`} />)}
      </div>
      <span><span className={`pill ${statePill(pump.state)}`}>{pump.state}</span> <span className="muted">{pump.dutyPct}%</span></span>
    </div>
  );
}

export function PumpStations() {
  const [stations, setStations] = useState<PumpStationSummary[]>([]);
  const [sid, setSid] = useState<string | null>(null);
  const [d, setD] = useState<PumpStationDetail | null>(null);
  const [pumpId, setPumpId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => api.pumpStations().then((s) => {
      setStations(s);
      setSid((cur) => cur ?? (s[0]?.id ?? null));
    }).catch(() => setErr('Could not load pump stations.'));
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sid) { setD(null); return; }
    const load = () => api.pumpStation(sid).then((det) => {
      setD(det);
      setPumpId((cur) => (cur && det.pumps.some((p) => p.id === cur)) ? cur : (det.pumps[0]?.id ?? null));
    }).catch(() => setErr('Could not load station detail.'));
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [sid]);

  const pump = d?.pumps.find((p) => p.id === pumpId) ?? null;

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>PUMP STATIONS</h1>
          <p className="exec-sub">{stations.length} pump house{stations.length === 1 ? '' : 's'} · duty-rotated for pump rest</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="station-bar">
        <label className="field" style={{ marginBottom: 0 }}>Pump house
          <select value={sid ?? ''} onChange={(e) => { setSid(e.target.value); setPumpId(null); }}>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>

      {d && (
        <>
          {/* Whole-house KPIs */}
          <section className="kpi-grid">
            <div className="kpi"><div className="val tnum">{fmt(d.kpis.storageM3, 0)}<span className="muted" style={{ fontSize: 14 }}> m³</span></div><div className="lbl">Water in storage</div></div>
            <div className="kpi"><div className="val tnum">{fmt(d.kpis.pressureBar, 2)}<span className="muted" style={{ fontSize: 14 }}> bar</span></div><div className="lbl">System pressure</div></div>
            <div className="kpi"><div className="val tnum">{fmt(d.kpis.netFlowKlh, 2)}<span className="muted" style={{ fontSize: 14 }}> kL/h</span></div><div className="lbl">Net flow</div></div>
            <div className="kpi"><div className="val tnum">{fmt(d.kpis.levelPct, 0)}<span className="muted" style={{ fontSize: 14 }}> %</span></div><div className="lbl">Tank level</div></div>
            <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{d.kpis.running}/{d.pumps.length}</div><div className="lbl">Pumps running</div></div>
            <div className="kpi"><div className="val tnum">{fmt(d.kpis.totalPowerKw, 1)}<span className="muted" style={{ fontSize: 14 }}> kW</span></div><div className="lbl">Total power</div></div>
          </section>

          {/* Pump duty timeline */}
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Pump duty rotation <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· {d.kpis.running} running · {d.kpis.resting} resting · {d.kpis.tripped} tripped</span></h3>
            <div className="pump-timeline">{d.pumps.map((p) => <Timeline key={p.id} pump={p} />)}</div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12 }} className="muted">
              <span><span className="st-dot st-safe" />Running</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--surface2)', marginRight: 6, verticalAlign: 'middle' }} />Resting</span>
              <span><span className="st-dot st-breach" />Tripped</span>
            </div>
          </div>

          {/* Charts */}
          <section className="wq-charts">
            <div className="panel"><p className="chart-title">Net Flow (kL/h)</p><LineArea data={d.charts.flow} color="var(--accent)" /></div>
            <div className="panel"><p className="chart-title">System Energy (kW)</p><LineArea data={d.charts.energy} color="var(--watch)" /></div>
          </section>
          <div className="panel"><p className="chart-title">Tank Level (%)</p><LineArea data={d.charts.tank} color="var(--accent2)" /></div>

          {/* Per-pump drilldown */}
          <div className="sectlabel">Individual pump</div>
          <div className="station-bar">
            <label className="field" style={{ marginBottom: 0 }}>Pump
              <select value={pumpId ?? ''} onChange={(e) => setPumpId(e.target.value)}>
                {d.pumps.map((p) => <option key={p.id} value={p.id}>{p.tag} — {p.name}</option>)}
              </select>
            </label>
          </div>
          {pump && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{pump.tag} — {pump.name} <span className={`pill ${statePill(pump.state)}`}>{pump.state}</span></h3>
              <section className="kpi-grid">
                <div className="kpi"><div className="val tnum" style={{ color: pump.health == null ? 'var(--muted)' : pump.health >= 85 ? 'var(--ok)' : pump.health >= 70 ? 'var(--watch)' : 'var(--alarm)' }}>{pump.health ?? '—'}</div><div className="lbl">ESA health</div></div>
                <div className="kpi"><div className="val tnum">{pump.dutyPct}<span className="muted" style={{ fontSize: 14 }}> %</span></div><div className="lbl">Duty cycle</div></div>
                <div className="kpi"><div className="val tnum">{fmt(pump.runtimeH, 1)}<span className="muted" style={{ fontSize: 14 }}> h</span></div><div className="lbl">Runtime (6h)</div></div>
                <div className="kpi"><div className="val tnum">{fmt(pump.powerKw, 1)}<span className="muted" style={{ fontSize: 14 }}> kW</span></div><div className="lbl">Power</div></div>
                <div className="kpi"><div className="val tnum">{fmt(pump.flowKlh, 1)}<span className="muted" style={{ fontSize: 14 }}> kL/h</span></div><div className="lbl">Flow</div></div>
              </section>
              <div style={{ marginTop: 10 }}>
                <strong>Power trend</strong>
                <LineArea data={pump.powerTrend} color="var(--watch)" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
