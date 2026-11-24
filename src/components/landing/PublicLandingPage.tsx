import Link from "next/link";

const MODULES = [
  {
    titre: "Tableau de bord & audit parcellaire",
    badge: "Contrôle géospatial",
    description:
      "Importez vos géométries GeoJSON pour exécuter un contrôle topologique, calculer la surface et suivre l'historique des analyses de votre organisation.",
    points: [
      "Validation de géométries GeoJSON et calcul de surface",
      "Synthèse des dossiers et activité récente par organisation",
      "Historique consultable de chaque audit parcellaire",
    ],
  },
  {
    titre: "Parcelles & cartographie multi-polygones",
    badge: "Cartographie Leaflet",
    description:
      "Visualisez l'ensemble de vos parcelles sur fond cartographique, détectez les chevauchements entre polygones et vérifiez la cohérence pays.",
    points: [
      "Vue carte interactive et fiches détaillées par parcelle",
      "Contrôle topologique et détection des chevauchements",
      "Vérification des frontières pays et attributs EUDR",
    ],
  },
  {
    titre: "Fournisseurs & portail d'invitation",
    badge: "Collecte sécurisée",
    description:
      "Référencez vos fournisseurs et invitez-les à activer un compte cloisonné sur leur périmètre afin de transmettre parcelles et justificatifs.",
    points: [
      "Invitation par jeton à durée limitée (empreinte SHA-256)",
      "Portail fournisseur strictement restreint au producteur lié",
      "Suivi des documents déposés et statut de vérification",
    ],
  },
  {
    titre: "Produits, lots & expéditions",
    badge: "Chaîne de traçabilité",
    description:
      "Reliez matières premières concernées par le RDUE, lots commerciaux, expéditions et parcelles d'origine dans un modèle structuré.",
    points: [
      "Catalogue produits et références réglementaires",
      "Association des lots et expéditions aux parcelles",
      "Traçabilité consolidée avant constitution du dossier",
    ],
  },
  {
    titre: "Diligence raisonnée & déclarations",
    badge: "RDUE (UE) 2023/1115",
    description:
      "Pilotez le cycle de vie de vos dossiers de diligence raisonnée (DDS), assemblez le pack de preuves et générez des exports brouillons structurés.",
    points: [
      "Machine d'états contrôlée du brouillon jusqu'au dossier prêt",
      "Export brouillon GeoJSON / XML structuré pour préparation TRACES-NT",
      "Pack de preuves horodaté et vérifiable",
    ],
  },
  {
    titre: "Risques, alertes, documents & audit",
    badge: "Gouvernance",
    description:
      "Centralisez pièces justificatives, évaluation des risques, alertes opérationnelles, rapports et journal d'audit chaîné.",
    points: [
      "Gestion documentaire avec contrôle de type réel et signature",
      "Journal d'audit immuable et chaîné par organisation",
      "Rapports de synthèse et supervision de disponibilité",
    ],
  },
] as const;

const PARCOURS_PRODUIT = [
  {
    etape: "01",
    titre: "Collecter",
    detail: "Fournisseurs, parcelles GeoJSON, lots et pièces justificatives dans un espace cloisonné.",
  },
  {
    etape: "02",
    titre: "Vérifier",
    detail: "Contrôles topologiques, chevauchements, pays, alertes et analyse de risque parcellaire.",
  },
  {
    etape: "03",
    titre: "Documenter",
    detail: "Constitution du dossier de diligence raisonnée, pack de preuves et exports brouillons.",
  },
  {
    etape: "04",
    titre: "Prouver",
    detail: "Journal d'audit chaîné, isolation multi-tenant RLS et traçabilité prête pour contrôle.",
  },
] as const;

const GARANTIES_SECURITE = [
  {
    titre: "Isolation multi-tenant PostgreSQL RLS",
    detail:
      "Politiques Row Level Security forcées sur les tables métier avec rôle applicatif non privilégié (sans BYPASSRLS ni droit destructif).",
  },
  {
    titre: "Accès deny-by-default & MFA TOTP",
    detail:
      "Toutes les données métier exigent une session authentifiée ; la double authentification TOTP est obligatoire pour les rôles d'administration et de conformité.",
  },
  {
    titre: "Défense en profondeur web",
    detail:
      "Politique Content-Security-Policy bloquante par nonce cryptographique, X-Frame-Options: DENY et limitation de cadence anti-force brute.",
  },
  {
    titre: "Gouvernance RGPD intégrée",
    detail:
      "Droit à l'effacement (Art. 17) encadré avec conservation légale des traces d'audit et purge mensuelle automatisée des traces techniques.",
  },
] as const;

const APERCU_MODULES_NAVIGATION = [
  "Tableau de bord",
  "Fournisseurs",
  "Produits",
  "Lots / Expéditions",
  "Parcelles",
  "Analyses",
  "Documents",
  "Risques",
  "Diligence raisonnée",
  "Déclarations TRACES",
  "Alertes",
  "Rapports",
  "Audit Log",
  "Paramètres",
] as const;

