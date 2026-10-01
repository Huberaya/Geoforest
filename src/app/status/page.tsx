import Link from "next/link";

import { sonderTout, type Composant } from "@/lib/alerting/regles";
import { lireAlertes, transportsDisponibles } from "@/lib/alerting/transports";

export const dynamic = "force-dynamic";

/**
 * Page de statut.
 *
 * ⚠️ P1-06 — ce qui est montré, et ce qui ne l'est pas.
 *
 * Une page de statut sert à répondre à une question simple : « le service
 * marche-t-il ? ». Elle est donc **publique** — la fermer obligerait un client
 * à se connecter pour savoir si la panne vient de chez lui, ce qui est absurde
 * en plein incident.
 *
 * Mais publique ne veut pas dire détaillée. Sont donc volontairement absents :
 * les chemins de disque, les noms de fichiers de sauvegarde, les identifiants
 * de composants, les valeurs chiffrées. Un état global, une date, un titre
 * d'incident : c'est tout ce dont un client a besoin, et rien de ce qui aiderait
 * quelqu'un d'autre.
 */

const LIBELLES: Record<Composant["nom"], string> = {
  base: "Base de données",
  stockage: "Stockage des pièces",
  disque: "Espace disque",
  sauvegarde: "Sauvegardes",
  gfw: "Analyse satellite",
  api: "API",
};

const COULEURS: Record<Composant["etat"], { fond: string; texte: string; libelle: string }> = {
  ok: { fond: "bg-emerald-50 border-emerald-200", texte: "text-emerald-800", libelle: "Opérationnel" },
  degrade: { fond: "bg-amber-50 border-amber-200", texte: "text-amber-800", libelle: "Dégradé" },
  indisponible: { fond: "bg-rose-50 border-rose-200", texte: "text-rose-800", libelle: "Indisponible" },
  non_configure: { fond: "bg-slate-50 border-slate-200", texte: "text-slate-600", libelle: "Non configuré" },
};

export default async function StatusPage() {
  const composants = await sonderTout();
  const alertes = lireAlertes(50).filter((a) => a.etat === "déclenchée").slice(0, 10);
  const transports = transportsDisponibles();

  const critique = composants.some(
    (c) => (c.nom === "base" || c.nom === "stockage") && c.etat === "indisponible",
  );
  const degrade = composants.some((c) => c.etat === "degrade" || c.etat === "non_configure");
  const global = critique ? "indisponible" : degrade ? "degrade" : "ok";
  const couleur = COULEURS[global];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-slate-800">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">État du service</h1>
        <p className="mt-1 text-sm text-slate-500">
          GeoForest Trace — mesures relevées à l&apos;instant, sans mise en cache.
        </p>
      </div>

      <div className={`mb-8 rounded-xl border px-5 py-4 ${couleur.fond}`}>
        <div className={`text-sm font-semibold ${couleur.texte}`}>
          {global === "ok"
            ? "Tous les composants sont opérationnels."
            : global === "degrade"
              ? "Le service fonctionne, mais un composant demande attention."
              : "Le service est interrompu : un composant critique est indisponible."}
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Composants
        </h2>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {composants.map((c) => {
            const k = COULEURS[c.etat];
            return (
              <li key={c.nom} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium text-slate-700">
                  {LIBELLES[c.nom] ?? c.nom}
                </span>
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${k.fond} ${k.texte}`}>
                  {k.libelle}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Derniers incidents
        </h2>
        {alertes.length === 0 ? (
          <p className="rounded-xl border border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            Aucun incident enregistré.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {alertes.map((a) => (
              <li key={`${a.code}-${a.ts}`} className="px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-slate-700">{a.titre}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {new Date(a.ts).toLocaleString("fr-FR")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{a.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
        <p>
          ⚠️ <strong>Ce que cette page ne dit pas.</strong> Elle est publique : elle montre un état
          global, et non les valeurs qui l&apos;expliquent (chemins, volumes, identifiants). Le
          détail est réservé aux comptes authentifiés et aux outils de supervision.
        </p>
        <p className="mt-2">
          {transports
            .filter((t) => !t.valide)
            .map((t) => `${t.nom} (${t.variable})`)
            .join(" · ")}{" "}
          sont <strong>écrits mais jamais validés</strong> sur une instance réelle : ils ne sont pas
          employés pour envoyer les alertes.
        </p>
      </section>

      <p className="text-xs text-slate-400">
        <Link href="/login" className="underline">
          Se connecter
        </Link>{" "}
        · Page mise à jour à chaque affichage.
      </p>
    </main>
  );
}
