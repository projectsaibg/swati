import { useEffect, useState } from 'react';
import { GeoQuery, WqAnalyser, WqDetail, WqParamSummary, WqStatus, WqSummary, api } from './api';
import { AxisChart } from './charts';
import { GeoFilter } from './GeoFilter';

const stClass = (s: WqStatus | null) => (s ? `st-${s}` : 'st-none');
function fmt(v: number | null): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
const CSS = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;

// --- small dependency-free charts (app palette only) -----------------------
function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 44, C = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={124} height={124} viewBox="0 0 124 124" role="img" aria-label="Compliance overview">
      <g transform="rotate(-90 62 62)">
        <circle cx={62} cy={62} r={r} fill="none" stroke="var(--line)" strokeWidth={15} />
        {segments.filter((s) => s.value > 0).map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={i} cx={62} cy={62} r={r} fill="none" stroke={s.color} strokeWidth={15}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />
          );
          off += len;
          return el;
        })}
      </g>
      <text x={62} y={60} textAnchor="middle" fontSize={22} fontWeight={800} fill="var(--ink)">{total}</text>
      <text x={62} y={76} textAnchor="middle" fontSize={9} fill="var(--muted)">ANALYSERS</text>
    </svg>
  );
}

function Arrow({ p }: { p: WqParamSummary }) {
  if (p.trend === 'flat') return <span className="muted kpi-arrow">–</span>;
  const color = p.good ? 'var(--ok)' : 'var(--alarm)';
  return (
    <svg className="kpi-arrow" width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
      {p.trend === 'up'
        ? <polygon points="7,2 12,11 2,11" fill={color} />
        : <polygon points="2,3 12,3 7,12" fill={color} />}
    </svg>
  );
}

