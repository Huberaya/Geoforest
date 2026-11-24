import DashboardClient from "@/components/dashboard/DashboardClient";
import PublicLandingPage from "@/components/landing/PublicLandingPage";
import AppShell from "@/components/layout/AppShell";
import { mfaRequiredFor, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

/**
 * Page d'entrée `/`.
 *
 * - Sans session valide (ou MFA requise non complétée) : affiche la vitrine
 *   publique produit sans aucune requête métier ni exposition de données tenant.
 * - Avec session valide : affiche le cockpit applicatif complet dans `AppShell`,
 *   en conservant `/` comme tableau de bord principal pour la navigation et
 *   les redirections post-connexion.
 */
export default async function HomePage() {
  const session = await getSession();

  if (!session || (mfaRequiredFor(session.user.role) && !session.user.mfa)) {
    return <PublicLandingPage />;
  }

  const roleKey =
    (session.user.role as Role) in ROLE_LABELS ? (session.user.role as Role) : "viewer";

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        roleLabel: ROLE_LABELS[roleKey],
        organizationName: session.user.organizationName,
      }}
    >
      <DashboardClient />
    </AppShell>
  );
}
