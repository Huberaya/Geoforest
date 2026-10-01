import { NextResponse, type NextRequest } from "next/server";

import { envoyerAlerte, lireAlertes, transportsDisponibles } from "@/lib/alerting/transports";
import { SEUILS, evaluer, etatsConnus, reinitialiserEtats, sonderTout, tracerEvaluation } from "@/lib/alerting/regles";
import { routeSupervision } from "@/lib/observability/route-supervision";

export const dynamic = "force-dynamic";

/**
 * Alertes : lecture du journal (`GET`) et évaluation immédiate (`POST`).
 *
 * ⚠️ P1-06 — l'évaluation est **déclenchée de l'extérieur**, pas glissée dans
 *   le chemin des requêtes. Mesurer la disponibilité ne doit pas la dégrader :
 *   une évaluation qui envoie un webhook depuis le gestionnaire d'une requête
 *   ajouterait la latence du réseau d'astreinte à celle du produit, et une
 *   panne du transport d'alertes deviendrait une panne du service. Le
 *   supervisionnaire appelle donc `POST` à intervalles réguliers ; c'est lui
 *   qui porte le rythme, et c'est ce rythme qui fixe le délai de détection.
 */
export const GET = routeSupervision(async () => {
  const composants = await sonderTout();
  return NextResponse.json({
    seuils: SEUILS,
    transports: transportsDisponibles(),
    etats: etatsConnus(),
    composants,
    alertes: lireAlertes(100),
  });
});

/**
 * `POST` — évalue et envoie.
 *
 * Corps :
 *   · `{}`          → évalue, envoie ce qui doit l'être, déduplique le reste ;
 *   · `{"aVide":true}` → **vide** la mémorisation de déduplication : évalue et
 *     rapporte ce qui serait envoyé, mais **n'envoie rien et ne mémorise rien**.
 *
 * ⚠️ Pourquoi `aVide` n'envoie ni ne mémorise. Vider la mémorisation puis
 *   envoyer reviendrait à réémettre toutes les alertes en cours : le
 *   destinataire recevrait un doublon qu'il ne peut pas distinguer d'une
 *   rechute. Et mémoriser sans envoyer serait pire encore — la boucle de
 *   supervision suivante trouverait l'alerte « déjà active » et se tairait, si
 *   bien qu'une panne réelle ne serait jamais annoncée. `aVide` sert à
 *   repartir d'un état connu, pas à produire du silence ni du bruit.
 */
export const POST = routeSupervision(async (request: NextRequest) => {
  const corps = (await request.json().catch(() => ({}))) as { aVide?: boolean };
  if (corps.aVide) reinitialiserEtats();

  const { aEnvoyer, deja } = await evaluer();
  tracerEvaluation(aEnvoyer, deja);

  const envois = [];
  if (!corps.aVide) {
    for (const alerte of aEnvoyer) {
      envois.push({ alerte: alerte.code, etat: alerte.etat, resultats: await envoyerAlerte(alerte) });
    }
  } else {
    // ⚠️ On revide APRÈS l'évaluation : sinon l'évaluation elle-même armerait
    //   la déduplication, et la boucle de supervision se tairait au tour
    //   suivant en croyant l'alerte déjà partie.
    reinitialiserEtats();
  }

  return NextResponse.json({
    evalueLe: new Date().toISOString(),
    vide: corps.aVide === true,
    aEnvoyer: aEnvoyer.map((a) => ({
      code: a.code,
      gravite: a.gravite,
      composant: a.composant,
      titre: a.titre,
      message: a.message,
      action: a.action,
      etat: a.etat,
      mesures: a.mesures,
    })),
    dejaActives: deja,
    envois,
  });
});
