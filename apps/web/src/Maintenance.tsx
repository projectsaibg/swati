import { useEffect, useState } from 'react';
import { GeoQuery, MaintenanceSummary, WorkOrder, api } from './api';
import { useAuth } from './contexts';
import { GeoFilter } from './GeoFilter';

const prioPill = (p: string) => (p === 'CRITICAL' ? 'critical' : p === 'HIGH' ? 'alarm' : p === 'MEDIUM' ? 'watch' : 'ok');
const statusPill = (s: string) => (s === 'DONE' ? 'ok' : s === 'IN_PROGRESS' ? 'watch' : s === 'CANCELLED' ? 'critical' : 'alarm');
const statusLabel = (s: string) => (s === 'IN_PROGRESS' ? 'In progress' : s.charAt(0) + s.slice(1).toLowerCase());
const errMsg = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Request failed';
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
const isOverdue = (w: WorkOrder) => !!w.dueAt && w.status !== 'DONE' && w.status !== 'CANCELLED' && new Date(w.dueAt).getTime() < Date.now();

export function Maintenance() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null);
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [geo, setGeo] = useState<GeoQuery>({});
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'DONE'>('ALL');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [nw, setNw] = useState({ title: '', type: 'PREVENTIVE', priority: 'MEDIUM', assignee: '', dueAt: '' });

  const canManage = !!user?.permissions?.some((p) => p === 'data.enter' || p === '*');

  const load = () => Promise.all([api.maintenanceSummary(geo), api.maintenanceOrders(geo)])
    .then(([s, o]) => { setSummary(s); setRows(o); })
    .catch(() => setErr('Could not load work orders.'));
  useEffect(() => {
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  const advance = async (w: WorkOrder, to: string) => {
    setBusy(w.id); setErr('');
    try { await api.updateWorkOrder(w.id, { status: to }); await load(); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };

  const createWo = async () => {
    if (!nw.title.trim()) return;
    setBusy('new'); setErr('');
    try {
      await api.createWorkOrder({ ...nw, dueAt: nw.dueAt || undefined } as any);
      setNw({ title: '', type: 'PREVENTIVE', priority: 'MEDIUM', assignee: '', dueAt: '' });
      setShowNew(false);
      await load();
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  };

  const shown = status === 'ALL' ? rows : rows.filter((w) => w.status === status);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>MAINTENANCE</h1>
          <p className="exec-sub">Preventive &amp; corrective work orders · scheduling and status</p>
        </div>
        <div className="statuspills"><span className="spill live"><span className="livedot" /> LIVE</span></div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Geo filter */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <GeoFilter value={geo} onChange={setGeo} />
        <span className="muted">{rows.length} work order{rows.length === 1 ? '' : 's'} in scope</span>
        {canManage && <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setShowNew((v) => !v)}>{showNew ? 'Cancel' : '+ New work order'}</button>}
      </div>

      {canManage && showNew && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="rowform">
            <label className="field" style={{ marginBottom: 0, minWidth: 240, flex: 1 }}>Title
              <input value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} placeholder="e.g. Replace bearing on PH012 pump" />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>Type
              <select value={nw.type} onChange={(e) => setNw({ ...nw, type: e.target.value })}>
                <option value="PREVENTIVE">Preventive</option>
                <option value="CORRECTIVE">Corrective</option>
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>Priority
              <select value={nw.priority} onChange={(e) => setNw({ ...nw, priority: e.target.value })}>
                <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option>
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>Assignee
              <input value={nw.assignee} onChange={(e) => setNw({ ...nw, assignee: e.target.value })} placeholder="name" />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>Due
              <input type="date" value={nw.dueAt} onChange={(e) => setNw({ ...nw, dueAt: e.target.value })} />
            </label>
            <button className="btn sm" disabled={busy === 'new' || !nw.title.trim()} onClick={createWo}>{busy === 'new' ? 'Creating…' : 'Create'}</button>
          </div>
        </div>
      )}

      {/* KPI hero */}
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{summary?.open ?? '—'}</div><div className="lbl">Open</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--watch)' }}>{summary?.inProgress ?? '—'}</div><div className="lbl">In progress</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--critical)' }}>{summary?.overdue ?? '—'}</div><div className="lbl">Overdue</div></div>
        <div className="kpi"><div className="val tnum">{summary?.highPriority ?? '—'}</div><div className="lbl">High priority</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{summary?.done ?? '—'}</div><div className="lbl">Completed</div></div>
        <div className="kpi"><div className="val tnum">{summary ? `${summary.corrective}/${summary.preventive}` : '—'}</div><div className="lbl">Corrective / preventive</div></div>
      </section>

      {/* Status chips */}
      <div className="vchips">
        {(['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const).map((f) => (
          <button key={f} className={`vchip ${status === f ? 'active' : ''}`} onClick={() => setStatus(f)}>{f === 'ALL' ? 'All' : statusLabel(f)}</button>
        ))}
      </div>

      {!canManage && <p className="muted">You can view work orders; creating or advancing them requires the <code>data.enter</code> permission.</p>}

      {/* Work order table */}
      <div className="panel">
        <table className="tbl">
          <thead>
            <tr><th>Code</th><th>Title</th><th>Type</th><th>Priority</th><th>Zone</th><th>Assignee</th><th>Due</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.id}>
                <td className="muted tnum">{w.code}</td>
                <td>{w.title}</td>
                <td><span className={`pill ${w.type === 'CORRECTIVE' ? 'alarm' : 'ok'}`}>{w.type === 'CORRECTIVE' ? 'Corrective' : 'Preventive'}</span></td>
                <td><span className={`pill ${prioPill(w.priority)}`}>{w.priority.charAt(0) + w.priority.slice(1).toLowerCase()}</span></td>
                <td className="muted">{[w.district, w.block, w.zone].filter(Boolean).join(' · ') || '—'}</td>
                <td>{w.assignee ?? '—'}</td>
                <td className={isOverdue(w) ? '' : 'muted'} style={isOverdue(w) ? { color: 'var(--critical)', fontWeight: 700 } : undefined}>{fmtDate(w.dueAt)}{isOverdue(w) ? ' !' : ''}</td>
                <td><span className={`pill ${statusPill(w.status)}`}>{statusLabel(w.status)}</span></td>
                <td>
                  {canManage && w.status === 'OPEN' && <button className="btn sm" disabled={busy === w.id} onClick={() => advance(w, 'IN_PROGRESS')}>Start</button>}
                  {canManage && w.status === 'IN_PROGRESS' && <button className="btn sm" disabled={busy === w.id} onClick={() => advance(w, 'DONE')}>Complete</button>}
                  {canManage && w.status === 'DONE' && <span className="pill ok">Done</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">No work orders in this scope.</p>}
      </div>
    </div>
  );
}
