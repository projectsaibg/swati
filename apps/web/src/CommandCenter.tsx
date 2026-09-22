import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CommandCenterData, api } from './api';
import { AxisChart } from './charts';
import { Icon } from './icons';

const CSS = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;
const nfmt = (n: number) => n.toLocaleString('en-IN');

// --- semicircular arc gauge ------------------------------------------------
function ArcGauge({ value, max, label, unit, color }: { value: number; max: number; label: string; unit: string; color: string }) {
  const W = 150, H = 96, cx = W / 2, cy = 84, r = 62;
  const frac = Math.max(0, Math.min(1, value / max));
  const pol = (a: number) => [cx + r * Math.cos(Math.PI - a * Math.PI), cy - r * Math.sin(Math.PI - a * Math.PI)];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pol(a0); const [x1, y1] = pol(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} ${value} ${unit}`}>
      <path d={arc(0, 1)} fill="none" stroke="var(--line)" strokeWidth={9} strokeLinecap="round" />
      <path d={arc(0, frac)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
      {ticks.map((t, i) => {
        const [x, y] = pol(t); const xi = cx + (r - 13) * Math.cos(Math.PI - t * Math.PI); const yi = cy - (r - 13) * Math.sin(Math.PI - t * Math.PI);
        return <line key={i} x1={x} y1={y} x2={xi} y2={yi} stroke="var(--muted)" strokeWidth={1} />;
      })}
      <text x={cx} y={cy - 14} textAnchor="middle" fontSize={24} fontWeight={800} fill="var(--ink)" className="tnum">{nfmt(value)}</text>
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="var(--muted)">{unit}</text>
      <text x={2} y={cy + 8} fontSize={9} fill="var(--muted)">0</text>
      <text x={W - 2} y={cy + 8} textAnchor="end" fontSize={9} fill="var(--muted)">{max}</text>
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

// --- leakage mini-map (normalized scatter over WB bounds) ------------------
function LeakScatter({ leaks }: { leaks: CommandCenterData['leaks'] }) {
  const LAT0 = 21.9, LAT1 = 24.2, LNG0 = 87.4, LNG1 = 89.0;
  const W = 260, H = 150;
  const x = (lng: number) => ((lng - LNG0) / (LNG1 - LNG0)) * W;
  const y = (lat: number) => H - ((lat - LAT0) / (LAT1 - LAT0)) * H;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="cc-leakmap" preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={W} height={H} fill="var(--surface2)" rx={8} />
      {Array.from({ length: 7 }, (_, i) => <line key={`v${i}`} x1={(i + 1) * W / 8} y1={0} x2={(i + 1) * W / 8} y2={H} stroke="var(--line)" strokeWidth={0.5} />)}
      {Array.from({ length: 4 }, (_, i) => <line key={`h${i}`} x1={0} y1={(i + 1) * H / 5} x2={W} y2={(i + 1) * H / 5} stroke="var(--line)" strokeWidth={0.5} />)}
      {leaks.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.lng)} cy={y(p.lat)} r={p.severity === 'High' ? 9 : 6} fill={p.severity === 'High' ? 'var(--alarm)' : 'var(--watch)'} opacity={0.25} />
          <circle cx={x(p.lng)} cy={y(p.lat)} r={3} fill={p.severity === 'High' ? 'var(--alarm)' : 'var(--watch)'} />
        </g>
      ))}
    </svg>
  );
}

// --- center Leaflet map (dark) --------------------------------------------
function CenterMap() {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [23.4, 88.4], zoom: 8, zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    // Key-free OSM tiles; darkened via a CSS filter on .cc-map (see styles.css).
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    const layer = L.layerGroup().addTo(map);
    api.mapPoints().then((d) => {
      const pts: [number, number][] = [];
      for (const s of d.sites) {
        const lat = Number(s.latitude), lng = Number(s.longitude);
        pts.push([lat, lng]);
        L.circleMarker([lat, lng], { radius: 3, color: s.fault > 0 ? '#e0533d' : '#22d3ee', weight: 1, fillOpacity: 0.85 }).addTo(layer);
      }
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15));
    }).catch(() => {});
    setTimeout(() => map.invalidateSize(), 120);
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  return <div ref={elRef} className="cc-map" />;
}

export function CommandCenter() {
  const [d, setD] = useState<CommandCenterData | null>(null);
  const [err, setErr] = useState('');
  const [supplyMode, setSupplyMode] = useState<'Supply' | 'Waste'>('Supply');

  useEffect(() => {
    const load = () => api.commandCenter().then(setD).catch(() => setErr('Could not load command center metrics.'));
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const pc = d?.pipeCondition;
  const condSegs = pc ? [
    { value: pc.good, color: CSS('--ok') },
    { value: pc.fair, color: CSS('--watch') },
    { value: pc.poor, color: '#e08a3d' },
    { value: pc.critical, color: CSS('--alarm') },
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
              <ArcGauge value={d?.pressure.psi ?? 0} max={150} label="Pressure" unit="PSI" color={CSS('--accent')} />
              <ArcGauge value={d?.pressure.gpm ?? 0} max={100000} label="Flow" unit="GPM" color={CSS('--ok')} />
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
            {d ? <LeakScatter leaks={d.leaks} /> : <p className="muted">Loading…</p>}
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{d?.leaks.length ?? 0} active leak alerts</div>
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
            <CenterMap />
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
            <div className="ccp-h">Plant and Station <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 7 days</span></div>
            {d ? <AxisChart data={d.plantStation.map((p) => ({ label: p.label, value: p.production }))} color={CSS('--watch')} name="Total production" unit="MGD" type="bar" height={130} /> : <p className="muted">Loading…</p>}
            <div className="cc-legend row" style={{ marginTop: 6 }}>
              <div><span className="dot" style={{ background: 'var(--watch)' }} /> Production</div>
              <div><span className="dot" style={{ background: 'var(--alarm)' }} /> Avg leakage <b>{d ? Math.round(d.plantStation.reduce((a, p) => a + p.leakage, 0) / d.plantStation.length) : 0}%</b></div>
            </div>
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
