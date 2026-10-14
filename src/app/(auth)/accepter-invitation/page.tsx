"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Activation d'un compte fournisseur (chantier 6). Page publique.
 *
 * Le jeton vient du fragment de l'URL (`#jeton=…`) : le navigateur ne l'envoie jamais
 * au serveur dans la requête de page, et il n'apparaît ni dans les journaux d'accès ni
 * dans le référent. Il est effacé de la barre d'adresse dès la lecture.
 */
export default function AccepterInvitationPage() {
  const [jeton, setJeton] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, "");
    const valeur = new URLSearchParams(fragment).get("jeton");
    setJeton(valeur && /^[A-Za-z0-9_-]{43}$/.test(valeur) ? valeur : "");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/invitation/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: jeton, password }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail ?? data?.error?.message ?? "Activation impossible.");
      }
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activation impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-2xl">
            🌳
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">GeoForest Trace</h1>
          <p className="mt-1 text-sm text-slate-400">Activation de votre compte fournisseur</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          {active ? (
            <div className="space-y-4">
              <p role="status" className="text-sm text-emerald-200">
                Votre compte est activé. Vous pouvez maintenant vous connecter.
              </p>
              <Link
                href="/login"
                className="block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                Se connecter
              </Link>
            </div>
          ) : jeton === null ? (
            <p className="text-sm text-slate-400">Vérification du lien…</p>
          ) : jeton === "" ? (
            <p role="alert" className="text-sm text-rose-200">
              Ce lien d&apos;invitation est incomplet. Demandez à votre donneur d&apos;ordre un nouveau lien.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-300">
                  Choisissez un mot de passe
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label htmlFor="confirmation" className="mb-1 block text-xs font-medium text-slate-300">
                  Confirmez le mot de passe
                </label>
                <input
                  id="confirmation"
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? "Activation…" : "Activer mon compte"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
