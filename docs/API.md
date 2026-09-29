# API — socle et collecte initiale

Même origine navigateur. JSON ; identité par cookie opaque, jamais par `user_id` fourni par le client. Toute mutation exige `Origin` correspondant à PUBLIC_ORIGIN et `X-CSRF-Token` obtenu via `/me`.

| Méthode | Chemin | Contrat |
|---|---|---|
| GET | /api/auth/login | Redirection OIDC, PKCE/state/nonce |
| GET | /api/auth/callback | Échange code, validation du jeton ID, session serveur |
| POST | /api/auth/logout | Révocation locale, 204 |
| GET | /api/v1/me | user, csrf_token, organizations, environment, états MFA |
| POST | /api/v1/organizations | `{name}` → organisation 201 ; crée appartenance Admin et audit atomiques |
| PATCH | /api/v1/organizations/{uuid} | `{name,version}` → nouvelle version ; Admin ; conflit 409 |
| GET | /api/v1/organizations/{uuid}/members | Liste limitée à l'organisation ; Admin |
| PUT | /api/v1/organizations/{uuid}/members | `{email,role,supplier_id?}` ; compte déjà connecté avec email vérifié ; UUID supplier obligatoire exclusivement pour Supplier, correspondant à une fiche active de cette organisation |
| DELETE | /api/v1/organizations/{uuid}/members/{user_uuid} | Révocation ; Admin ; dernier Admin protégé ; 204 |
| GET | /api/v1/organizations/{uuid}/audit?limit=50 | Admin/Compliance Manager ; limite 1..100 ; événements les plus récents |
| GET | /health/live | Vivacité sans accès DB |
| GET | /health/ready | Vérifie version de migration et PostGIS |

401 : session absente/expirée/révoquée. 403 : permissions, MFA ou CSRF. 404 : organisation non accessible. 409 : conflit de version/dernier administrateur/quota. 413 : corps supérieur à 64 Kio. 422 : entrée invalide. 429 : limitation de débit. 503 : DB indisponible, message sans détail SQL.

Les anciennes routes métier, y compris audit/export, répondent 401 sans identité et 410 une fois authentifié. Aucun fallback vers le prototype. Documentation OpenAPI non exposée publiquement ; schéma exportable par le script de documentation. Les DTO frontend sont actuellement typés manuellement, non générés ; génération du client à intégrer au développement des modules métier.


## Approvisionnement — chantier 2

Préfixe `O=/api/v1/organizations/{org}`. Lecture Admin, Compliance Manager, Procurement, Analyst, Viewer ; Supplier lit seulement sa fiche, ses relations et ses lots. Écriture canonique Admin/Compliance Manager/Procurement. Admin soumis au contrôle MFA du socle.

| Méthode | Chemin | Contrat |
|---|---|---|
| GET | /api/v1/catalogue | Pays ISO, sept matières déclaratives, unités ; session OIDC |
| GET | O/supply-summary | Comptages réels, limités au périmètre, aucun score réglementaire |
| GET / POST | O/suppliers | Liste / création ; référence unique par organisation |
| GET / PUT | O/suppliers/{id} | Détail avec contacts/collectes/invitations sans secrets / remplacement avec version |
| POST | O/suppliers/import-preview | `{csv_text}` ; aperçu, conflits, checksum, import antérieur |
| POST | O/suppliers/import | Même corps ; tout ou rien, replay sans doublons ; aucun écrasement |
| POST | O/suppliers/{id}/contacts | Création nom/email ; unicité email sans tenir compte de la casse |
| PUT / DELETE | O/suppliers/{id}/contacts/{cid} | Mise à jour avec version / suppression avec `?version=N` ; audit conservé |
| GET / POST | O/products | Liste / création ; `commodities`, `supplier_ids`, `hs_code` déclaratif |
| PUT | O/products/{id} | Remplacement versionné ; impossible de délier une association utilisée par un lot |
| GET / POST | O/lots | Liste / création ; quantité décimale exacte, unité, source revue facultative |
| PUT | O/lots/{id} | Remplacement versionné ; source du même fournisseur et revue requise |
| POST | O/{suppliers,products,lots}/{id}/archive | `{version}` ; conservation historique ; fournisseur : révoque les accès portail |
| POST | O/suppliers/{id}/invitations | `{expires_in_hours:72}` (1..168) → 201, URL secrète affichée une fois, livraison MANUAL ; révoque tous les anciens liens/sessions |
| DELETE | O/suppliers/{id}/invitations/{iid} | Révocation immédiate aux prochains accès ; 204 |
| POST | O/suppliers/{id}/collections/{cid}/review | `{version,decision:REVIEWED ou CHANGES_REQUESTED,note}` ; Admin/Compliance Manager uniquement ; note 5..2000 caractères |