export function WaterQuality() {
  const [summary, setSummary] = useState<WqSummary | null>(null);
  const [analysers, setAnalysers] = useState<WqAnalyser[]>([]);
  const [dma, setDma] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<WqDetail | null>(null);
  const [trendKey, setTrendKey] = useState('ph');
  const [geo, setGeo] = useState<GeoQuery>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => Promise.all([api.wqSummary(geo), api.wqAnalysers(geo)])
      .then(([s, a]) => { setSummary(s); setAnalysers(a); })
      .catch(() => setErr('Could not load water quality data.'));
    load();
    const t = setInterval(load, 45000); // live refresh for the demo/real feed
    return () => clearInterval(t);
  }, [geo]);
  // Clear a drill-down selection when the geo scope changes.
  useEffect(() => { setDma(null); setSel(null); }, [geo]);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    const load = () => api.wqDetail(sel).then(setDetail).catch(() => setErr('Could not load analyser detail.'));
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [sel]);

  const shown = dma ? analysers.filter((a) => a.dmaId === dma) : analysers;
  const c = summary?.compliance;
  const segments = c ? [
    { label: 'Compliant', value: c.compliant, color: CSS('--ok') },
    { label: 'Under review', value: c.underReview, color: CSS('--watch') },
    { label: 'Non-compliant', value: c.nonCompliant, color: CSS('--alarm') },
    { label: 'Pending', value: c.pending, color: CSS('--muted') },
  ] : [];

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>WATER QUALITY</h1>
          <p className="exec-sub">
            {summary ? `${summary.analyserCount} analysers across ${summary.dmaCount} DMA${summary.dmaCount === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
      </div>

      {err && <div className="err">{err}</div>}

      {/* Top: compliance + over-time (left) beside the parameter KPIs (right) */}
      {summary && (
        <div className="wq-top">
          <div className="wq-left">
            <div className="panel">
              <p className="chart-title">Compliance Overview</p>
              <div className="donut-wrap">
                <Donut segments={segments} />
                <div className="legend">
                  {segments.map((s) => (
                    <div className="li" key={s.label}>
                      <span className="sw" style={{ background: s.color }} />{s.label}
                      <span className="lc">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="panel">
              <p className="chart-title">Water Quality Over Time</p>
              <AxisChart
                data={summary.overTime.map((o) => ({ label: o.label, value: o.pct }))}
                color="var(--accent)" name="Water quality index" unit="0–100" type="bar" yMin={0} yMax={100} height={130}
              />
            </div>
          </div>
          <div className="wq-right">
            <section className="kpi2">
              {summary.parameters.map((p) => (
                <div className={`wq-tile ${stClass(p.status)}`} key={p.key}>
                  <div className="wl">{p.label}</div>
                  <div className="wv tnum">{fmt(p.avg)}{p.unit && <span className="u">{p.unit}</span>}<Arrow p={p} /></div>
                  <div className="wmeta">{p.total ? `${p.breach} breach · ${p.warn} warn / ${p.total}` : 'no data'}</div>
                </div>
              ))}
            </section>
            <div className="panel wq-meters">
              <div className="meter">
                <div className="mt"><span>Compliance progress</span><span className="mv" style={{ color: 'var(--ok)' }}>{summary.compliancePct}%</span></div>
                <div className="track"><div className="fill" style={{ width: `${summary.compliancePct}%`, background: 'var(--ok)' }} /></div>
              </div>
              <div className="meter">
                <div className="mt"><span>Pollution / non-compliance</span><span className="mv" style={{ color: summary.pollutionPct >= 40 ? 'var(--alarm)' : 'var(--watch)' }}>{summary.pollutionPct}%</span></div>
                <div className="track"><div className="fill" style={{ width: `${summary.pollutionPct}%`, background: summary.pollutionPct >= 40 ? 'var(--alarm)' : 'var(--watch)' }} /></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DMA cards */}
      {summary && summary.dmas.length > 0 && (
        <>
          <div className="sectlabel">District Metered Areas</div>
          <section className="dma-cards">
            <div className={`dma-card ${dma === null ? 'sel' : ''} st-safe`} onClick={() => setDma(null)}>
              <div className="dn">All DMAs</div>
              <div className="muted">{summary.analyserCount} analysers</div>
            </div>
            {summary.dmas.map((d) => (
              <div key={d.id} className={`dma-card ${stClass(d.status)} ${dma === d.id ? 'sel' : ''}`} onClick={() => setDma(d.id)}>
                <div className="dn"><span className={`st-dot ${stClass(d.status)}`} />{d.name}</div>
                <div className="muted">{d.analyserCount} analyser{d.analyserCount === 1 ? '' : 's'}{d.worstParam ? ` · ${d.worstParam}` : ''}</div>
              </div>
            ))}
          </section>
        </>
      )}

      {/* Analysers */}
      <div className="sectlabel">Analysers{dma ? ' in DMA' : ''}</div>
      <div className="panel">
        <table className="tbl">
          <thead><tr><th>Tag</th><th>Analyser</th><th>DMA</th><th>Transport</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id}>
                <td>{a.tag}</td>
                <td>{a.name}</td>
                <td className="muted">{a.dmaName}</td>
                <td className="muted">{a.transport ?? '—'}</td>
                <td><span className={`pill ${a.status === 'safe' ? 'ok' : a.status === 'warn' ? 'watch' : 'alarm'}`}>{a.status.toUpperCase()}</span></td>
                <td><button className="btn ghost sm" onClick={() => setSel(sel === a.id ? null : a.id)}>{sel === a.id ? 'Hide' : 'Details'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Analyser detail */}
      {detail && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>{detail.tag} — {detail.name} <span className="muted" style={{ fontSize: 14 }}>· {detail.dmaName}</span></h2>
          <section className="wq-params">
            {detail.params.map((p) => (
              <div className={`wq-tile ${stClass(p.status)}`} key={p.key} onClick={() => setTrendKey(p.key)} style={{ cursor: 'pointer' }}>
                <div className="wl">{p.label}</div>
                <div className="wv tnum">{fmt(p.value)}{p.unit && <span className="u">{p.unit}</span>}</div>
                <div className="wmeta">{p.status ? p.status.toUpperCase() : 'no data'}</div>
              </div>
            ))}
          </section>
          <div style={{ marginTop: 8 }}>
            <strong>Trend — {detail.params.find((p) => p.key === trendKey)?.label ?? trendKey}</strong>
            <AxisChart
              data={(detail.trends[trendKey] ?? []).map((t) => ({ label: new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), value: t.value }))}
              color="var(--accent)"
              name={detail.params.find((p) => p.key === trendKey)?.label ?? trendKey}
              unit={detail.params.find((p) => p.key === trendKey)?.unit ?? ''}
              type="area"
            />
          </div>
        </div>
      )}
    </div>
  );
}
