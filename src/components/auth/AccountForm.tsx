"use client";

import { SignIn, SignUp, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Public account screens never call the business API or the session exchange. */
export function AccountForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const { isLoaded } = useAuth();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setUnavailable(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link href="/" className="eyebrow">
          GEOFOREST TRACE
        </Link>
        <h1>{mode === "sign-up" ? "Créer votre compte" : "Se connecter"}</h1>
        <p>
          {mode === "sign-up"
            ? "Créez votre identité de connexion avec Clerk. Les accès à vos organisations sont ensuite gérés dans GeoForest."
            : "Retrouvez votre espace de traçabilité et de diligence raisonnée."}
        </p>
        {!isLoaded ? (
          unavailable ? (
            <div role="alert">
              <h2>Connexion indisponible</h2>
              <p>
                Le service d’identité n’a pas pu être chargé. Vous pouvez
                réessayer ou revenir à l’accueil.
              </p>
              <button
                className="button primary"
                onClick={() => window.location.reload()}
              >
                Réessayer
              </button>
            </div>
          ) : (
            <p role="status">Chargement du formulaire sécurisé…</p>
          )
        ) : mode === "sign-up" ? (
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            forceRedirectUrl="/espace"
          />
        ) : (
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            forceRedirectUrl="/espace"
          />
        )}
        <p>
          {mode === "sign-up" ? "Déjà un compte ? " : "Pas encore de compte ? "}
          <Link href={mode === "sign-up" ? "/sign-in" : "/sign-up"}>
            {mode === "sign-up" ? "Se connecter" : "Créer un compte"}
          </Link>
        </p>
        <p className="muted">
          L’inscription ne vaut ni validation de votre organisation ni
          certification EUDR.
        </p>
        <Link href="/">← Retour à l’accueil</Link>
      </section>
    </main>
  );
}
