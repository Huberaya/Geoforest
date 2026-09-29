# Backend GeoForest sur Vercel — préparation et recette

29 septembre 2026. **Configuration préparée, aucun backend déployé par ce chantier.** L'achat du domaine et l'activation réelle de Clerk production restent reportés à la fin du projet, conformément à la décision utilisateur.

## Architecture retenue pour la préparation

Deux projets Vercel, issus du même dépôt :

| Projet | Racine | Fonction |
|---|---|---|
| Frontend existant | racine du dépôt | Next.js et routage public `/api/*` vers l'API HTTPS |
| Backend à créer/qualifier | `backend` | FastAPI, secrets Clerk serveur, accès Neon |

Ce choix évite de placer les secrets Neon/Clerk serveur dans le projet frontend. Aucun second projet n'a été créé et aucun plan payant n'a été souscrit. Vérifier le plan, l'usage commercial autorisé, les coûts et quotas avant déploiement. Vercel Hobby n'est pas un plan de lancement SaaS commercial.

Ne pas activer l'inclusion des sources situées au-dessus de la racine backend sans audit du contenu du bundle. Ne pas remplacer la configuration du projet frontend par celle de `backend/vercel.json`.

## Packaging préparé

- Entrée native FastAPI : `app/main.py`, objet `app`. Ce n'est pas un serveur de démonstration.
- `backend/.python-version` : Python 3.13.
- `backend/requirements.txt` : dépendances d'exécution épinglées, dont Pillow, pypdf, reportlab, rasterio et psycopg. Sous-ensemble vérifié de `requirements.lock`, sans pytest/iniconfig/pluggy/Pygments.
- `requirements.lock` reste le manifeste de test complet. La CI teste l'alignement des deux listes.
- Le Dockerfile utilise désormais les dépendances d'exécution ; il reste distinct du déploiement Functions.
- `backend/vercel.json` : framework FastAPI, région candidate `fra1`, durée maximale de 60 secondes, exclusion des tests, caches, fichiers `.env` et migrations du bundle d'exécution.
- Les références géographiques et la police PDF embarquée sont conservées. Aucune migration n'est exécutée au build ou au démarrage.
- `.vercelignore` ajoute une protection contre l'envoi de fichiers locaux d'environnement et de test.

La configuration JSON a été validée contre le schéma officiel Vercel. **Cela ne constitue pas un build cloud.** La région `fra1` est une proposition UE : confirmer sa pertinence par rapport à la région Neon, au plan et aux obligations de traitement des données. Une région de calcul ne garantit pas seule toute la résidence des données.

## Profil Vercel du noyau API

Le marqueur d'environnement `VERCEL=1` active les gardes suivantes :

- `APP_ENV=production` obligatoire ; les gardes Clerk/TLS/RLS de production restent inchangées ;
- `DATABASE_POOL_SIZE` au plus 2 ;
- `DATABASE_MAX_OVERFLOW=0` ;
- `FOREST_ANALYSIS_ENABLED=false`, `DOCUMENTS_ENABLED=false`, `DILIGENCE_ENABLED=false`.

**Ce profil n'est pas la livraison complète des huit chantiers.** Il prépare l'identité et les opérations du noyau API. Le coffre POSIX, les workers forestiers et les exports de diligence ne peuvent pas être activés dans ce profil tant que leurs adaptations et qualifications ne sont pas réalisées. La configuration refuse leur activation au lieu de laisser croire qu'ils sont utilisables sur Functions.

Les modules restent présents pour les autres modes d'hébergement et les tests locaux. La recette navigateur/métier finale doit annoncer clairement les modules disponibles.

## Variables backend à préparer

