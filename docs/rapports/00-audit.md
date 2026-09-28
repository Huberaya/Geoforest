# AUDIT GEOFOREST TRACE
## État du dépôt, cadrage réglementaire et plan de développement

**Date : 28 septembre 2026 — Europe/Paris**
**Dépôt :** https://github.com/Huberaya/Geoforest
**Commit audité :** `ba6b8dac4d52a980f2b57b84d5e004e5ad207a40` (23 septembre 2026).
**Décision : NO-GO pour une exploitation réglementaire ou des données fournisseurs réelles.**

Le dépôt est un prototype d'audit géospatial, pas encore un SaaS de diligence raisonnée. Des composants sont réutilisables, mais l'absence d'authentification, la simulation intégrée au moteur de décision et l'absence de workflow probatoire empêchent une mise en production responsable.

**Aucun code applicatif modifié. Aucun commit ni push effectué. Aucun chantier d'implémentation commencé.** Le clone est dans `/home/user/Geoforest` ; les livrables d'audit sont séparés dans `/home/user/audit-geoforest`.

---

## 1. Périmètre et niveau de preuve

### Réalisé
- Clone du dépôt public et inventaire des 46 fichiers suivis.
- Revue de l'architecture, des routes, schémas, moteurs, composants, tests et fichiers de déploiement.
- Installation des dépendances ; exécution lint, TypeScript, build Next.js, tests Python et audit npm.
- Sondes locales supplémentaires sur l'API Python avec une base en mémoire et sur les fonctions TypeScript compilées séparément.
- Consultation de sources officielles européennes, dont les modifications de 2025 et de septembre 2026.

### Non vérifié / non accessible dans ce périmètre
- Infrastructure déployée, réglages GitHub privés, secrets de production, bases réelles, sauvegardes et logs d'exploitation : non fournis.
- Docker et PostgreSQL non disponibles comme commandes dans l'environnement audité : pas de validation de `docker compose up`, ni d'intégration Next.js/PostgreSQL réelle.
- Pas de session navigateur automatisée : responsive, accessibilité et rendu cartographique sont examinés dans le code, non validés visuellement.
- Pas de clé GFW ni de compte EUDR ACCEPTANCE/PRODUCTION : aucune requête métier réelle ni soumission officielle.
- La page CIRCABC de documentation API retourne « Loading... » à l'outil de lecture : spécifications détaillées, versions, authentification et quotas non qualifiés.
- Pas de pentest exhaustif, de scan de l'historique Git complet, ni de scan des dépendances Python/conteneurs.

Le présent rapport clôt l'audit du dépôt accessible et propose le plan. Il ne constitue ni une certification de sécurité, ni une consultation juridique, ni la qualification complète des connecteurs externes.

## 2. Synthèse demandée

| Domaine | État | Qualité | Action |
|---|---|---|---|
| Architecture | Next.js + FastAPI avec duplication métier et deux bases | Prototype divergent | Une API métier, une base centrale ; conserver Next.js pour l'interface |
| Authentification | Absente | Bloquant | OIDC, sessions sécurisées, MFA administrateurs, RBAC |
| Base de données | Une table d'audits dans PostgreSQL et SQLite | Insuffisante | PostgreSQL/PostGIS, modèle relationnel tenanté, migrations versionnées |
| Cartographie | Leaflet et fonds Esri, affichage des imports | Réutilisable sous réserve | Dessin/édition, GPS, permissions et qualification des fonds |
| Fournisseurs | Aucun référentiel ni portail | Absent | Identités, contacts, invitations limitées, progression |
| Parcelles | Validation/import partiels ; pas de registre indépendant | Fragile | Parcelles versionnées, import transactionnel, topologie robuste |
| EUDR | Règles simplifiées, verdicts absolus | Bloquant | Référentiel versionné, qualification des rôles et produits, revue humaine |
| Documents | Pas de coffre ni preuve de légalité | Absent | Stockage privé, antivirus, versions, expiration, revue |
| Analyse risque | Simulation et connecteur GFW non qualifié | Bloquant | Supprimer le repli simulation en réel ; risque expliqué et sourcé |
| Reporting | XML/JSON locaux et historique des analyses | Partiel | Dossier probatoire PDF/JSON/CSV, pas de promesse TRACES non vérifiée |
| Sécurité | Aucun tenant/RBAC ; limites côté client seulement | Bloquant | Défense en profondeur, limites serveur, secrets et sauvegardes |

Autres manques : produits dérivés, lots, expéditions, traçabilité des transformations, légalité, tâches, emails, validation humaine, journal d'événements, gestion des déclarations officielles, mesure d'usage et assistant IA.

## 3. Architecture existante

### 3.1 Frontend
- Next.js **16.2.6**, App Router, React **19.2.6**, TypeScript **5.9.3**, Tailwind **4.1.17**.
- Une page métier : `src/app/page.tsx`.
- Quatre composants principaux : `GeoUploader`, `MapViewer`, `AuditResultCard`, `AuditHistory`.
- Leaflet **1.9.4**, tuiles imagerie et références Esri chargées depuis le navigateur.
- Imports GeoJSON/JSON, KML et CSV via `src/lib/parsers.ts`. Limite de 10 Mo dans le navigateur ; cela ne protège pas l'API.
- Mise en page adaptative présente, mais pas de portail fournisseur, navigation SaaS, dessin, édition cartographique ou GPS navigateur.
- Les échecs de chargement de l'historique sont masqués : une panne peut ressembler à un historique vide.

