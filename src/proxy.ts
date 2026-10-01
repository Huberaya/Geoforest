import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE } from "@/lib/auth/constants";
import { mfaRequiredFor } from "@/lib/auth/roles";
import { verifyAccessToken } from "@/lib/auth/tokens";
import {
  CADENCE_AUTH,
  CADENCE_AUTH_FENETRE_MS,
  CADENCE_IP_RAFALE,
  CADENCE_IP_RAFALE_FENETRE_MS,
  CADENCE_IP_SOUTENUE,
  CADENCE_IP_SOUTENUE_FENETRE_MS,
  CADENCE_ORG_RAFALE,
  CADENCE_ORG_RAFALE_FENETRE_MS,
  CADENCE_ORG_SOUTENUE,
  CADENCE_ORG_SOUTENUE_FENETRE_MS,
  CORPS_MAX_OCTETS,
  retryAfter,
} from "@/lib/api/limits";
import { adresseClient, verifierCadence } from "@/lib/rate-limit";

/**
 * Contrôle d'accès **deny-by-default**.
 *
 * Tout ce qui n'est pas explicitement public exige un jeton d'accès valide.
 * Le **proxy** ne vérifie que la signature du jeton, sans base de données ; la
 * validation complète — statut du compte, verrouillage, révocation,
 * permissions — est faite dans les routes via `guard()`.
 *
 * ⚠️ Pourquoi ce fichier s'appelle `proxy.ts` et non `middleware.ts`.
 *   Next 16 remplace la convention `middleware.ts` (moteur Edge) par `proxy.ts`
 *   (runtime **Node.js**). Ici le renommage n'a rien de cosmétique : un fichier
 *   `middleware.ts` produit une sortie « Edge Function », et l'hébergeur refuse
 *   les fonctions Edge dans un projet multi-services. Trois déploiements
 *   consécutifs ont échoué sur `EDGE_RUNTIME_UNSUPPORTED_IN_SERVICES` alors que
 *   la compilation, elle, réussissait — l'erreur ne survient qu'à la mise en
 *   production des artefacts.
 */

/** Chemins accessibles sans session. */
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/v1/auth/login",
  "/api/v1/auth/mfa",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/health",
  // Sonde de disponibilite : doit rester joignable sans authentification,
  // sinon un equilibreur de charge ne peut pas retirer l instance du pool.
  "/api/ready",
  // P1-06 — page de statut : publique par necessite. Fermer cette page
  // obligerait un client a se connecter pour savoir si la panne vient de chez
  // lui, ce qui est absurde en plein incident. Elle ne montre qu un etat
  // global ; les valeurs qui l expliquent restent reservees aux comptes
  // authentifies et aux outils de supervision.
  "/status",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname.startsWith("/api/v1/auth/");
}

/**
 * Routes de supervision : accessibles avec un jeton, sans session.
 *
 * ⚠️ P1-06 — pourquoi ne pas simplement les rendre publiques.
 *   `/api/metrics` décrit la topologie du service : quelles routes existent,
 *   lesquelles sont lentes, lesquelles échouent, et pour quelle organisation.
 *   Publiée, elle offrirait cette carte au premier venu. Elles ne sont donc
 *   ouvertes qu'au porteur d'un jeton explicite — et le contrôle est refait
 *   dans la route elle-même (`routeSupervision`) : le proxy est la
 *   première porte, pas la seule.
 */
const CHEMINS_SUPERVISION = new Set<string>(["/api/metrics", "/api/observability/alertes"]);

async function hasher(valeur: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valeur)));
}

/**
 * Compare deux secrets sans fuite par le temps.
 *
 * ⚠️ La comparaison porte sur des **condensats de longueur fixe**, jamais sur
 *   les secrets eux-mêmes : les comparer directement laisserait inférer leur
 *   longueur du temps de réponse.
 *
 *   Web Crypto est employé plutôt que `node:crypto` parce qu'il existe dans
 *   les deux moteurs : ce fichier a été écrit pour le moteur Edge et tourne
 *   désormais sous Node.js, où `crypto.subtle` est également disponible. Ce
 *   code est donc indifférent au moteur d'exécution — c'est une raison de ne
 *   pas y toucher sans nécessité.
 */
async function jetonSupervisionValide(request: NextRequest): Promise<boolean> {
  const attendu = process.env.GF_METRICS_TOKEN?.trim();
  if (!attendu) return false;
  const presente = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!presente) return false;
  const [a, b] = await Promise.all([hasher(attendu), hasher(presente)]);
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a[i] ^ b[i];
  return ecart === 0;
}

function isStatic(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icons/") ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf)$/i.test(pathname)
  );
}