| Variable | Valeur ou contrainte |
|---|---|
| `APP_ENV` | `production` |
| `AUTH_PROVIDER` | `clerk_production` une fois domaine et instance live prêts |
| `PUBLIC_ORIGIN` | Domaine applicatif HTTPS canonique |
| `ALLOWED_HOSTS` | Hôtes explicites : application et API ; pas de wildcard |
| `CLERK_ISSUER`, `CLERK_SECRET_KEY`, `SESSION_SECRET`, `ADMIN_ACR` | Voir le guide Clerk production ; `ADMIN_ACR=clerk-mfa` |
| `DATABASE_URL` | URI runtime Neon, jamais le propriétaire/migrateur ; TLS `verify-full` |
| `DATABASE_CONNECTION_MODE` | `direct` ou `transaction_pool`, choisi explicitement |
| `DATABASE_POOL_SIZE` | `2`, ou `1` après qualification de charge |
| `DATABASE_MAX_OVERFLOW` | `0` |
| `DATABASE_POOL_TIMEOUT` | 5 secondes par défaut |
| `DATABASE_CONNECT_TIMEOUT` | 5 secondes par défaut |
| `DATABASE_POOL_RECYCLE` | 300 secondes par défaut |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 15 000 ms par instruction SQL par défaut |
| `DATABASE_LOCK_TIMEOUT_MS` | 3 000 ms d'attente de verrou SQL par défaut |
| Les trois indicateurs de modules avancés | `false` dans ce profil |

Ne jamais fournir les identifiants de migration à l'application. `VERCEL` est fourni par la plateforme ; vérifier sa présence effective, ne pas le falsifier pour contourner le profil.

### Certificats TLS portables

L'URI doit conserver `sslmode=verify-full` et un `sslrootcert` explicite. Le sélecteur **`sslrootcert=certifi`** est maintenant pris en charge par l'application : il est résolu vers le fichier CA du paquet certifi embarqué, puis transmis à psycopg. Cela évite de supposer que Vercel possède le même chemin de certificats que Debian.

Un chemin CA explicite fourni par l'opérateur reste possible. Ce mécanisme ne désactive ni la chaîne de confiance ni la vérification du nom d'hôte. La connexion TLS réelle à Neon reste à tester sur le runtime cloud ; l'existence locale du bundle CA ne la prouve pas.

## Connexions et verrous PostgreSQL

### Noyau API

Le pool est borné et vérifié avant réutilisation (`pool_pre_ping`), avec délai d'attente, recyclage et délai de connexion. La limite est **par instance**, pas globale : 50 instances avec un pool de 2 peuvent encore créer 100 connexions clientes. Dimensionner les limites Neon et la concurrence Vercel ; un petit pool ne remplace pas un test de charge.

L'identité RLS reste installée par `set_config(..., true)`, à portée de transaction. Les limites de durée SQL et d'attente de verrou utilisent également une portée locale. Un échec ou un rollback ne doit pas laisser l'identité du client précédent sur une connexion réutilisée.

### Pooler Neon

Un hôte Neon contenant `-pooler.` est refusé tant que `DATABASE_CONNECTION_MODE=transaction_pool` n'est pas déclaré. Pour le noyau API à transactions courtes, cette option est envisageable, **après recette du véritable pooler**.

Les traitements documents et forêt utilisent des verrous consultatifs de session, incompatibles avec le pooling transactionnel Neon. Ils sont donc refusés en mode `transaction_pool`, même hors Vercel. Il ne faut pas ajouter simplement `-pooler` à une ancienne URI de production.

### Traitements conservés hors profil Vercel

Les verrous forestiers et antivirus utilisent maintenant une connexion directe **séparée du pool API**, avec `NullPool`. Sa fermeture physique libère aussi les verrous de session en cas d'exception. Un traitement ne monopolise plus une connexion du petit pool métier.

Cette connexion utilise la même URI/base/rôle, pas une deuxième base de coordination. Les limites globales de traitements existantes restent présentes. Les connexions directes supplémentaires doivent néanmoins être comptées dans le dimensionnement des workers ; `NullPool` n'est pas une limite de concurrence globale.

Pour un proxy PostgreSQL non Neon, le nom d'hôte ne permet pas de détecter automatiquement son mode : la déclaration de l'opérateur et la recette restent indispensables.

## Démarrage et health checks

Le lifespan de production conserve ses contrôles : rôle runtime sans privilège dangereux, tables/politiques RLS, schéma `0007` et présence de PostGIS.

Une protection supplémentaire, `RuntimeReadinessGate`, effectue ces contrôles avant les requêtes HTTP de production même si l'adaptateur ASGI n'émet pas d'événements lifespan. Elle mémorise seulement les succès, au maximum 60 secondes par instance, et refuse l'accès avec HTTP 503 sans détails sensibles si le contrôle échoue. Les contrôles sont sérialisés avec une attente bornée.

- `/health/live` : prouve seulement que l'application répond ; ne teste pas la base.
- `/health/ready` : vérifie fraîchement la configuration de données ; ne se contente pas du cache de la protection.

