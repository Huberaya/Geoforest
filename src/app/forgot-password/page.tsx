"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSent(true);
    }, 800);
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-[#0D5B41]/10 via-slate-50 to-emerald-50 items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D5B41] text-white text-2xl shadow-md">
            🌿
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">GeoForest Trace</h1>
          <p className="text-xs font-semibold text-[#0D5B41] uppercase tracking-wider">
            Réinitialisation du mot de passe
          </p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-lg space-y-5">
          {sent ? (
            <div className="text-center space-y-4 py-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-[#0D5B41] text-2xl">
                ✉️
              </div>
              <h2 className="text-base font-bold text-slate-900">Email envoyé !</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Si un compte existe pour <strong>{email}</strong>, un lien sécurisé de réinitialisation vous a été transmis par email.
              </p>
              <div className="pt-2">
                <Link
                  href="/login"
                  className="inline-block rounded-xl bg-[#0D5B41] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833]"
                >
                  Retour à la connexion
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">Mot de passe oublié</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Indiquez votre adresse email professionnelle pour recevoir les instructions.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email professionnel *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nom@entreprise.com"
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#0D5B41] py-3 text-xs font-bold text-white shadow-md hover:bg-[#0a4833] disabled:opacity-50"
              >
                {loading ? "Envoi du lien..." : "Envoyer le lien de réinitialisation ➔"}
              </button>

              <div className="text-center pt-2">
                <Link href="/login" className="text-xs font-semibold text-slate-500 hover:text-slate-900">
                  ← Retour à la connexion
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
