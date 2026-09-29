# Clerk production — configuration et recette

Date : 29 septembre 2026. **Guide de préparation, pas attestation de déploiement.**

## 1. Prérequis réels

La documentation Clerk demande un **domaine possédé par l'exploitant avec accès DNS** pour une instance de production. Le domaine partagé `geoforest-eabr.vercel.app` ne remplace pas ce prérequis. L'application peut rester hébergée sur Vercel avec un domaine personnalisé. La redirection éventuelle de l'alias Vercel vers ce domaine sera configurée lors du chantier de publication.

Le code de ce chantier prend en charge le modèle standard :

- application : `https://app.votre-domaine.tld` ou `https://votre-domaine.tld` ;
- Frontend API Clerk : `https://clerk.votre-domaine.tld` ;
- même domaine racine, sans proxy FAPI ni domaine satellite.

Ces exemples ne sont pas des domaines achetés ou configurés. La validation syntaxique ne prouve pas la propriété DNS ni la disponibilité des certificats.

À préparer dans Clerk, sans souscription automatique :

1. créer/configurer l'instance **Production**, distincte de Development ;
2. déclarer le domaine, poser les enregistrements indiqués par Clerk et vérifier les certificats ;
3. activer un parcours avec adresse email principale vérifiée ;
4. rendre disponible un second facteur, de préférence TOTP, et les moyens de récupération ; vérifier les possibilités/coûts du plan avant toute activation payante ;
5. permettre une stratégie de premier facteur compatible avec la revérification, par exemple mot de passe ou code email ;
6. restreindre la liste des sous-domaines autorisés au domaine applicatif utilisé ;
7. vérifier `/sign-in`, `/sign-up` et le retour vers `/espace` ;
8. si une connexion sociale est souhaitée, fournir ses propres paramètres OAuth de production. Aucun fournisseur social n'est configuré par ce chantier.

**Ne pas importer ni fusionner automatiquement les utilisateurs de développement avec ceux de production.** L'identifiant applicatif est déterminé par `(issuer, subject)`, jamais par la seule adresse email.

## 2. Variables frontend

| Variable | Valeur / rôle |
|---|---|
| `APP_ENV` | `production` |
| `AUTH_PROVIDER` | `clerk_production` |
| `PUBLIC_ORIGIN` | Origine HTTPS canonique choisie, sans slash final, port ou chemin |
| `CLERK_ISSUER` | URL FAPI de l'instance live, exactement celle des JWT |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clé `pk_live_…` fournie par cette même instance |
| `API_INTERNAL_URL` | Backend HTTPS réel à préparer au chantier suivant ; ne pas laisser le repli local sur Vercel |

**Aucun `CLERK_SECRET_KEY`, secret de session ou mot de passe Neon dans le frontend ou les variables `NEXT_PUBLIC_*`.** Le validateur frontend n'a pas besoin de la clé secrète Clerk.

La clé publique et l'émetteur doivent correspondre. Le mode production refuse les clés test, les origines HTTP, les domaines de développement, `*.vercel.app` et les configurations hors du modèle standard ci-dessus.

Un build compilé avec une clé `pk_test_…` **ne devient pas un build production par simple promotion**. Reconstruire avec les variables Production correctes, puis vérifier le commit et le déploiement associés au domaine public.

## 3. Variables backend

| Variable | Valeur / rôle |
|---|---|
| `APP_ENV` | `production` |
| `AUTH_PROVIDER` | `clerk_production` |
| `PUBLIC_ORIGIN` | Identique à l'origine applicative frontend ; validation stricte de `Origin` et `azp` |
| `ALLOWED_HOSTS` | Hôtes explicites acceptés par l'API, incluant l'hôte de `PUBLIC_ORIGIN`, sans wildcard |
| `CLERK_ISSUER` | Identique à la configuration frontend |
| `CLERK_SECRET_KEY` | Clé `sk_live_…` de la même instance, backend uniquement |
| `SESSION_SECRET` | Secret aléatoire indépendant, au moins 32 caractères, sans placeholder |
| `ADMIN_ACR` | Valeur imposée `clerk-mfa` |
| `DATABASE_URL` | Rôle runtime Neon non propriétaire, driver psycopg, TLS `verify-full` et `sslrootcert` valide |