Listes : `q` (200 caractères max), `page=1` (max 1000), `limit=20` (max 100), `include_archived=false`. Produits : filtre `supplier_id` facultatif. Les champs de quantité sont renvoyés comme **chaînes décimales**, pas nombres flottants. Pays ISO 3166-1 alpha-2 ; codes SH/NC 4, 6 ou 8 chiffres, sans qualification juridique automatique. Le CSV accepte 48 000 caractères, sous la limite globale de corps HTTP de 64 Kio ; le navigateur limite le fichier à 48 Ko. Numéro d’erreur CSV : ligne physique de fin d’enregistrement, utile pour les cellules multilignes.

Le détail fournisseur affiche les 30 dernières collectes et 10 invitations. Les révisions de chaque soumission sont conservées en base et les mutations sont auditées ; une interface dédiée de comparaison historique n’est pas livrée. L’archivage n’efface ni les références ni les relations et n’est pas réversible dans cette version.

## Portail fournisseur

Cookie séparé `__Host-gft-supplier` sous HTTPS (`gft-supplier` en local HTTP), HttpOnly/Secure/SameSite=Lax, session max 8 h bornée par l’expiration de l’invitation. Hash uniquement en base. Aucun droit d’accès aux routes entreprise. Le fragment d’URL est effacé **avant** échange explicite du secret. `POST /exchange` exige Origin ; les autres mutations exigent aussi `X-CSRF-Token`.

| Méthode | Chemin | Contrat |
|---|---|---|
| POST | /api/portal/exchange | `{token}` à usage unique → cookie et csrf_token ; 401 pour invalide/utilisé/expiré/révoqué ; 10 tentatives/minute par pair réseau (bucket partagé avec login OIDC) |
| GET | /api/portal/me | Identité du fournisseur et entreprise destinataire, csrf_token, expiration, collectes et catalogue ; aucune identité de personne certifiée |
| PUT | /api/portal/collections/{id} | `{version,payload:{company,products}}` ; seulement DRAFT/CHANGES_REQUESTED ; max 20 produits |
| POST | /api/portal/collections/{id}/submit | `{version,confirmed:true}` ; collecte complète exigée ; snapshot append-only ; transition SUBMITTED |
| POST | /api/portal/logout | Révocation session et suppression cookie ; 204 ; retour nécessite un nouveau lien |

Complétude : nom/pays/adresse/email/contact de l’organisation et nom/matière/quantité/unité/pays de chaque produit ; au moins un produit. Scope `INITIAL_COLLECTION_ONLY` : **jamais** un taux de conformité EUDR. Une collecte soumise est figée jusqu’à demande de corrections ; une collecte revue demeure figée, une nouvelle invitation ouvre un nouveau brouillon copié. Aucune proposition n’écrase le canonique. Le serveur revalide session, invitation et fournisseur actif à chaque accès ; le contexte SQL est transactionnel LOCAL.

OpenAPI exporté : `docs/openapi.json`. Les champs frontend restent typés manuellement ; contrat testé en intégration et E2E, génération de client à ajouter ultérieurement.

## Parcelles — chantier 3 / API 0.4.0 / migration 0003

`O=/api/v1/organizations/{org}`. Même authentification OIDC, CSRF/Origin et contexte transactionnel que le socle. Le rôle applicatif n’est propriétaire d’aucune table. Lecture limitée au tenant et, pour Supplier, à son fournisseur. Écriture Admin/Compliance Manager/Procurement ; revue Admin/Compliance Manager seulement.

