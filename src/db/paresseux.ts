/**
 * Initialisation paresseuse et transparence du proxy.
 *
 * ⚠️ Pourquoi ce module est partagé.
 *
 * Les deux pools de l'application (`src/db/index.ts` pour le tenant,
 * `src/db/admin.ts` pour les opérations système) doivent se comporter de la
 * même façon :
 *   · importer ne construit **aucune** connexion ;
 *   · le premier usage réel construit, ou échoue en nommant la variable
 *     d'environnement manquante ;
 *   · le proxy reste transparent pour l'appelant (réflexion, spread,
 *     `instanceof`, identité des méthodes).
 *
 * Deux implémentations d'un comportement aussi subtil finiraient par diverger,
 * et l'écart ne se verrait qu'en production. La version ci-dessous est celle
 * validée par `scripts/check-pool-admin.ts` (27 contrôles) ; elle est reprise
 * telle quelle par les deux pools et couverte par `scripts/check-pool-tenant.ts`.
 *
 * ⚠️ Un proxy qui ne piégeait que `get` et `has` n'était pas transparent :
 * `Object.keys` renvoyait `[]`, le spread `{}`, `instanceof` était faux et
 * l'identité des méthodes changeait à chaque accès. « Aucun appelant ne fait
 * cela » est une observation datée, pas une garantie.
 *
 * Toutes les trapes délèguent à l'instance réelle. Seule
 * `getOwnPropertyDescriptor` diffère : elle force `configurable: true`, parce
 * que la cible du proxy est un objet vide extensible et que déclarer une
 * propriété non configurable absente de cette cible violerait l'invariant du
 * langage (TypeError).
 */
const methodesLiees = new WeakMap<object, Map<PropertyKey, unknown>>();

/** Un constructeur porte toujours un `prototype` ; une méthode, jamais. */
function estConstructeur(valeur: unknown): boolean {
  return typeof valeur === "function" && "prototype" in valeur;
}

export function paresseux<T extends object>(cible: () => T): T {
  const lier = (reel: T, propriete: PropertyKey, valeur: unknown): unknown => {
    if (typeof valeur !== "function") return valeur;
    // ⚠️ Ne lier que les **méthodes**. Lier tout ce qui est appelable cassait
    // `adminPool.constructor` et `pool.Client` : une classe liée n'est plus
    // elle-même (`adminPool.constructor === Pool` devenait faux, et
    // `new pool.Client()` construisait autre chose). Une méthode n'a pas de
    // `prototype` ; un constructeur en a toujours un.
    if (estConstructeur(valeur)) return valeur;
    let cache = methodesLiees.get(reel);
    if (!cache) {
      cache = new Map();
      methodesLiees.set(reel, cache);
    }
    // La même méthode garde la même identité d'un accès à l'autre : sans cela
    // `adminPool.query !== adminPool.query`, ce qui casse toute comparaison ou
    // tout `removeListener`.
    if (!cache.has(propriete)) cache.set(propriete, valeur.bind(reel));
    return cache.get(propriete);
  };

  return new Proxy({} as T, {
    get(_vide, propriete) {
      const reel = cible();
      return lier(reel, propriete, Reflect.get(reel, propriete, reel));
    },
    set(_vide, propriete, valeur) {
      return Reflect.set(cible(), propriete, valeur);
    },
    has(_vide, propriete) {
      return propriete in cible();
    },
    deleteProperty(_vide, propriete) {
      return Reflect.deleteProperty(cible(), propriete);
    },
    defineProperty(_vide, propriete, descripteur) {
      return Reflect.defineProperty(cible(), propriete, descripteur);
    },
    ownKeys() {
      return Reflect.ownKeys(cible());
    },
    getOwnPropertyDescriptor(_vide, propriete) {
      const descripteur = Reflect.getOwnPropertyDescriptor(cible(), propriete);
      if (!descripteur) return undefined;
      return { ...descripteur, configurable: true };
    },
    getPrototypeOf() {
      // Rend `adminPool instanceof Pool` vrai : le proxy représente un Pool.
      return Reflect.getPrototypeOf(cible());
    },
  });
}