Ne jamais considérer un simple 200 sur `/health/live` comme une autorisation de publier. La vérification initiale n'est pas un audit DBA permanent : surveiller également les changements de privilèges, les erreurs et les health checks.

## Routage frontend

En environnement `VERCEL=1` **ou** `APP_ENV=production`, `API_INTERNAL_URL` doit être une origine HTTPS DNS publique explicite. L'absence de valeur provoque un échec de configuration/build clair, et non un repli silencieux vers localhost.

Les adresses IP littérales, HTTP, hôtes internes usuels, identifiants dans l'URL, chemins, ports non canoniques, query strings et fragments sont refusés. La cible ne doit pas être l'origine frontend elle-même. La destination conserve `/api` : une requête `/api/v1/me` rejoint le même chemin sur le backend.

Ces contrôles sont syntaxiques : **résolution DNS réelle, CNAME vers une adresse privée et boucles via un alias restent à vérifier au déploiement**. Les adresses `.example` utilisées pour les builds de test ne sont pas des services déployés.

En mode Clerk, aucune réécriture Keycloak n'est ajoutée. En mode OIDC hébergé, les réécritures historiques `/identity/*` ne sont ajoutées que si une destination explicite est donnée ; sinon l'émetteur OIDC peut être servi sur son propre domaine. Les replis locaux restent disponibles uniquement pour le développement non hébergé.

Ce profil de routage vise des projets Vercel séparés. Une topologie auto-hébergée avec proxy HTTP privé nécessitera une configuration explicite adaptée ; ne pas la faire passer pour du développement pour contourner les gardes.

## Recette cloud restant obligatoire

Aucun élément ci-dessous n'a été exécuté dans ce chantier :

1. vérifier plan commercial, quotas/coûts et accès de publication ; créer/relier le projet backend avec racine `backend` ;
2. préparer le rôle et les paramètres Neon autorisés sans migration/reset ; conserver la séparation des secrets entre projets ;
3. lorsque le domaine sera disponible, configurer Clerk live selon son guide ;
4. effectuer un vrai build Vercel et contrôler contenu/taille du bundle Python, références, CA et dépendances natives ;
5. vérifier commit, région et configuration effective du déploiement ;
6. tester `/health/live` et `/health/ready`, puis démarrage à froid, mauvais rôle et mauvaise version de schéma sur une base de recette autorisée, jamais en altérant Neon Production ;
7. vérifier les hôtes vus par l'API, cookies, CSRF/Origin, l'absence de cache privé et la protection des environnements de recette ;
8. qualifier l'adresse du pair ASGI derrière Vercel : le limiteur de débit actuel ne fait pas confiance arbitrairement à `X-Forwarded-For`. Ne pas laisser tous les utilisateurs partager par erreur le même quota ;
9. tester pooler/TLS, concurrence, saturation, timeouts, annulation et absence de fuite d'identité entre organisations ;
10. réaliser l'inscription/connexion/MFA réelles, puis publier l'artefact validé en **Production**, avec preuve de l'alias public et possibilité de retour arrière.

La Preview restera un outil de recette, pas la livraison finale. Les secrets temporaires de publication supprimés précédemment ne sont pas réutilisés. Ne pas envoyer de secrets dans le chat ou les rapports.

## Références

- [FastAPI sur Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Runtime Python et limites de packaging](https://vercel.com/docs/functions/runtimes/python)
- [Schéma de configuration Vercel](https://openapi.vercel.sh/vercel.json)
- [Pooler Neon et verrous de session](https://neon.com/docs/connect/connection-pooling)
- [Clerk production : configuration et recette](clerk-production.md)

## Reprise du chantier 4 — constat public du 29 septembre 2026

L'[audit 04b](../rapports/04b-reprise-geospatial-production.md) constate `/sign-in` en 404 et les chemins `/api/v1/me` / catalogue géospatial en erreur `DNS_HOSTNAME_RESOLVED_PRIVATE` sur le domaine public fourni. Le routage local compile correctement vers une cible HTTPS fictive ; aucune configuration distante n'a été corrigée ou publiée par cet audit. Priorité : inspecter le projet et le déploiement **Production** via un accès actuel, raccorder le backend public puis effectuer la recette authentifiée. Ne pas assimiler le build local au déploiement.
