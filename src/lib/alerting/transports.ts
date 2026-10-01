import "server-only";

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { journal } from "@/lib/observability/journal";
import type { Alerte, ResultatEnvoi, TransportAlerte } from "./types";

/**
 * Sorties d'alertes.
 *
 * ⚠️ Deux transports sont **éprouvés** ici — le journal local et le webhook —
 *   et trois sont **écrits mais jamais exécutés** (Sentry, collecteur
 *   OpenTelemetry, PagerDuty). La différence n'est pas de style : les premiers
 *   sont mesurés par les essais de ce chantier, les seconds n'ont jamais
 *   parlé à un service réel et sont donc refusés par défaut.
 */

/** Fichier du journal d'alertes. Toujours actif : c'est la référence locale. */
export function fichierAlertes(): string {
  const explicite = process.env.GF_ALERT_FILE?.trim();
  return resolve(explicite || "var/alertes/alertes.jsonl");
}

const transportJournal: TransportAlerte = {
  nom: "journal-local",
  valide: true,
  variable: "(toujours actif)",
  async envoyer(alerte: Alerte): Promise<ResultatEnvoi> {
    const chemin = fichierAlertes();
    try {
      mkdirSync(dirname(chemin), { recursive: true });
      appendFileSync(chemin, JSON.stringify(alerte) + "\n", "utf8");
      return { transport: this.nom, etat: "envoyé", detail: chemin };
    } catch (error) {
      return {
        transport: this.nom,
        etat: "echec",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Webhook générique : c'est le transport qui rend l'alerte réellement « envoyée »
 * hors du processus. Un journal local prouve qu'on a détecté ; un webhook reçu
 * par un tiers prouve qu'on a prévenu.
 */
const transportWebhook: TransportAlerte = {
  nom: "webhook",
  valide: true,
  variable: "GF_ALERT_WEBHOOK",
  async envoyer(alerte: Alerte): Promise<ResultatEnvoi> {
    const url = process.env.GF_ALERT_WEBHOOK?.trim();
    if (!url) return { transport: this.nom, etat: "non configuré" };
    const delai = Number(process.env.GF_ALERT_WEBHOOK_TIMEOUT_MS ?? "5000");
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), Number.isFinite(delai) ? delai : 5000);
    try {
      const reponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alerte),
        signal: controleur.signal,
      });
      return {
        transport: this.nom,
        etat: reponse.ok ? "envoyé" : "refusé",
        detail: `HTTP ${reponse.status}`,
      };
    } catch (error) {
      return {
        transport: this.nom,
        etat: "echec",
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(minuteur);
    }
  },
};

/**
 * ⚠️ Adaptateur **non validé** — jamais exécuté contre un projet Sentry réel.
 * Le format d'enveloppe suit le point d'entrée « store » de Sentry ; la
 * construction du DSN, l'authentification et les quotas ne sont pas éprouvés.
 */
