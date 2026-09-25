"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { login } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

function LoginForm() {
  const router = useRouter();
  const { refresh, isAuthed, user } = useAuth();
  const [email, setEmail] = useState("demo@geoforest-trace.com");
  const [password, setPassword] = useState("DemoPassword2026!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthed) router.replace(user?.role === "supplier" ? "/supplier-portal" : "/dashboard");
  }, [isAuthed, user?.role, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l4 6h-3l3.5 5H13v4h-2v-4H7.5L11 9H8l4-6z" />
            </svg>
          </div>
          <div className="text-lg font-bold">GeoForest Trace</div>
        </div>
      </div>
      <h2 className="text-2xl font-bold text-slate-900">Connexion</h2>
      <p className="mt-1 text-sm text-slate-500">Accédez à votre espace de conformité EUDR.</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Mot de passe</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Connexion en cours…" : "Se connecter"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Pas encore de compte ?{" "}
        <Link href="/auth/register" className="font-semibold text-emerald-700 hover:underline">
          Créer une organisation
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
        <strong className="text-slate-700">Compte de démonstration :</strong>
        <br />
        demo@geoforest-trace.com / DemoPassword2026!
        <br />
        (créé automatiquement au démarrage)
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-700 p-12 text-white lg:block">
        <div className="flex h-full flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l4 6h-3l3.5 5H13v4h-2v-4H7.5L11 9H8l4-6z" />
                </svg>
              </div>
              <div className="text-xl font-bold">GeoForest Trace</div>
            </div>
            <h1 className="mt-16 max-w-md text-4xl font-bold leading-tight">
              La diligence raisonnée EUDR, de la parcelle à la déclaration.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-emerald-50">
              Collectez, vérifiez, analysez et documentez votre chaîne d'approvisionnement avec une
              plateforme qui transforme les données fournisseurs et géospatiales en dossiers de
              conformité exploitables.
            </p>
          </div>
          <div className="text-xs text-emerald-100/70">
            Règlement (UE) 2023/1115 · Application : 30 déc. 2026 (LME) · 30 juin 2027 (micro/PME)
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <LoginForm />
      </div>
    </div>
  );
}
