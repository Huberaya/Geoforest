import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authProvider } from "@/auth-provider";

export default function SignInPage() {
  if (authProvider() !== "clerk_development") redirect("/api/auth/login");
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link href="/" className="eyebrow">
          GEOFOREST TRACE
        </Link>
        <h1>Votre espace sécurisé</h1>
        <p>
          Connectez-vous avec votre compte Clerk de développement. Vos
          permissions sont gérées dans GeoForest.
        </p>
        <SignIn routing="path" path="/sign-in" forceRedirectUrl="/" />
        <p className="muted">
          Recette locale uniquement. Aucune déclaration officielle EUDR.
        </p>
      </section>
    </main>
  );
}
