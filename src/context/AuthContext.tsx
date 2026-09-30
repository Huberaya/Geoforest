"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type UserRole = "ADMIN_OPERATOR" | "COMPLIANCE_OFFICER" | "AUDITOR" | "VIEWER" | "SUPPLIER";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  jobTitle: string;
  organizationId: string;
  organizationName: string;
  organizationEori: string;
  avatar?: string;
  preferredLanguage: string;
  emailNotifications: boolean;
  satelliteAlerts: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  eori: string;
  country: string;
  address: string;
  vatNumber?: string;
  plan: "STARTER" | "PRO" | "ENTERPRISE";
  plotsUsed: number;
  plotsLimit: number;
  satelliteAuditsUsed: number;
  satelliteAuditsLimit: number;
  retentionYears: number;
  createdAt: string;
}

export const DEMO_ORGANIZATIONS: Organization[] = [
  {
    id: "org-001",
    name: "Entreprise SA",
    slug: "entreprise-sa",
    eori: "FR123456789",
    country: "FR",
    address: "12 rue de la Paix, 75002 Paris, France",
    vatNumber: "FR32123456789",
    plan: "ENTERPRISE",
    plotsUsed: 8742,
    plotsLimit: 25000,
    satelliteAuditsUsed: 4210,
    satelliteAuditsLimit: 10000,
    retentionYears: 5,
    createdAt: "2025-01-15T08:00:00Z",
  },
  {
    id: "org-002",
    name: "GeoForest Agrobusiness SAS",
    slug: "geoforest-agrobusiness",
    eori: "FR987654321",
    country: "FR",
    address: "44 Avenue des Forêts, 44000 Nantes, France",
    vatNumber: "FR88987654321",
    plan: "PRO",
    plotsUsed: 1420,
    plotsLimit: 5000,
    satelliteAuditsUsed: 850,
    satelliteAuditsLimit: 2000,
    retentionYears: 5,
    createdAt: "2025-04-10T10:30:00Z",
  },
  {
    id: "org-003",
    name: "Iberian Agro Trade SL",
    slug: "iberian-agro-trade",
    eori: "ESB12345678",
    country: "ES",
    address: "Paseo de la Castellana 100, 28046 Madrid, Espagne",
    vatNumber: "ESA12345678",
    plan: "PRO",
    plotsUsed: 3100,
    plotsLimit: 5000,
    satelliteAuditsUsed: 1950,
    satelliteAuditsLimit: 2000,
    retentionYears: 5,
    createdAt: "2025-06-20T14:15:00Z",
  },
];

