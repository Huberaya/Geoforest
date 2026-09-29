# Chantier 8 — Audit du backend sur Vercel

**Date : 29 septembre 2026**
**Code examiné : `7a2da36a76c7bc16b9bb080853ca649fc0d8b68e`**
**Décision : API envisageable après adaptation ; application complète non déployable telle quelle.**

## 1. Conclusion opérationnelle

Vercel prend bien en charge FastAPI/Python. Il n'est donc pas nécessaire de choisir immédiatement un autre hébergeur pour le noyau API de GeoForest Trace.

En revanche, **promouvoir le frontend Preview en Production ne répare pas, à lui seul, la connexion**. Aucun backend n'est actuellement hébergé ; le routage API retombe sur `127.0.0.1:8000`. De plus, l'intégration Clerk du dépôt est volontairement limitée au développement et à une base locale de test.

Le principal obstacle architectural au déploiement complet sur des Functions est le **coffre documentaire POSIX persistant**, avec fichiers partagés entre requêtes, quarantaine et versions. Une instance de calcul sans état ne remplace pas ce stockage. Les images de conteneurs Vercel ne constituent pas, à elles seules, un volume persistant partagé.

### Décision par périmètre

| Périmètre | Verdict | Conditions |
|---|---|---|
| Frontend Next.js | Compatible avec Vercel | Publication Production distincte de la Preview ; configuration d'identité et API cohérente |
| Noyau API FastAPI / organisations / fournisseurs / lots / parcelles | **GO conditionnel pour adaptation et qualification** | Packaging Python, identité production, Neon/RLS, connexions, routage, contrôles de démarrage et tests réels |
| Calculs géospatiaux | **À qualifier sur Vercel** | Dépendances natives, sous-processus, ressources, concurrence et timeouts |
| Coffre local actuel | **NO-GO tel quel** | Stockage privé durable partagé indispensable |
| Antivirus | **À intégrer et qualifier** | Binaire, bibliothèques, signatures actualisées et politique d'échec fermé |
| Application complète en Production | **BLOQUÉE en l'état** | Résoudre identité, hébergement API et stockage, puis recette complète |

**Cet audit n'a effectué aucun déploiement, aucune promotion Production, aucune migration Neon et aucune souscription.**

## 2. Cause de l'erreur publique

Le diagnostic public réalisé pendant cette investigation a constaté :

| Route | Résultat observé |
|---|---|
| `/` | HTTP 200, ancien frontend |
| `/sign-in` | HTTP 404 |
| `/api/auth/login` | HTTP 404 avec `DNS_HOSTNAME_RESOLVED_PRIVATE` |
| `/api/v1/me` | HTTP 404 avec `DNS_HOSTNAME_RESOLVED_PRIVATE` |

`next.config.ts` utilise une destination API locale de repli. Sur Vercel, cela ne désigne pas un backend GeoForest hébergé. **Ce n'est pas un problème de mot de passe.**

La branche chantier 8 est publiée sur GitHub et dispose d'une Preview READY. Cela ne signifie pas que le domaine `https://geoforest-eabr.vercel.app/` a été mis à jour. La dernière vérification de publication constatait toujours l'ancien déploiement en Production ; aucune promotion n'a eu lieu depuis dans cette intervention.

## 3. Capacités Vercel vérifiées dans la documentation

