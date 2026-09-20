import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, setAccessToken, http, Me, PublicFeature } from './api';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to restore a session via the refresh cookie.
    (async () => {
      try {
        const r = await http.post('/auth/refresh');
        setAccessToken(r.data.accessToken);
        setUser(await api.me());
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    setAccessToken(res.accessToken);
    setUser(res.user);
  };
  const logout = async () => {
    await api.logout();
    setAccessToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------
interface FeaturesCtx {
  features: PublicFeature[];
  isEnabled: (key: string) => boolean;
  visibility: (key: string) => 'PUBLIC' | 'LOGIN' | null;
  tierOf: (key: string) => string | null;
  reload: () => Promise<void>;
  loading: boolean;
}
const FeaturesContext = createContext<FeaturesCtx>(null as any);
export const useFeatures = () => useContext(FeaturesContext);

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<PublicFeature[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      setFeatures(await api.publicFeatures());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  const map = new Map(features.map((f) => [f.key, f.visibility]));
  const tierMap = new Map(features.map((f) => [f.key, f.tier ?? null]));
  return (
    <FeaturesContext.Provider
      value={{
        features,
        loading,
        reload,
        isEnabled: (k) => map.has(k),
        visibility: (k) => map.get(k) ?? null,
        tierOf: (k) => tierMap.get(k) ?? null,
      }}
    >
      {children}
    </FeaturesContext.Provider>
  );
}