### 3.2 Deux implémentations concurrentes

```text
Navigateur → routes Next.js → Drizzle → PostgreSQL
         ou → FastAPI → sqlite3 → SQLite
```

`src/lib/api.ts` utilise les routes Next.js par défaut. `NEXT_PUBLIC_API_URL` permet de choisir FastAPI ; ce n'est pas un miroir synchronisé. Les algorithmes SIG, satellite et export sont dupliqués en Python et TypeScript.

Routes métier présentes :
- `POST /api/v1/audit/parcel`
- `GET /api/v1/audits`
- `GET /api/v1/audits/{id}`
- `POST /api/v1/export/traces`

Aucun contrôle d'identité ou d'appartenance à une organisation sur ces routes.

### 3.3 Données et stockage
- PostgreSQL : `src/db/schema.ts`, table `parcel_audits`, géométrie JSONB, aucun PostGIS.
- Python : `backend/app/core/database.py`, SQLite avec verrou de processus, création DDL au démarrage.
- Aucun `organization_id`, utilisateur, fournisseur, lot, document, lien de preuve ou migration historisée.
- `created_at` et l'historique des analyses ne remplacent pas une piste d'audit avant/après.
- Absence de stockage documentaire, de politique de conservation, de sauvegarde/restauration démontrée.

### 3.4 Déploiement et configuration
- Dockerfiles et Compose présents, aucun workflow CI suivi dans le dépôt.
- **Blocage Docker probable par inspection :** `COPY --from=builder /app/public ./public`, mais aucun répertoire `public` dans le clone.
- **Blocage migration :** `drizzle.config.json` pointe vers `127.0.0.1`, alors que PostgreSQL Compose est sur `db`. Le `DATABASE_URL` de Compose n'est pas utilisé par cette configuration JSON.
- `drizzle-kit push --force` au démarrage : à remplacer par des migrations contrôlées exécutées une seule fois avec un rôle distinct.
- Identifiants PostgreSQL de développement codés dans Compose et configuration, port DB publié ; impropres à la production.
- `.dockerignore` frontend n'exclut pas les `.env` ; absence de `.dockerignore` backend. Risque d'embarquer des secrets locaux au build. Aucun secret de production confirmé dans les fichiers examinés.
- Conteneurs sans utilisateur non-root explicitement configuré ; dépendances de développement copiées dans l'image frontend.
- `NEXT_PUBLIC_API_URL` est une variable de build côté navigateur, pas un commutateur fiable à l'exécution du conteneur déjà construit. Utiliser un proxy same-origin, jamais `localhost` dans le navigateur d'un client distant.

Variables repérées : `DATABASE_URL`, `DATABASE_PATH`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, `GFW_API_KEY`, `GFW_LIVE_ENABLED`, `GFW_API_URL`, `GFW_DATASET`, `GFW_TIMEOUT_SECONDS`. Prévoir validation typée et `.env.example` sans secret.

## 4. Constats prioritaires et preuves

### P0 — Corriger avant toute utilisation réelle

**SEC-01 — Accès anonyme à toutes les opérations.**
Les sondes Python obtiennent, sans identité : création 201, liste 200, détail 200 et export 200. Les routes Next.js n'ont pas non plus de garde. Un UUID n'est pas une permission. Sources : `backend/app/api/v1/endpoints.py`, `src/app/api/v1/**/route.ts`.

**REG-01 — Une simulation peut devenir un verdict EUDR.**
Les deux `satellite-checker` utilisent hotspots et hash du centroïde pour fabriquer perte, couvert et confiance en l'absence de clé. Une erreur du fournisseur réel déclenche également ce repli. La source mock apparaît dans la réponse, mais le résumé affiche « CONFORME EUDR » ou « NON CONFORME EUDR ». Un libellé technique de source ne neutralise pas cette conclusion.

**REG-02 — Le demandeur peut imposer le résultat simulé.**
`properties.simulated_loss_year` est accepté dans le flux normal. Sondes Python sur la même position : 2019 → `COMPLIANT` ; 2022 → `NON_COMPLIANT`. Isoler les fixtures dans un environnement de démonstration sans aucune capacité de déclaration réelle.

**REG-03 — Absence d'alerte assimilée à conformité.**
Pas d'analyse de légalité, de qualité de couverture, de dégradation forestière du bois, de risque de mélange ou de validation humaine. Le seuil `max(0.01 ha, 0.5 % de la surface)` et les confiances 0,95 ou dérivées d'un hash ne sont pas justifiés comme critères juridiques. Une réponse GFW sans `data` devient une liste vide et peut aboutir à `compliant: true`. Il faut un statut « données indisponibles / analyse non concluante », jamais un feu vert par défaut.

**SEC-02 — Dépendances signalées vulnérables.**
`npm audit` signale 7 entrées : 1 critique, 2 élevées, 4 modérées. Next est signalé critique ; PostCSS et Sharp élevés. Ce sont des résultats du registre, pas la démonstration d'une exploitation dans ce produit. Qualification, mise à jour contrôlée et tests requis ; ne pas appliquer aveuglément `npm audit fix --force`.

### P1 — Fiabilité et cohérence

