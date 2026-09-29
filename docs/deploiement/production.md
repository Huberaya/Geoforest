# Préparer un déploiement de production — chantier 8 en cours

**Ce document n’est pas une recette de production validée. Ne pas exposer les données métier avant levée des critères bloquants.** La cible proposée est documentée dans [la recommandation UE](recommandation-hebergement-ue.md), sans ressource souscrite.

## 1. Séparer développement et production

Le `docker-compose.yml` fourni reste une pile de **développement** : HTTP, Keycloak `start-dev`, secrets de développement, aucune qualification antivirus/coffre dans l’image de base. Le flag diligence est désormais transmis, mais les documents restent explicitement désactivés dans cette pile. Définir `DOCUMENTS_ENABLED=true` dans `.env` ne transforme pas cette image en service de coffre qualifié.

Aucun fichier Compose de production « prêt à lancer » n’est revendiqué. Il serait trompeur de fournir un tel fichier avant test des images, de la sandbox, du coffre et de la cible.

- Application non root ; runtime DB distinct du migrateur et de l’administrateur du service managé.
- Migration réalisée par un job/opérateur distinct, secrets retirés du runtime.
- DB et backend non publics ; seule l’entrée TLS doit être exposée.
- IdP de production avec données persistantes, mise à jour, TLS et MFA réellement imposé ; pas de compte démo ni de base embarquée de recette.
- Codes OIDC, tokens de portail, secrets et identifiants personnels exclus des logs de requêtes et de supervision.

## 2. Configuration de production : contrôles implémentés

`APP_ENV=production` exige désormais :

- `PUBLIC_ORIGIN` HTTPS, avec hostname, sans identifiants, query, fragment, chemin ni slash terminal. Exemple de forme : `https://trace.example.invalid` (remplacer par le domaine réel).
- `OIDC_ISSUER` HTTPS sans identifiants/query/fragment ; le chemin du realm est permis. Le discovery doit correspondre **exactement** à cette valeur.
- `OIDC_BACKCHANNEL_ORIGIN`, s’il est renseigné, doit être une origine HTTPS sans chemin. La configuration HTTP du Compose de développement est refusée en production. Installer la chaîne CA appropriée ; ne pas désactiver la vérification TLS.
- `ALLOWED_HOSTS` liste explicite sans wildcard/entrée vide/espace/URL/port, contenant le hostname de l’origine publique. Prévoir les hostnames utilisés par les sondes internes. Ce format attend des noms DNS ou IPv4, pas une URL IPv6 littérale.
- `ADMIN_ACR` non vide : ce n’est qu’une valeur attendue. Il faut encore démontrer que l’IdP impose réellement le facteur supplémentaire et émet ce claim.
- Secrets OIDC et session **distincts**, au moins 32 caractères, sans placeholder `CHANGE_ME`. Ces contrôles ne mesurent pas l’entropie ; générer les valeurs cryptographiquement, les conserver hors Git et prévoir rotation/révocation.
- `DATABASE_URL` PostgreSQL avec driver `postgresql+psycopg`, hôte/base/utilisateur/mot de passe explicites, `sslmode=verify-full` et `sslrootcert` défini. Les comptes nommés `postgres` et `geoforest_migrator` sont refusés ; les variantes de paramètres de connexion capables de remplacer host/user/db sont refusées. Choisir un rôle runtime dédié, pas l’utilisateur administrateur créé par le fournisseur.

Forme documentaire, **pas un secret à utiliser** :

```text
postgresql+psycopg://geoforest_app:SECRET_URL_ENCODE@db.example.invalid/geoforest?sslmode=verify-full&sslrootcert=/run/secrets/db-ca.pem&connect_timeout=5
```

La présence du chemin CA dans la configuration n’atteste ni l’existence du fichier ni l’authenticité du certificat : la connexion réelle doit réussir et un mauvais CA/hostname doit échouer pendant la qualification cible. Ne pas monter les secrets dans les workers de traitement de fichiers.

Les erreurs de validation Settings n’affichent plus les valeurs d’entrée dans leur représentation textuelle. Ce n’est pas une raison pour journaliser un objet Settings ou son dump : il contient encore des secrets.

## 3. Garde-fous DB au démarrage et en readiness

En production, l’API refuse de démarrer si les contrôles DB échouent : schéma 0007/PostGIS, rôle runtime et RLS. Le message de démarrage est fixe, sans DSN ni noms de rôles. `/health/ready` revérifie l’isolation et renvoie 503 en cas d’écart ; `/health/live` indique seulement que le processus répond.

