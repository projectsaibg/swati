import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CommandCenterData, api } from './api';
import { AxisChart } from './charts';
import { Icon } from './icons';

const CSS = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;
const nfmt = (n: number) => n.toLocaleString('en-IN');
const fmtTick = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

// --- analog needle gauge ---------------------------------------------------
function AnalogGauge({ value, max, unit, color, majors }: { value: number; max: number; unit: string; color: string; majors: number }) {
  const cx = 80, cy = 80, r = 62, start = 135, sweep = 270;
  const ang = (f: number) => ((start + f * sweep) * Math.PI) / 180;
  const pt = (f: number, rr: number): [number, number] => [cx + rr * Math.cos(ang(f)), cy + rr * Math.sin(ang(f))];
  const frac = Math.max(0, Math.min(1, value / max));
  const arcPath = (f0: number, f1: number, rr: number) => {
    const [x0, y0] = pt(f0, rr); const [x1, y1] = pt(f1, rr);
    return `M ${x0} ${y0} A ${rr} ${rr} 0 ${(f1 - f0) * sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ticks = Array.from({ length: majors + 1 }, (_, i) => i / majors);
  const [nx, ny] = pt(frac, r - 15);
  return (
    <svg viewBox="0 0 160 160" width={148} height={138} role="img" aria-label={`${value} ${unit}`}>
      <path d={arcPath(0, 1, r)} stroke="var(--line)" strokeWidth={8} fill="none" strokeLinecap="round" />
      <path d={arcPath(0, frac, r)} stroke={color} strokeWidth={8} fill="none" strokeLinecap="round" />
      {ticks.map((t, i) => {
        const [x0, y0] = pt(t, r - 5); const [x1, y1] = pt(t, r - 13); const [lx, ly] = pt(t, r - 25);
        return (
          <g key={i}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--muted)" strokeWidth={1.5} />
            <text x={lx} y={ly} fontSize={8.5} fill="var(--muted)" textAnchor="middle" dominantBaseline="middle">{fmtTick(Math.round(t * max))}</text>
          </g>
        );
      })}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill={color} />
      <text x={cx} y={cy + 34} textAnchor="middle" fontSize={value >= 10000 ? 17 : 22} fontWeight={800} fill="var(--ink)" className="tnum">{nfmt(value)}</text>
      <text x={cx} y={cy + 49} textAnchor="middle" fontSize={10} fill="var(--muted)">{unit}</text>
    </svg>
  );
}

// --- condition donut -------------------------------------------------------
function Donut({ segs, center, sub }: { segs: { value: number; color: string }[]; center: string; sub: string }) {
  const t = segs.reduce((a, s) => a + s.value, 0) || 1;
  const r = 42, C = 2 * Math.PI * r; let off = 0;
  return (
    <svg width={120} height={120} viewBox="0 0 120 120">
      <g transform="rotate(-90 60 60)">
        <circle cx={60} cy={60} r={r} fill="none" stroke="var(--line)" strokeWidth={14} />
        {segs.filter((s) => s.value > 0).map((s, i) => {
          const len = (s.value / t) * C;
          const el = <circle key={i} cx={60} cy={60} r={r} fill="none" stroke={s.color} strokeWidth={14} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />;
          off += len; return el;
        })}
      </g>
      <text x={60} y={58} textAnchor="middle" fontSize={22} fontWeight={800} fill="var(--ink)">{center}</text>
      <text x={60} y={74} textAnchor="middle" fontSize={9} fill="var(--muted)">{sub}</text>
    </svg>
  );
}

// --- plant & station: grouped bars + leakage line (dual axis) -------------
function PlantStationChart({ data }: { data: CommandCenterData['plantStation'] }) {
  const W = 340, H = 176, padL = 28, padR = 28, padT = 12, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const series: { key: 'production' | 'wamr' | 'ami'; color: string }[] = [
    { key: 'production', color: '#e6a52b' },
    { key: 'wamr', color: '#e0559b' },
    { key: 'ami', color: '#22d3ee' },
  ];
  const leftMax = Math.max(1, Math.ceil(Math.max(...data.flatMap((d) => [d.production, d.wamr, d.ami])) / 100) * 100);
  const rightMax = Math.max(6, Math.ceil(Math.max(...data.map((d) => d.leakage)) / 6) * 6);
  const n = data.length || 1;
  const gw = plotW / n;
  const bw = Math.max(4, Math.min(9, (gw - 8) / 3));
  const yL = (v: number) => padT + plotH - (v / leftMax) * plotH;
  const yR = (v: number) => padT + plotH - (v / rightMax) * plotH;
  const gx = (i: number) => padL + i * gw;
  const line = data.map((d, i) => `${gx(i) + gw / 2},${yR(d.leakage)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Plant and station production and leakage">
      {ticks.map((t, i) => {
        const y = padT + plotH - t * plotH;
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line)" strokeWidth={0.5} />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={8} fill="var(--muted)">{Math.round(t * leftMax)}</text>
            <text x={W - padR + 4} y={y + 3} textAnchor="start" fontSize={8} fill="var(--muted)">{Math.round(t * rightMax)}</text>
          </g>
        );
      })}
      {data.map((d, i) => (
        <g key={i}>
          {series.map((s, j) => {
            const x = gx(i) + (gw - bw * 3 - 4) / 2 + j * (bw + 2);
            const y = yL(d[s.key]);
            return <rect key={j} x={x} y={y} width={bw} height={Math.max(0, padT + plotH - y)} fill={s.color} rx={1} />;
          })}
          <text x={gx(i) + gw / 2} y={H - 7} textAnchor="middle" fontSize={8} fill="var(--muted)">{d.label}</text>
        </g>
      ))}
      <polyline points={line} fill="none" stroke="#f5d020" strokeWidth={2} />
      {data.map((d, i) => <circle key={i} cx={gx(i) + gw / 2} cy={yR(d.leakage)} r={2.5} fill="#f5d020" />)}
      <text x={padL - 4} y={padT - 3} textAnchor="end" fontSize={8} fill="var(--muted)">MGD</text>
      <text x={W - padR + 4} y={padT - 3} textAnchor="start" fontSize={8} fill="var(--muted)">%</text>
    </svg>
  );
}

