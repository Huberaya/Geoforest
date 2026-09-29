# Vercel — accueil public et comptes Clerk

Cible indiquée par l’utilisateur : https://geoforest-eabr.vercel.app/

## État constaté et limite d’accès

La lecture de la page publique le 29 septembre 2026 montre une interface d’audit de parcelles, sans les accès inscription/connexion demandés. Elle est différente de la version de travail du chantier 8. Le dépôt, la branche et le commit effectivement reliés au projet Vercel **ne sont pas connus avec certitude** ; ne pas présumer que Vercel suit `main` ni changer cette branche sans vérification.

L’accès à cette URL ne permet pas de modifier la configuration Vercel ou de publier un commit. Aucun déploiement, changement de branche, ajout de variable, changement Clerk ou écriture Neon n’a été effectué dans ce bloc.

## Routes préparées

| URL | Rôle |
|---|---|
| `/` | Accueil public sans appel nécessaire à Clerk ou à l’API métier |
| `/sign-up` | Formulaire officiel Clerk de création de compte, si ce fournisseur est activé |
| `/sign-in` | Formulaire officiel Clerk de connexion ; redirection OIDC dans l’autre mode |
| `/espace` | Application et pont de session sécurisé ; droits contrôlés par FastAPI/PostgreSQL |
| `/portail` | Portail fournisseur indépendant du compte Clerk |

Les liens inscription/connexion de l’accueil ne préchargent pas les parcours d’identité. Les écrans de compte restent publics : **l’API métier n’est pas nécessaire pour afficher un formulaire d’inscription ou de connexion**. Elle est nécessaire pour ouvrir un espace métier et exercer des droits.

Après inscription/connexion Clerk, les redirections imposées sont relatives : `/espace`. La déconnexion revient à `/`. Aucun hôte Arena temporaire n’est codé dans ces liens. Les paramètres Clerk/Vercel actuellement en console n’ont pas été consultés ni corrigés automatiquement ; vérifier également d’éventuelles anciennes URLs dans ces configurations.

La création d’une identité Clerk n’ajoute pas automatiquement une appartenance ou un rôle dans GeoForest. Le mode OIDC ne présente pas une fausse inscription : `/sign-up` indique explicitement que Clerk n’est pas activé.

## Informations nécessaires avant publication

1. Capture du dernier déploiement Vercel montrant son **dépôt, sa branche et son commit source**, ainsi que la racine du projet si elle n’est pas la racine du dépôt.
2. Vérification de l’accès permettant de publier les commits et de configurer/redéployer Vercel, ou réalisation de ces opérations par le propriétaire. Ne pas envoyer de secret dans le texte de la conversation ni capturer les valeurs des variables d’environnement.
3. URL et environnement du backend FastAPI existant, s’il est déjà hébergé. Sinon, choisir et qualifier cette cible avant de promettre un espace métier opérationnel. Un build Next.js ne déploie pas automatiquement le dossier backend Python ; un déploiement FastAPI sur Vercel ou ailleurs doit être configuré et qualifié séparément.

## Configuration à vérifier — ne pas appliquer aveuglément en production

Pour une **préproduction avec Clerk développement** :

- `AUTH_PROVIDER=clerk_development` et `APP_ENV=development` pour le frontend ; ce n’est pas une qualification de production même si l’URL est accessible publiquement.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` et `CLERK_ISSUER` correspondants ; clés existantes conservées hors Git.
- `NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED=true`, `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=true`.
- Pas de clé secrète Clerk dans le build frontend. Elle appartient au backend FastAPI uniquement.
- `API_INTERNAL_URL` doit désigner le backend réellement joignable depuis Vercel, pas `127.0.0.1:8000` ou `backend:8000`.
- Côté API : `PUBLIC_ORIGIN` égal à l’origine du frontend réellement testé, `ALLOWED_HOSTS` cohérent avec le proxy, cookies Secure et CSRF vérifiés. Pour tester une URL Vercel Preview distincte, utiliser son origine exacte plutôt que relâcher la validation `azp`/Origin.
- Activer l’inscription dans l’instance Clerk selon la politique souhaitée et valider l’e-mail. **La politique actuelle de l’instance et les fournisseurs OAuth disponibles restent à vérifier.** Aucun compte ni réglage distant n’a été créé par ce bloc.

Le backend Clerk développement actuel exige toujours une base locale suffixée `_test` et refuse les bases distantes et `APP_ENV=production`. **Ne pas brancher la configuration Neon Production, ni retirer ce garde-fou pour faire passer le déploiement.** Une préproduction persistante ou un lancement réel exige une architecture de test dédiée ou une qualification supplémentaire du mode production, notamment du MFA.

Le hostname stable `geoforest-eabr.vercel.app` ne transforme pas des clés de développement en authentification de production. Préférer d’abord un déploiement Preview contrôlé, sans remplacer le site public avant validation.

## Ordre de publication proposé

1. Vérifier dépôt/branche/racine et état du déploiement actuel.
2. Publier les commits locaux autorisés et préparer un déploiement Preview de la bonne branche ; pas de fusion ou modification implicite de `main`.
3. Configurer frontend, Clerk et backend de recette de manière cohérente, sans modifier Neon Production.
4. Tester accueil public, création d’identité, validation e-mail, connexion, accès `/espace`, renouvellement, déconnexion et séparation entre organisations sur cette URL.
5. Vérifier également les mentions d’information/confidentialité et les paramètres d’inscription avant une collecte publique de données personnelles. Résoudre les gates de production et obtenir l’accord de mise en ligne avant de promouvoir une version publique destinée à des données réelles.

Le serveur temporaire Arena n’est plus proposé comme URL d’accès au produit. Les captures locales montrent le travail préparé, pas un changement déjà publié sur Vercel.
