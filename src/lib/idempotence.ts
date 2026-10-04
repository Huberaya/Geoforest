import "server-only";

import { createHash } from "node:crypto";

import { and, eq, lt, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { idempotence } from "@/db/schema";
import { journal } from "@/lib/observability/journal";
import { withTenant } from "@/lib/tenant";

/**
 * Idempotence des écritures — P1-11.
 *
 * ⚠️ Le défaut, mesuré avant ce chantier : deux soumissions identiques
 * concurrentes créaient **deux ressources distinctes**, donc deux audits pour
 * une seule action. Dans un outil de conformité, un doublon n'est pas un
 * détail d'affichage : c'est une trace qui ne correspond à rien de réel, et
 * personne ne peut plus distinguer l'audit authentique de son jumeau.
 *
 * Le principe : la requête est **revendiquée** avant d'être exécutée, par une
 * contrainte d'unicité en base. La requête jumelle, elle, ne peut pas
 * revendiquer la même place ; elle attend la réponse de la première et la sert
 * à l'identique. L'unicité est le verrou — sans elle, deux transactions
 * concurrentes pourraient chacune « ne rien trouver » et écrire deux fois.
 *
 * Trois décisions qui méritent d'être écrites :
 *
 * 1. **La revendication est validée hors de la transaction du gestionnaire.**
 *    Une ligne écrite dans la même transaction serait invisible pour la
 *    requête concurrente (rien n'est visible avant validation) et disparaîtrait
 *    au moindre retour arrière : le verrou ne tiendrait pas.
 *
 * 2. **Seules les réponses 2xx sont consignées.** Un échec n'a rien écrit :
 *    effacer la revendication permet de rejouer la même clé. Consigner un
 *    échec interdirait à l'utilisateur de retenter, alors que rien n'a été créé.
 *
 * 3. **Une clé absente n'empêche pas la protection.** Elle est alors dérivée
 *    d'une empreinte de la requête (méthode, route, organisation, utilisateur,
 *    corps), avec une fenêtre courte. Une soumission vraiment identique dans
 *    les trente secondes est un double envoi, pas une volonté de créer deux
 *    fois la même chose. La fenêtre est courte précisément pour que cette
 *    supposition reste prudente.
 */

/** Méthodes protégées : celles qui modifient l'état. */
const METHODES_PROTEGEES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Taille maximale de corps acceptée pour le calcul d'une empreinte. */
const CORPS_MAX_EMPREINTE = 8 * 1024 * 1024;
/** Taille maximale de réponse consignée (au-delà, la relecture est impossible). */
const REPONSE_MAX_CONSIGNEE = 512 * 1024;
// ⚠️ `new Response("…")` avec l'un de ces statuts lève une TypeError :
//   ils n'admettent pas de corps. Rejouer une suppression (204) plantait
//   donc en 500 — défaut découvert au nettoyage des essais P1-11.
const STATUTS_SANS_CORPS = new Set([204, 205, 304]);

function fenetreSecondes(explicite: boolean): number {
  const parDefaut = explicite ? 86_400 : 30;
  const cle = explicite
    ? "GF_IDEMPOTENCE_FENETRE_EXPLICITE_S"
    : "GF_IDEMPOTENCE_FENETRE_AUTO_S";
  const brut = Number(process.env[cle] ?? parDefaut);
  return Number.isFinite(brut) && brut > 0 ? Math.floor(brut) : parDefaut;
}

function attenteMaxMs(): number {
  const brut = Number(process.env.GF_IDEMPOTENCE_ATTENTE_MS ?? 5_000);
  return Number.isFinite(brut) && brut >= 0 ? Math.floor(brut) : 5_000;
}

export function methodeProtegee(methode: string): boolean {
  return METHODES_PROTEGEES.has(methode.toUpperCase());
}

/** Forme admise pour une clé fournie par le client : repérable, bornée, sûre. */
const CLE_VALIDE = /^[A-Za-z0-9._:-]{8,255}$/;

interface CleCalculee {
  cle: string;
  explicite: boolean;
  /** Empreinte du corps, `null` si le corps est trop volumineux pour être lu. */
  empreinte: string | null;
}

/**
 * Détermine la clé d'idempotence.
 *
 * ⚠️ Une clé fournie par le client mais malformée est **refusée**, pas ignorée :
 * l'ignorer reviendrait à exécuter la requête sans protection en laissant
 * croire le contraire. Mieux vaut une erreur franche qu'une protection
 * silencieusement absente.
 */
async function calculerCle(
  request: NextRequest,
  portee: string,
  organisation: string,
  utilisateur: string | null,
): Promise<CleCalculee | { refus: string }> {
  const fournie = request.headers.get("idempotency-key");
  if (fournie !== null && !CLE_VALIDE.test(fournie)) {
    return {
      refus:
        "En-tête Idempotency-Key invalide : 8 à 255 caractères, " +
        "lettres, chiffres et « . _ : - » uniquement.",
    };
  }

  // Le corps est lu sur une copie : le gestionnaire doit pouvoir le lire à son
  // tour — un corps consommé ne se relit pas.
  let empreinte: string | null = null;
  const annonce = Number(request.headers.get("content-length") ?? "0");
  if (annonce <= CORPS_MAX_EMPREINTE) {
    try {
      const copie = request.clone();
      const tampon = Buffer.from(await copie.arrayBuffer());
      empreinte = createHash("sha256").update(tampon).digest("hex");
    } catch {
      empreinte = null;
    }
  }

  if (fournie !== null) return { cle: `exp:${fournie}`, explicite: true, empreinte };

  // ⚠️ Sans empreinte possible, aucune clé dérivée ne peut être calculée : on
  //   renonce à protéger plutôt que de fabriquer une clé qui confondrait deux
  //   gros dépôts différents. Une clé explicite reste honorée, elle.
  if (empreinte === null) return { cle: "", explicite: false, empreinte: null };

  const base = [organisation, utilisateur ?? "", portee, empreinte].join("|");
  return {
    cle: `auto:${createHash("sha256").update(base).digest("hex")}`,
    explicite: false,
    empreinte,
  };
}

function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms));
}

