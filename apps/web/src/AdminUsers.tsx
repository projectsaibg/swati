import { useEffect, useState } from 'react';
import { AdminUser, Permission, Role, api } from './api';

/** Shows a generated password once, with a dismiss button. */
function PasswordFlash({ pw, onClose }: { pw: string; onClose: () => void }) {
  return (
    <div className="flash">
      <span>
        Generated password (shown once — copy it now): <code>{pw}</code>
      </span>
      <button className="btn ghost sm" onClick={onClose}>Dismiss</button>
    </div>
  );
}

function errMsg(e: any): string {
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

export function AdminUsersRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [flashPw, setFlashPw] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reload = async () => {
    const [r, u, p] = await Promise.all([api.roles(), api.users(), api.permissions()]);
    setRoles(r); setUsers(u); setPerms(p);
  };
  useEffect(() => { reload().catch((e) => setError(errMsg(e))); }, []);

  const guard = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <div>
      {error && <div className="err">{error}</div>}
      {flashPw && <PasswordFlash pw={flashPw} onClose={() => setFlashPw(null)} />}

      <UsersPanel
        users={users} roles={roles}
        onChange={setUsers}
        onFlash={setFlashPw}
        guard={guard}
        reload={reload}
      />
      <RolesPanel perms={perms} roles={roles} onChange={setRoles} guard={guard} reload={reload} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function UsersPanel({
  users, roles, onChange, onFlash, guard,
}: {
  users: AdminUser[]; roles: Role[];
  onChange: (u: AdminUser[]) => void;
  onFlash: (pw: string) => void;
  guard: (fn: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');

  const add = () =>
    guard(async () => {
      const res = await api.createUser({ email, name, roleId: roleId || roles[0]?.id });
      onChange(res.users);
      if (res.generatedPassword) onFlash(res.generatedPassword);
      setEmail(''); setName(''); setRoleId('');
    });

  const setRole = (id: string, rid: string) =>
    guard(async () => onChange(await api.updateUser(id, { roleId: rid })));
  const setManager = (id: string, mid: string) =>
    guard(async () => onChange(await api.updateUser(id, { managerId: mid || null })));
  const toggleStatus = (u: AdminUser) =>
    guard(async () => onChange(await api.updateUser(u.id, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })));
  const reset = (id: string) =>
    guard(async () => { const r = await api.resetUserPassword(id); onFlash(r.generatedPassword); });
  const remove = (u: AdminUser) =>
    guard(async () => {
      if (!confirm(`Delete user ${u.email}?`)) return;
      onChange(await api.deleteUser(u.id));
    });

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Users</h2>
      <p className="muted">Each user has a role and an optional manager override for the reporting line.</p>

      <table className="tbl">
        <thead>
          <tr><th>Email</th><th>Name</th><th>Role</th><th>Manager</th><th>Status</th><th>Last login</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>
                <select className="inline-input" style={{ width: 170 }} value={u.roleId} onChange={(e) => setRole(u.id, e.target.value)}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </td>
              <td>
                <select className="inline-input" style={{ width: 160 }} value={u.managerId ?? ''} onChange={(e) => setManager(u.id, e.target.value)}>
                  <option value="">(role default)</option>
                  {users.filter((o) => o.id !== u.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </td>
              <td>
                <button className={`pill ${u.status === 'ACTIVE' ? 'ok' : 'critical'}`} style={{ border: 0 }} onClick={() => toggleStatus(u)}>
                  {u.status}
                </button>
              </td>
              <td className="muted tnum">{u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn ghost sm" onClick={() => reset(u.id)}>Reset pw</button>{' '}
                <button className="btn danger sm" onClick={() => remove(u)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rowform" style={{ marginTop: 14 }}>
        <label className="field">Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@swati.local" /></label>
        <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label>
        <label className="field">Role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">{roles[0]?.name ?? '(none)'}</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button className="btn" onClick={add} disabled={!email || !name || roles.length === 0}>Add user</button>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>A random password is generated and shown once. The user can change it later.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
function RolesPanel({
  perms, roles, onChange, guard,
}: {
  perms: Permission[]; roles: Role[];
  onChange: (r: Role[]) => void;
  guard: (fn: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rank, setRank] = useState('50');

  const add = () =>
    guard(async () => {
      onChange(await api.createRole({ name, rank: parseInt(rank, 10) || 0, permissions: [] }));
      setName(''); setRank('50');
    });
  const setRank2 = (id: string, v: string) =>
    guard(async () => onChange(await api.updateRole(id, { rank: parseInt(v, 10) || 0 })));
  const setReportsTo = (id: string, rid: string) =>
    guard(async () => onChange(await api.updateRole(id, { reportsToId: rid || null })));
  const togglePerm = (role: Role, key: string) =>
    guard(async () => {
      const has = role.permissions.includes(key);
      const permissions = has ? role.permissions.filter((p) => p !== key) : [...role.permissions, key];
      onChange(await api.updateRole(role.id, { permissions }));
    });
  const remove = (r: Role) =>
    guard(async () => {
      if (!confirm(`Delete role ${r.name}?`)) return;
      onChange(await api.deleteRole(r.id));
    });

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Role ladder</h2>
      <p className="muted">Rank orders seniority; "reports to" sets the default chain of command. Permissions gate actions server-side.</p>

      <table className="tbl">
        <thead>
          <tr><th>Role</th><th>Rank</th><th>Reports to</th><th>Users</th><th>Permissions</th><th></th></tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td><input className="inline-input" defaultValue={r.rank} onBlur={(e) => setRank2(r.id, e.target.value)} /></td>
              <td>
                <select className="inline-input" style={{ width: 160 }} value={r.reportsToId ?? ''} onChange={(e) => setReportsTo(r.id, e.target.value)}>
                  <option value="">(top)</option>
                  {roles.filter((o) => o.id !== r.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </td>
              <td className="tnum">{r.userCount}</td>
              <td>
                {r.permissions.includes('*') ? <span className="pill ok">ALL</span> : <span className="muted">{r.permissions.length} set</span>}
                {' '}
                <button className="btn ghost sm" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                  {editing === r.id ? 'Close' : 'Edit'}
                </button>
              </td>
              <td><button className="btn danger sm" disabled={r.userCount > 0} onClick={() => remove(r)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (() => {
        const role = roles.find((r) => r.id === editing);
        if (!role) return null;
        return (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <strong>Permissions — {role.name}</strong>
            <div className="checkgrid">
              {perms.map((p) => (
                <label key={p.key}>
                  <input type="checkbox" checked={role.permissions.includes(p.key)} onChange={() => togglePerm(role, p.key)} />
                  {p.label} <span className="muted">({p.key})</span>
                </label>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="rowform" style={{ marginTop: 14 }}>
        <label className="field">New role<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zonal Manager" /></label>
        <label className="field">Rank<input value={rank} onChange={(e) => setRank(e.target.value)} className="inline-input" /></label>
        <button className="btn" onClick={add} disabled={!name}>Add role</button>
      </div>
    </div>
  );
}
