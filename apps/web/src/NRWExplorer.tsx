import { useEffect, useState } from 'react';
import { NrwSummary, api } from './api';
import { AxisChart } from './charts';

const kl = (n: number) => `${Math.round(n).toLocaleString()}`;
const nrwColor = (p: number) => (p <= 20 ? 'var(--ok)' : p <= 30 ? 'var(--watch)' : 'var(--alarm)');
const nrwPill = (p: number) => (p <= 20 ? 'ok' : p <= 30 ? 'watch' : 'alarm');

export function NRWExplorer() {
  const [s, setS] = useState<NrwSummary | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.nrwSummary().then(setS).catch(() => setErr('Could not load NRW data.'));
  }, []);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>NRW EXPLORER</h1>
          <p className="exec-sub">Non-revenue water by DMA{s?.period ? ` · ${s.period}` : ''}</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      {s && (
        <>
          <section className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="val tnum">{kl(s.totalInputKl)}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">Water supplied</div></div>
            <div className="kpi"><div className="val tnum">{kl(s.totalBilledKl)}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">Billed</div></div>
            <div className="kpi"><div className="val tnum">{kl(s.nrwKl)}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">NRW volume</div></div>
            <div className="kpi"><div className="val tnum" style={{ color: nrwColor(s.nrwPct) }}>{s.nrwPct}<span style={{ fontSize: 14 }}>%</span></div><div className="lbl">NRW ratio</div></div>
            <div className="kpi"><div className="val tnum">{kl(s.physicalKl)}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">Physical losses ({s.physicalPct}%)</div></div>
            <div className="kpi"><div className="val tnum">{kl(s.commercialKl)}<span className="muted" style={{ fontSize: 13 }}> kL</span></div><div className="lbl">Commercial losses ({s.commercialPct}%)</div></div>
          </section>

          <div className="wq-charts">
            <div className="panel">
              <p className="chart-title">NRW % Trend</p>
              <AxisChart
                data={s.trend.map((t) => ({ label: t.period.slice(5), value: t.nrwPct }))}
                color="var(--watch)" name="NRW ratio" unit="%" type="line" yMin={0}
              />
            </div>
            <div className="panel">
              <p className="chart-title">Loss composition</p>
              <div style={{ display: 'grid', gap: 12, paddingTop: 6 }}>
                <div className="meter">
                  <div className="mt"><span>Physical (real) losses</span><span className="mv" style={{ color: 'var(--alarm)' }}>{s.physicalPct}%</span></div>
                  <div className="track"><div className="fill" style={{ width: `${s.physicalPct}%`, background: 'var(--alarm)' }} /></div>
                </div>
                <div className="meter">
                  <div className="mt"><span>Commercial (apparent) losses</span><span className="mv" style={{ color: 'var(--watch)' }}>{s.commercialPct}%</span></div>
                  <div className="track"><div className="fill" style={{ width: `${s.commercialPct}%`, background: 'var(--watch)' }} /></div>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Physical = leakage &amp; overflows · Commercial = metering &amp; billing gaps (modeled split).</p>
              </div>
            </div>
          </div>

          <div className="sectlabel">DMAs ranked by NRW</div>
          <div className="panel">
            <table className="tbl">
              <thead><tr><th>DMA</th><th>Supplied (kL)</th><th>Billed (kL)</th><th>NRW (kL)</th><th>NRW %</th><th></th></tr></thead>
              <tbody>
                {s.dmas.map((d) => (
                  <tr key={d.area}>
                    <td>{d.area}</td>
                    <td className="tnum">{kl(d.inputKl)}</td>
                    <td className="tnum">{kl(d.billedKl)}</td>
                    <td className="tnum">{kl(d.nrwKl)}</td>
                    <td><span className={`pill ${nrwPill(d.nrwPct)}`}>{d.nrwPct}%</span></td>
                    <td style={{ width: 160 }}>
                      <div className="track" style={{ height: 8 }}>
                        <div className="fill" style={{ width: `${Math.min(100, d.nrwPct)}%`, height: '100%', background: nrwColor(d.nrwPct) }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
