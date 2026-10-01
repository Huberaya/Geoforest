/**
 * Rôles et permissions.
 *
 * Le schéma existant (`gf_users.role`) déclare : admin, compliance_officer,
 * auditor, viewer. On y ajoute `supplier` pour le portail fournisseur.
 */

export const ROLES = ["admin", "compliance_officer", "auditor", "viewer", "supplier"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Rôles pour lesquels la double authentification est obligatoire. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["admin", "compliance_officer"];

export function mfaRequiredFor(role: string): boolean {
  return MFA_REQUIRED_ROLES.includes(role as Role);
}

export type Permission =
  | "org:manage"
  | "user:manage"
  | "supplier:read"
  | "supplier:write"
  | "product:read"
  | "product:write"
  | "shipment:read"
  | "shipment:write"
  | "plot:read"
  | "plot:write"
  | "document:read"
  | "document:write"
  | "analysis:read"
  | "analysis:run"
  | "risk:read"
  | "risk:write"
  | "dds:read"
  | "dds:write"
  | "dds:validate"
  | "declaration:submit"
  | "export:run"
  | "audit:read"
  | "settings:manage"
  | "supplier-portal:submit";

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    "org:manage",
    "user:manage",
    "supplier:read",
    "supplier:write",
    "product:read",
    "product:write",
    "shipment:read",
    "shipment:write",
    "plot:read",
    "plot:write",
    "document:read",
    "document:write",
    "analysis:read",
    "analysis:run",
    "risk:read",
    "risk:write",
    "dds:read",
    "dds:write",
    "dds:validate",
    "declaration:submit",
    "supplier-portal:submit",
    "export:run",
    "audit:read",
    "settings:manage",
    "supplier-portal:submit",
  ],
  compliance_officer: [
    "supplier:read",
    "supplier:write",
    "product:read",
    "product:write",
    "shipment:read",
    "shipment:write",
    "plot:read",
    "plot:write",
    "document:read",
    "document:write",
    "analysis:read",
    "analysis:run",
    "risk:read",
    "risk:write",
    "dds:read",
    "dds:write",
    "dds:validate",
    "declaration:submit",
    "supplier-portal:submit",
    "export:run",
    "audit:read",
  ],
  auditor: [
    "supplier:read",
    "product:read",
    "shipment:read",
    "plot:read",
    "document:read",
    "analysis:read",
    "analysis:run",
    "risk:read",
    "dds:read",
    "export:run",
    "audit:read",
  ],
  viewer: ["supplier:read", "product:read", "shipment:read", "plot:read", "document:read", "risk:read", "dds:read", "analysis:read"],
  supplier: ["supplier-portal:submit", "document:write", "plot:write"],
};

export function permissionsFor(role: string): readonly Permission[] {
  return PERMISSIONS[(role as Role) in PERMISSIONS ? (role as Role) : "viewer"] ?? PERMISSIONS.viewer;
}

export function can(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  compliance_officer: "Responsable conformité",
  auditor: "Auditeur",
  viewer: "Lecteur",
  supplier: "Fournisseur",
};
