import { useEffect, useState } from 'react';
import { ValveDetail, ValveRow, api } from './api';
import { useAuth } from './contexts';
import { Icon } from './icons';

const statusColor = (s: string) => (s === 'Open' ? 'var(--ok)' : s === 'Closed' ? 'var(--alarm)' : 'var(--watch)');
const statusPill = (s: string) => (s === 'Open' ? 'ok' : s === 'Closed' ? 'alarm' : 'watch');
const statusClass = (s: string) => (s === 'Open' ? 'st-safe' : s === 'Closed' ? 'st-breach' : 'st-warn');
const fmt = (v: number | null, dp = 1) => (v == null ? '—' : Number(v).toFixed(dp));
const errMsg = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Request failed';

function Gauge({ pct, status }: { pct: number; status: string }) {
  return (
    <div className="gauge vgauge" style={{ ['--v' as any]: pct, ['--c' as any]: statusColor(status) }}>
      <div className="g-in">
        <div className="n" style={{ color: statusColor(status) }}>{pct}%</div>
        <div className="l">{status.toUpperCase()}</div>
      </div>
    </div>
  );
}

export function ValveControl() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ValveRow[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'Open' | 'Throttled' | 'Closed'>('ALL');
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<ValveDetail | null>(null);
  const [setPos, setSetPos] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const canOperate = !!user?.permissions?.some((p) => p === 'valve.operate' || p === '*');

  const load = () => api.valves().then(setRows).catch(() => setErr('Could not load valves.'));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    api.valve(sel).then((d) => { setDetail(d); setSetPos(Number(d.positionPct ?? 50)); }).catch(() => setErr('Could not load valve.'));
  }, [sel]);

  const operate = async (id: string, action: 'OPEN' | 'CLOSE' | 'SET', positionPct?: number) => {
    setBusy(true); setErr('');
    try { setDetail(await api.operateValve(id, { action, positionPct })); await load(); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  };

  const counts = rows.reduce((a, v) => { a[v.status] = (a[v.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const shown = filter === 'ALL' ? rows : rows.filter((v) => v.status === filter);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>VALVE CONTROL CENTER</h1>
          <p className="exec-sub">Remote valve operations · real-time position, pressure & flow</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> REMOTE CONTROL</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* KPI stats */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum">{rows.length}</div><div className="lbl">Total valves</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{counts.Open ?? 0}</div><div className="lbl">Open</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--watch)' }}>{counts.Throttled ?? 0}</div><div className="lbl">Throttled</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{counts.Closed ?? 0}</div><div className="lbl">Closed</div></div>
        <div className="kpi"><div className="val tnum">{rows.filter((v) => v.controllable).length}</div><div className="lbl">Controllable</div></div>
      </section>

      {/* Filter chips */}
      <div className="vchips">
        {(['ALL', 'Open', 'Throttled', 'Closed'] as const).map((f) => (
          <button key={f} className={`vchip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Valve card grid */}
      <section className="valve-grid">
        {shown.map((v) => (
          <div
            key={v.id}
            className={`valve-card ${statusClass(v.status)} ${sel === v.id ? 'sel' : ''}`}
            onClick={() => v.controllable && setSel(sel === v.id ? null : v.id)}
            style={{ cursor: v.controllable ? 'pointer' : 'default' }}
          >
            <div className="vc-head">
              <div>
                <div className="vc-name">{v.name}</div>
                <div className="vc-sub">{v.tag} · {v.area ?? '—'}</div>
              </div>
              <span className="badge">{v.valveType ?? 'Valve'}</span>
            </div>
            <div style={{ display: 'grid', placeItems: 'center', margin: '6px 0 10px' }}>
              <Gauge pct={Number(v.positionPct ?? 0)} status={v.status} />
            </div>
            <div className="vtiles">
              <div className="vtile"><div className="pv">{fmt(v.upstreamBar, 1)}<span className="u"> bar</span></div><div className="pl">Upstream</div></div>
              <div className="vtile"><div className="pv">{fmt(v.downstreamBar, 1)}<span className="u"> bar</span></div><div className="pl">Downstream</div></div>
            </div>
            <div className="vc-foot">
              <span><Icon name="activity" size={13} /> {fmt(v.flowKlmin, 1)} <span className="muted">kL/min</span></span>
              <span className={`pill ${v.health === 'Good' ? 'ok' : 'watch'}`}>{v.health ?? 'n/a'}</span>
            </div>
          </div>
        ))}
      </section>

      {/* Operate + audit for the selected valve */}
      {detail && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>
            {detail.tag} — {detail.name} <span className={`pill ${statusPill(detail.status)}`}>{detail.status}</span>
            <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>position {detail.positionPct ?? 0}%</span>
          </h3>
          {canOperate ? (
            <div className="rowform" style={{ alignItems: 'center' }}>
              <button className="btn sm" disabled={busy} onClick={() => operate(detail.id, 'OPEN')}>Open</button>
              <button className="btn danger sm" disabled={busy} onClick={() => operate(detail.id, 'CLOSE')}>Close</button>
              <label className="field" style={{ marginBottom: 0 }}>Set position: {setPos}%
                <input type="range" min={0} max={100} value={setPos} onChange={(e) => setSetPos(Number(e.target.value))} />
              </label>
              <button className="btn ghost sm" disabled={busy} onClick={() => operate(detail.id, 'SET', setPos)}>Apply {setPos}%</button>
            </div>
          ) : <p className="muted">Read-only — operating requires <code>valve.operate</code>.</p>}

          <h4 style={{ margin: '14px 0 6px' }}>Operation audit trail</h4>
          {detail.ops.length === 0 ? (
            <p className="muted">No operations recorded yet.</p>
          ) : (
            <table className="tbl">
              <thead><tr><th>Time</th><th>Action</th><th>Change</th><th>Position</th><th>Operator</th></tr></thead>
              <tbody>
                {detail.ops.map((o) => (
                  <tr key={o.id}>
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(o.ts).toLocaleString()}</td>
                    <td>{o.action}</td>
                    <td className="muted">{o.fromStatus ?? '—'} → {o.toStatus}</td>
                    <td className="tnum">{o.positionPct != null ? `${o.positionPct}%` : '—'}</td>
                    <td>{o.operator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
