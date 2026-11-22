/**
 * Politique de sécurité du contenu (CSP) — Chantier B (levée B5 / S-02).
 *
 * Inventaire vérifié des ressources réellement chargées par le navigateur :
 *  - Scripts : uniquement Next.js (`'self'`) et ses scripts d'hydratation / RSC
 *    estampillés par un nonce cryptographique généré par requête + `'strict-dynamic'`.
 *    Leaflet est empaqueté localement via npm (`import "leaflet"`) : aucun CDN
 *    (`unpkg.com`) n'est autorisé.
 *  - Styles : CSS compilé localement (`'self'`, y compris `leaflet/dist/leaflet.css`)
 *    + `'unsafe-inline'` conservé volontairement pour les attributs `style` de
 *    positionnement dynamique générés par Leaflet et les composants React.
 *  - Images : `'self'`, `data:` (icônes/SVG), `blob:` (aperçus locaux) et les
 *    tuiles satellites Esri (`https://server.arcgisonline.com`) utilisées par
 *    `MapViewer.tsx` et `MultiPlotMap.tsx`.
 *  - Connexions (`connect-src`) : `'self'` uniquement. Le navigateur n'appelle
 *    jamais Global Forest Watch ni FastAPI directement ; les tuiles Esri sont
 *    chargées via `<img>` (`img-src`).
 *  - Polices (`font-src`) : `'self'` et `data:` uniquement.
 *  - Objets / cadres : `object-src 'none'`, `frame-src 'none'`,
 *    `frame-ancestors 'none'`.
 *
 * En production (`isProd = true`) :
 *  - `'unsafe-eval'` est totalement retiré ;
 *  - `'unsafe-inline'` est absent de `script-src` ;
 *  - `upgrade-insecure-requests` est activé.
 *
 * Compatible Web Crypto (Node.js et Edge) : aucune dépendance à `node:crypto`.
 */

export const EN_TETE_CSP = "Content-Security-Policy";
export const EN_TETE_NONCE = "x-nonce";

/**
 * Hôte exact des tuiles cartographiques Esri utilisé dans
 * `src/components/MapViewer.tsx` et `src/components/MultiPlotMap.tsx`.
 */
export const HOTE_TUILES_CARTE = "https://server.arcgisonline.com";

/**
 * Génère un nonce cryptographique de 128 bits encodé en base64.
 * Un nouveau nonce doit être émis pour chaque requête HTTP.
 */
export function genererNonceCsp(): string {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);
  let binaire = "";
  for (let i = 0; i < octets.length; i += 1) {
    binaire += String.fromCharCode(octets[i]);
  }
  return btoa(binaire);
}

export interface OptionsCsp {
  nonce: string;
  isProd: boolean;
}

/**
 * Construit la valeur de l'en-tête bloquant `Content-Security-Policy`.
 */
export function construireCsp({ nonce, isProd }: OptionsCsp): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // En développement uniquement : React Fast Refresh / piles d'erreurs Next.js.
    ...(!isProd ? ["'unsafe-eval'"] : []),
  ];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Leaflet positionne ses calques par attributs `style="..."` inline.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${HOTE_TUILES_CARTE}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}
