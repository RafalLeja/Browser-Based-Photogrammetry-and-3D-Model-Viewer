import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError, type User } from './api';

interface Auth {
  user: User | null;
  /** False until the first /auth/me answer, so pages do not flash the signed-out state. */
  ready: boolean;
  login: (login: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<Auth>({
  user: null,
  ready: false,
  login: () => Promise.reject(new Error('AuthProvider missing')),
  logout: () => Promise.resolve(),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((error: unknown) => {
        // 401 simply means "visitor"; anything else is logged but must not block browsing.
        if (!(error instanceof ApiError && error.status === 401)) console.warn('[auth]', error);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (name: string, password: string) => {
    const signedIn = await api.login(name, password);
    setUser(signedIn);
    return signedIn;
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Sends visitors to the login page and back here afterwards. */
export function RequireCurator({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="empty">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}
