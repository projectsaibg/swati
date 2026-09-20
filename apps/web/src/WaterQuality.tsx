import { useEffect, useState } from 'react';
import { WqAnalyser, WqDetail, WqParamSummary, WqStatus, WqSummary, api } from './api';

const stClass = (s: WqStatus | null) => (s ? `st-${s}` : 'st-none');
function fmt(v: number | null): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
const CSS = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;

// --- small dependency-free charts (app palette only) -----------------------
function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 54, C = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={150} height={150} viewBox="0 0 150 150" role="img" aria-label="Compliance overview">
      <g transform="rotate(-90 75 75)">
        <circle cx={75} cy={75} r={r} fill="none" stroke="var(--line)" strokeWidth={18} />
        {segments.filter((s) => s.value > 0).map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={i} cx={75} cy={75} r={r} fill="none" stroke={s.color} strokeWidth={18}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />
          );
          off += len;
          return el;
        })}
      </g>
      <text x={75} y={72} textAnchor="middle" fontSize={26} fontWeight={800} fill="var(--ink)">{total}</text>
      <text x={75} y={90} textAnchor="middle" fontSize={10} fill="var(--muted)">ANALYSERS</text>
    </svg>
  );
}

function Bars({ data }: { data: { label: string; pct: number }[] }) {
  if (!data.length) return <p className="muted" style={{ textAlign: 'center' }}>No time-series yet.</p>;
  const W = 340, H = 170, base = 130, top = 12, n = data.length;
  const slot = W / n, bw = Math.min(38, slot * 0.55);
  const col = (p: number) => (p >= 85 ? 'var(--ok)' : p >= 60 ? 'var(--watch)' : 'var(--alarm)');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Compliance over time">
      {[0, 50, 100].map((g) => {
        const y = base - (g / 100) * (base - top);
        return <line key={g} x1={0} x2={W} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} opacity={0.5} />;
      })}
      {data.map((d, i) => {
        const x = i * slot + (slot - bw) / 2;
        const h = (d.pct / 100) * (base - top);
        return (
          <g key={i}>
            <rect x={x} y={base - h} width={bw} height={h} rx={3} fill={col(d.pct)} />
            <text x={x + bw / 2} y={base - h - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">{d.pct}</text>
            <text x={x + bw / 2} y={base + 14} textAnchor="middle" fontSize={9} fill="var(--muted)">{d.label}</text>
          </g>
        );
      })}
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

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="muted">Not enough history</span>;
  const w = 300, h = 44, min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1, step = w / (values.length - 1);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
  return <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ maxHeight: 44 }}><path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} /></svg>;
}

export function WaterQuality() {
  const [summary, setSummary] = useState<WqSummary | null>(null);
  const [analysers, setAnalysers] = useState<WqAnalyser[]>([]);
  const [dma, setDma] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<WqDetail | null>(null);
  const [trendKey, setTrendKey] = useState('ph');
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = () => Promise.all([api.wqSummary(), api.wqAnalysers()])
      .then(([s, a]) => { setSummary(s); setAnalysers(a); })
      .catch(() => setErr('Could not load water quality data.'));
    load();
    const t = setInterval(load, 45000); // live refresh for the demo/real feed
    return () => clearInterval(t);
  }, []);
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

      {err && <div className="err">{err}</div>}

      {/* Compliance donut + over-time bars */}
      {summary && (
        <section className="wq-charts">
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
            <p className="chart-title">Compliance Over Time</p>
            <Bars data={summary.overTime} />
          </div>
        </section>
      )}

      {/* Parameter KPIs with trend arrows */}
      {summary && (
        <section className="wq-params">
          {summary.parameters.map((p) => (
            <div className={`wq-tile ${stClass(p.status)}`} key={p.key}>
              <div className="wl">{p.label}</div>
              <div className="wv tnum">{fmt(p.avg)}{p.unit && <span className="u">{p.unit}</span>}<Arrow p={p} /></div>
              <div className="wmeta">{p.total ? `${p.breach} breach · ${p.warn} warn / ${p.total}` : 'no data'}</div>
            </div>
          ))}
        </section>
      )}

      {/* Progress meters */}
      {summary && (
        <section className="wq-charts">
          <div className="panel">
            <div className="meter">
              <div className="mt"><span>Compliance progress</span><span className="mv" style={{ color: 'var(--ok)' }}>{summary.compliancePct}%</span></div>
              <div className="track"><div className="fill" style={{ width: `${summary.compliancePct}%`, background: 'var(--ok)' }} /></div>
            </div>
          </div>
          <div className="panel">
            <div className="meter">
              <div className="mt"><span>Pollution / non-compliance</span><span className="mv" style={{ color: summary.pollutionPct >= 40 ? 'var(--alarm)' : 'var(--watch)' }}>{summary.pollutionPct}%</span></div>
              <div className="track"><div className="fill" style={{ width: `${summary.pollutionPct}%`, background: summary.pollutionPct >= 40 ? 'var(--alarm)' : 'var(--watch)' }} /></div>
            </div>
          </div>
        </section>
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
            <Spark values={(detail.trends[trendKey] ?? []).map((t) => t.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