Contrôles ajoutés :

- Le rôle effectif ne doit pas être membre d’un rôle superuser, BYPASSRLS, CREATEROLE ou CREATEDB.
- Il ne doit pas être propriétaire/membre du rôle propriétaire d’une table publique, ni pouvoir créer dans `public`.
- Les **32 tables métier/session fournisseur attendues** doivent exister et avoir RLS activée ; une politique doit être présente, sauf `supplier_sessions` volontairement en refus par défaut et accessible via helpers restreints.

Ces contrôles détectent des erreurs d’installation, **pas toute politique SQL malveillante ou toute délégation de privilèges**. Ils ne remplacent pas les tests d’isolation, la revue des fonctions privilégiées et l’administration DB. Une modification de privilèges après démarrage doit déclencher une alerte et retirer l’instance du trafic via readiness ; ne pas donner un accès direct contournant l’entrée contrôlée.

## 4. Modules : ouverture séparée

| Module | Condition de mise en service |
|---|---|
| Collecte/parcelles | DB/SSO/TLS/RLS, sauvegardes, quotas et tests cible validés |
| Observations forestières | `FOREST_ANALYSIS_ENABLED=true` après qualification CPU/RAM, sandbox et egress vers hôtes publics fixes ; consentement à la demande maintenu |
| Documents/légalité/risque | `DOCUMENTS_ENABLED=true` uniquement avec coffre durable privé, moteur/signatures qualifiés, permissions, quarantaine, sandbox, inventaire/restauration et alertes |
| Diligence | `DILIGENCE_ENABLED=true`, schéma 0007 et accès effectif aux sources/coffre nécessaires. Sans preuves disponibles, ne pas annoncer un parcours validable |
| Déclaration officielle | Aucun connecteur qualifié : ne pas activer ni inventer un bouton de dépôt |

## 5. Critères bloquants avant données réelles

- Contrat, DPA, sous-traitants et localisation des données, logs, sauvegardes et accès support approuvés.
- Version PostgreSQL/PostGIS, bootstrap des rôles, migrations et restauration testés sur l’offre retenue.
- Images construites et testées sur moteur conteneur cible ; versions/digests, scan des images et composants OS revus. Les audits pip/npm ne couvrent pas les images.
- Sandbox OS/conteneur et restrictions d’egress des parseurs/antivirus/raster testées. Les limites `resource` ne constituent pas cette isolation.
- TLS public, OIDC, backchannel et DB ; tests de mauvais certificat ; en-têtes de sécurité et secrets qualifiés.
- Sauvegarde chiffrée, cohérente DB + coffre, restauration hors source avec révocation des sessions et invitations, mesure réelle du RPO/RTO.
- Alertes reçues par un responsable identifié : disque, DB, disponibilité, antivirus/signatures, corruption et échec de sauvegarde. La fonction SMTP produit étant non livrée, ne pas confondre alertes d’exploitation et emails utilisateur.
- Charge mesurée sur volumes réalistes ; rate limit partagé derrière proxy, coût de scans/PDF/raster et saturation mesurés. Pas de promesse de millions de parcelles à ce stade.
- Revue UX/accessibilité et E2E transversaux sans skip, données synthétiques, défauts bloquants corrigés.
- Responsabilités support, incidents, conservation, réversibilité et mises à jour documentées.

## 6. Reprise et retour arrière

Ne jamais improviser un downgrade destructif. Conserver application/version, dump, coffre, références, manifestes et secrets dans des circuits distincts. Faire une sauvegarde cohérente avant migration ; restaurer dans une nouvelle cible, révoquer sessions/invitations copiées, tester intégrité/RLS/exports puis basculer avec procédure revue.

Les preuves locales du chantier 7 sont utiles mais ne mesurent pas le RPO/RTO du fournisseur. Pour cadrage initial seulement, proposer à validation métier **RPO ≤24 h et RTO ≤8 h pour un pilote non HA** ; ce ne sont ni des résultats mesurés ni des engagements contractuels. Des objectifs plus exigeants imposeront un autre dispositif de sauvegarde/réplication et des tests supplémentaires.

## 7. État courant

Premier incrément de durcissement testé localement. Hébergement recommandé, non sélectionné contractuellement et non déployé. Le chantier 8 et la décision de lancement global restent **EN COURS / NON AUTORISÉ POUR PRODUCTION**.
