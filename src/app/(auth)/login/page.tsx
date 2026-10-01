"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type Step = "credentials" | "mfa" | "setup";

interface SetupPayload {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  useEffect(() => {
    // Si une session est déjà active, on évite de réafficher le formulaire.
    void fetch("/api/v1/auth/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) router.replace(next);
      })
      .catch(() => undefined);
  }, [next, router]);

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, remember }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data?.error?.code === "account_locked") {
          setLockedUntil(data.error.message);
        }
        throw new Error(data?.error?.message ?? "Connexion impossible.");
      }

      if (data.status === "mfa_setup_required") {
        setSetup(data.setup);
        setStep("setup");
        setNotice(
          "La double authentification est obligatoire pour votre rôle. Enregistrez votre application d'authentification, puis saisissez le code à 6 chiffres.",
        );
        return;
      }

      if (data.status === "mfa_required") {
        setStep("mfa");
        setNotice("Saisissez le code à 6 chiffres de votre application d'authentification.");
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/v1/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code, remember }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "Code invalide.");
      }

      if (Array.isArray(data.recoveryCodes) && data.recoveryCodes.length > 0) {
        setRecoveryCodes(data.recoveryCodes);
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code invalide.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-2xl">
            🌲
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">GeoForest Trace</h1>
          <p className="mt-1 text-xs text-slate-400">
            Règlement (UE) 2023/1115 — Diligence raisonnée
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          {recoveryCodes ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-white">Codes de secours</h2>
              <p className="text-xs leading-relaxed text-slate-300">
                Conservez ces codes en lieu sûr. Chacun permet une connexion unique si vous perdez
                votre application d&apos;authentification. <strong>Ils ne seront plus affichés.</strong>
              </p>
              <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">
                {recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setRecoveryCodes(null);
                  router.replace(next);
                  router.refresh();
                }}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                J&apos;ai enregistré mes codes — continuer
              </button>
            </div>
          ) : step === "credentials" ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <h2 className="text-sm font-semibold text-white">Connexion</h2>

              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-300">
                  Adresse e-mail professionnelle
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  placeholder="prenom.nom@entreprise.fr"
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-300">
                  Mot de passe
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950"
                />
                Rester connecté sur cet appareil (30 jours)
              </label>

              {error && (
                <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
                  {error}
                </p>
              )}
              {lockedUntil && (
                <p role="alert" className="rounded-lg border border-amber-800 bg-amber-950/60 px-3 py-2 text-xs text-amber-200">
                  {lockedUntil}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? "Vérification…" : "Se connecter"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              <h2 className="text-sm font-semibold text-white">
                {step === "setup" ? "Activation de la double authentification" : "Double authentification"}
              </h2>

              {step === "setup" && setup && (
                <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-300">
                    1. Scannez ce QR code avec Google Authenticator, Authy, Microsoft Authenticator
                    ou FreeOTP.
                  </p>
                  <div
                    className="mx-auto w-40 [&>svg]:h-40 [&>svg]:w-40 [&>svg]:bg-white [&>svg]:p-2 [&>svg]:rounded-lg"
                    // QR généré côté serveur (SVG inline) — aucune ressource externe.
                    dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                  />
                  <p className="text-xs text-slate-300">
                    2. Si vous ne pouvez pas scanner, saisissez cette clé manuellement :
                  </p>
                  <code className="block break-all rounded bg-slate-900 px-2 py-1.5 text-[11px] text-emerald-300">
                    {setup.secret}
                  </code>
                </div>
              )}

              <div>
                <label htmlFor="code" className="mb-1 block text-xs font-medium text-slate-300">
                  Code à 6 chiffres
                </label>
                <input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9A-Fa-f]*"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  placeholder="000000"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Vous pouvez aussi utiliser un code de secours (10 caractères).
                </p>
              </div>

              {notice && (
                <p className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                  {notice}
                </p>
              )}
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
                {loading ? "Vérification…" : "Valider"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("credentials");
                  setSetup(null);
                  setCode("");
                  setError(null);
                  setNotice(null);
                }}
                className="w-full rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Recommencer
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
          Accès réservé aux utilisateurs habilités. Les tentatives de connexion sont journalisées.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginForm />
    </Suspense>
  );
}
