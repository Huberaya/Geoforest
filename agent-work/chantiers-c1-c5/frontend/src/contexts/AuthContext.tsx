"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type OrganizationMe,
  type UserMe,
  apiFetch,
  fetchMe,
  fetchMyOrganization,
  getStoredUser,
  logout as clearAuth,
} from "@/lib/api";

interface AuthState {
  user: UserMe | null;
  organization: OrganizationMe | null;
  loading: boolean;
  isAuthed: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  setUser: (u: UserMe | null) => void;
  isAdmin: boolean;
  canManageUsers: boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserMe | null>(null);
  const [organization, setOrganization] = useState<OrganizationMe | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const accessToken = typeof window !== "undefined" ? window.localStorage.getItem("gft_access_token") : null;
    if (!accessToken) {
      setUserState(null);
      setOrganization(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const me = await fetchMe();
      setUserState(me);
      try {
        const org = await fetchMyOrganization();
        setOrganization(org);
      } catch {
        setOrganization(null);
      }
    } catch {
      setUserState(null);
      setOrganization(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUserState(stored);
    }
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    clearAuth();
    setUserState(null);
    setOrganization(null);
    window.location.href = "/auth/login";
  }, []);

  const setUser = useCallback((u: UserMe | null) => {
    setUserState(u);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      organization,
      loading,
      isAuthed: !!user,
      isAdmin: user?.role === "admin",
      canManageUsers: !!user && ["admin", "compliance"].includes(user.role),
      refresh,
      logout,
      setUser,
    }),
    [user, organization, loading, refresh, logout, setUser],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur d'AuthProvider");
  return ctx;
}
