import { useEffect, useMemo, useState } from 'react';
import { ConditionAsset, ConditionDetail, EsaResult, api } from './api';
import { AxisChart } from './charts';

function healthColor(h: number | null): string {
  if (h == null) return 'var(--muted)';
  if (h >= 85) return 'var(--ok)';
  if (h >= 70) return 'var(--watch)';
  if (h >= 50) return 'var(--alarm)';
  return 'var(--critical)';
}
function barClass(v: number | null): string {
  if (v == null) return 'warn';
  return v >= 80 ? 'good' : v >= 60 ? 'warn' : 'bad';
}

const SUBS: { key: keyof EsaResult; label: string }[] = [
  { key: 'supplyIndex', label: 'Power supply' },
  { key: 'statorIndex', label: 'Stator winding' },
  { key: 'rotorIndex', label: 'Rotor bars' },
  { key: 'eccentricityIndex', label: 'Eccentricity' },
  { key: 'bearingIndex', label: 'Bearing' },
  { key: 'loadIndex', label: 'Load / efficiency' },
];

function num(v: unknown, dp = 1): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n.toFixed(dp);
}

export function ConditionMonitoring() {
  const [assets, setAssets] = useState<ConditionAsset[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConditionDetail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.conditionAssets().then((a) => {
      setAssets(a);
      if (a.length) setSel(a[0].id);
    }).catch(() => setErr('Could not load condition data.'));
  }, []);

  useEffect(() => {
    if (!sel) return;
    api.conditionDetail(sel).then(setDetail).catch(() => setErr('Could not load asset detail.'));
  }, [sel]);

  const gaugeStyle = useMemo(() => {
    const h = detail?.esa?.healthScore ?? 0;
    return { ['--v' as any]: h ?? 0, ['--c' as any]: healthColor(detail?.esa?.healthScore ?? null) };
  }, [detail]);

  const L = detail?.latest ?? null;

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>PUMP &amp; MOTOR</h1>
          <p className="exec-sub">Electrical Signature Analysis · {assets.length} machines monitored</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> ESA ENGINE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      <div className="esa-cards">
        {assets.map((a) => (
          <div
            key={a.id}
            className={`esa-card ${sel === a.id ? 'sel' : ''}`}
            style={{ ['--c' as any]: healthColor(a.esa?.healthScore ?? null) }}
            onClick={() => setSel(a.id)}
          >
            <div className="tag">{a.tag} · {a.ratedPowerKw ? `${a.ratedPowerKw} kW` : a.type}</div>
            <div className="nm">{a.name}</div>
            <div className="hs">
              <span className="n" style={{ color: healthColor(a.esa?.healthScore ?? null) }}>
                {a.esa?.healthScore ?? '—'}
              </span>
              <span className="muted">{a.esa?.severity ?? ''}</span>
            </div>
          </div>
        ))}
      </div>

      {detail && detail.esa && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>{detail.tag} — {detail.name}</h2>
            <div className="esa-detail">
              <div className="gauge" style={gaugeStyle}>
                <div className="g-in">
                  <div className="n" style={{ color: healthColor(detail.esa.healthScore) }}>{detail.esa.healthScore ?? '—'}</div>
                  <div className="l">{detail.esa.severity}</div>
                </div>
              </div>
              <div className="subbars">
                {SUBS.map((s) => {
                  const v = detail.esa![s.key] as number | null;
                  return (
                    <div className="subbar" key={s.key}>
                      <span className="lbl">{s.label}</span>
                      <span className="track"><span className={`fill ${barClass(v)}`} style={{ width: `${v ?? 0}%`, display: 'block' }} /></span>
                      <span className="v">{v ?? '—'}</span>
                    </div>
                  );
                })}
                {detail.esa.drivers.length > 0 && (
                  <div className="drivers">
                    {detail.esa.drivers.map((d) => <span className="driverchip" key={d}>{d}</span>)}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Health trend</h3>
            <AxisChart
              data={detail.trend.filter((t) => t.healthScore != null).map((t) => ({ label: new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), value: t.healthScore as number }))}
              color="var(--accent2)" name="Health score" unit="0–100" type="area" yMin={0} yMax={100}
            />
          </div>

          {L && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Latest electrical signature</h3>
              <div className="paramgrid">
                <div className="param"><div className="pv">{num(L.voltageV, 0)}<span className="muted"> V</span></div><div className="pl">Voltage</div></div>
                <div className="param"><div className="pv">{num(L.currentA, 0)}<span className="muted"> A</span></div><div className="pl">Current</div></div>
                <div className="param"><div className="pv">{num(L.powerFactor, 2)}</div><div className="pl">Power factor</div></div>
                <div className="param"><div className="pv">{num(L.loadPct, 0)}<span className="muted"> %</span></div><div className="pl">Load</div></div>
                <div className="param"><div className="pv">{num(L.efficiencyPct, 0)}<span className="muted"> %</span></div><div className="pl">Efficiency</div></div>
                <div className="param"><div className="pv">{num(L.voltageUnbalancePct)}<span className="muted"> %</span></div><div className="pl">V unbalance</div></div>
                <div className="param"><div className="pv">{num(L.currentUnbalancePct)}<span className="muted"> %</span></div><div className="pl">I unbalance</div></div>
                <div className="param"><div className="pv">{num(L.thdCurrentPct)}<span className="muted"> %</span></div><div className="pl">Current THD</div></div>
                <div className="param"><div className="pv">{num(L.vibrationMmS, 1)}<span className="muted"> mm/s</span></div><div className="pl">Vibration</div></div>
                <div className="param"><div className="pv">{num(L.bearingTempC, 0)}<span className="muted"> °C</span></div><div className="pl">Bearing temp</div></div>
                <div className="param"><div className="pv">{num(L.windingTempC, 0)}<span className="muted"> °C</span></div><div className="pl">Winding temp</div></div>
                <div className="param"><div className="pv">{num(L.speedRpm, 0)}<span className="muted"> rpm</span></div><div className="pl">Speed</div></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