**GIS-01 — FeatureCollection perdue dans le moteur satellite TypeScript.**
Le validateur produit une `FeatureCollection` castée en `SupportedGeometry`. Le calcul de centroïde satellite ne parcourt que `geometry.coordinates`, absent sur une collection. Sonde : géométrie valide, puis pays `XX`, aire nulle et résultat `compliant: true`, confiance 0,973. La branche Python a un traitement différent. Analyser chaque parcelle, puis agréger sans supprimer les identifiants.

**GIS-02 — Validation malformée provoquant une exception.**
Un polygone contenant un anneau `null` produit `Cannot read properties of null (reading 'length')` dans le validateur TS. Pas de limite serveur explicite de sommets/profondeur ; test d'intersections quadratique. Risque d'erreurs 500 et de saturation, non mesuré par test de charge.

**GIS-03 — Pays déterminé par rectangles.**
`COUNTRY_BOXES` n'est pas un référentiel de frontières : recouvrements, pays fictif `EU`, défaut `XX`, centroïde insuffisant. Sonde Helsinki → `EU`, pas `FI`. Les catégories sont codées en dur ; par exemple le Vietnam est `STANDARD` dans le code alors que le règlement 2025/1093 le liste faible risque. Remplacer par frontières sourcées + table officielle versionnée. [2](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ%3AL_202501093)

**GIS-04 — Surface et précision.**
Seuil `>= 4` erroné par rapport à « plus de 4 hectares » ; bovins non distingués. Un point sans surface est supposé inférieur à 4 ha. Le calcul TS est sphérique, contrairement à la promesse README de correction ellipsoïdale ; Python utilise pyproj. Les zéros finaux disparaissent en nombres JSON et `min_decimals` fourni par le client contourne le contrôle : ne pas assimiler décimales déclarées et précision réelle de mesure. Sources : les deux validateurs ; règle officielle art. 2(28). [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226)

**API-01 — FastAPI n'est pas interchangeable avec les routes Next.js.**
`GET /audits/{id}` Python renvoie le dataclass brut (`id`, sans `audit_id` ni `summary`) alors que le frontend attend `ParcelAuditResponse`. Export Python modifie le statut en `EXPORTED`, non pris en charge par les palettes UI ; Next.js conserve le statut et inscrit une date. Contrat OpenAPI partagé et tests de parcours requis.

**EXP-01 — Export réglementaire non qualifié.**
XML construit à la main avec espaces de noms et extension `gft:verification`. Tests de XML bien formé, mais aucun XSD/WSDL officiel versionné ni test ACCEPTANCE. `GFT-…` est une référence interne, non une référence de déclaration officielle. L'export autorise aussi les analyses à risque et les quantités absentes. Un rapport d'investigation peut être exporté ; il doit être séparé du dossier « prêt pour déclaration ». Aucun appel de soumission officielle n'est implémenté.

**DATA-01 — Modèle réduit à un audit de parcelle.**
L'opérateur sert aussi de producteur à l'export ; un code HS unique est déduit de chaque commodité. Cela ne représente ni les produits dérivés ni la chaîne fournisseur–lot–parcelles. Les preuves ne sont pas figées ni reliées à une version de règle.

### P2 — Qualité et exploitation
- Lint en échec ; pas de tests TS ni E2E configurés.
- Pas de métriques, de files de jobs, de timeouts globaux, de quotas tenant ou de gestion de reprise durable.
- Pas d'alertes, de coffre, d'OCR, de consentement GPS ou de gestion de session fournisseur.
- Cartes Esri : licence, conditions, coût, accès et divulgation des zones consultées au fournisseur de tuiles à examiner.

## 5. Rapport des tests réellement exécutés

| Contrôle | Résultat | Limite |
|---|---|---|
| `npm ci --ignore-scripts` | Réussi | Installation, pas qualification sécurité |
| `npm run typecheck` | Réussi | Les casts masquent certains écarts runtime |
| `npm run build` | Réussi | Pas une preuve de démarrage Docker ou DB |
| `npm run lint` | Échec : 1 erreur | `src/app/page.tsx:31`, `react-hooks/set-state-in-effect` |
| `pytest -q` | 26 réussis, 0 échoué | Moteur simulé et SQLite en mémoire ; pas de données satellite réelles |
| Audit npm | 7 entrées signalées | Exploitabilité à qualifier |
| Sondes API Python | Reproductions réussies | Accès anonyme, année simulée, contrat incompatible, statut EXPORTED |
| Sondes SIG TypeScript | Reproductions réussies | Collection mal analysée, anneau null, point exactement 4 ha rejeté |
| E2E navigateur, responsive, accessibilité | Non exécutés | À créer |
| Isolation inter-tenant | Non testable en tant que fonctionnalité | Modèle et contrôles absents ; défaut architectural établi |
| PostgreSQL, Docker, API GFW, EUDR ACCEPTANCE | Non exécutés | Environnement ou accès manquants |

Environnement : Node 20.20.2 ; Python 3.13.14. Le Dockerfile Python cible 3.11 : la matrice CI devra tester la version de déploiement.

Preuves locales : `preuves/frontend.txt`, `preuves/pytest.txt`, `preuves/npm-audit.json`, `preuves/sondes-typescript.txt`, `preuves/sondes-python.txt`. Les sondes constatent des défauts ; leur réussite n'est pas un succès des contrôles de sécurité.

## 6. Vérification réglementaire actualisée

### 6.1 Corpus officiel consulté

