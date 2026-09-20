import { useEffect, useState } from 'react';
import { ValveDetail, ValveRow, api } from './api';
import { useAuth } from './contexts';

function statusPill(s: string) {
  return s === 'Open' ? 'ok' : s === 'Closed' ? 'alarm' : 'watch';
}
function errMsg(e: any) { return e?.response?.data?.message ?? e?.message ?? 'Request failed'; }

export function ValveControl() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ValveRow[]>([]);
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
    try {
      const d = await api.operateValve(id, { action, positionPct });
      setDetail(d);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const counts = rows.reduce((a, v) => { a[v.status] = (a[v.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const controllable = rows.filter((v) => v.controllable).length;

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>VALVE CONTROL</h1>
          <p className="exec-sub">{rows.length} valves · {controllable} remotely controllable</p>
        </div>
        <div className="statuspills">
          <span className="pill ok">{counts.Open ?? 0} open</span>
          <span className="pill watch">{counts.Throttled ?? 0} throttled</span>
          <span className="pill alarm">{counts.Closed ?? 0} closed</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {!canOperate && <p className="muted">You can view valves; operating requires the <code>valve.operate</code> permission.</p>}

      <div className="panel">
        <table className="tbl">
          <thead>
            <tr><th>Tag</th><th>Valve</th><th>Area</th><th>Type</th><th>Status</th><th>Position</th><th>Last operated</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td>{v.tag}</td>
                <td>{v.name}</td>
                <td className="muted">{v.area ?? '—'}</td>
                <td className="muted">{v.valveType ?? '—'}</td>
                <td><span className={`pill ${statusPill(v.status)}`}>{v.status}</span></td>
                <td style={{ minWidth: 120 }}>
                  <div className="track" style={{ height: 8 }}>
                    <div className="fill" style={{ width: `${Number(v.positionPct ?? 0)}%`, background: 'var(--accent)', height: '100%' }} />
                  </div>
                  <span className="muted" style={{ fontSize: 11 }}>{v.positionPct != null ? `${v.positionPct}%` : '—'}</span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{v.lastOperated ? `${new Date(v.lastOperated).toLocaleString()}${v.lastOperator ? ` · ${v.lastOperator}` : ''}` : '—'}</td>
                <td>
                  {v.controllable
                    ? <button className="btn ghost sm" onClick={() => setSel(sel === v.id ? null : v.id)}>{sel === v.id ? 'Close' : 'Manage'}</button>
                    : <span className="muted" style={{ fontSize: 12 }}>manual</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="panel">
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
