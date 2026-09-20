import { useEffect, useState } from 'react';
import { WqAnalyser, WqDetail, WqStatus, WqSummary, api } from './api';

const stClass = (s: WqStatus | null) => (s ? `st-${s}` : 'st-none');

function fmt(v: number | null): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
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
    Promise.all([api.wqSummary(), api.wqAnalysers()])
      .then(([s, a]) => { setSummary(s); setAnalysers(a); })
      .catch(() => setErr('Could not load water quality data.'));
  }, []);

  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    api.wqDetail(sel).then(setDetail).catch(() => setErr('Could not load analyser detail.'));
  }, [sel]);

  const shown = dma ? analysers.filter((a) => a.dmaId === dma) : analysers;

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

      {/* Project parameter KPIs */}
      {summary && (
        <section className="wq-params">
          {summary.parameters.map((p) => (
            <div className={`wq-tile ${stClass(p.status)}`} key={p.key}>
              <div className="wl">{p.label}</div>
              <div className="wv tnum">{fmt(p.avg)}{p.unit && <span className="u">{p.unit}</span>}</div>
              <div className="wmeta">{p.total ? `${p.breach} breach · ${p.warn} warn / ${p.total}` : 'no data'}</div>
            </div>
          ))}
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
