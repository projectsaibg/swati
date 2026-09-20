import { useEffect, useState } from 'react';
import { AlertRow, api } from './api';
import { useAuth } from './contexts';
import { Icon } from './icons';

function sevClass(s: string) {
  return s === 'CRITICAL' ? 'critical' : s === 'ALARM' ? 'alarm' : s === 'WATCH' ? 'watch' : 'ok';
}

export function ActionCenter() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const canAck = !!user?.permissions?.some((p) => p === 'alert.ack' || p === '*');

  const load = () => api.alerts('OPEN').then(setRows).catch(() => setErr('Could not load alerts.'));
  useEffect(() => { load(); }, []);

  const ack = async (id: string) => {
    setErr(''); setBusy(id);
    try {
      setRows(await api.ackAlert(id));
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Acknowledge failed.');
    } finally {
      setBusy(null);
    }
  };

  const counts = rows.reduce((a, r) => { a[r.severity] = (a[r.severity] ?? 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>ACTION CENTER</h1>
          <p className="exec-sub">{rows.length} open alert{rows.length === 1 ? '' : 's'} requiring attention</p>
        </div>
        <div className="statuspills">
          {(['CRITICAL', 'ALARM', 'WATCH', 'INFO'] as const).map((sv) => (
            <span key={sv} className={`pill ${sevClass(sv)}`}>{counts[sv] ?? 0} {sv}</span>
          ))}
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {!canAck && <p className="muted">You can view alerts; acknowledging requires the <code>alert.ack</code> permission.</p>}

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Icon name="shieldcheck" /> No open alerts. All clear.
          </p>
        ) : rows.map((r) => (
          <div className="alertrow" key={r.id}>
            <div className={`sevbar ${r.severity}`} />
            <div>
              <div className="alertmsg">{r.message}</div>
              <div className="alertmeta">
                {r.assetTag ? `${r.assetTag} · ${r.assetName ?? ''} · ` : ''}{r.category}
                {r.metric ? ` · ${r.metric}${r.valueNum != null ? ` = ${r.valueNum}` : ''}` : ''}
                {' · '}{new Date(r.createdAt).toLocaleString()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className={`pill ${sevClass(r.severity)}`}>{r.severity}</span>
              {canAck && (
                <button className="btn sm" disabled={busy === r.id} onClick={() => ack(r.id)}>
                  {busy === r.id ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