- **[11]** Règlement 2023/1115, consolidation du 26/12/2025 : définitions, art. 3–13, 37–38 et annexes. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226
- **[12]** Règlement modificatif 2025/2650. https://eur-lex.europa.eu/eli/reg/2025/2650/oj/eng
- **[13]** Règlement délégué 2026/2102, publié le 17/09/2026, entrée en vigueur le lendemain : modification de l'annexe I. https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj/eng
- **[2]** Règlement d'exécution 2025/1093 : classification des pays. https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ%3AL_202501093
- **[14]** Règlement d'exécution 2026/1565 modifiant 2024/3084 : Information System. https://eur-lex.europa.eu/eli/reg_impl/2026/1565/oj/eng
- **[1]** Commission, Information System et lien officiel vers les spécifications API CIRCABC. https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/information-system-deforestation-regulation_en

Une consolidation datée de décembre 2025 ne suffit donc pas à qualifier l'annexe I en septembre 2026. Les règles doivent référencer leurs amendements, dates d'entrée en vigueur et dates d'application distinctes.

### 6.2 Matrice exigence → conception → limite

| Sujet | Exigence vérifiée et source | Conséquence produit proposée |
|---|---|---|
| Dates | Application générale le **30/12/2026** ; report au **30/06/2027** pour les opérateurs visés à l'art. 38(3), établis comme tels au 31/12/2024, sauf produits couverts par l'annexe EUTR. Art. 37 : transition bois spécifique. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Questionnaire de qualification ; pas de date unique « toutes PME » |
| Produits | Sept commodités, mais assujettissement par produit/annexe I ; modification 2026/2102 en vigueur le 18/09/2026. Extraits de café 2101 11 00 ajoutés avec application le 30/12/2027, suppressions de certaines catégories de cuir. [13](https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj/eng) | Référentiel codes CN/HS et conditions, versionné ; classement assisté et validé |
| Opérateur | Diligence avant mise sur le marché/export ; déclaration préalable selon art. 4, sous réserve régime 4a ; responsabilité reste à l'opérateur. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Profil juridique par opération, jamais déduit seulement du rôle utilisateur |
| Aval et commerçant | Art. 5 : informations fournisseurs/clients, références si fournisseur direct opérateur ; conservation au moins 5 ans ; inscription des non-PME et obligations face aux préoccupations étayées. Pas de DDR systématique pour chaque revente. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Workflow de traçabilité aval distinct du workflow opérateur |
| Petits opérateurs primaires | Art. 2(15a) et 4a : conditions cumulatives de taille/statut, pays faible risque et production propre ; déclaration simplifiée unique ; adresse postale possible en remplacement géolocalisation. Ce n'est pas une exemption générale pour les PME importatrices. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Parcours spécifique seulement après qualification documentée |
| Données | Art. 9 : description, espèces bois communes/scientifiques, quantité/unité, pays, toutes les parcelles, période de production, fournisseurs/clients et preuves vérifiables de légalité et absence de déforestation. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Ne pas se limiter à une date de récolte, une commodity et un point |
| Géolocalisation | Art. 2(28) : au moins six décimales ; polygone pour parcelles **strictement > 4 ha**, hors bovins. Art. 9 : tous les établissements où les bovins ont été détenus. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Validation selon commodité, régime et surface ; fixtures 3,9999 / 4 / 4,0001 ha |
| Date de référence | Art. 2(13) : absence de déforestation après **31/12/2020** ; bois : dégradation forestière également. Déforestation = conversion forestière à usage agricole, pas toute perte de couvert. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Distinguer signal satellite, occupation des sols et qualification humaine |
| Diligence | Art. 8–11 : collecte, évaluation, réduction jusqu'à risque nul ou négligeable ; décisions documentées ; revues au moins annuelles des évaluations et mesures. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Un score de priorisation ne constitue pas la décision juridique |
| Pays | 2025/1093 : faible/élevé dans l'annexe, standard sinon ; art. 13 : diligence simplifiée sous conditions et retour au régime complet en présence d'informations préoccupantes. [2](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ%3AL_202501093) [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Aucun « pays faible risque = produit conforme » ; importer la liste officielle datée |
| Légalité | Art. 2(40) : foncier, environnement, règles forestières, droits des tiers/travailleurs, droits humains, consentement libre préalable éclairé, fiscalité/anticorruption/commerce/douanes. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Checklist par origine et matière ; textes locaux et pertinence validés par expert |
| Conservation | Art. 4, 5, 9 et 12 : délais de cinq ans avec points de départ distincts ; art. 12 : revue annuelle du système et reporting public des opérateurs non-PME concernés. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Calcul de rétention par objet, gel légal et politique RGPD ; rapport public expurgé |
| Déclaration | Annexe II : identité, EORI dans les cas prévus, produit/HS/quantité, origine/géolocalisation, attestation et signature ; annexe III pour régime simplifié. [11](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226) | Validateur de complétude et consentement du signataire avant soumission |
| Système officiel | API machine-à-machine et documentation CIRCABC annoncées officiellement ; environnements ACCEPTANCE et PRODUCTION séparés, seules soumissions PRODUCTION ont valeur légale. [1](https://green-forum.ec.europa.eu/nature-and-biodiversity/deforestation-regulation-implementation/information-system-deforestation-regulation_en) | Connecteur à qualifier ; aucun statut officiel à partir d'un export ou d'un test |

**Limites à lever avant le codage réglementaire concerné :** extraction exhaustive de l'annexe I amendée, matrice de règles locale par pays, modalités détaillées API, limites de fichiers, gestion des corrections/retraits, régime de contingence, licences et validation scientifique des sources satellite. Les obligations locales ne peuvent pas être inventées à partir du seul pays.

### 6.3 Modes à afficher dans l'application cible

| Fonction | Mode proposé | Ce que l'utilisateur doit comprendre |
|---|---|---|
| Bornes GPS, topologie, surfaces, champs manquants | Automatique | Contrôle technique, pas preuve juridique |
| Signal de changement satellite | Automatique si source qualifiée, sinon indisponible | Source, millésime, période, couverture et limites visibles |
| Classement produit et profil d'obligations | Assisté | Hypothèses confirmées par le responsable |
| OCR et extraction | Assisté | Valeur proposée avec page/source ; confirmation requise |
| Légalité, risque résiduel et validation DDR | Manuel/assisté | Décision motivée et signée par une personne habilitée |
| Export préparatoire | Automatique | N'est pas une déclaration officielle |
| Soumission Information System | À qualifier techniquement | Désactivée avant accès, spécifications et tests réels |
| Checklist d'un pays non qualifié | À confirmer réglementairement | Bloque toute affirmation de complétude réglementaire |

Libellé permanent : **« Résultat d'analyse automatisée — validation humaine requise lorsque nécessaire. »**

## 7. Architecture cible proposée

### Décision recommandée, à valider

Conserver Next.js et Leaflet, retenir **FastAPI comme unique API métier**, PostgreSQL/PostGIS comme base unique, et retirer progressivement le miroir métier TypeScript et SQLite. Python est déjà présent et approprié à GEOS/PROJ et aux traitements raster ; le coût de migration reste limité tant que le produit ne possède qu'une table principale.

```text
Entreprise / fournisseur (Next.js responsive)
          ↓ session sécurisée, même origine
Proxy/BFF Next.js — aucun moteur réglementaire dupliqué
          ↓ identité vérifiée et contexte d'organisation
FastAPI / OpenAPI — modules métier + contrôle d'accès
          ├─ PostgreSQL + PostGIS + RLS
          ├─ Stockage objet privé UE + quarantaine + antivirus
          ├─ Transactional outbox → workers Python + file de jobs
          ├─ Connecteurs géospatiaux versionnés
          └─ Exports / connecteur Information System qualifié
```

Un monolithe modulaire, pas des microservices par entité. Redis/Celery envisageable pour les jobs ; décision opérationnelle à figer dans une ADR. SQLAlchemy/Alembic proposés pour la persistance Python ; contrat frontend généré depuis OpenAPI.

### Sécurité dès le premier chantier
- Fournisseur d'identité OIDC maintenu, hébergement/région et sous-traitance validés ; sessions HttpOnly/Secure/SameSite, CSRF sur mutations, rotation et révocation.
- RBAC serveur et périmètres d'objets. `Supplier` limité à son fournisseur ET son organisation, indépendamment des identifiants soumis.
- PostgreSQL RLS et clés étrangères composites `(organization_id, id)` ; rôle applicatif sans BYPASSRLS, politique restrictive par défaut et tests via le vrai rôle DB. Contexte tenant transactionnel nettoyé avec le pool.
- URLs documentaires signées à courte durée uniquement après contrôle serveur. Préfixer une clé objet ne suffit pas à sécuriser un coffre.
- Invitations aléatoires, stockées hachées, expirables/révocables, échange contre session ; pas de jeton dans logs, analytics ou Referer.
- Quotas requêtes/jobs/bytes/sommets, antivirus, types MIME réels, refus macros/exécutables, traitement XML sans résolution externe et archives avec quotas si SHP ultérieur.
- TLS, chiffrement DB/objets/sauvegardes, secrets hors images/dépôt, restauration testée. Hébergement UE souhaité ; le choix UE seul ne garantit pas le RGPD.
- Journal append-only pour le rôle applicatif, événements avant/après dans la transaction métier, exports d'intégrité vers stockage à rétention. Ne pas promettre une immutabilité absolue face à un administrateur DB.
- Politique RGPD : responsabilités, sous-traitants, transferts, conservation, droits et minimisation ; examen de nécessité d'une AIPD.

### Échelle
PostGIS avec index GiST et index composites tenant ; pagination curseur ; analyses asynchrones idempotentes ; caches liés à géométrie/version de source/méthode ; tuiles vectorielles et clustering plutôt que millions de GeoJSON dans le navigateur. Partitionnement et sharding seulement après mesures. Les millions de parcelles sont un objectif d'architecture, pas une capacité déjà démontrée.

## 8. Modèle relationnel cible

Toutes les entités métier portent `organization_id`, dates, auteur et version. Les référentiels globaux sont en lecture seule pour les clients. Aucun partage implicite des fournisseurs entre entreprises.

| Ensemble | Entités et relations principales |
|---|---|
| Identité | `Organization`, `User`, `Membership(User, Organization, Role)`, `SupplierAccess`, `Invitation` |
| Approvisionnement | `Supplier → SupplierContact` ; `SupplierProduct` relie fournisseurs et produits ; `Product → ProductCommodity → Commodity` ; `ProductScopeAssessment` avec version de nomenclature |
| Flux | `Lot → Product` ; `LotSupplier` si plusieurs origines ; `Shipment → ShipmentItem → Lot` ; `LotTransformation` pour entrées/sorties, quantités et unités |
| Géographie | `Plot → PlotVersion → Geolocation` ; `SupplierPlot` ; `LotPlot` relie un lot aux versions exactes de parcelles ; `Establishment` et `CattleResidence` pour bovins |
| Preuves | `Document → DocumentVersion` ; liens typés fournisseur/lot/parcelle/dossier ; `Certificate` référence une version ; hash, émetteur, validité, validation |
| Analyse | `AnalysisJob`, `DeforestationAnalysis → PlotVersion`, `DatasetVersion`, `AnalysisEvidence`, `LegalityAssessment`, `RiskAssessment → RiskFactor → Evidence` |
| Diligence | `DueDiligenceCase`, `CaseLot`, `MitigationAction`, `HumanApproval`, `CaseSnapshot` ; distinct de `DueDiligenceStatement` et `SimplifiedDeclaration` |
| Transmission | `SubmissionAttempt`, requête/réponse sécurisées, empreintes, référence officielle, environnement, état de rapprochement |
| Gouvernance | `ComplianceTask`, `Notification`, `AuditLog`, `RegulatoryRuleVersion`, `CountryRiskVersion`, `RetentionPolicy` |
| Usage | `UsageEvent`, `PlanEntitlement` ; ni abonnement ni prix définitif avant validation économique |

L'évaluation d'obligations dépend du rôle réglementaire dans la transaction ; ce rôle n'est pas `Admin`, `Analyst` ou `Viewer`.

### Statuts et invariants
- Dossier : Brouillon → Données manquantes → En analyse → À revoir / Risque identifié → Actions requises → Prêt pour déclaration → Déclaré → Archivé.
- Statuts d'analyse distincts : en attente, en cours, terminée, non concluante, erreur, simulée.
- Statuts de transmission distincts : préparée, envoi en cours, résultat inconnu, rejetée, confirmation officielle reçue ; correction/retrait selon capacités qualifiées.
- `Prêt pour déclaration` exige règles applicables validées, données et preuves complètes, revue de légalité, risque résiduel nul/négligeable documenté et approbation habilitée.
- `Déclaré` exige une preuve officielle PRODUCTION reliée à la version de dossier : réponse API ou justificatif saisi manuellement puis vérifié. Une référence interne ou ACCEPTANCE ne suffit jamais.
- Toute modification critique après approbation invalide la préparation et exige une nouvelle revue ; les snapshots déjà déclarés restent conservés.
- Un score de priorisation 0–100 éventuel n'efface jamais un facteur bloquant. « Inconnu » reste inconnu.

## 9. Réutiliser, refactoriser, retirer

**Réutiliser :** structure Next.js, identité visuelle sobre, Leaflet, parcours d'import comme base UX, concepts de validateurs Python/Shapely/pyproj, certains fixtures et scénarios tests.

**Refactoriser :** contrats d'API, composants de résultat, gestion des erreurs, parsers, règles de surface/précision, modèle de données, build et déploiement.

**Retirer du chemin réel :** simulation, `simulated_loss_year`, verdicts automatiques de conformité, confiance fabriquée, rectangles de pays, mapping unique commodity→HS, références internes présentées comme TRACES.

**Retirer après migration validée :** SQLite et moteur métier TS dupliqué. Si données réelles existent ailleurs, les inventorier d'abord ; ne rien effacer. Conserver les anciens audits comme résultats historiques non requalifiés, avec provenance et avertissement, puis réanalyser les parcelles.

## 10. Plan détaillé chantier par chantier

Chaque chantier suit : analyse et risques → plan validé → implémentation → tests → bilan **FAIT / NON FAIT / PROBLÈMES / RISQUES / PROCHAINE ÉTAPE**. Aucun passage automatique si les critères de sortie ne sont pas atteints.

### Chantier 1 — Assainissement, architecture, identité et organisations (semaine 1)
**Objectif :** obtenir un socle sécurisé et reproductible, pas un nouveau dashboard décoratif.

**Dépendances :** validation de l'architecture, choix OIDC/hébergement, présence ou non de données existantes à migrer.

**Fichiers existants :** `Dockerfile`, `docker-compose.yml`, `drizzle.config.json`, `package*.json`, `src/lib/api.ts`, `src/app/api/**`, `backend/app/core/**`, les deux moteurs de simulation et composants affichant les verdicts.

**Fichiers nouveaux proposés :** `docs/adr/`, `.env.example`, `.github/workflows/ci.yml`, `backend/app/auth/`, `backend/app/modules/organizations/`, `backend/migrations/`, `backend/tests/security/`.

**Implémentation prévue :** décisions d'architecture, correctifs dépendances/lint/Docker, PostgreSQL/PostGIS et migrations, API unique, OIDC et rôles, organisations/memberships, protections des endpoints existants, journal minimal transactionnel, environnement démo explicitement séparé, neutralisation immédiate des fausses conclusions réglementaires.

**Tests/sortie :** build + lint + tests verts ; démarrage depuis base vide ; migration reproductible ; aucune mutation anonyme ; organisation A ne peut ni lire ni référencer B, y compris sous requête SQL avec rôle applicatif ; Viewer sans écriture ; fournisseur limité à son périmètre ; aucun mock activable en réel ; secrets absents des images.

**Risques :** lot dense. En cas de dépassement, réduire le périmètre visible et prolonger le chantier ; ne pas différer l'isolation à la semaine 8.

### Chantier 2 — Fournisseurs, produits, lots et collecte (semaine 2)
**Dépend du 1.** Modules `backend/app/modules/{suppliers,products,lots,shipments}`, routes UI entreprise et portail fournisseur, migrations et client OpenAPI.

CRUD validés, contacts, produits dérivés/codes, origine/période, relations lot-parcelle futures, import tabulaire idempotent, détection des doublons, invitations expirables et portail six étapes avec sauvegarde. Progression calculée sur les champs réellement demandés, pas un pourcentage fictif.

**Sortie :** fournisseur incomplet explicite ; plusieurs fournisseurs/lots correctement reliés ; séparation inter-fournisseurs ; lien expiré/révoqué refusé ; petits écrans 360/390 px testés. Risque : collecte excessive ; ne demander que les informations justifiées.

### Chantier 3 — Registre de parcelles et cartographie (semaine 3)
**Dépend des 1–2.** `src/components/MapViewer.tsx`, `GeoUploader.tsx`, `src/lib/parsers.ts`, nouveaux modules `plots`, import jobs, versions PostGIS.

Dessin point/polygone, édition/suppression contrôlée, import GeoJSON/KML avec rapport par feature, coordonnées et GPS avec consentement/refus géré. Conserver original et géométrie normalisée ; aucune correction silencieuse. SHP différé sauf demande prioritaire.

**Sortie :** trous, multipolygones, imports multiples, fichiers corrompus, format non supporté, doublons, annulation et limites serveur ; géolocalisation mobile refusée sans blocage du parcours. Risque : licences cartographiques et couverture réseau.

### Chantier 4 — Moteur géospatial de référence (semaine 4)
**Dépend du 3 et des règles qualifiées.** `backend/app/services/gis_validator.py`, nouveau module `geospatial`, référentiels frontières et règles versionnées.

GEOS/PostGIS pour validité/chevauchements, surface géodésique, cohérence pays, coordonnées finies, dateline, limite de complexité. Règles par parcelle, commodité et régime ; ne pas déduire la surface d'un point. Suppression des rectangles de pays et des calculs TS autoritatifs.

**Sortie :** tests 4 ha exact, bovins, points sans surface, très grandes/petites surfaces, géométries dégénérées, trous externes, intersections, frontières, chevauchements légitimes et suspects. Risque : géométrie techniquement correcte mais origine non prouvée.

### Chantier 5 — Analyse environnementale sourcée (semaine 5)
**Dépend du 4, accès et licences.** `backend/app/services/satellite_checker.py` à remplacer par `connectors/` et `analysis/`, workers, stockage de provenance.

Contrat de connecteur : capacités, couverture spatiale/temporelle, résolution, version des données, licence, limites, méthode et contrôle qualité. Un premier connecteur réellement validé, autres désactivés. Interfaces prévues pour Hansen/GFW, Sentinel-1/2 et sources futures ; ne pas prétendre qu'un accès aux images constitue un algorithme de déforestation.

**Sortie :** jeux de référence connus, zones sans données, nuages, petite parcelle sous résolution, timeout, réponse invalide, version modifiée ; pas de conformité automatique en cas d'erreur. Distinguer couvert perdu, conversion agricole et dégradation du bois. Risque : qualification scientifique pouvant dépasser une semaine ; un état indisponible honnête est préférable à une simulation.

### Chantier 6 — Documents, légalité et risque (semaine 6)
**Dépend des 2–5 et checklists locales validées.** Modules `documents`, `legality`, `risk`, `tasks`, pipeline de quarantaine et composants coffre.

Upload privé, scan, versions, expiration, revue/commentaires, preuves typées. OCR optionnel assisté, jamais prérequis bloquant du MVP. Risque expliqué avec facteurs, pièces, dates, règles, évaluateur et actions correctives. Rappels internes puis email avec outbox, consentements et suivi d'échec.

**Sortie :** MIME falsifié, fichier malveillant de test standard, taille excessive, document expiré/manquant, lien direct non autorisé ; checklist non qualifiée signalée ; score faible ne contourne aucun blocage. Risque : catalogue juridique pays non disponible.

### Chantier 7 — Diligence, exports et préparation officielle (semaine 7)
**Dépend du 6.** Modules `due_diligence`, `reports`, `declarations`, refonte des exporters et bibliothèque de templates.

Workflow, validation humaine, gel de preuves, PDF/JSON/CSV et manifeste d'empreintes. Export GeoJSON validé au format officiel lorsque qualifié ; mapping annexe II/III ; dossier préparatoire clairement distinct de la soumission.

Sous-chantier connecteur : récupérer et archiver les specs CIRCABC, qualifier comptes/mandats, authentification et schémas, tester ACCEPTANCE, reprises et doublons ; rapprochement obligatoire si réponse perdue. Pas de nouvelle soumission automatique à l'aveugle. PRODUCTION derrière activation explicite et validation du responsable.

**Sortie :** dossier incomplet ou risque non résolu jamais prêt ; export ne crée jamais le statut déclaré ; reconstruction des pièces et versions ; tests de contrat officiels si accès obtenu. Si accès manquant : export assisté opérationnel, connecteur bloqué explicitement sans fausse promesse.

### Chantier 8 — Qualification du pilote et lancement (semaine 8)
**Dépend des critères de sortie des autres chantiers.** `tests/e2e/`, tests sécurité/charge, CI, runbooks, `docs/{technique,utilisateur,conformite}`.

Tests parcours entreprise/fournisseur, audit des permissions, clavier/accessibilité, responsive, reprise après interruption, alertes, backups/restauration, revue RGPD, monitoring, procédures incident et rollback. Données synthétiques et démo séparées. Dashboard alimenté par les données réelles avec dénominateurs et dates ; « dossiers validés en interne » plutôt qu'un taux de conformité juridique implicite.

**Sortie :** aucun P0/P1 sécurité ouvert, restauration démontrée, échantillon de dossiers revu par compliance, connecteurs qualifiés ou désactivés, documentation entreprise/fournisseur/admin, rapport de tests et lancement PRÊT / À FINALISER / BLOQUÉ / RISQUE RÉGLEMENTAIRE / PROCHAINE VERSION.

### Faisabilité des huit semaines
Ce calendrier est un objectif de **pilote borné**, pas une promesse de plateforme complète prête pour des millions de parcelles. Hypothèse : équipe pluridisciplinaire (backend/SIG, frontend, QA/DevOps, référent compliance disponible), accès aux fournisseurs de données et décisions rapides. Un seul développeur ne peut raisonnablement garantir tout le périmètre décrit en huit semaines.

Proposition de pilote à valider : café/cacao, un nombre limité d'origines juridiquement qualifiées, première source environnementale vérifiée, export préparatoire. Préparer le modèle pour toutes les commodités sans activer de parcours bois/bovins incomplets. Toute extension dépend des mêmes critères de sortie.

## 11. Stratégie de tests cible

- **Unitaires :** validateurs, matrices d'obligations, nomenclature datée, facteurs de risque, calculs de progression et échéances.
- **Intégration :** PostgreSQL/PostGIS réel, RLS avec rôle de production, migrations, stockage privé, jobs et outbox.
- **E2E :** invitation fournisseur → collecte → import → document → revue → DDR → export ; risque détecté → action → nouvelle revue ; modification après approbation.
- **Sécurité :** A/B pour chaque endpoint, jobs, téléchargement, recherche et agrégat ; utilisateurs multi-organisations, changement de rôle, token expiré ; aucun secret ni donnée producteur dans logs/erreurs.
- **Géospatial :** données malformées, coordonnées non finies, anneaux vides, self-intersections, trous, multipolygones, dateline, très petite/grande parcelle, dépassement quotas.
- **Connecteurs :** contract tests avec fixtures versionnées ; tests réels séparés avec comptes de test ; absence de données ≠ absence de risque.
- **Charge :** objectifs chiffrés fixés après profil de volumétrie ; budgets de sommets, temps de réponse, jobs et coûts ; tests avant toute promesse de capacité.
- **Non-régression réglementaire :** chaque règle → source/article/version → scénario → décision humaine requise. Les tests actuels qui valident de faux verdicts doivent être remplacés, pas seulement conservés verts.

## 12. V2/V3, IA et modèle économique

**V2 :** suivi récurrent des parcelles, sources additionnelles qualifiées, connecteurs ERP et API fournisseurs avec scopes, webhooks signés, exports incrémentaux. Intégrations SAP/Dynamics/Salesforce uniquement après cas d'usage validé.

**IA :** rechercher dans les données autorisées du tenant ; répondre avec référence au document, page, champ et règle. Traitement des documents comme données non fiables, protection contre injections, abstention si preuve absente, confirmation humaine de l'extraction. Aucune écriture de verdict juridique ou transmission officielle autonome. Contrats de confidentialité et usage des données du fournisseur IA à valider.

**V3 :** monitoring élargi et indicateurs qualité ; prédiction/benchmarking seulement avec données, consentements et méthodologie suffisants. Un « réseau vérifié » ne doit pas réexposer les parcelles d'autres clients.

**Tarification :** événements d'usage idempotents pour fournisseurs actifs, parcelles, analyses, stockage et déclarations effectivement confirmées. Les exports, retries et tests ACCEPTANCE ne doivent pas être comptés comme déclarations payantes. Prévoir entitlements/quotas et adaptateur de paiement sans coder de prix Stripe ni modèle 10–30 €/déclaration avant validation commerciale. Conserver les obligations de rétention même après fin d'abonnement selon politique approuvée.

## 13. Bilan de l'étape et décisions attendues

### FAIT
Audit du dépôt accessible, tests existants exécutés, défauts majeurs reproduits, corpus réglementaire actualisé consulté, architecture et plan séquencé présentés.

### NON FAIT
Aucune correction ou fonctionnalité livrée ; aucune qualification navigateur/Docker/PostgreSQL de bout en bout ; aucun connecteur réel validé ; aucune certification juridique ou sécurité.

### PROBLÈMES
API anonyme, pas de tenants, verdicts sur simulation, divergence des moteurs, défaut de collections géographiques, déploiement incohérent, lint en échec et dépendances signalées vulnérables.

### RISQUES
Exposition de données producteurs, dossiers trompeusement qualifiés, faux sentiment de sécurité dû aux 26 tests verts, évolution réglementaire, temps de qualification satellite et légalité locale.

### PROCHAINE ÉTAPE
Valider le chantier 1 avant implémentation :
1. Confirmer FastAPI unique + PostgreSQL/PostGIS + Next.js/Leaflet conservés.
2. Indiquer s'il existe un déploiement ou des données à préserver hors du dépôt ; aucun secret à envoyer dans la conversation.
3. Choisir le fournisseur OIDC et l'hébergement, ou autoriser une proposition documentée UE.
4. Définir le périmètre du pilote : commodités, pays, volumes et profil opérateur/aval.

**Le chantier 1 n'a pas commencé.**
