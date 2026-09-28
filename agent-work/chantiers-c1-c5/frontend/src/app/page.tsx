"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const { isAuthed, loading, user } = useAuth();
  const dashboardHref = user?.role === "supplier" ? "/supplier-portal" : "/dashboard";
  const primaryHref = !loading && isAuthed ? dashboardHref : "/auth/login";
  const primaryLabel = !loading && isAuthed ? "Accéder à mon espace" : "Se connecter";

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(16,185,129,0.22),transparent_32%),radial-gradient(circle_at_15%_85%,rgba(20,184,166,0.16),transparent_34%)]" />

      <header className="relative z-10 flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l4 6h-3l3.5 5H13v4h-2v-4H7.5L11 9H8l4-6z" />
            </svg>
          </span>
          <span>
            <span className="block text-sm font-bold tracking-wide sm:text-base">GeoForest Trace</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-emerald-200/70">Conformité EUDR</span>
          </span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Accès au compte">
          {!isAuthed && (
            <Link
              href="/auth/register"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:inline-flex"
            >
              Créer une organisation
            </Link>
          )}
          <Link
            href={primaryHref}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
          >
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-6 py-16 sm:px-10 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16 lg:py-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            Traçabilité de la chaîne d’approvisionnement
          </div>
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            De la parcelle aux <span className="text-emerald-300">dossiers EUDR</span>, avec une chaîne de preuve claire.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Centralisez fournisseurs, lots, parcelles, documents et évaluations internes des risques dans un espace organisé pour votre équipe.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={primaryHref}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3 text-base font-bold text-slate-950 shadow-xl shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200"
            >
              {primaryLabel}
              <span className="ml-2" aria-hidden="true">→</span>
            </Link>
            {!isAuthed && (
              <Link
                href="/auth/register"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:hidden"
              >
                Créer une organisation
              </Link>
            )}
            <span className="text-xs text-slate-400">Accès réservé aux comptes autorisés.</span>
          </div>
        </div>

        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:mt-0">
          {[
            { number: "01", title: "Fournisseurs & produits", detail: "Structurez les acteurs, commodités et lots." },
            { number: "02", title: "Parcelles & origine", detail: "Rassemblez les données géographiques et leurs validations." },
            { number: "03", title: "Documents & preuves", detail: "Suivez les pièces, leur statut et leurs échéances." },
            { number: "04", title: "Revue interne", detail: "Consignez les constats, décisions et préparations internes." },
          ].map((item) => (
            <article key={item.number} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/10 backdrop-blur-sm">
              <div className="text-xs font-bold tracking-[0.2em] text-emerald-300">{item.number}</div>
              <h2 className="mt-4 text-base font-semibold text-white">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 px-6 py-4 text-center text-xs text-slate-500 sm:px-10">
        Outil de suivi interne — ne constitue ni une certification juridique ni un dépôt de déclaration EUDR.
      </footer>
    </main>
  );
}
