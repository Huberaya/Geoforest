import type { Metadata } from "next";
import Link from "next/link";
import { authProvider } from "@/auth-provider";
import { AccountForm } from "@/components/auth/AccountForm";

export const metadata: Metadata = {
  title: "Créer un compte — GeoForest Trace",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  if (authProvider() !== "clerk_development")
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <Link href="/" className="eyebrow">
            GEOFOREST TRACE
          </Link>
          <h1>Création de compte</h1>
          <p>
            L’inscription Clerk n’est pas activée dans cet environnement.
            Contactez votre administrateur pour obtenir un accès ; aucun compte
            n’a été créé.
          </p>
          <Link className="button primary" href="/sign-in">
            Se connecter
          </Link>
          <p>
            <Link href="/">← Retour à l’accueil</Link>
          </p>
        </section>
      </main>
    );
  return <AccountForm mode="sign-up" />;
}