export const DEMO_USERS: Record<string, User> = {
  "marie.dupont@entreprise-sa.fr": {
    id: "usr-001",
    name: "Marie Dupont",
    email: "marie.dupont@entreprise-sa.fr",
    role: "ADMIN_OPERATOR",
    jobTitle: "Lead EUDR & Responsable Conformité RSE",
    organizationId: "org-001",
    organizationName: "Entreprise SA",
    organizationEori: "FR123456789",
    avatar: "MD",
    preferredLanguage: "fr",
    emailNotifications: true,
    satelliteAlerts: true,
  },
  "mamadou.traore@coopadi.ci": {
    id: "usr-002",
    name: "Mamadou Traoré",
    email: "mamadou.traore@coopadi.ci",
    role: "SUPPLIER",
    jobTitle: "Directeur Général Coopérative COOPADI",
    organizationId: "org-001",
    organizationName: "Coopérative Cacaoyère de Divo (COOPADI)",
    organizationEori: "CI00987654321",
    avatar: "MT",
    preferredLanguage: "fr",
    emailNotifications: true,
    satelliteAlerts: false,
  },
  "thomas.laurent@audit-tiers.eu": {
    id: "usr-003",
    name: "Thomas Laurent",
    email: "thomas.laurent@audit-tiers.eu",
    role: "AUDITOR",
    jobTitle: "Auditeur Indépendant Tiers Agréé EUDR",
    organizationId: "org-001",
    organizationName: "Bureau Veritas Certification",
    organizationEori: "FR556677889",
    avatar: "TL",
    preferredLanguage: "fr",
    emailNotifications: true,
    satelliteAlerts: true,
  },
};

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  availableOrganizations: Organization[];
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<boolean>;
  register: (data: {
    name: string;
    email: string;
    password?: string;
    companyName: string;
    eori?: string;
    country: string;
    commodity?: string;
  }) => Promise<boolean>;
  logout: () => void;
  switchOrganization: (orgId: string) => void;
  updateUser: (updates: Partial<User>) => void;
  updateOrganization: (updates: Partial<Organization>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY_USER = "geoforest_auth_user";
const STORAGE_KEY_ORG = "geoforest_auth_org";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [availableOrganizations] = useState<Organization[]>(DEMO_ORGANIZATIONS);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize from LocalStorage or default demo user
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem(STORAGE_KEY_USER);
      const storedOrg = localStorage.getItem(STORAGE_KEY_ORG);

      if (storedUser) {
        setUser(JSON.parse(storedUser));
      } else {
        // Default connected user for smooth demonstration
        const defaultUser = DEMO_USERS["marie.dupont@entreprise-sa.fr"];
        setUser(defaultUser);
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(defaultUser));
      }

      if (storedOrg) {
        setOrganization(JSON.parse(storedOrg));
      } else {
        const defaultOrg = DEMO_ORGANIZATIONS[0];
        setOrganization(defaultOrg);
        localStorage.setItem(STORAGE_KEY_ORG, JSON.stringify(defaultOrg));
      }
    } catch {
      // Fallback
      setUser(DEMO_USERS["marie.dupont@entreprise-sa.fr"]);
      setOrganization(DEMO_ORGANIZATIONS[0]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string): Promise<boolean> => {
    const trimmed = email.trim().toLowerCase();
    const existing = DEMO_USERS[trimmed];

    const loggedUser: User = existing || {
      id: `usr-${Date.now()}`,
      name: email.split("@")[0].replace(".", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      email: trimmed,
      role: "ADMIN_OPERATOR",
      jobTitle: "Responsable Conformité EUDR",
      organizationId: organization?.id || "org-001",
      organizationName: organization?.name || "Entreprise SA",
      organizationEori: organization?.eori || "FR123456789",
      avatar: email.substring(0, 2).toUpperCase(),
      preferredLanguage: "fr",
      emailNotifications: true,
      satelliteAlerts: true,
    };

    setUser(loggedUser);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(loggedUser));
    return true;
  };

  const register = async (data: {
    name: string;
    email: string;
    companyName: string;
    eori?: string;
    country: string;
  }): Promise<boolean> => {
    const newOrg: Organization = {
      id: `org-${Date.now()}`,
      name: data.companyName,
      slug: data.companyName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      eori: data.eori || "FR000000000",
      country: data.country || "FR",
      address: "Siège social",
      plan: "PRO",
      plotsUsed: 0,
      plotsLimit: 5000,
      satelliteAuditsUsed: 0,
      satelliteAuditsLimit: 2000,
      retentionYears: 5,
      createdAt: new Date().toISOString(),
    };

    const newUser: User = {
      id: `usr-${Date.now()}`,
      name: data.name,
      email: data.email.trim().toLowerCase(),
      role: "ADMIN_OPERATOR",
      jobTitle: "Administrateur & Responsable EUDR",
      organizationId: newOrg.id,
      organizationName: newOrg.name,
      organizationEori: newOrg.eori,
      avatar: data.name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "OP",
      preferredLanguage: "fr",
      emailNotifications: true,
      satelliteAlerts: true,
    };

    setOrganization(newOrg);
    setUser(newUser);
    localStorage.setItem(STORAGE_KEY_ORG, JSON.stringify(newOrg));
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(newUser));
    return true;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY_USER);
  };

  const switchOrganization = (orgId: string) => {
    const target = availableOrganizations.find((o) => o.id === orgId);
    if (target) {
      setOrganization(target);
      localStorage.setItem(STORAGE_KEY_ORG, JSON.stringify(target));
      if (user) {
        const updated = {
          ...user,
          organizationId: target.id,
          organizationName: target.name,
          organizationEori: target.eori,
        };
        setUser(updated);
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updated));
      }
    }
  };

  const updateUser = (updates: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updated));
  };

  const updateOrganization = (updates: Partial<Organization>) => {
    if (!organization) return;
    const updated = { ...organization, ...updates };
    setOrganization(updated);
    localStorage.setItem(STORAGE_KEY_ORG, JSON.stringify(updated));
    if (user && (updates.name || updates.eori)) {
      const updatedUser = {
        ...user,
        organizationName: updates.name ?? user.organizationName,
        organizationEori: updates.eori ?? user.organizationEori,
      };
      setUser(updatedUser);
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(updatedUser));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        availableOrganizations,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        switchOrganization,
        updateUser,
        updateOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