| Méthode | Chemin | Contrat / effet |
|---|---|---|
| GET / POST | O/plots | Liste paginée / création avec fournisseur, géométrie et confirmation des avertissements |
| POST | O/plots/check | Analyse sans écriture, relations dans le périmètre autorisé ; `exclude_plot_id` possible lors d’une modification |
| POST | O/plots/import-preview | Source texte, format, fournisseur, préfixe/pays/matière ; aperçu, checksum, conflits et replay éventuel |
| POST | O/plots/import | Même entrée + `confirmed:true` + `preview_checksum` ; transaction atomique et replay sans doublons |
| GET | O/plot-imports/{id}/source | Texte source brut privé, téléchargement sans interprétation HTML ; rôles writers uniquement |
| GET / PUT | O/plots/{id} | Détail / nouvelle révision avec version optimiste et confirmation des avertissements |
| GET | O/plots/{id}/revisions/{revision} | Snapshot immuable : payload, analyse, source, acteur, date |
| POST | O/plots/{id}/archive | `{version}` ; conserve historique et liens |
| GET / PUT | O/lots/{lot}/plots | Révisions retenues / remplacement explicite `{version,plots:[{plot_id,revision}]}` ; même fournisseur |
| GET | O/plot-proposals | Propositions du périmètre, pagination et filtre fournisseur |
| GET | O/plot-proposals/{id}/revisions | Historique des transmissions fournisseur |
| POST | O/plot-proposals/{id}/review | `{version,decision,note,adopted_reference?,confirmed?}` ; ACCEPTED exige `confirmed:true`, CHANGES_REQUESTED renvoie au fournisseur |

La liste des parcelles accepte `page` (1..1000), `page_size` (1..50), `q` (200 caractères max). Parcelles : `supplier_id`, `include_archived`, `bbox=west,south,east,north` WGS84 sans traversée de l’antiméridien. La liste des propositions accepte `page` (1..1000) et `supplier_id`, avec 20 éléments par page. La carte UI n’affiche que la page courante ; aucune promesse de chargement de millions de géométries.

Portail, avec cookie et CSRF fournisseur distincts :

| Méthode | Chemin | Contrat |
|---|---|---|
| POST | /api/portal/plots/check | Contrôle technique, **sans recherche dans les parcelles canoniques** |
| GET / POST | /api/portal/plot-proposals | Liste limitée au fournisseur / création `{payload}` |
| PUT | /api/portal/plot-proposals/{id} | `{version,payload}` ; brouillon ou corrections seulement |
| POST | /api/portal/plot-proposals/{id}/submit | `{version,confirmed:true}` ; snapshot de soumission append-only |

`PlotData` : référence, nom, pays déclaré ISO, matière facultative, géométrie 2D, surface déclarée facultative, méthode de capture, observations, précision GPS et date facultatives. Une capture GPS exige précision et date avec fuseau, non future au-delà de la tolérance de cinq minutes. Il s’agit d’une provenance déclarée, pas d’une attestation du capteur.

Erreurs : 413 budget HTTP ; 422 validation/confirmation absente ; 409 conflit de version/référence, état métier ou avertissements à confirmer ; 403 permission ; 404 objet hors périmètre/inexistant ; 429 débit. Les erreurs d’analyse ne doivent pas être interprétées comme des décisions réglementaires.

Budgets : routes géographiques ciblées 2 Mio HTTP, source d’import 1 Mio, 100 éléments et 10 000 positions cumulées ; une géométrie isolée 10 000 positions ; surface maximale technique 100 000 ha ; relations spatiales limitées à 50 résultats, avec indication de troncature. SQL géospatial borné par `statement_timeout` de 8 secondes par instruction, **pas** un SLA de durée totale d’import.

La version du validateur est enregistrée dans chaque analyse (`plots-v1-draft` pour cette première règle technique, non homologuée pour un échange officiel). L’API conserve la géométrie source ; la simulation à six décimales n’écrase rien. Les snapshots et imports sont append-only pour le rôle runtime. La provenance d’un lot ne change pas automatiquement après une modification parcellaire.

