/**
 * Récepteur d'alertes — le tiers auquel le produit doit pouvoir prouver qu'il a
 * prévenu quelqu'un.
 *
 * ⚠️ P1-06 — pourquoi ce petit serveur existe.
 *   Un journal d'alertes local prouve que le produit a **détecté**. Il ne prouve
 *   pas qu'il a **prévenu** : un webhook qui n'atteint jamais sa destination ne
 *   laisse aucune trace côté produit si personne ne l'écoute. Le critère
 *   d'acceptation du chantier parle d'« alerte envoyée » ; il faut donc un
 *   destinataire réel, qui écrit ce qu'il reçoit, pour que l'envoi soit mesuré
 *   et non supposé.
 *
 * Usage :
 *   npx tsx scripts/recepteur-alertes.ts [--port 4318] [--sortie var/alertes/recues.jsonl]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function option(nom: string, defaut: string): string {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
}

const PORT = Number(option("port", "4318"));
const SORTIE = resolve(option("sortie", "var/alertes/recues.jsonl"));

mkdirSync(dirname(SORTIE), { recursive: true });

/** Horodatage de réception : c'est lui qui permet de mesurer le délai. */
function noter(objet: Record<string, unknown>): void {
  const ligne = JSON.stringify({ recuLe: new Date().toISOString(), ...objet });
  appendFileSync(SORTIE, ligne + "\n", "utf8");
  console.log(ligne);
}

function lireCorps(req: IncomingMessage): Promise<string> {
  return new Promise((resoudre, refuser) => {
    let donnees = "";
    // ⚠️ Un récepteur d'alertes est une cible : on borne. Un corps sans limite
    //   ferait de l'outil de surveillance une faille de disponibilité.
    let taille = 0;
    req.on("data", (morceau: Buffer) => {
      taille += morceau.length;
      if (taille > 256 * 1024) {
        refuser(new Error("corps trop volumineux"));
        req.destroy();
        return;
      }
      donnees += morceau.toString("utf8");
    });
    req.on("end", () => resoudre(donnees));
    req.on("error", refuser);
  });
}

const serveur = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Méthode non autorisée" }));
    return;
  }
  try {
    const corps = await lireCorps(req);
    const alerte = JSON.parse(corps) as Record<string, unknown>;
    noter(alerte);
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recu: true }));
  } catch (error) {
    noter({ erreur: error instanceof Error ? error.message : String(error) });
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recu: false }));
  }
});

serveur.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    evenement: "recepteur.pret",
    port: PORT,
    sortie: SORTIE,
    ts: new Date().toISOString(),
  }));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    serveur.close(() => process.exit(0));
  });
}
