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
