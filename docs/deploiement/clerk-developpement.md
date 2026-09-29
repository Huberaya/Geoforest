# Clerk développement — raccordement local et recette humaine

## Périmètre autorisé

Ce mode complète l'authentification OIDC existante sans la remplacer par défaut. Il est **réservé à une base PostgreSQL locale dont le nom se termine par `_test`**. L'utilisation avec Neon Production, une URL distante, des paramètres de connexion alternatifs ou `APP_ENV=production` est refusée au chargement de la configuration backend.

Aucune migration SQL supplémentaire. Ne pas exécuter les fixtures de tests ni initialiser une nouvelle base sur Neon Production. Le mode ne reproduit pas encore les exigences MFA et d'exploitation d'une authentification Clerk de production.

## Configuration séparée

Valeurs communes au frontend et au backend :

- `AUTH_PROVIDER=clerk_development`
- `APP_ENV=development` (ou `test` pour les tests)
- `PUBLIC_ORIGIN` : origine réelle du navigateur, sans chemin ni slash terminal ; `http://localhost:3000` en local, HTTPS pour un aperçu distant.
- `CLERK_ISSUER` : URL HTTPS de l'instance développement, au format `https://<instance>.clerk.accounts.dev`.

**Backend FastAPI seulement** :

- `CLERK_SECRET_KEY`, clé `sk_test_…`, transmise par un canal privé.
- `DATABASE_URL` du runtime local, host `127.0.0.1` ou `localhost`, nom suffixé `_test`, sans paramètres query. Rôles app/migrateur séparés et migrations existantes déjà appliquées à cette cible locale.
- `SESSION_SECRET` aléatoire ; `ALLOWED_HOSTS` incluant l'hôte navigateur et celui du proxy interne.
- `ADMIN_ACR` vide : aucune équivalence de MFA Clerk avec un ACR OIDC n'est revendiquée.

**Frontend Next.js seulement** :

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, clé `pk_test_…` correspondant exactement à l'émetteur configuré. Cette clé est publique par conception.
- `NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED=true` et `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true`.
- `API_INTERNAL_URL` vers FastAPI sur le réseau privé. Le navigateur n'utilise que des URLs relatives `/api/…`.
- **Pas de `CLERK_SECRET_KEY` dans le frontend, même côté serveur Next.** Le parcours développé n'en a pas besoin.

Recompiler Next et redémarrer les deux services après tout changement de fournisseur, de clé publique, d'émetteur ou de proxy. Ne pas changer seulement les variables runtime d'un artefact déjà construit dans l'autre mode. Les secrets restent hors Git ; ne pas exporter une configuration contenant des clés dans un terminal partagé.

Le lanceur privé préparé pour l'aperçu Arena filtre explicitement la clé secrète avant de lancer Next, force la base locale et désactive les modules forêt/documents/diligence non concernés par cette recette. Il ne fait aucune migration, aucune écriture Neon et ne crée pas de compte Clerk.

## Architecture et autorisation

Le SDK officiel `@clerk/nextjs` fournit les composants client de connexion, localisés en français. Il n'est **pas utilisé pour autoriser les données côté serveur Next** : pas de `auth()` Next, pas de middleware d'authentification Next, pas de données métier rendues sur le serveur frontend.

Ce choix évite de faire dépendre la première page du handshake serveur de Clerk. Le SDK navigateur gère sa session ; FastAPI reste l'unique autorité d'authentification applicative et d'autorisation métier. Toute future route serveur Next accédant aux données devra passer par les contrôles FastAPI, et non faire confiance à un état client ou à une simple présence de cookie.

Les pages entreprise et connexion sont regroupées sous `src/app/(workspace)` sans changement d'URL. Le portail `/portail` reste en dehors du provider Clerk et du pont de session : son invitation sécurisée ne nécessite pas de compte Clerk.

### Échange

`POST /api/auth/clerk/exchange` exige une origine exacte et un Bearer token Clerk. Le serveur :

1. Vérifie signature RS256, version v2, `iss`, `azp`, dates, sujet et session.
2. Relit auprès de Clerk la session active et le profil correspondant, dont l'e-mail principal vérifié. Une indisponibilité ou un quota refuse le renouvellement.
3. Lie l'utilisateur GeoForest par `(issuer, subject)` ; **aucune fusion automatique par e-mail**, aucun transfert de permissions depuis des claims ou métadonnées Clerk.
4. Crée ou renouvelle une session GeoForest HttpOnly/SameSite=Lax, Secure et préfixée `__Host-` en HTTPS.
5. Fixe l'expiration au plus tôt entre celle du JWT et **60 secondes après le contrôle** ; une preuve valable moins de dix secondes est refusée.