Les paramètres et secrets OIDC ne sont pas requis dans ce mode. Le fonctionnement OIDC existant reste disponible séparément, avec ses gardes de production inchangées.

Le démarrage production conserve ses vérifications : rôle sans contournement RLS, schéma `0007`, PostGIS. La gestion des connexions et des verrous pour Vercel reste le chantier suivant ; ne pas changer aveuglément la connexion Neon en connexion `-pooler`.

Le mode `clerk_development` conserve ses restrictions : environnement non production, base locale `_test`, aucune connexion distante. **Ne jamais le réutiliser pour connecter Neon.**

## 4. Contrat de sécurité

### Preuve d'identité

Le navigateur obtient un JWT Clerk puis le transmet au backend dans l'en-tête `Authorization`, jamais dans une URL.

Le serveur contrôle : signature RSA/RS256, version 2, émetteur exact, origine autorisée `azp`, identifiants `sub` et `sid`, dates `iat`/`nbf`/`exp`, durée maximale du JWT de cinq minutes, état non pending et absence de jeton d'impersonation.

En production, les clés publiques sont obtenues depuis **`https://api.clerk.com/v1/jwks`**, avec la clé de l'instance live. La clé secrète n'est jamais envoyée à l'hôte FAPI configurable. Le serveur relit la session et le profil dans la Backend API : session active appartenant au bon utilisateur, compte explicitement non banni/non verrouillé, email principal vérifié.

Les requêtes sortantes sont bornées, sans suivi de redirection, avec cache JWKS de 60 secondes et limite de concurrence. Une indisponibilité, un timeout ou un dépassement de quota ne crée pas de session applicative. Une rotation de clé inconnue peut nécessiter d'attendre l'expiration du cache JWKS avant une nouvelle tentative ; aucun relâchement de signature.

### Session applicative

`POST /api/auth/clerk/exchange` crée ou renouvelle une session opaque :

- cookie `__Host-gft-session`, Secure, HttpOnly, SameSite=Lax, Path=/, sans Domain ;
- seul son condensat est enregistré dans PostgreSQL ;
- durée maximale de **60 secondes**, jamais au-delà de l'expiration du JWT ;
- renouvellement client toutes les 20 secondes, avec nouvelle vérification serveur de Clerk ;
- changement de session Clerk : rotation du cookie et du jeton CSRF, révocation du précédent ;
- séparation des sessions OIDC, Clerk développement et Clerk production ;
- contrôles Origin et CSRF maintenus pour les écritures métier.

La révocation côté Clerk, le blocage du compte ou une panne empêchent le renouvellement. **Une session applicative déjà délivrée peut rester utilisable jusqu'à son expiration, au maximum 60 secondes.** Aucune révocation globale instantanée par webhook n'est annoncée.

La déconnexion révoque la session applicative du navigateur puis appelle Clerk sign-out. Le client attend les renouvellements déjà en cours. En cas d'échec, il indique que la déconnexion complète n'est pas confirmée ; une requête différée utilisant un cookie révoqué ne peut pas le réactiver.

### Permissions et MFA

Les rôles, organisations et métadonnées fournis par le navigateur ou les claims organisationnels Clerk ne créent aucun droit métier. Les appartenances sont lues dans PostgreSQL/RLS. Une nouvelle identité n'obtient pas automatiquement un accès à une entreprise existante. La création volontaire d'une nouvelle organisation suit le parcours métier existant et exige la MFA en production.

Pour les opérations déjà protégées par `require_mfa`, le serveur exige :

- un second facteur activé dans le profil retourné par Clerk ;
- des âges `fva` signés valides pour **les deux facteurs** ;
- une vérification récente, dans une fenêtre maximale de dix minutes.

Le calcul utilise une borne conservatrice pour l'arrondi de `fva` à la minute, ancrée sur `iat` avec marge d'horloge. La durée réellement accordée peut donc être plus courte. Le renouvellement d'un cookie ne suffit pas à prolonger une ancienne preuve MFA.