## Cohérence pays — référence mondiale indicative chantier 4 / API 0.5.0

Schéma requis : **0004**. Méthode actuelle `country-screening-v2-global-indicative` ; anciens résultats v1 conservés. Le catalogue retourne `GLOBAL_INDICATIVE_WITH_EXCEPTIONS`, `covered_count`, les sources et exclusions, ou `UNAVAILABLE` si le manifeste est indisponible/invalide. Contrôles séparés des géolocalisations immuables existantes, sans remplacement des résultats géométriques ni du pays déclaré.

`O=/api/v1/organizations/{org}` :

| Méthode | Chemin | Contrat |
|---|---|---|
| GET | O/geospatial/sources | Catalogue et limites, session OIDC et appartenance ; 246 codes admis, exceptions AQ/EG/UM, versions/empreintes/attributions |
| GET | O/plots/{plot}/country-checks?revision=N&page=1 | Historique de la révision demandée, 20 résultats/page, page 1..1000 ; permissions de lecture et périmètre fournisseur identiques à la parcelle |
| POST | O/plots/{plot}/country-checks | `{revision,review_distance_m,request_id}` ; Admin/Compliance Manager/Procurement ; source et géométrie déterminées exclusivement par le serveur |

`revision` est un entier strict positif ; `review_distance_m` est obligatoire, entier 0..50 000, sans valeur implicite ; `request_id` est un UUID généré par le client. Ce paramètre de proximité est une marge de revue, **pas une précision de la source ni une règle EUDR**.

La même requête dans l’organisation retourne le même résultat et `replayed:true`, y compris après changement de disponibilité du référentiel ; changer de révision, parcelle ou marge en réutilisant le même identifiant produit 409. Verrou transactionnel par organisation/identifiant et unicité DB empêchent les doublons simultanés. Pour une nouvelle analyse, utiliser un nouvel identifiant. Une réponse `SOURCE_UNAVAILABLE` reste historisée ; ce n’est pas une validation et une nouvelle tentative doit être explicite.

La géométrie et le pays proviennent du snapshot de révision autorisé. Le résultat conserve son identifiant, la révision, la source/version/hash/année/licence, la version de méthode/PostGIS et les limites. `country_verified` reste faux, `regulatory_status` reste `NOT_ASSESSED`, revue humaine requise. GET ne lance aucun calcul et ne remet pas les résultats historiques au goût du jour.

Analyst/Viewer/Supplier OIDC : lecture uniquement ; Supplier limité à son fournisseur. Portail par lien : aucun accès à ces routes OIDC. L’ancienne collecte/proposition du portail reste inchangée ; les contrôles persistants concernent le référentiel entreprise, y compris ses anciennes révisions et archives.

Erreurs 404 pour parcelle/révision absente ou hors périmètre ; 403 droits/CSRF ; 422 entrée invalide ; 409 réutilisation incompatible ; indisponibilité générale DB : 503. Une panne pendant le calcul référentiel est classée `SOURCE_UNAVAILABLE`, isolée par savepoint, sans transformer l’erreur en correspondance.

## Observations forestières — chantier 5 / API 0.6.0 / migration 0005

Préfixe `O=/api/v1/organizations/{org}`. Les calculs sont indicatifs et restent `NOT_ASSESSED`, revue humaine obligatoire.

| Méthode | Route sous O | Description |
|---|---|---|
| GET | `/forest/sources` | Activation serveur, sources GFC et JRC TMF via Epoch |
| POST | `/plots/{plot}/forest-analyses` | `{revision,request_id,allow_public_tile_requests:true}` ; types stricts ; source/géométrie déterminées côté serveur |
| GET | `/plots/{plot}/forest-analyses?revision=1&page=1` | Historique paginé 20, sans les gros blocs de preuves |
| GET | `/plots/{plot}/forest-analyses/{analysis}` | Preuves complètes privées, octets comprimés, masques, versions/empreintes |

Écriture Admin/Compliance Manager/Procurement ; lecture Analyst/Viewer et Supplier OIDC limité à son fournisseur. Aucun accès nouveau par portail de lien. CSRF/Origin et audit existants conservés.

