import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        roleLabel: ROLE_LABELS[(session.user.role as Role) in ROLE_LABELS ? (session.user.role as Role) : "viewer"],
        organizationName: session.user.organizationName,
      }}
    >
      {children}
    </AppShell>
  );
}