const transportSentry: TransportAlerte = {
  nom: "sentry",
  valide: false,
  variable: "SENTRY_DSN",
  async envoyer(alerte: Alerte): Promise<ResultatEnvoi> {
    const dsn = process.env.SENTRY_DSN?.trim();
    if (!dsn) return { transport: this.nom, etat: "non configuré" };
    try {
      const url = new URL(dsn);
      const projet = url.pathname.replace(/^\//, "");
      const clePublique = url.username;
      const hote = url.host;
      const reponse = await fetch(`${url.protocol}//${hote}/api/${projet}/store/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${clePublique}`,
        },
        body: JSON.stringify({
          // Enveloppe « event » minimale. ⚠️ Jamais envoyée pour de vrai : la
          // forme exacte attendue par un Sentry auto-hébergé ou SaaS varie
          // selon la version, et rien ici n'a été vérifié.
          level: alerte.gravite === "critique" ? "fatal" : "error",
          message: `${alerte.titre} — ${alerte.message}`,
          tags: { composant: alerte.composant, code: alerte.code },
          extra: alerte.mesures,
          timestamp: alerte.ts,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return { transport: this.nom, etat: reponse.ok ? "envoyé" : "refusé", detail: `HTTP ${reponse.status}` };
    } catch (error) {
      return {
        transport: this.nom,
        etat: "echec",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * ⚠️ Adaptateur **non validé** — jamais exécuté contre un collecteur réel.
 * Le corps suit OTLP/HTTP en JSON ; l'encodage des attributs et l'authentification
 * par en-tête ne sont pas éprouvés.
 */
const transportOtlp: TransportAlerte = {
  nom: "otlp",
  valide: false,
  variable: "OTEL_EXPORTER_OTLP_ENDPOINT",
  async envoyer(alerte: Alerte): Promise<ResultatEnvoi> {
    const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    if (!base) return { transport: this.nom, etat: "non configuré" };
    try {
      // OTLP attend des nanosecondes. La cible de compilation interdit les
      // littoraux BigInt : on passe par un Number, dont la plage suffit
      // largement a l echelle de nanosecondes depuis 1970.
      const maintenant = Date.now() * 1_000_000;
      const corps = {
        resourceLogs: [
          {
            resource: { attributes: [{ key: "service.name", value: { stringValue: "geoforest-trace" } }] },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: String(Math.round(maintenant)),
                    severityText: alerte.gravite.toUpperCase(),
                    body: { stringValue: `${alerte.titre} — ${alerte.message}` },
                    attributes: Object.entries(alerte.mesures).map(([k, v]) => ({
                      key: k,
                      value:
                        typeof v === "number"
                          ? { doubleValue: v }
                          : typeof v === "boolean"
                            ? { boolValue: v }
                            : { stringValue: String(v ?? "") },
                    })),
                  },
                ],
              },
            ],
          },
        ],
      };
      const reponse = await fetch(`${base.replace(/\/$/, "")}/v1/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(5000),
      });
      return { transport: this.nom, etat: reponse.ok ? "envoyé" : "refusé", detail: `HTTP ${reponse.status}` };
    } catch (error) {
      return { transport: this.nom, etat: "echec", detail: error instanceof Error ? error.message : String(error) };
    }
  },
};

/**
 * ⚠️ Adaptateur **non validé** — jamais exécuté contre PagerDuty.
 * Le schéma « Events API v2 » est reproduit de mémoire ; la clé de routage, les
 * quotas et la déduplication côté PagerDuty ne sont pas éprouvés.
 */
const transportPagerDuty: TransportAlerte = {
  nom: "pagerduty",
  valide: false,
  variable: "PAGERDUTY_ROUTING_KEY",
  async envoyer(alerte: Alerte): Promise<ResultatEnvoi> {
    const cle = process.env.PAGERDUTY_ROUTING_KEY?.trim();
    if (!cle) return { transport: this.nom, etat: "non configuré" };
    try {
      const reponse = await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routing_key: cle,
          event_action: alerte.etat === "résolue" ? "resolve" : "trigger",
          dedup_key: alerte.code,
          payload: {
            summary: `${alerte.titre} — ${alerte.message}`,
            severity: alerte.gravite === "critique" ? "critical" : alerte.gravite === "majeure" ? "error" : "warning",
            source: "geoforest-trace",
            component: alerte.composant,
            custom_details: alerte.mesures,
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
      return { transport: this.nom, etat: reponse.ok ? "envoyé" : "refusé", detail: `HTTP ${reponse.status}` };
    } catch (error) {
      return { transport: this.nom, etat: "echec", detail: error instanceof Error ? error.message : String(error) };
    }
  },
};

const TOUS: TransportAlerte[] = [
  transportJournal,
  transportWebhook,
  transportSentry,
  transportOtlp,
  transportPagerDuty,
];

/**
 * Transports effectivement employés.
 *
 * ⚠️ Un transport non validé n'est employé que sur acquittement explicite
 *   (`GF_ALERT_ACCEPT_NON_VALIDE=1`). Sans cette règle, configurer `SENTRY_DSN`
 *   suffirait à faire croire à une supervision qui n'a jamais fonctionné.
 */
export function transportsActifs(): TransportAlerte[] {
  const acquitte = process.env.GF_ALERT_ACCEPT_NON_VALIDE === "1";
  return TOUS.filter((t) => t.valide || acquitte);
}

export function transportsDisponibles(): Array<{
  nom: string;
  valide: boolean;
  variable: string;
  actif: boolean;
  configure: boolean;
}> {
  const acquitte = process.env.GF_ALERT_ACCEPT_NON_VALIDE === "1";
  return TOUS.map((t) => ({
    nom: t.nom,
    valide: t.valide,
    variable: t.variable,
    actif: t.valide || acquitte,
    configure: t.variable.startsWith("(") ? true : Boolean(process.env[t.variable]?.trim()),
  }));
}

/**
 * Envoie une alerte par tous les transports actifs, et consigne le résultat de
 * chacun.
 *
 * ⚠️ Un échec d'envoi est lui-même journalisé : une alerte qui n'est pas partie
 *   est un incident d'exploitation, pas un détail.
 */
export async function envoyerAlerte(alerte: Alerte): Promise<ResultatEnvoi[]> {
  const actifs = transportsActifs();
  const resultats = await Promise.all(
    actifs.map((t) =>
      t.envoyer(alerte).catch((error: unknown) => ({
        transport: t.nom,
        etat: "echec" as const,
        detail: error instanceof Error ? error.message : String(error),
      })),
    ),
  );
  for (const r of resultats) {
    if (r.etat === "echec") {
      journal.error("alerte.envoi_impossible", {
        alerte: alerte.code,
        transport: r.transport,
        detail: r.detail,
      });
    }
  }
  journal.warn(alerte.etat === "résolue" ? "alerte.resolue" : "alerte.declencher", {
    code: alerte.code,
    gravite: alerte.gravite,
    composant: alerte.composant,
    transports: resultats.map((r) => `${r.transport}:${r.etat}`),
  });
  return resultats;
}

/** Relit le journal d'alertes, du plus récent au plus ancien. */
export function lireAlertes(limite = 200): Alerte[] {
  try {
    const lignes = readFileSync(fichierAlertes(), "utf8").split("\n").filter(Boolean);
    return lignes
      .slice(-limite)
      .map((l) => JSON.parse(l) as Alerte)
      .reverse();
  } catch {
    return [];
  }
}
