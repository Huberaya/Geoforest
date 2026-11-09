/**
 * C9 — prouve que l'analyse satellite ne peut pas certifier une absence de
 * déforestation quand elle n'a rien vu.
 *
 * ⚠️ Ce contrôle est né ROUGE, à dessein, sur le code d'avant correction.
 *
 *   Deux défauts y sont prouvés, et aucun des deux n'a besoin d'une clé GFW pour
 *   être observé :
 *
 *   A. **Le silence devient une certification.** Quand l'API ne renvoie aucune
 *      ligne, `liveCheck` répond `compliant: true`. Or aucune ligne ne signifie
 *      pas « pas de déforestation » : cela signifie « aucune perte détectée dans
 *      ce jeu de données », ce qui vaut aussi pour une parcelle située sous un
 *      nuage permanent, sous une couverture nuageuse non observée, ou hors de
 *      l'emprise du produit. La différence n'est pas philosophique : elle
 *      sépare une observation d'une absence d'observation, et seule la première
 *      peut entrer dans une déclaration.
 *
 *   B. **N'importe quel service devient Global Forest Watch.** Le nom du
 *      fournisseur est calculé d'après l'hôte réel (`nommerFournisseur`) — mais
 *      `is_probative` ne le consulte jamais. Un intermédiaire, un cache, un
 *      banc d'essai produisait donc une analyse marquée probante, et le dossier
 *      DDR l'acceptait.
 *
 * Les deux défauts sont prouvés par EXÉCUTION, contre un serveur HTTP local qui
 * joue le rôle du fournisseur. Aucune clé réelle, aucune requête sortante.
 *
 * Usage : npm run check:satellite
 * Sortie : 0 si tout est conforme, 1 sinon.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { checkDeforestationRisk, gfwConfigured, demoModeEnabled } from "../src/lib/eudr/satellite-checker";
import type { SatelliteCheckResult, SupportedGeometry } from "../src/lib/eudr/types";
import { examinerDossier, type DossierAExaminer } from "../src/lib/eudr/validateur-dossier";

interface Controle {
  nom: string;
  ok: boolean;
  detail?: string;
}

const controles: Controle[] = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

/* --------------------------------------------------------- parcelle témoin */

/** 10 ha environ, dans une zone agricole ivoirienne. */
const PARCELLE: SupportedGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [-5.5, 5.3],
      [-5.49, 5.3],
      [-5.49, 5.31],
      [-5.5, 5.31],
      [-5.5, 5.3],
    ],
  ],
};

/* ------------------------------------- faux fournisseur satellite, en local */

type Scenario = "vide" | "perte-2021" | "erreur-500";

interface Banc {
  url: string;
  scenario: Scenario;
  requetes: number;
  derniereRequete: { sql?: string; geometry?: unknown } | null;
  fermer: () => Promise<void>;
}

async function demarrerBanc(): Promise<Banc> {
  const banc: Banc = {
    url: "",
    scenario: "vide",
    requetes: 0,
    derniereRequete: null,
    fermer: async () => undefined,
  };

  const serveur: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    banc.requetes += 1;
    let corps = "";
    req.on("data", (c: Buffer) => {
      corps += c.toString("utf-8");
    });
    req.on("end", () => {
      try {
        banc.derniereRequete = JSON.parse(corps) as { sql?: string; geometry?: unknown };
      } catch {
        banc.derniereRequete = null;
      }
      if (banc.scenario === "erreur-500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "panne simulée du fournisseur" }));
        return;
      }
      // L'API GFW rend `{ data: [...] }`. Un scénario « vide » rend un tableau
      // VIDE : c'est exactement ce que renvoie le service réel pour une parcelle
      // sans perte détectée — et c'est ce que le code prenait pour une preuve.
      const data =
        banc.scenario === "perte-2021"
          ? [{ umd_tree_cover_loss__year: 2021, area__ha: 2.5 }]
          : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data }));
    });
  });

  await new Promise<void>((resolve) => serveur.listen(0, "127.0.0.1", resolve));
  const port = (serveur.address() as AddressInfo).port;
  banc.url = `http://127.0.0.1:${port}`;
  banc.fermer = () =>
    new Promise<void>((resolve) => {
      serveur.close(() => resolve());
    });
  return banc;
}

/* ----------------------------------------------------------- environnement */

