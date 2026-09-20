import { ReactNode, useState } from 'react';
import { NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth, useFeatures } from './contexts';
import { GROUP_ORDER, NAV } from './registry';

function canSeeAdmin(perms?: string[]) {
  return !!perms && (perms.includes('*') || perms.includes('features.manage'));
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { isEnabled, visibility } = useFeatures();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  // A nav item shows if the feature is enabled AND (public OR the user is logged in).
  const visibleItems = NAV.filter(
    (i) => isEnabled(i.key) && (visibility(i.key) === 'PUBLIC' || !!user),
  );

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">SWATI <small>Ops</small></div>
        {GROUP_ORDER.map((group) => {
          const items = visibleItems.filter((i) => i.group === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <div className="navgroup">{group}</div>
              {items.map((i) => (
                <NavLink
                  key={i.key}
                  to={i.path}
                  end={i.path === '/'}
                  className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  {i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
        {canSeeAdmin(user?.permissions) && (
          <div>
            <div className="navgroup">Admin</div>
            <NavLink to="/admin" className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
              Admin panel
            </NavLink>
          </div>
        )}
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn ghost" onClick={() => setOpen((v) => !v)}>Menu</button>
            {loc.pathname !== '/' && (
              <NavLink className="btn ghost" to="/">&larr; Overview</NavLink>
            )}
          </div>
          <div className="right">
            {user ? (
              <>
                <span>{user.name}{user.roleName ? ` · ${user.roleName}` : ''}</span>
                <button className="btn ghost" onClick={() => logout()}>Sign out</button>
              </>
            ) : (
              <NavLink className="btn" to="/login">Sign in</NavLink>
            )}
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="content muted">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="content muted">Loading…</div>;
  if (!user || !canSeeAdmin(user.permissions)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