- FastAPI/ASGI et Python 3.13 sont pris en charge. Python 3.12 est la version par défaut ; 3.14 est également documentée. [Documentation Python](https://vercel.com/docs/functions/runtimes/python)
- **Services**, en bêta sur tous les plans, permet de déployer Next.js et FastAPI dans un même projet avec routage commun. Les variables d'environnement sont décrites comme partagées : leur cloisonnement entre services ne doit pas être supposé acquis. [Services](https://vercel.com/docs/services)
- Les **images de conteneurs OCI**, également en bêta, sont possibles via un point d'entrée adapté tel que `Dockerfile.vercel`. Le `backend/Dockerfile` existant n'est pas automatiquement déployé par le projet Next.js actuel. Les conteneurs restent des Functions avec montée et descente automatiques en charge. [Container Images](https://vercel.com/docs/functions/container-images)
- La limite standard documentée du bundle Python est **500 MB décompressés**. Une option Large Functions existe en bêta, mais son activation et ses conditions ne sont pas présumées disponibles dans ce projet. [Runtime Python](https://vercel.com/docs/functions/runtimes/python)
- La limite de corps de requête est **4,5 MB** ; les réponses non streamées sont également concernées. La documentation indique que le streaming permet de dépasser cette limite de réponse, et le runtime Python prend en charge le streaming. [Guide des tailles de payload](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- Avec Fluid Compute, la documentation indique notamment 300 secondes sur Hobby. Un timeout applicatif de 100 secondes ne suffit donc pas à conclure à une incompatibilité. Mémoire, CPU, concurrence et plan effectif restent à vérifier. [Limites](https://vercel.com/docs/functions/limitations)
- Hobby est réservé à l'usage personnel non commercial. **Aucune promesse de SaaS B2B gratuit sur ce plan.** Le plan actuel du compte n'a pas été vérifié. [Plan Hobby](https://vercel.com/docs/plans/hobby)

## 4. Résultats de l'inspection du code

### 4.1 Authentification : blocage de production

`backend/app/config.py` accepte `oidc` ou `clerk_development`. Le second mode refuse explicitement :

- `APP_ENV=production` ;
- une base distante, notamment Neon ;
- une base locale dont le nom ne se termine pas par `_test`.

Ces gardes sont intentionnelles et doivent rester présentes. Il ne faut ni renommer l'environnement pour les contourner, ni les retirer pour connecter Neon.

**Travail requis :** implémenter une véritable intégration Clerk de production : validation des jetons, émetteur/audience autorisée, révocation, session applicative, MFA des opérations sensibles, rattachement des utilisateurs et permissions décidées par la base. Les rôles transmis par le navigateur ne constituent pas une autorisation.

Le fournisseur OIDC historique exige lui aussi un service d'identité correctement configuré ; son adresse locale de développement n'est pas une solution de production.

### 4.2 Stockage documentaire : incompatibilité structurelle en l'état

`backend/app/documents/storage.py` et `processing.py` s'appuient sur `LocalStore`, un répertoire privé persistant, des descripteurs POSIX, des écritures synchronisées et des fichiers de versions/quarantaine.

Les dépôts sont **déjà découpés en blocs de 65 536 octets au maximum** (`put_chunk`, `documents/routes.py`). Il serait donc incorrect d'affirmer qu'un document de 20 Mio est envoyé en une seule requête dépassant 4,5 MB.

Le vrai problème : des blocs successifs peuvent être traités par des instances différentes, et les fichiers doivent survivre aux redémarrages et redéploiements. Un répertoire temporaire ne garantit ni cette continuité ni la conservation des preuves.

Vercel recommande un stockage objet pour persister les fichiers. [Guide fichiers](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)

**Choix existant à respecter : coffre auto-hébergé privé.** Deux voies restent possibles, sans en engager aucune ici :

1. conserver ce choix et prévoir un composant de stockage durable auto-hébergé, avec son exploitation et ses sauvegardes ;
2. décider explicitement de changer ce choix pour un stockage objet privé, puis adapter le code, la quarantaine, l'assemblage, les contrôles d'accès, les versions et la restauration.

Aucun bucket public, fournisseur supplémentaire ou service payant n'a été créé.

### 4.3 Antivirus et traitements natifs

Le Dockerfile backend actuel n'installe pas ClamAV. Le code attend pourtant un binaire, des bibliothèques éventuelles et des signatures actualisées.

Un conteneur Vercel pourrait faciliter leur packaging ; ce n'est pas une qualification antivirus. Il faut encore vérifier l'actualisation des signatures, leur taille, les limites mémoire/CPU et les comportements en cas d'indisponibilité. La quarantaine ne doit jamais être levée sur un simple échec du scanner.

Les traitements forestiers et PDF utilisent des sous-processus avec limites de ressources. Un sous-processus n'est pas interdit par principe sur Vercel, mais les roues natives, les signaux, les limites `RLIMIT`, les fichiers temporaires et la mémoire cumulée doivent être testés sur le runtime effectivement déployé.

### 4.4 PDF et téléchargements

`backend/app/diligence/artifacts.py` autorise des PDF jusqu'à **8 Mio**, renvoyés via `Response` dans les routes de diligence. Les gros exports nécessitent un chemin de réponse streamé qualifié ou une livraison privée adaptée ; une réponse bufferisée peut dépasser la limite Vercel.

Les téléchargements documentaires utilisent déjà `StreamingResponse`. Leur taille maximale n'est donc pas, à elle seule, une preuve d'incompatibilité. Il reste à tester le streaming de bout en bout, y compris le routage public, les interruptions et les contrôles d'accès.

### 4.5 Neon : attention aux verrous de session

`database.py` configure un pool SQLAlchemy de 5 connexions avec 5 supplémentaires possibles, **par instance**. La montée en charge serverless peut multiplier ce total. Les identités RLS sont installées avec `set_config(..., true)`, donc à portée de transaction : ce principe doit être conservé.

Point supplémentaire important :

- `forest/routes.py::work_slot` utilise des verrous consultatifs **de session**, conservés entre plusieurs transactions ;
- `documents/processing.py::scan_slot` utilise également ce mécanisme.

Le pooler Neon fonctionne en mode transaction et ne prend pas en charge les verrous consultatifs de session. **Ne pas ajouter simplement `-pooler` à la connexion actuelle.** [Documentation Neon](https://neon.com/docs/connect/connection-pooling)

Solutions à qualifier : connexions directes strictement dimensionnées pour ces traitements, séparation des connexions API/workers, ou mécanisme de coordination durable compatible avec le pooling transactionnel. Transformer ces verrous en verrous transactionnels sans revoir le déroulement des traitements ne serait pas une correction suffisante.

### 4.6 Démarrage et limitation de débit

Le lifespan de production vérifie le rôle runtime, la migration `0007` et PostGIS. Leur exécution doit être confirmée sur Vercel, avec refus effectif d'un déploiement mal configuré.

Le middleware API utilise PostgreSQL pour les compteurs de débit et se base sur le pair réseau ASGI, sans faire confiance aveuglément à `X-Forwarded-For`. Il faut qualifier l'adresse réellement fournie derrière le proxy Vercel pour éviter de regrouper tous les utilisateurs dans un même quota. Ne pas remplacer cette protection par une confiance générale dans les en-têtes du client.

### 4.7 Packaging reproductible

L'installation locale depuis `backend/requirements.lock` réussit. Toutefois, `backend/requirements.txt`, détectable automatiquement par Vercel, **n'est pas aligné** : il ne déclare notamment pas `Pillow`, `pypdf` et `reportlab`, présents dans le verrouillage et utilisés pour les documents/PDF.

Il faut un manifeste de production complet et reproductible, fixer Python 3.13 et exclure les fichiers inutiles du bundle sans retirer les ressources requises, notamment la police PDF embarquée.

Mesures locales après installation : environ **362 Mio** de `site-packages` et **27 Mio** pour `backend` selon `du`. Ces tailles incluent des éléments de développement/cache et **ne sont pas la taille d'un bundle Vercel**. Elles ne prouvent ni un dépassement ni le respect final des 500 MB.

## 5. Vérifications exécutées

Script reproductible : `scripts/audit-vercel-local.py`.

Preuve : `docs/rapports/preuves-chantier-8/audit-vercel-backend/smoke-local.json`.

Commande :

```sh
.venv/bin/python scripts/audit-vercel-local.py
```

Le script remplace la configuration héritée par des valeurs fictives, s'exécute hors des fichiers `.env`, bloque les connexions réseau/SQL testées et ne réalise aucune migration.

**10 vérifications locales réussies, Python 3.13.14 / Linux x86_64 :**

1. import de l'application ASGI ;
2. `/health/live` retourne 200 sans base ;
3. l'API renvoie 503 lorsque l'accès SQL du limiteur de débit est bloqué, sans laisser passer la requête ;
4. aller-retour raster en mémoire avec NumPy/Rasterio/GDAL ;
5. géométrie native Shapely ;
6. génération PDF avec la police embarquée ;
7. relecture du PDF par pypdf ;
8. contrôle positif de configuration Clerk développement sur une base locale `_test` fictive ;
9. refus de Clerk développement en production ;
10. refus de Clerk développement avec une base distante fictive.

Le premier passage du script supposait à tort un HTTP 401 sans base sur `/api/v1/me`. L'inspection du middleware a confirmé le HTTP 503 attendu : le contrôle de débit SQL précède l'identité. L'assertion a été corrigée dans le script d'audit, **sans modifier l'application**.

Un avertissement de dépréciation Starlette concernant le transport `httpx` du TestClient est émis. Il n'empêche pas ces contrôles ; aucun changement de dépendance n'a été fait pour le masquer.

**Non exécutés :** build/déploiement Vercel du backend, authentification Clerk réelle, connexion Neon, tests RLS/concurrence sur Neon, antivirus réel, workers isolés complets, recette métier/UX complète, tests de charge et suite de régression intégrale. Ces dix contrôles ne remplacent pas ces qualifications.

## 6. Plan recommandé avant publication publique

### Étape A — Préparer le noyau Vercel

- Aligner le manifeste Python et préparer l'entrée FastAPI réelle, sans serveur factice.
- Implémenter l'identité Clerk production sans affaiblir le mode développement.
- Dimensionner les connexions Neon et préserver les contrôles RLS et de démarrage.
- Remplacer le repli local en environnement hébergé par une configuration explicite, avec erreur claire si l'API n'est pas définie.
- Choisir région de calcul UE et proximité Neon après vérification des régions effectives ; une région de calcul ne suffit pas à garantir seule toute la résidence des données.

### Étape B — Qualifier l'architecture Vercel

Deux architectures restent possibles : Services dans le projet existant, ou frontend et API dans deux projets Vercel. Services est pratique pour le domaine commun, mais le cloisonnement des secrets doit être établi ; deux projets permettent des configurations d'environnement séparées. Le navigateur doit continuer à appeler le domaine public via `/api`, pas `localhost`.

Les secrets Clerk serveur et Neon ne doivent jamais entrer dans le bundle navigateur. Leur présence dans l'environnement du frontend doit aussi être évitée lorsque l'architecture permet de les réserver au backend.

Vérifier plan commercial autorisé, coûts, quotas, règles de proxy, protection des environnements de test, ports/hosts et politique de déploiement. Aucune souscription automatique.

### Étape C — Résoudre le coffre et qualifier les fonctions avancées

Conserver le choix auto-hébergé ou faire approuver explicitement son remplacement. Tester persistance multi-instance, versions, quarantaine, ClamAV, reprise des dépôts, sauvegarde/restauration et isolation entre organisations. Qualifier les workers et gros PDF sur le runtime cible.

Un premier périmètre plus restreint ne doit pas être présenté comme la livraison complète des huit chantiers ; tout module indisponible doit être clairement signalé.

### Étape D — Recette puis Production

Critères minimaux :

- accueil, création de compte et connexion réellement fonctionnels ;
- session, déconnexion/révocation, MFA et permissions vérifiées ;
- deux organisations isolées et portail fournisseur restreint ;
- API sans destination privée de repli ;
- contrôles DB de production actifs, démarrages à froid et concurrence testés ;
- parcours fournisseurs/lots/parcelles, imports invalides et erreurs réseau ;
- documents/PDF et analyses qualifiés selon le périmètre annoncé ;
- vérification responsive ;
- commit exact, configuration Production, retour arrière et preuve du déploiement associé au domaine public.

**L'accord de l'utilisateur pour publier en Production est déjà donné.** Il n'est pas nécessaire de le redemander. La Preview ne doit servir qu'à la recette technique, jamais être présentée comme la publication finale. Les accès de publication temporaires seront nécessaires au moment de publier ; aucun ancien jeton supprimé n'a été réutilisé.

## 7. Bilan du chantier

- **PRÊT :** décision d'architecture documentée ; capacité FastAPI de Vercel confirmée ; smoke checks locaux reproductibles.
- **À FINALISER :** packaging, adaptation Clerk production, configuration API/Neon, qualification du runtime, débit et streaming.
- **BLOQUÉ :** exploitation du coffre POSIX actuel sur un calcul Vercel sans stockage durable partagé ; publication complète non qualifiée.
- **RISQUE RÉGLEMENTAIRE :** la pérennité, l'intégrité et la disponibilité des preuves documentaires ne peuvent pas reposer sur des fichiers temporaires. Cet audit d'hébergement n'est ni une certification EUDR ni une nouvelle vérification juridique.
- **PROCHAINE VERSION :** montée en charge et industrialisation des workers après qualification du socle ; ne pas annoncer une capacité à des millions de parcelles sur la base de ces seuls tests.

Fichiers ajoutés par cet audit : présent rapport, script local et preuve JSON. Aucun fichier produit, configuration Vercel active ou donnée Neon n'a été modifié. La modification préexistante du mode de `infra/bootstrap-db.sh` reste hors de ce travail.