interface EnvSauve {
  GFW_API_URL?: string;
  GFW_API_KEY?: string;
  GFW_DEMO_MODE?: string;
  GFW_LIVE_ENABLED?: string;
  GFW_TIMEOUT_SECONDS?: string;
  GFW_EXIGER_HOTE_OFFICIEL?: string;
}

const CLES: Array<keyof EnvSauve> = [
  "GFW_API_URL",
  "GFW_API_KEY",
  "GFW_DEMO_MODE",
  "GFW_LIVE_ENABLED",
  "GFW_TIMEOUT_SECONDS",
  "GFW_EXIGER_HOTE_OFFICIEL",
];

function sauverEnv(): EnvSauve {
  const e: EnvSauve = {};
  for (const k of CLES) e[k] = process.env[k];
  return e;
}

function restaurerEnv(e: EnvSauve): void {
  for (const k of CLES) {
    if (e[k] === undefined) delete process.env[k];
    else process.env[k] = e[k];
  }
}

/** Branche le module sur le banc local, avec une clé factice. */
function brancherSurLeBanc(url: string): void {
  process.env.GFW_API_URL = url;
  process.env.GFW_API_KEY = "cle-de-banc-local";
  process.env.GFW_DEMO_MODE = "false";
  process.env.GFW_LIVE_ENABLED = "true";
  process.env.GFW_TIMEOUT_SECONDS = "5";
}