interface Revendication {
  id: string;
  etat: string;
  empreinteCorps: string;
  statutHttp: number | null;
  typeContenu: string | null;
  corpsReponse: string | null;
}

async function lire(organisation: string, portee: string, cle: string) {
  const [ligne] = await withTenant(organisation, (tx) =>
    tx
      .select()
      .from(idempotence)
      .where(
        and(
          eq(idempotence.organizationId, organisation),
          eq(idempotence.portee, portee),
          eq(idempotence.cle, cle),
        ),
      )
      .limit(1),
  );
  return (ligne as Revendication | undefined) ?? null;
}

/**
 * Exécute `operation` une seule fois pour une même clé.
 *
 * Renvoie la réponse de la première exécution aux appels jumeaux — même code
 * HTTP, même corps — ou 409 si la première est toujours en cours à l'issue du
 * délai d'attente.
 */
export async function avecIdempotence(params: {
  request: NextRequest;
  /** Motif de route, par exemple « /api/v1/audits ». */
  route: string;
  /**
   * Chemin réellement demandé, par exemple « /api/v1/plots/3f2a… ».
   * ⚠️ C'est lui — et non le motif — qui définit la portée de la clé :
   *   sans cette distinction, supprimer la parcelle A puis la parcelle B
   *   produit la même empreinte dérivée (même motif, même corps vide) et la
   *   seconde suppression est prise pour une relecture de la première.
   */
  chemin: string;
  organizationId: string;
  utilisateurId?: string | null;
  operation: () => Promise<Response>;
}): Promise<Response> {
  const { request, route, chemin, organizationId, utilisateurId, operation } = params;
  const portee = `${request.method.toUpperCase()} ${chemin}`;

  const calculee = await calculerCle(request, portee, organizationId, utilisateurId ?? null);
  if ("refus" in calculee) {
    return Response.json({ detail: calculee.refus }, { status: 400 });
  }
  const { cle, explicite, empreinte } = calculee;

  // Aucune clé exploitable : on exécute sans protection, mais on le dit.
  if (cle === "" || empreinte === null) {
    journal.warn("idempotence.inapplicable", {
      route,
      methode: request.method,
      motif: cle === "" ? "cle_absente_et_corps_illisible" : "empreinte_indisponible",
    });
    return operation();
  }

  const fenetre = fenetreSecondes(explicite);
  const expireLe = new Date(Date.now() + fenetre * 1000);

  // --- 1. revendiquer la place
  let revendiquee = false;
  try {
    const inserees = await withTenant(organizationId, (tx) =>
      tx
        .insert(idempotence)
        .values({
          organizationId,
          utilisateurId: utilisateurId ?? null,
          portee,
          cle,
          empreinteCorps: empreinte,
          etat: "en_cours",
          expireLe,
        })
        .onConflictDoNothing()
        .returning({ id: idempotence.id }),
    );
    revendiquee = inserees.length > 0;
  } catch (erreur) {
    // ⚠️ Une panne du mécanisme ne doit **jamais** empêcher l'écriture :
    //   mieux vaut un doublon, qui se voit, qu'un dépôt refusé, qui se perd.
    journal.error("idempotence.revendication_impossible", {
      route,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
    });
    return operation();
  }

  // --- 2. la place était prise : rejouer, ou attendre
  if (!revendiquee) {
    const budget = attenteMaxMs();
    const debut = Date.now();

    while (true) {
      const existante = await lire(organizationId, portee, cle);

      if (!existante) {
        // La requête précédente a échoué, sa revendication a été effacée :
        // cette requête prend la suite.
        break;
      }

      if (existante.empreinteCorps !== empreinte) {
        return Response.json(
          {
            detail:
              "Cette clé d'idempotence a déjà été utilisée avec un contenu différent.",
          },
          { status: 422 },
        );
      }

      if (existante.etat === "termine") {
        return rejouer(existante, cle);
      }

      if (Date.now() - debut >= budget) {
        return Response.json(
          {
            detail:
              "Une requête identique est déjà en cours. Réessayez dans quelques instants.",
          },
          { status: 409 },
        );
      }

      await attendre(60);
    }

    // La place s'est libérée : on la reprend.
    const reprises = await withTenant(organizationId, (tx) =>
      tx
        .insert(idempotence)
        .values({
          organizationId,
          utilisateurId: utilisateurId ?? null,
          portee,
          cle,
          empreinteCorps: empreinte,
          etat: "en_cours",
          expireLe,
        })
        .onConflictDoNothing()
        .returning({ id: idempotence.id }),
    );
    if (reprises.length === 0) {
      // Un concurrent a été plus rapide : on lit ce qu'il a produit.
      const existante = await lire(organizationId, portee, cle);
      if (existante?.etat === "termine") return rejouer(existante, cle);
      return Response.json(
        { detail: "Une requête identique est déjà en cours." },
        { status: 409 },
      );
    }
  }

  // --- 3. exécuter, puis consigner ou libérer
  let reponse: Response;
  try {
    reponse = await operation();
  } catch (erreur) {
    await liberer(organizationId, portee, cle);
    throw erreur;
  }

  const corps = reponse.ok ? await corpsPourMemoire(reponse) : null;

  if (reponse.ok && corps !== null) {
    await withTenant(organizationId, (tx) =>
      tx
        .update(idempotence)
        .set({
          etat: "termine",
          statutHttp: reponse.status,
          typeContenu: reponse.headers.get("content-type"),
          corpsReponse: corps,
        })
        .where(
          and(
            eq(idempotence.organizationId, organizationId),
            eq(idempotence.portee, portee),
            eq(idempotence.cle, cle),
          ),
        ),
    ).catch((erreur: unknown) => {
      journal.error("idempotence.consignation_impossible", {
        route,
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
      });
    });
    reponse.headers.set("Idempotency-Key", cle);
  } else {
    // ⚠️ Rien n'a été écrit : la place est rendue pour qu'un nouvel essai
    //   avec la même clé puisse aboutir.
    await liberer(organizationId, portee, cle);
    if (reponse.ok && corps === null) {
      journal.warn("idempotence.reponse_trop_volumineuse", { route, portee });
    }
  }

  // --- 4. nettoyage opportuniste, borné pour ne jamais ralentir une requête
  if (Math.random() < 0.04) void purger(organizationId);

  return reponse;
}

