import { NextResponse } from "next/server";

import { sonderBase, sonderStockage } from "@/lib/alerting/regles";
import { journal } from "@/lib/observability/journal";

export const dynamic = "force-dynamic";

/**
 * Sonde d'**aptitude à recevoir du trafic** (readiness).
 *
 * ⚠️ P1-06 — distincte de `/api/health`, et la confusion entre les deux coûte
 *   cher en exploitation :
 *
 *   · `/api/health` = *liveness* : le processus répond-il encore ? Une réponse
 *     négative autorise le superviseur à redémarrer l'instance.
 *   · `/api/ready` = *readiness* : cette instance peut-elle honorer les
 *     écritures qu'on va lui confier ? Une réponse négative autorise
 *     l'équilibreur à la retirer du pool, **sans** la redémarrer.
 *
 *   Redémarrer une instance simplement pour qu'un équilibreur la remette en
 *   route aggraverait la situation : on perd le cache, les sessions en vol, et
 *   on rallonge l'incident. On n'évalue donc ici que les composants dont dépend
 *   la **persistance** : la base et le support des pièces. Un disque à 85 % ou
 *   une sauvegarde en retard n'empêchent pas d'écrire : ils relèvent d'une
 *   alerte, pas d'une éviction.
 *
 * La sonde **écrit réellement** sur le support des pièces (aller-retour, puis
 * effacement) : constater qu'un répertoire existe ne prouve pas qu'on peut y
 * écrire.
 */
export async function GET() {
  const debut = Date.now();
  const [base, stockage] = await Promise.all([sonderBase(), sonderStockage()]);

  const bloquants = [base, stockage].filter((c) => c.etat !== "ok");
  const pret = bloquants.length === 0;

  if (!pret) {
    // ⚠️ Une instance retirée du pool doit être diagnostiquée sans ouvrir la
    //   connexion : c'est justement le moment où les sondes sont les seules
    //   traces disponibles.
    journal.warn("disponibilite.non_pret", {
      bloquants: bloquants.map((c) => `${c.nom}: ${c.detail}`),
    });
  }

  return NextResponse.json(
    {
      ready: pret,
      dureeMs: Date.now() - debut,
      // ⚠️ On expose les composants, pas leurs chemins ni leurs volumes :
      //   `/api/ready` est souvent laissée accessible aux équilibreurs et aux
      //   sondes externes, et un détail de montage est une information
      //   d'infrastructure.
      composants: [base, stockage].map((c) => ({
        nom: c.nom,
        etat: c.etat,
        dureeMs: c.dureeMs,
        detail: pret ? "ok" : c.detail,
      })),
      notice: pret
        ? null
        : "Instance inapte à recevoir du trafic : une écriture ne serait pas durable. À retirer du pool, sans redémarrage.",
    },
    { status: pret ? 200 : 503, headers: pret ? undefined : { "Retry-After": "10" } },
  );
}