/**
 * Identifiant de corrélation — P1-06.
 *
 * ⚠️ Deux précautions, sinon l'identifiant devient une faille :
 *
 *   · il n'est **jamais recopié tel quel** : accepter n'importe quelle chaîne
 *     permettrait à un appelant d'écrire ce qu'il veut dans le journal
 *     (fausses lignes, ou contenu destiné à polluer l'outil d'analyse). Un
 *     identifiant qui n'a pas la forme attendue est remplacé ;
 *   · il est **régénéré à l'entrée** et renvoyé dans la réponse, de sorte
 *     qu'un signalement client (« ma requête X a échoué ») se retrouve dans
 *     le journal sans que le client ait eu à le deviner.
 *
 * Le motif est volontairement identique à celui de `dansContexte()` côté
 * serveur : une divergence entre les deux produirait un identifiant accepté ici
 * et rejeté là, donc un journal qui ne correspond pas à la réponse.
 */
const MOTIF_IDENTIFIANT = /^[A-Za-z0-9_-]{8,64}$/;

const EN_TETE_IDENTIFIANT = "x-request-id";

function identifiantDeRequete(request: NextRequest): { id: string; entetes: Headers } {
  const propose = request.headers.get(EN_TETE_IDENTIFIANT)?.trim() ?? "";
  const id = MOTIF_IDENTIFIANT.test(propose) ? propose : crypto.randomUUID().replace(/-/g, "");
  // ⚠️ On remplace, on n'ajoute pas : un en-tête `x-request-id` posé en doublon
  //   serait lu différemment selon les couches traversées.
  const entetes = new Headers(request.headers);
  entetes.set(EN_TETE_IDENTIFIANT, id);
  return { id, entetes };
}

/**
 * En-têtes de sécurité.
 *
 * ⚠️ La CSP est posée en **Report-Only** : l'application charge Leaflet et les
 * tuiles Esri depuis des CDN. Une CSP bloquante casserait la carte — elle ne
 * sera activée qu'après inventaire des ressources externes (cf. P2-10).
 */
function withSecurityHeaders(response: NextResponse, idRequete?: string): NextResponse {
  // ⚠️ L'identifiant est renvoyé au client : c'est ce qui rend le journal
  //   exploitable par le support. Sans lui, un utilisateur qui signale « ça ne
  //   marche pas » ne peut désigner aucune ligne.
  if (idRequete) response.headers.set("X-Request-Id", idRequete);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      "img-src 'self' data: blob: https://*.arcgisonline.com https://unpkg.com",
      "connect-src 'self' https://*.arcgisonline.com https://data-api.globalforestwatch.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  return response;
}

/**
 * 429 — Trop de requêtes.
 *
 * L'en-tête `Retry-After` est renseigné : un client bien élevé attendra au
 * lieu de marteler, et un client hostile se heurtera à une borne prévisible.
 */
function limiteAtteinte(reessayerDans: number): NextResponse {
  const message = `Trop de requêtes. Réessayer dans ${reessayerDans} seconde(s).`;
  return withSecurityHeaders(
    NextResponse.json(
      {
        // `detail` est la clé que lit `extractError` côté client : sans elle,
        // l'utilisateur verrait « Erreur HTTP 429 » au lieu d'une phrase qui
        // lui indique quoi faire. `error` garde la forme utilisée par le reste
        // de l'API.
        detail: message,
        error: { code: "rate_limited", message },
      },
      { status: 429, headers: { "Retry-After": retryAfter(reessayerDans) } },
    ),
  );
}


function jsonUnauthorized(
  request: NextRequest,
  code: string,
  message: string,
  status: number,
  idRequete?: string,
) {
  const response = NextResponse.json({ error: { code, message } }, { status });
  return withSecurityHeaders(response, idRequete);
}

/**
 * Interrupteur d'exploitation de la limitation de cadence.
 *
 * `GF_RATE_LIMIT=off` la désactive. Deux garde-fous, parce qu'un interrupteur
 * que l'on oublie d'actionner au déploiement est une faille :
 *
 *   • la variable est **ignorée en production** (NODE_ENV=production) : une
 *     configuration reprise telle quelle d'un environnement de test ne peut
 *     pas désactiver la limitation sur le système réel ;
 *   • l'absence de la variable active la limitation — le défaut est sûr.
 *
 * Cet interrupteur existe parce que les suites de vérification antérieures
 * (P0-01 en particulier) enchaînent des dizaines de connexions : sans lui,
 * elles mesureraient la limitation au lieu de mesurer l'authentification. La
 * suite P1-07 s'exécute, elle, limitation **activée** — c'est son objet.
 */
const limitationActive =
  process.env.NODE_ENV === "production" || process.env.GF_RATE_LIMIT !== "off";

/** Routes recevant un mot de passe, un code TOTP ou un jeton : quota serré. */
const CHEMINS_SECRETS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/mfa",
  "/api/v1/auth/password",
]);