async function main(): Promise<void> {
  const envInitial = sauverEnv();
  const banc = await demarrerBanc();

  try {
    /* ================================================================
     * A. Le silence ne vaut pas certification
     * ================================================================ */

    // ⚠️ `GFW_EXIGER_HOTE_OFFICIEL=false` est INDISPENSABLE ici, et c'est une
    //   leçon de falsification, pas un détail de confort.
    //
    //   Premier essai : le banc tournait sur 127.0.0.1 avec l'exigence par
    //   défaut. Les deux garde-fous se recouvraient — retirer le refus de
    //   conclure sur une réponse vide laissait le contrôle VERT (17/17), parce
    //   que le refus d'hôte non officiel produisait le même résultat. Le
    //   contrôle n'avait donc prouvé qu'un seul des deux défauts.
    //
    //   En relâchant explicitement la provenance, le seul garde-fou restant est
    //   celui de l'observation : ce que ce bloc mesure devient ce qu'il prétend
    //   mesurer.
    brancherSurLeBanc(banc.url);
    process.env.GFW_EXIGER_HOTE_OFFICIEL = "false";
    banc.scenario = "vide";
    const vide = await checkDeforestationRisk(PARCELLE, "2024-06-01");

    verifier(
      "aucune ligne renvoyée ne produit pas un verdict de conformité",
      vide.compliant !== true,
      `compliant=${vide.compliant} — une absence de détection n'est pas une absence de déforestation : ` +
        "nuage permanent, couverture non observée, ou parcelle hors emprise du produit donnent le même silence",
    );

    verifier(
      "une réponse vide n'est pas déclarée probante",
      vide.is_probative === false,
      `is_probative=${vide.is_probative} — une analyse qui n'a rien observé ne peut pas entrer dans une déclaration`,
    );

    verifier(
      "l'absence d'observation est nommée, pas présentée comme un résultat",
      typeof vide.details === "string" && /aucune observation|non observé|pas d'observation/i.test(vide.details),
      `details=${(vide.details ?? "").slice(0, 100)}`,
    );

    /* ================================================================
     * B. Une perte réellement observée reste un constat
     * ================================================================
     *
     * ⚠️ Ce banc-ci tourne sur 127.0.0.1, donc sur un hôte NON officiel. Le
     *   produit refuse par défaut de conclure sur une telle source — c'est le
     *   défaut B, et il est correct. Pour éprouver le chemin « perte réellement
     *   constatée », il faut donc activer explicitement l'échappatoire
     *   documentée. Le contrôle vérifie ensuite que ce relâchement RESTE
     *   VISIBLE dans la trace : relâcher la provenance ne doit pas la faire
     *   disparaître.
     */
    brancherSurLeBanc(banc.url);
    process.env.GFW_EXIGER_HOTE_OFFICIEL = "false";
    banc.scenario = "perte-2021";
    const perte = await checkDeforestationRisk(PARCELLE, "2024-06-01");

    verifier(
      "une perte observée après la date butoir reste non conforme",
      perte.compliant === false && perte.loss_year === 2021,
      `compliant=${perte.compliant} · loss_year=${perte.loss_year}`,
    );

    verifier(
      "une perte observée est probante",
      perte.is_probative === true,
      "la correction ne doit pas rendre le produit incapable de constater une déforestation réelle",
    );

    verifier(
      "un relâchement de la provenance reste inscrit dans la trace",
      perte.evidence?.is_official_source === false && /service configuré/i.test(perte.evidence?.provider ?? ""),
      `official=${perte.evidence?.is_official_source} · provider=${perte.evidence?.provider ?? "(vide)"} — ` +
        "accepter une source non officielle est un choix ; le dissimuler en serait un autre",
    );

    verifier(
      "la géométrie envoyée est celle de la parcelle, pas un rectangle englobant",
      Array.isArray((banc.derniereRequete?.geometry as { coordinates?: unknown[] })?.coordinates),
      "vérifier ce qui est réellement transmis, et pas seulement ce qui est reçu",
    );

    verifier(
      "l'analyse interroge la perte de couvert et son année",
      typeof banc.derniereRequete?.sql === "string" &&
        /umd_tree_cover_loss__year/.test(banc.derniereRequete.sql) &&
        /area__ha/.test(banc.derniereRequete.sql),
      `sql=${(banc.derniereRequete?.sql ?? "").slice(0, 80)}`,
    );

    /* ================================================================
     * C. Un service qui n'est pas GFW ne certifie rien
     * ================================================================ */

    // Le banc est sur 127.0.0.1 : ce n'est pas l'hôte officiel. Le module le
    // sait déjà (`nommerFournisseur`), mais ne s'en servait pas pour décider.
    // On revient à l'exigence par défaut : c'est elle que l'installation de
    // production applique tant que personne n'a rien réglé.
    delete process.env.GFW_EXIGER_HOTE_OFFICIEL;
    banc.scenario = "perte-2021";
    const nonOfficiel = await checkDeforestationRisk(PARCELLE, "2024-06-01");

    verifier(
      "un service non officiel n'est pas déclaré probant",
      nonOfficiel.is_probative === false,
      `is_probative=${nonOfficiel.is_probative} — l'analyse venait de 127.0.0.1 et se présentait comme probante ; ` +
        "un cache ou un intermédiaire produirait une « preuve » que personne ne peut rattacher à Global Forest Watch",
    );

    // ⚠️ Ne pas se contenter de `compliant !== true` : à ce stade l'analyse
    //   porte sur une perte réelle, donc `compliant === false`. Le contrôle ne
    //   doit pas être vert parce que la non-conformité est vraie, mais bien
    //   parce que le VERDICT ne peut pas être rattaché à une source officielle.
    verifier(
      "un service non officiel n'émet pas de verdict exploitable",
      nonOfficiel.compliant === null,
      `compliant=${nonOfficiel.compliant} — un verdict nul est la seule forme honnête : ` +
        "on ne peut pas le rattacher à la source que la déclaration invoque",
    );

    verifier(
      "l'exigence d'hôte officiel est le comportement PAR DÉFAUT",
      process.env.GFW_EXIGER_HOTE_OFFICIEL === undefined && nonOfficiel.is_probative === false,
      `variable=${process.env.GFW_EXIGER_HOTE_OFFICIEL ?? "(non définie)"} · probant=${nonOfficiel.is_probative} — ` +
        "une installation neuve doit être exigeante sans qu'on ait à la configurer",
    );

    verifier(
      "le fournisseur réellement appelé est nommé dans la trace",
      /127\.0\.0\.1/.test(nonOfficiel.evidence?.endpoint ?? "") ||
        /service configuré/i.test(nonOfficiel.evidence?.provider ?? ""),
      `endpoint=${nonOfficiel.evidence?.endpoint ?? "(vide)"} · provider=${nonOfficiel.evidence?.provider ?? "(vide)"}`,
    );

    /* ================================================================
     * D. Une panne ne produit ni verdict ni simulation
     * ================================================================ */

    banc.scenario = "erreur-500";
    const panne = await checkDeforestationRisk(PARCELLE, "2024-06-01");

    verifier(
      "une panne du fournisseur ne produit aucun verdict",
      panne.compliant === null && panne.is_probative === false,
      `compliant=${panne.compliant} · source=${panne.source}`,
    );

    verifier(
      "une panne ne bascule pas en simulation",
      panne.source !== "simulated",
      `source=${panne.source}`,
    );

    /* ================================================================
     * E. Conséquences dans le dossier DDR
     * ================================================================ */

    // ⚠️ C'est le point qui compte vraiment : un verdict non probant doit
    //   BLOQUER la déclaration. Sinon tout ce qui précède ne change rien à ce
    //   que l'utilisateur peut envoyer à une autorité.
    const dossier: DossierAExaminer = {
      id: "dossier-du-banc",
      status: "DRAFT",
      supplierId: "s1",
      productId: "prod1",
      commodity: "cocoa",
      parcelles: [
        {
          id: "p1",
          name: "Parcelle du banc",
          // ⚠️ Statut COMPLIANT, comme le produit l'aurait écrit avant
          //   correction : c'est bien la probité de l'analyse qui doit bloquer,
          //   pas un statut que l'on aurait soi-même dégradé pour se donner
          //   raison.
          status: vide.compliant === false ? "NON_COMPLIANT" : "COMPLIANT",
          countryCode: "CI",
          countryStatut: "RESOLU",
          areaHa: 10,
          derniereAnalyse: {
            analysisSource: vide.source,
            analysisProbative: vide.is_probative,
            status: vide.source === "simulated" ? "SIMULATED_NON_PROBATIVE" : "COMPLIANT",
            harvestDate: "2024-06-01",
          },
          // Les pièces de légalité et la période de production sont renseignées
          // pour que le dossier ne soit PAS bloqué par un autre motif : c'est la
          // seule façon de savoir ce que ce contrôle mesure réellement.
          documents: [
            { id: "d1", category: "LAND_TENURE", status: "VALID", expiryDate: null },
            { id: "d2", category: "HARVEST_PERMIT", status: "VALID", expiryDate: null },
            { id: "d3", category: "TAX_CLEARANCE", status: "VALID", expiryDate: null },
          ],
        },
      ],
      taches: [],
    };
    const verdictDossier = examinerDossier(dossier, "2026-11-06");

    // ⚠️ Ma première version vérifiait seulement `!complet`. Elle était VERTE
    //   sur le code d'avant correction, mais pour une mauvaise raison : le
    //   dossier de test n'avait aucune pièce de légalité ni de période de
    //   production, donc d'autres manques bloquaient déjà. Un contrôle qui
    //   réussit grâce au défaut d'à côté ne prouve rien. Il exige maintenant la
    //   présence ET l'unicité du manque visé.
    const bloquants = verdictDossier.manques.filter((m) => m.gravite === "bloquant");
    verifier(
      "un dossier appuyé sur une analyse sans observation est bloqué PAR ce motif",
      bloquants.length === 1 && bloquants[0]?.code === "ANALYSE_NON_PROBANTE",
      `bloquants=[${bloquants.map((m) => m.code).join(", ") || "aucun"}] — le dossier de test est complet ` +
        "par ailleurs, de sorte que seul ce motif peut le bloquer",
    );

    /* ================================================================
     * F. Le comportement d'origine, quand rien n'est configuré
     * ================================================================ */

    delete process.env.GFW_API_KEY;
    delete process.env.GFW_API_URL;
    process.env.GFW_DEMO_MODE = "false";
    const sansSource = await checkDeforestationRisk(PARCELLE, "2024-06-01");

    verifier(
      "sans aucune source configurée, aucun verdict n'est émis",
      sansSource.compliant === null && sansSource.is_probative === false,
      `compliant=${sansSource.compliant} · source=${sansSource.source}`,
    );

    verifier(
      "la configuration est lue, pas supposée",
      gfwConfigured() === false && demoModeEnabled() === false,
      `gfwConfigured=${gfwConfigured()} · demoMode=${demoModeEnabled()}`,
    );
  } finally {
    await banc.fermer();
    restaurerEnv(envInitial);
  }

  const echecs = controles.filter((c) => !c.ok);
  for (const c of controles) {
    if (c.ok) console.log(`  ✅ ${c.nom}`);
    else console.log(`  🔴 ${c.nom}${c.detail ? `\n       ${c.detail}` : ""}`);
  }
  console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
  process.exit(echecs.length === 0 ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error("🔴 Banc impossible :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

/** Réexport de types pour que les éditeurs ne signalent pas d'import inutilisé. */
export type { SatelliteCheckResult };