L'assurance dérivée est enregistrée dans le champ `sessions.acr` existant sous la forme interne `clerk-production:<sid>:<échéance>`. **Aucune migration de schéma n'est nécessaire.** Ce marqueur est produit par le serveur, pas accepté depuis le navigateur. L'échéance est contrôlée lors des opérations protégées ; `/api/v1/me` utilise le même contrôle.

## 5. Parcours utilisateur de renforcement

1. Dans l'espace entreprise, ouvrir **Sécurité du compte**.
2. Activer le second facteur dans le composant de gestion de compte Clerk.
3. Sélectionner **Vérifier mon identité**.
4. Le serveur vérifie une nouvelle preuve via `/api/auth/clerk/assurance`. Si nécessaire, il demande une revérification `multi_factor` avec une fenêtre de cinq minutes au composant Clerk.
5. Après le dialogue, une nouvelle preuve est contrôlée côté serveur, puis la session métier est renouvelée et son état relu.

L'endpoint d'assurance ne crée ni session métier ni rôle. Une annulation, un échec ou la seule fermeture du dialogue ne donne aucun privilège.

**Attention : Clerk documente une possibilité de repli vers un seul facteur lorsque l'utilisateur n'a pas de second facteur. Le backend GeoForest ne l'accepte pas pour l'administration.** L'utilisateur doit effectivement activer la MFA.

## 6. Recette obligatoire sur l'instance réelle

Les tests automatisés du chantier utilisent des données fictives et des réponses Clerk simulées. Avant publication, réaliser avec des comptes de recette autorisés :

- inscription réelle, validation email, connexion et renouvellement sur le domaine définitif ;
- refus d'un email non vérifié, compte banni/verrouillé, mauvaise origine ou session révoquée ;
- accès ordinaire sans MFA, refus des opérations administrateur, enrôlement TOTP, renforcement puis expiration ;
- annulation de la MFA, second facteur supprimé, stratégie de connexion incompatible avec la revérification ;
- déconnexion locale et Clerk, relecture après expiration, changement d'identité et plusieurs onglets ;
- deux entreprises, accès refusé entre elles et droits fournisseur limités ;
- panne/quota Clerk sans fuite de secrets et sans ouverture de droits ;
- smartphone et ordinateur, y compris les vrais composants Clerk de MFA ;
- rôle runtime Neon, RLS, cookies derrière le proxy, absence de cache partagé pour les réponses privées et charge supportable des renouvellements.

Ne pas enregistrer les JWT, cookies, clés ou profils complets dans les logs, traces ou captures de recette. Configurer également la rétention et la protection des journaux de la plateforme.

## 7. Retour arrière et limites

Aucune donnée Neon ni configuration distante n'a été modifiée par ce chantier. Le code n'effectue aucune fusion d'identités ni migration automatique des comptes.

En cas d'échec de déploiement futur : revenir au dernier artefact **qualifié**, avec sa configuration d'identité correspondante, ou suspendre la connexion. Ne pas revenir à `clerk_development` sur Neon. Les sessions production ne sont pas acceptées comme sessions de développement/OIDC.

Restent hors de ce chantier : déploiement du backend Vercel, routage API réel, coffre durable, antivirus, coordination/pooling des workers, éventuelle synchronisation d'identité par webhooks et dimensionnement des quotas Clerk. Les fonctionnalités de fournisseur, de conformité et les validations humaines ne sont pas remplacées par Clerk.

## Sources consultées

- [Déploiement Clerk production](https://clerk.com/docs/guides/development/deployment/production)
- [Claims des jetons de session, dont fva](https://clerk.com/docs/guides/sessions/session-tokens)
- [Revérification et limites des facteurs](https://clerk.com/docs/guides/secure/reverification)
- [Hook useReverification](https://clerk.com/docs/nextjs/reference/hooks/use-reverification)
- [JWKS Backend API](https://clerk.com/docs/reference/backend-api/tag/jwks/get/jwks)