// --- shared interactive Leaflet map (dark) --------------------------------
type Marker = { lat: number; lng: number; color: string; label?: string };
function LeafMap({ markers, height, fit }: { markers: Marker[]; height: number; fit?: boolean }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [23.4, 88.4], zoom: 8, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts: [number, number][] = [];
    for (const m of markers) {
      pts.push([m.lat, m.lng]);
      const cm = L.circleMarker([m.lat, m.lng], { radius: 5, color: '#fff', weight: 1, fillColor: m.color, fillOpacity: 0.9 });
      if (m.label) cm.bindPopup(m.label);
      cm.addTo(layer);
    }
    if (fit && pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  }, [markers, fit]);

  return <div ref={elRef} className="cc-leaflet" style={{ height }} />;
}

export function CommandCenter() {
  const [d, setD] = useState<CommandCenterData | null>(null);
  const [sites, setSites] = useState<Marker[]>([]);
  const [err, setErr] = useState('');
  const [supplyMode, setSupplyMode] = useState<'Supply' | 'Waste'>('Supply');

  useEffect(() => {
    const load = () => api.commandCenter().then(setD).catch(() => setErr('Could not load command center metrics.'));
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    api.mapPoints().then((m) => setSites(m.sites.map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude), color: s.fault > 0 ? '#e0533d' : '#22d3ee', label: `${s.name}` })))).catch(() => {});
  }, []);

  const leakMarkers = useMemo<Marker[]>(() => (d?.leaks ?? []).map((l) => ({ lat: l.lat, lng: l.lng, color: l.severity === 'High' ? CSS('--alarm') : CSS('--watch'), label: `${l.severity} leak risk` })), [d]);

  const pc = d?.pipeCondition;
  const condSegs = pc ? [
    { value: pc.good, color: CSS('--ok') }, { value: pc.fair, color: CSS('--watch') },
    { value: pc.poor, color: '#e08a3d' }, { value: pc.critical, color: CSS('--alarm') },
  ] : [];

  const tiles = d ? [
    { icon: 'droplet', label: 'Treatment Plant', sub: `Qty: ${d.assets.treatmentPlants}` },
    { icon: 'sliders', label: 'Pump Station', sub: `Qty: ${d.assets.pumpStations}` },
    { icon: 'layers', label: 'Asset Count', sub: `Valves: ${nfmt(d.assets.valves)}` },
    { icon: 'users', label: 'Active Account', sub: `Cust: ${nfmt(d.assets.customers)}` },
    { icon: 'network', label: 'Supply Network', sub: `${nfmt(d.assets.networkMiles)} miles` },
  ] : [];

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title">COMMAND CENTER</h1>
          <p className="exec-sub">Urban water distribution — real-time operations{d ? ` · updated ${new Date(d.updatedAt).toLocaleTimeString()}` : ''}</p>
        </div>
        <div className="statuspills">
          <span className="spill"><Icon name="shieldcheck" size={15} /> SECURE</span>
          <span className="spill live"><span className="livedot" /> LIVE</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="cc-grid">
        {/* LEFT COLUMN */}
        <div className="cc-col">
          <div className="panel">
            <div className="ccp-h">System Pressure &amp; Flow</div>
            <div className="cc-gauges">
              <AnalogGauge value={d?.pressure.psi ?? 0} max={120} majors={6} unit="PSI" color={CSS('--accent')} />
              <AnalogGauge value={d?.pressure.gpm ?? 0} max={100000} majors={5} unit="GPM" color={CSS('--ok')} />
            </div>
          </div>

          <div className="panel">
            <div className="ccp-h">Real-Time Consumption</div>
            {d && d.consumption.length ? <AxisChart data={d.consumption} color={CSS('--accent2')} name="Consumption" unit="GPM" type="line" height={130} /> : <p className="muted">Loading…</p>}
          </div>

          <div className="panel">
            <div className="ccp-h">Network Pipe Condition</div>
            <div className="cc-cond">
              <Donut segs={condSegs} center={`${pc?.overallHealth ?? 0}%`} sub="OVERALL" />
              <div className="cc-legend">
                <div><span className="dot" style={{ background: 'var(--ok)' }} /> Good <b>{pc?.good ?? 0}%</b></div>
                <div><span className="dot" style={{ background: 'var(--watch)' }} /> Fair <b>{pc?.fair ?? 0}%</b></div>
                <div><span className="dot" style={{ background: '#e08a3d' }} /> Poor <b>{pc?.poor ?? 0}%</b></div>
                <div><span className="dot" style={{ background: 'var(--alarm)' }} /> Critical <b>{pc?.critical ?? 0}%</b></div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="ccp-h">Leakage Detection</div>
            <LeafMap markers={leakMarkers} height={170} fit />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{leakMarkers.length} active leak alerts</div>
          </div>
        </div>

        {/* CENTER COLUMN */}
        <div className="cc-col">
          <div className="panel cc-centerpanel">
            <div className="cc-supplytoggle">
              {(['Supply', 'Waste'] as const).map((m) => (
                <button key={m} className={`cc-seg ${supplyMode === m ? 'on' : ''}`} onClick={() => setSupplyMode(m)}>{m}</button>
              ))}
            </div>
            <div className="cc-assettiles">
              {tiles.map((t) => (
                <div className="cc-assettile" key={t.label}>
                  <div className="cc-asseticon"><Icon name={t.icon} size={20} /></div>
                  <div className="cc-assetlabel">{t.label}</div>
                  <div className="cc-assetsub">{t.sub}</div>
                </div>
              ))}
            </div>
            <LeafMap markers={sites} height={420} fit />
          </div>

          <div className="panel">
            <div className="ccp-h">Water Main Breaks <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· last 30 days</span></div>
            {d ? <AxisChart data={d.waterMainBreaks.map((w) => ({ label: w.label, value: w.breaks }))} color={CSS('--alarm')} name="Water main breaks" unit="" type="bar" height={150} /> : <p className="muted">Loading…</p>}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="cc-col">
          <div className="panel">
            <div className="ccp-h">Supply &amp; Demand</div>
            <div className="cc-sd">
              <div className="cc-sd-tile"><div className="lbl">Supply</div><div className="val" style={{ color: 'var(--accent)' }}>{d?.supplyDemand.supplyPsi ?? '—'} <span>PSI</span></div></div>
              <div className="cc-sd-tile"><div className="lbl">Total Demand</div><div className="val" style={{ color: 'var(--ok)' }}>{d ? nfmt(d.supplyDemand.totalDemandGpm) : '—'} <span>GPM</span></div></div>
              <div className="cc-sd-tile"><div className="lbl">System Demand</div><div className="val" style={{ color: 'var(--accent)' }}>{d ? nfmt(d.supplyDemand.systemDemandGpm) : '—'} <span>GPM</span></div></div>
              <div className="cc-sd-tile"><div className="lbl">Supply Reserve</div><div className="val" style={{ color: 'var(--accent2)' }}>{d?.supplyDemand.supplyReserveMld ?? '—'} <span>MLD</span></div></div>
            </div>
          </div>

          <div className="panel">
            <div className="ccp-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Plant and Station</span>
              {d && d.plantStation.length ? <span className="cc-daterange">{d.plantStation[0].label} — {d.plantStation[d.plantStation.length - 1].label}</span> : null}
            </div>
            <div className="cc-legend row" style={{ marginBottom: 6, fontSize: 11 }}>
              <div><span className="dot" style={{ background: '#f5d020' }} /> Leakage</div>
              <div><span className="dot" style={{ background: '#e6a52b' }} /> Total Plant Production</div>
              <div><span className="dot" style={{ background: '#e0559b' }} /> WAMR</div>
              <div><span className="dot" style={{ background: '#22d3ee' }} /> AMI</div>
            </div>
            {d ? <PlantStationChart data={d.plantStation} /> : <p className="muted">Loading…</p>}
          </div>

          <div className="panel">
            <div className="ccp-h">Active Maintenance</div>
            <div className="cc-maint">
              {d?.maintenance.length ? d.maintenance.map((m) => (
                <div className="cc-maint-row" key={m.code}>
                  <span className={`cc-prio ${m.priority === 'CRITICAL' ? 'critical' : m.priority === 'HIGH' ? 'alarm' : 'watch'}`} />
                  <div className="cc-maint-main">
                    <div className="cc-maint-title">{m.title}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{m.site ?? m.code}</div>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{m.due ?? '—'}</div>
                </div>
              )) : <p className="muted">No active work orders.</p>}
            </div>
          </div>

          <div className="panel">
            <div className="ccp-h">Pump Station Status</div>
            <div className="cc-pumpgrid">
              {d?.pumpStatus.map((r) => (
                <div className="cc-pumprow" key={r.name}>
                  <span className="cc-pumpname">{r.name}</span>
                  <div className="cc-cells">
                    {r.cells.map((c, i) => <span key={i} className={`cc-cell ${c ? 'on' : ''}`} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