export default function PublicLandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Barre de navigation publique */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-lg shadow-sm"
            >
              🌲
            </span>
            <div>
              <p className="text-base font-bold tracking-tight text-white">GeoForest Trace</p>
              <p className="text-xs text-slate-400">Règlement (UE) 2023/1115 — RDUE</p>
            </div>
          </Link>

          <nav aria-label="Navigation principale" className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#modules" className="transition-colors hover:text-white">
              Modules
            </a>
            <a href="#parcours" className="transition-colors hover:text-white">
              Parcours RDUE
            </a>
            <a href="#securite" className="transition-colors hover:text-white">
              Sécurité &amp; RGPD
            </a>
            <Link href="/status" className="transition-colors hover:text-white">
              État du service
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b border-slate-800/80 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/70">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:items-center lg:py-24">
            <div className="space-y-6 lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-800/80 bg-emerald-950/60 px-3 py-1 text-xs font-medium text-emerald-300">
                <span>Conformité EUDR · Règlement (UE) 2023/1115</span>
              </div>

              <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
                Le cockpit de diligence raisonnée et de traçabilité parcellaire.
              </h1>

              <p className="max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                GeoForest Trace rassemble dans un espace multi-tenant sécurisé vos fournisseurs,
                parcelles géolocalisées, contrôles topologiques, pièces justificatives et dossiers
                de diligence raisonnée.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  href="/login"
                  className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                >
                  Accéder à l&apos;application
                </Link>
                <a
                  href="#modules"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Découvrir les 14 modules
                </a>
              </div>

              <p className="text-xs text-slate-400">
                Accès applicatif réservé aux comptes habilités · Aucune donnée client n&apos;est
                exposée sur cette page publique.
              </p>
            </div>

            {/* Aperçu structuré de l'espace applicatif (aucune donnée réelle) */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl">
                <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                      Aperçu de l&apos;espace produit
                    </p>
                    <p className="text-sm font-semibold text-white">Cockpit GeoForest Trace</p>
                  </div>
                  <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300">
                    Accès authentifié
                  </span>
                </div>

                <p className="mb-3 text-xs text-slate-400">
                  Navigation disponible après connexion selon votre rôle (administrateur, conformité,
                  auditeur, lecteur ou fournisseur) :
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {APERCU_MODULES_NAVIGATION.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-lg border border-slate-800/90 bg-slate-950/80 px-3 py-2 text-xs text-slate-200"
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                      />
                      <span className="truncate">{item}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-3.5 py-2.5 text-xs">
                  <span className="text-emerald-200">Déjà un compte habilité ?</span>
                  <Link href="/login" className="font-semibold text-emerald-400 hover:text-emerald-300">
                    Ouvrir ma session →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Parcours en 4 temps */}
        <section id="parcours" className="border-b border-slate-800/80 bg-slate-950 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Chaîne de diligence raisonnée
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                De la parcelle géo-référencée au dossier auditable
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PARCOURS_PRODUIT.map((item) => (
                <div
                  key={item.etape}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-5"
                >
                  <span className="font-mono text-xs font-semibold text-emerald-400">
                    ÉTAPE {item.etape}
                  </span>
                  <h3 className="mt-2 text-base font-semibold text-white">{item.titre}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modules du produit */}
        <section id="modules" className="border-b border-slate-800/80 bg-slate-900/40 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Fonctionnalités intégrées
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                Tout le produit réuni dans un seul cockpit
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Chaque module est accessible immédiatement après connexion via la barre latérale.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((mod) => (
                <article
                  key={mod.titre}
                  className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/80 p-6"
                >
                  <span className="w-fit rounded-md border border-emerald-900/80 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                    {mod.badge}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold text-white">{mod.titre}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{mod.description}</p>
                  <ul className="mt-4 space-y-2 border-t border-slate-800/80 pt-4 text-xs text-slate-300">
                    {mod.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-0.5 text-emerald-400">
                          ✓
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Sécurité & RGPD */}
        <section id="securite" className="border-b border-slate-800/80 bg-slate-950 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Architecture de confiance
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                Sécurité multi-tenant et conformité RGPD par construction
              </h2>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {GARANTIES_SECURITE.map((g) => (
                <div
                  key={g.titre}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-6"
                >
                  <h3 className="text-base font-semibold text-white">{g.titre}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{g.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Bandeau d'appel à l'action */}
        <section className="bg-slate-900/60 py-14">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 sm:px-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-bold text-white sm:text-2xl">
                Prêt à ouvrir votre espace GeoForest Trace ?
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Connectez-vous avec votre compte professionnel ou consultez l&apos;état de la plateforme.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Se connecter
              </Link>
              <Link
                href="/status"
                className="rounded-lg border border-slate-700 bg-slate-950 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                État du service
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 bg-slate-950 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:px-6">
          <p>GeoForest Trace — Plateforme de diligence raisonnée Règlement (UE) 2023/1115.</p>
          <div className="flex items-center gap-5">
            <Link href="/status" className="hover:text-slate-200">
              Statut
            </Link>
            <Link href="/login" className="hover:text-slate-200">
              Connexion
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