Le cookie opaque et le CSRF sont conservés lors d'un renouvellement pour le même utilisateur ; changement d'identité = rotation et révocation de l'ancienne session. Aucun JWT Clerk n'est stocké dans PostgreSQL ou localStorage par notre code. Les appartenances et rôles GeoForest restent en base. Une création d'organisation demeure une action métier explicite, pas une conséquence automatique de la connexion.

Le navigateur renouvelle toutes les vingt secondes et au retour d'un onglet visible, avec traitement des erreurs, timeout et une seule opération de renouvellement simultanée par pont. Un navigateur suspendu peut perdre sa session ; à son retour, les vues sont masquées tant qu'une nouvelle preuve n'est pas vérifiée. Les API imposent toujours leur propre contrôle d'expiration.

### Révocation et déconnexion

Une révocation distante n'est pas poussée instantanément à GeoForest : **fenêtre résiduelle maximale de 60 secondes** pour une session locale déjà accordée. Le prochain renouvellement relit la session Clerk, sans cache de profil/session. Aucun webhook de révocation n'est installé.

`POST /api/auth/clerk/logout` impose Origin et `X-GFT-Logout: 1`, y compris pour un cookie expiré. Il révoque la session locale et efface son cookie. Le bouton frontend attend un renouvellement en cours, ferme la session locale puis appelle `signOut()` du SDK Clerk ; un échec est signalé et non présenté comme une déconnexion complète. Un renouvellement serveur arrivant avec un cookie déjà révoqué est refusé.

Changer `AUTH_PROVIDER` rend les sessions de l'autre parcours inutilisables dans les API. Cela n'est pas une migration des identités ou une révocation globale des anciennes sessions de tous les fournisseurs.

## Protections de charge et réseau

- Cache JWKS par processus, 60 secondes et 64 clés maximum. Une nouvelle clé non encore en cache peut être refusée jusqu'au rafraîchissement ; un `kid` inconnu ne déclenche pas des rafraîchissements réseau illimités.
- Quatre vérifications simultanées maximum par vérificateur ; budget réseau de dix secondes avec timeouts HTTP, taille de réponse bornée à 128 KiB. Le budget n'est pas une garantie temps réel sur les étapes CPU/SQL.
- 30 échanges par minute et par pair, compteur partagé PostgreSQL. Ce plafond conservateur peut toucher plusieurs utilisateurs derrière le même proxy ; il ne constitue pas une qualification de charge production.
- Pas de redirection HTTP suivie par le vérificateur ; domaines fournisseurs fixes, TLS vérifié, clé secrète seulement vers l'API backend Clerk.
- Dans le lanceur local, Uvicorn utilise `--no-proxy-headers` : un X-Forwarded-For envoyé par le client ne doit pas contourner les limites. En production future, qualifier séparément la chaîne de proxies et les quotas.
- CSP limitée à l'émetteur Clerk configuré, aux domaines documentés de protection Clerk/Cloudflare et aux images Clerk. Les sources supplémentaires ne sont activées qu'en mode Clerk développement. La CSP existante utilise encore unsafe-inline ; ce bloc n'est pas une qualification de CSP stricte avec nonce.

## Recette humaine dans l'aperçu

1. Ouvrir l'aperçu dans **un nouvel onglet**, plutôt que rester dans un iframe pouvant bloquer les cookies ou une connexion OAuth.
2. Cliquer sur « Se connecter en toute sécurité », puis utiliser votre compte Clerk développement existant. Ne transmettre ni mot de passe ni code de connexion à l'assistant.
3. Vérifier l'arrivée dans GeoForest avec votre identité. L'absence d'organisation au premier accès est normale : aucune appartenance n'est créée depuis Clerk.
4. Si nécessaire, créer uniquement une organisation **fictive de recette**, puis vérifier qu'un second compte sans appartenance n'y accède pas.
5. Attendre plusieurs renouvellements ; tester la déconnexion et, séparément, la révocation de la session dans Clerk en tenant compte de la fenêtre maximale de 60 secondes.
6. Signaler toute erreur sans joindre de token, cookie ou capture contenant des secrets.

La base locale est temporaire, distincte de Neon et non qualifiée pour la conservation de données métier. Ne pas y déposer de documents ou données réels. Le démarrage et les tests automatisés ne remplacent pas cette connexion humaine ni une validation de tous les modes OAuth, MFA ou récupération de compte disponibles dans votre instance.