/** Lit le corps sans consommer la réponse envoyée au client. */
async function corpsPourMemoire(reponse: Response): Promise<string | null> {
  try {
    const texte = await reponse.clone().text();
    return texte.length > REPONSE_MAX_CONSIGNEE ? null : texte;
  } catch {
    return null;
  }
}

function rejouer(ligne: Revendication, cle: string): Response {
  const entetes = new Headers();
  if (ligne.typeContenu) entetes.set("content-type", ligne.typeContenu);
  entetes.set("Idempotency-Key", cle);
  // ⚠️ Sans cette marque, le client ne peut pas distinguer une création d'une
  //   relecture — et croirait avoir créé une seconde ressource.
  entetes.set("Idempotency-Replayed", "true");

  if (ligne.corpsReponse === null) {
    return Response.json(
      { detail: "Réponse non reproductible : recommencez avec une autre clé." },
      { status: 409, headers: entetes },
    );
  }
  const statut = ligne.statutHttp ?? 200;
  return new Response(
    STATUTS_SANS_CORPS.has(statut) ? null : ligne.corpsReponse,
    { status: statut, headers: entetes },
  );
}

async function liberer(organisation: string, portee: string, cle: string): Promise<void> {
  await withTenant(organisation, (tx) =>
    tx
      .delete(idempotence)
      .where(
        and(
          eq(idempotence.organizationId, organisation),
          eq(idempotence.portee, portee),
          eq(idempotence.cle, cle),
        ),
      ),
  ).catch((erreur: unknown) => {
    journal.error("idempotence.liberation_impossible", {
      portee,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
    });
  });
}

async function purger(organisation: string): Promise<void> {
  await withTenant(organisation, (tx) =>
    tx.execute(
      sql`delete from ${idempotence} where ${idempotence.expireLe} < now() and ${idempotence.organizationId} = ${organisation}`,
    ),
  ).catch(() => {
    // Un nettoyage manqué n'a aucune conséquence fonctionnelle : l'expiration
    // rend la ligne inerte, et le passage suivant la reprendra.
  });
}

export async function purgerExpirees(organisation: string): Promise<number> {
  return withTenant(organisation, async (tx) => {
    const resultat = await tx.execute(
      sql`with supprimees as (
            delete from ${idempotence}
            where ${idempotence.expireLe} < now()
              and ${idempotence.organizationId} = ${organisation}
            returning 1
          )
          select count(*)::int as total from supprimees`,
    );
    const ligne = (resultat as unknown as { rows?: { total?: number }[] }).rows?.[0];
    return ligne?.total ?? 0;
  });
}
