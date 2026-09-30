"use client";

import { useAuth, DEMO_USERS } from "@/context/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("marie.dupont@entreprise-sa.fr");
  const [password, setPassword] = useState("••••••••••••");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login(email, password);
      router.push("/");
    } catch {
      setError("Identifiants incorrects ou compte inactif.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (demoEmail: string) => {
    setLoading(true);
    setEmail(demoEmail);
    await login(demoEmail);
    router.push("/");
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-[#0D5B41]/10 via-slate-50 to-emerald-50 items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D5B41] text-white text-3xl shadow-md">
            🌿
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">GeoForest Trace</h1>
          <p className="text-xs font-semibold text-[#0D5B41] uppercase tracking-wider">
            Cockpit de Diligence Raisonnée EUDR (UE 2023/1115)
          </p>
        </div>

        {/* Main Card */}
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-lg space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900">Connexion à votre espace</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Accédez à la traçabilité parcellaire et aux déclarations TRACES-NT
            </p>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-semibold">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Email professionnel *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nom@entreprise.com"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:border-[#0D5B41] focus:ring-1 focus:ring-[#0D5B41] focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold text-slate-700">Mot de passe *</label>
                <Link
                  href="/forgot-password"
                  className="text-[11px] font-semibold text-[#0D5B41] hover:underline"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Votre mot de passe"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:border-[#0D5B41] focus:ring-1 focus:ring-[#0D5B41] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                <input type="checkbox" defaultChecked className="rounded border-slate-300 accent-[#0D5B41]" />
                <span>Rester connecté (30 jours)</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-[#0D5B41] py-3 text-xs font-bold text-white shadow-md hover:bg-[#0a4833] transition-all disabled:opacity-50"
            >
              {loading ? "Vérification..." : "Se connecter ➔"}
            </button>
          </form>

          {/* 1-Click Quick Demo Switcher */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center">
              Accès Démo 1-Clic par Profil
            </span>

            <div className="grid grid-cols-1 gap-2 text-left">
              <button
                type="button"
                onClick={() => handleQuickLogin("marie.dupont@entreprise-sa.fr")}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-xs hover:bg-emerald-50/70 hover:border-emerald-300 transition flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900">🌿 Marie Dupont (Opérateur UE)</div>
                  <div className="text-[10px] text-slate-500">Entreprise SA • Lead EUDR</div>
                </div>
                <span className="text-emerald-700 font-bold text-xs">Entrer →</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin("mamadou.traore@coopadi.ci")}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-xs hover:bg-emerald-50/70 hover:border-emerald-300 transition flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900">🌾 Mamadou Traoré (Fournisseur)</div>
                  <div className="text-[10px] text-slate-500">Coopérative COOPADI • Côte d'Ivoire</div>
                </div>
                <span className="text-emerald-700 font-bold text-xs">Entrer →</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin("thomas.laurent@audit-tiers.eu")}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-xs hover:bg-emerald-50/70 hover:border-emerald-300 transition flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900">🔍 Thomas Laurent (Auditeur Tiers)</div>
                  <div className="text-[10px] text-slate-500">Bureau Veritas Certification</div>
                </div>
                <span className="text-emerald-700 font-bold text-xs">Entrer →</span>
              </button>
            </div>
          </div>

          {/* SSO Options */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleQuickLogin("marie.dupont@entreprise-sa.fr")}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
              >
                <span>🔑</span>
                <span>EU Login TRACES</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin("marie.dupont@entreprise-sa.fr")}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
              >
                <span>🏢</span>
                <span>SSO Microsoft / Google</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Link */}
        <div className="text-center text-xs text-slate-500">
          Pas encore de compte opérateur ?{" "}
          <Link href="/register" className="font-bold text-[#0D5B41] hover:underline">
            Créer un compte entreprise gratuitement
          </Link>
        </div>
      </div>
    </div>
  );
}