Activation explicite `FOREST_ANALYSIS_ENABLED=true`, sinon nouveau calcul 503. Les anciennes preuves restent lisibles et une requête déjà enregistrée est rejouable. Session/permissions contrôlées avant puis après le travail ; résultat attaché à la révision demandée, pas remplacé lors d’un changement de source.

Une analyse prend au maximum environ 100 secondes de worker ; pas de file asynchrone durable promise. 409 pour une même requête déjà active ou une clé réutilisée avec une autre entrée, 429 si organisation/capacité occupée, 503 pour échec du worker. Le lecteur peut également enregistrer un résultat explicitement `SOURCE_UNAVAILABLE`, `PARTIAL`, `NOT_COVERED` ou `BUDGET_EXCEEDED` : HTTP 200 ne signifie jamais « conforme ». Conserver le même request_id après un problème de transport ; créer un nouvel UUID pour une nouvelle observation explicite.

Le résultat valide la même empreinte géométrique que le snapshot autorisé. Le détail JSON peut atteindre 8 Mio ; les listes omettent `windows`. Les masques binaires packbits et tableaux de pixels zlib/base64 utilisent les dimensions/dtypes/grilles de leurs métadonnées ; ils ne représentent pas une image RGB interprétée comme donnée analytique.

### Choix de source forestière (chantier 5)

Le POST accepte `source_id`: `gfc-2025-v1.13` (valeur par défaut, rétrocompatible) ou `tmf-2025-epoch`. Toute autre valeur, y compris une URL, est refusée (422). La source entre dans l’empreinte d’idempotence : réutiliser `request_id` avec une autre source renvoie 409. Le résultat contient `source_id` ; les historiques GFC anciens sans ce champ restent lisibles.

TMF utilise `tmf-parcel-grid-v1`, trois couches natives et des années entières uint16, pas les codes uint8 GFC. `baseline_tmf_forest_pixels`, `non_baseline_tmf_forest_pixels`, `baseline_tmf_class_counts`, compteurs séparés des années de déforestation/dégradation sont documentés dans les résumés des fenêtres. Pas de champ de masque historique GFC détourné pour TMF. `PARTIAL_OVERLAPPING_SOURCE_GRIDS` et `POINT_SAMPLE_OVERLAPPING_SOURCE_GRIDS` indiquent une ambiguïté de chevauchement ; pas de conclusion négative complète. Le signal reste toujours distinct d’une décision EUDR.

## Diligence — chantier 7, MVP interne clôturé (backend 0.8.0)

Schéma 0007 et `DILIGENCE_ENABLED=true` nécessaires. Flag désactivé par défaut ; interface et PDF/CSV intégrés, recette finale effectuée. Documentation des contrats dans `openapi.json`, synthèse dans [le bilan final](rapports/07d-chantier-7-cloture.md).

Préfixe `O/diligence` : POST `/revisions`, GET liste paginée, GET `/{dossier}/revisions/{revision}`, POST `/{dossier}/revisions/{revision}/decisions`, GET `/{dossier}/revisions/{revision}/export.{kind}` (`json`, `csv`, `pdf`).

Rôles internes uniquement. Création/revue idempotentes par `request_id`, conflits 409, snapshots immuables, état officiel toujours `NOT_SUBMITTED_BY_GEOFOREST`. Un export d’une validation ancienne indique explicitement si elle reste une validation interne courante ; aucune équivalence avec TRACES. Le JSON inclut géolocalisations, références des preuves et décisions, pas les pièces binaires ni les blocs raster détaillés.

Exports : `X-Content-SHA256` contient le SHA-256 des octets servis ; le navigateur le vérifie. PDF synthèse 8 Mio/60 pages/80 000 caractères affichés, JSON et CSV 2 Mio. Un PDF simultané par base (429 si occupé). Échec borné PDF : 409 avec code explicite ; aucun audit d’export validé en cas d’échec. PDF/CSV ne remplacent pas le JSON structuré. Voir [guide](guide-diligence.md).
