"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { register } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh, isAuthed } = useAuth();
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    organization_name: "",
    eori: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthed) router.replace("/dashboard");
  }, [isAuthed, router]);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await register(form);
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l4 6h-3l3.5 5H13v4h-2v-4H7.5L11 9H8l4-6z" />
            </svg>
          </div>
          <div className="text-lg font-bold">GeoForest Trace</div>
        </div>
        <div className="card">
          <h1 className="text-2xl font-bold text-slate-900">Créer mon organisation</h1>
          <p className="mt-1 text-sm text-slate-500">
            Vous serez administrateur de votre espace EUDR.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="label">Nom de l'organisation *</label>
              <input
                className="input"
                required
                minLength={2}
                value={form.organization_name}
                onChange={(e) => update("organization_name", e.target.value)}
                placeholder="Ex : Café Import SAS"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Prénom</label>
                <input
                  className="input"
                  value={form.first_name}
                  onChange={(e) => update("first_name", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Nom</label>
                <input
                  className="input"
                  value={form.last_name}
                  onChange={(e) => update("last_name", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">Email professionnel *</label>
              <input
                className="input"
                type="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Mot de passe * (min. 10 caractères)</label>
              <input
                className="input"
                type="password"
                required
                minLength={10}
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Numéro EORI (optionnel)</label>
              <input
                className="input font-mono uppercase"
                value={form.eori}
                onChange={(e) => update("eori", e.target.value.toUpperCase())}
                placeholder="FR12345678901234"
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? "Création…" : "Créer mon organisation"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Déjà un compte ?{" "}
            <Link href="/auth/login" className="font-semibold text-emerald-700 hover:underline">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