export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (isStatic(pathname)) return NextResponse.next();

  // ---------------------------------------------------------------- P1-06
  // L'identifiant est attribué une fois pour toutes à l'entrée : le reste du
  // proxy n'a plus à y penser, et les réponses d'erreur le portent aussi —
  // c'est précisément là qu'il sert.
  const { id: idRequete, entetes } = identifiantDeRequete(request);
  const suite = () => NextResponse.next({ request: { headers: entetes } });

  // ---------------------------------------------------------------- P1-07
  // Deux gardes posées **avant** tout travail : le corps n'est pas lu, la base
  // n'est pas touchée. Une requête qui dépasse une limite ne coûte presque
  // rien, ce qui est précisément le but.

  // 1. Taille annoncée. Le contrôle définitif est fait à la lecture
  //    (`lireCorpsJson`), mais refuser ici évite de recevoir le flux.
  const annonce = request.headers.get("content-length");
  if (annonce && Number(annonce) > CORPS_MAX_OCTETS) {
    return withSecurityHeaders(
      NextResponse.json(
        {
          detail: "Corps de requête trop volumineux",
          limite_octets: CORPS_MAX_OCTETS,
          annonce_octets: Number(annonce),
        },
        { status: 413 },
      ),
    );
  }

  // 2. Cadence. Deux fenêtres : la rafale, puis le régime soutenu.
  const ip = adresseClient(request.headers);

  // Seules les routes qui **reçoivent un secret** sont soumises au quota
  // serré : elles coûtent un hachage de mot de passe ou une vérification TOTP,
  // et ce sont elles qu'un adversaire martèle.
  //
  // ⚠️ Une première version rangeait tout `/api/v1/auth/*` dans ce quota,
  //    `me`, `refresh` et `logout` compris. Le parcours réel l'a démenti :
  //    le renouvellement de jeton est appelé à chaque rotation de session, et
  //    la limite se déclenchait en usage normal. Le quota ne vaut que pour ce
  //    qu'il protège réellement.
  if (CHEMINS_SECRETS.has(pathname)) {
    const v = limitationActive
      ? verifierCadence(`auth:${ip}`, CADENCE_AUTH, CADENCE_AUTH_FENETRE_MS)
      : null;
    if (v && !v.autorise) return limiteAtteinte(v.reessayerDans);
    return withSecurityHeaders(suite(), idRequete);
  }

  for (const [cle, max, fenetre] of [
    [`ip-rafale:${ip}`, CADENCE_IP_RAFALE, CADENCE_IP_RAFALE_FENETRE_MS],
    [`ip-soutenu:${ip}`, CADENCE_IP_SOUTENUE, CADENCE_IP_SOUTENUE_FENETRE_MS],
  ] as const) {
    if (!limitationActive) break;
    const v = verifierCadence(cle, max, fenetre);
    if (!v.autorise) return limiteAtteinte(v.reessayerDans);
  }

  // Supervision : un jeton explicite vaut session, pour un appelant qui ne
  // peut pas ouvrir de session interactive. Ce contrôle intervient APRÈS les
  // limites de taille et de cadence : le jeton identifie l'appelant, il ne
  // l'autorise pas à marteler.
  if (CHEMINS_SUPERVISION.has(pathname) && (await jetonSupervisionValide(request))) {
    return withSecurityHeaders(suite(), idRequete);
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = token ? await verifyAccessToken(token) : null;

  if (isPublic(pathname)) {
    // Déjà authentifié : inutile de retourner sur la page de connexion.
    if (claims && pathname === "/login") {
      return withSecurityHeaders(NextResponse.redirect(new URL("/", request.url)), idRequete);
    }
    return withSecurityHeaders(suite(), idRequete);
  }

  // Cadence par organisation : elle complète celle par adresse IP. Deux
  // organisations differentes derrière la même IP ne se pénalisent pas, et une
  // organisation ne peut pas épuiser le quota de ses voisines.
  if (claims?.org && limitationActive) {
    for (const [cle, max, fenetre] of [
      [`org-rafale:${claims.org}`, CADENCE_ORG_RAFALE, CADENCE_ORG_RAFALE_FENETRE_MS],
      [`org-soutenu:${claims.org}`, CADENCE_ORG_SOUTENUE, CADENCE_ORG_SOUTENUE_FENETRE_MS],
    ] as const) {
      const v = verifierCadence(cle, max, fenetre);
      if (!v.autorise) return limiteAtteinte(v.reessayerDans);
    }
  }

  if (!claims) {
    if (pathname.startsWith("/api/")) {
      return jsonUnauthorized(
        request,
        "unauthenticated",
        "Authentification requise.",
        401,
        idRequete,
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return withSecurityHeaders(NextResponse.redirect(loginUrl), idRequete);
  }

  // Les rôles soumis à la MFA doivent présenter une session validée par le second facteur.
  if (pathname.startsWith("/api/") && mfaRequiredFor(claims.role) && !claims.mfa) {
    return jsonUnauthorized(
      request,
      "mfa_required",
      "Double authentification requise pour cette action.",
      403,
      idRequete,
    );
  }

  return withSecurityHeaders(suite(), idRequete);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
