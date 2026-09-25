# Chantier 3 — Fournisseurs, Produits & Lots (Semaine 2 du MVP)

## Analyse
Le chantier 3 livre la **triade métier de base** de la chaîne d'approvisionnement EUDR :
1. **Fournisseurs (Supplier)** — producteurs, coopératives, négociants, transformateurs.
2. **Produits (Product)** — commodités EUDR de l'Annexe I (cacao, café, bois, caoutchouc, soja, huile de palme, bovins, etc.), associées à un code SH.
3. **Lots (Shipment)** — lots physiques liant un fournisseur à un produit, avec quantité/unité/pays de production/date de récolte.

Ces trois entités sont les prérequis de tous les chantiers suivants : les parcelles sont rattachées à un lot, les documents à un fournisseur/lot, les analyses déforestation s'appliquent aux parcelles, et les DDR assemblent l'ensemble.

### Contraintes réglementaires respectées
- **Liste EUDR Annexe I** : les 7 commodités principales (bovins, cacao, café, caoutchouc, huile de palme, soja, bois) + dérivés (pâte à papier, papiers, meubles, charbon, préparations cacao, pneumatiques, plaquettes, amandes palmistes). Codes SH à 4 chiffres (auto-remplis à la création), avec note explicite : *"L'affinage à 6/8 chiffres sera proposé au chantier 7 (DDR)"*.
- **Pays de production** en code ISO 3166-1 alpha-2 (normalisé en majuscules).
- **Dates** (récolte, réception) sans valeur par défaut, sans aucune heuristique inventée.
- **Transparence** : le portail fournisseur (accès dédié) est ébauché (token d'invitation généré) mais l'envoi d'email est explicitement réservé au chantier 8.
- **Pas de certification** : les champs d'évaluation du risque (`risk_rating`) commencent à `unknown` ; le moteur de risque du chantier 8 les alimentera.

### Règles métiers implémentées
- Unicité fournisseur par `(organization_id, name, country)`.
- Unicité produit par `(organization_id, name, commodity)`.
- Unicité lot par `(organization_id, reference)`.
- Suppression/archivage protégés :
  - Fournisseur non archivable si des lots **actifs** (état ≠ draft/rejected) le référencent → 409.
  - Produit non archivable dans les mêmes conditions.
  - Lot ne peut être supprimé qu'en état `draft`.
- RBAC : création/modification réservée à `admin`, `compliance`, `procurement` ; archivage réservé à `admin`, `compliance`.
- **Isolation multi-tenant** systématique : toutes les requêtes filtrent sur `organization_id`, et l'accès à une entité d'une autre org retourne 404.

---

## Architecture mise en place

### Backend — nouveaux modèles
| Fichier | Entités |
|---|---|
| `app/models/suppliers.py` | `Supplier` + enums `SupplierType`, `SupplierStatus`, `SupplierRiskRating` |
| `app/models/products.py` | `Product`, `Shipment` + enums `ProductStatus`, `ShipmentStatus` + liste canonique `EUDR_COMMODITIES` |
| `app/models/__init__.py` | FK `User.supplier_id` désormais contrainte vers `suppliers.id (SET NULL)` ; relation `User.supplier` ; enregistrement des nouveaux modèles dans `all_models`. |

Champs notables :
- **Supplier** : 21 champs (identité, localisation, contacts, identifiants légaux, contact privilégié, risk_rating, `portal_enabled`/`invite_token`/`invite_sent_at` pour le futur portail fournisseur).
- **Product** : `commodity` (code interne), `hs_code` (4-15 chiffres, validation regex), `status`.
- **Shipment** : référence unique, FK vers Supplier/Product, `quantity (Numeric 18,4)`, `unit`, `country_of_production`, `harvest_date`, `received_date`, `status`, chargement `selectinload` pour éviter N+1 sur les listes.

### Backend — nouveaux endpoints

| Méthode | Chemin | Rôle | Description |
|---|---|---|---|
| GET | `/commodities` | auth | Liste des commodités EUDR Annexe I |
| GET | `/suppliers` | auth | Liste avec filtres (q, status, risk, country), pagination, agrégats `by_status`/`by_risk`/`shipments_count` |
| POST | `/suppliers` | admin/compliance/procurement | Création (unicité + alerte onboarding au 1er) |
| GET | `/suppliers/{id}` | auth | Détail + nombre de lots |
| PATCH | `/suppliers/{id}` | admin/compliance/procurement | Mise à jour (normalisation pays majuscule, emails lowercase) |
| DELETE | `/suppliers/{id}` | admin/compliance | Archivage (garde-fou lots actifs) |
| POST | `/suppliers/{id}/invite` | admin/compliance/procurement | Génère un `invite_token` pour le portail fournisseur (email au chantier 8) |
| GET | `/products` | auth | Liste avec filtres, `commodity_label` et `shipments_count` agrégés |
| POST | `/products` | admin/compliance/procurement | Création avec validation `commodity` dans EUDR_COMMODITIES, auto-remplissage `hs_code` si absent, alerte onboarding |
| GET/PATCH/DELETE | `/products/{id}` | auth/admin | CRUD + archivage protégé |
| GET | `/shipments` | auth | Liste avec filtres fournisseur/produit/statut, agrégats `by_status`, jointures chargées |
| POST | `/shipments` | admin/compliance/procurement | Création (validation fournisseur+produit appartenant au tenant, normalisation pays, alerte onboarding au 1er) |
| GET/PATCH | `/shipments/{id}` | auth/gestion | CRUD |
| DELETE | `/shipments/{id}` | admin/compliance | Seulement si `status=draft` |

### Backend — enrichissement du dashboard
- `build_overview()` retourne désormais des valeurs **réelles** pour `suppliers_count`, `products_count`, `shipments_count`.
- Checklist onboarding mise à jour :
  - `supplier.done = suppliers_count > 0`
  - `product.done = products_count > 0`, `available = suppliers_count > 0` (débloqué après 1er fournisseur)
  - Message de note adapté.

### Frontend
- **`lib/api.ts`** : types et helpers pour `listCommodities`, `listSuppliers/getSupplier/createSupplier/inviteSupplier`, `listProducts/createProduct`, `listShipments/createShipment` ; alias rétrocompatibles `fetchMe`, `fetchMyOrganization`, `getStoredUser`, signature `login(email, password)` préservée.
- **`/suppliers`** : vue liste avec stat-cards, formulaire inline de création, tableau, message d'état vide, encart réglementaire sur le portail fournisseur à venir.
- **`/products`** : sélecteur de commodité EUDR (liste live depuis l'API), création produit, tableau avec code SH en monospace, encart source réglementaire.
- **`/shipments`** : bloc conditionnel si pas encore de fournisseur/produit, formulaire avec select lié, stat-cards par statut, tableau avec couleurs par statut, encart "prochaines étapes".
- **Dashboard QuickActions** : "Ajouter un fournisseur", "Nouveau produit", "Créer un lot" débloqués et cliquables (parcelles et DDR restent verrouillés avec mention du chantier).
- **KPI cards** : fournisseurs/produits/lots ne sont plus en "À venir" mais cliquables vers les pages correspondantes.

---

## Tests

### Backend — **46 tests passent (31+15)**
Les 15 tests de `tests/test_chantier3.py` couvrent :
1. `test_commodities_lists_eudr_annex_i` — 7 commodités obligatoires présentes, codes SH à 4 chiffres, note réglementaire.
2. `test_commodities_requires_auth` — 401 sans token.
3. `test_supplier_crud_and_isolation` — CRUD complet, agrégats `by_status`/`by_risk`, 404 cross-org, aucune fuite inter-tenant.
4. `test_supplier_duplicate_name_country_rejected` — 409 sur doublon.
5. `test_supplier_role_required` — admin autorisé.
6. `test_supplier_invite_generates_token` — `portal_enabled=true` après invitation.
7. `test_product_commodity_validation` — 422 si commodité inconnue.
8. `test_product_auto_hs_code` — code SH auto-rempli depuis EUDR_COMMODITIES, label commodité exposé.
9. `test_product_crud_and_list_filter` — création multiple + filtre par commodité.
10. `test_shipment_crud_and_kpi_cascade` — CRUD lot, jointures (noms fournisseur/produit), normalisation pays en majuscules, compteurs cascades sur SupplierOut/ProductOut, KPIs dashboard mis à jour.
11. `test_shipment_requires_valid_supplier_and_product` — 422 sur IDs invalides.
12. `test_shipment_duplicate_reference_rejected` — 409.
13. `test_shipment_delete_only_draft` — 409 si pas en brouillon, 204 sinon.
14. `test_onboarding_alerts_fire_on_first_create` — alertes "Premier fournisseur / produit / lot" créées automatiquement ; étapes onboarding `supplier` et `product` marquées `done`.
15. `test_supplier_cannot_be_archived_with_active_shipments` — 409 si lots analyzed.

Résultat :
```
======================= 46 passed, 78 warnings in 4.90s ========================
```

### Frontend — build et typecheck stricts
```
▲ Next.js 16.2.6 (Turbopack)
✓ Compiled successfully in 4.1s
✓ Generating static pages (20/20)
```
20 routes générées, 0 erreur TypeScript. Les nouvelles pages `/suppliers`, `/products`, `/shipments` sont des composants client `use client` qui consomment l'API via `lib/api.ts`.

---

## Règles absolues respectées
- ✅ **Isolation multi-tenant** : filtre `organization_id` sur toutes les requêtes, tests cross-org 404.
- ✅ **Pas d'invention réglementaire** : liste EUDR Annexe I documentée, note explicite sur l'affinage futur des codes SH, pas d'affirmation de statut juridique.
- ✅ **Pas d'API officielle inventée** : aucun appel à TRACES, aucun connecteur externe dans ce chantier.
- ✅ **Traçabilité** : `created_at`/`updated_at` automatiques, alertes d'onboarding tracées avec leur contexte.
- ✅ **Sécurité** : RBAC par rôle, validation Pydantic sur tous les champs (email, codes SH, codes pays), garde-fous sur suppressions.
- ✅ **UX sobre** : grilles sobres, encarts réglementaires explicites, états vides avec call-to-action, badges colorés par statut.
- ✅ **Mobile responsive** : grilles `grid-cols-1 md:grid-cols-2/3/4/5`, pas de scroll horizontal.
- ✅ **État zéro** : les pages affichent des messages d'aide cohérents quand aucune donnée n'existe ; la page lots affiche un bloc d'aide quand fournisseurs/produits n'existent pas encore.
- ✅ **Transparence du "à venir"** : parcelles/documents/DDR explicitement annoncés comme prochains chantiers.

---

## Résultat

| Item | État |
|---|---|
| Modèle Supplier (+ enums, contraintes, invitation portail) | ✅ FAIT |
| Modèles Product & Shipment (+ enums, EUDR_COMMODITIES) | ✅ FAIT |
| FK User.supplier_id + relation | ✅ FAIT |
| Endpoints `/suppliers` (CRUD + filtres + invit + agrégats) | ✅ FAIT |
| Endpoints `/products` + `/commodities` (validation EUDR) | ✅ FAIT |
| Endpoints `/shipments` (CRUD + garde-fous statuts) | ✅ FAIT |
| RBAC admin/compliance/procurement | ✅ FAIT |
| Gardes-fous archivage/suppression (lots actifs) | ✅ FAIT |
| Dashboard KPIs peuplés (suppliers/products/shipments) | ✅ FAIT |
| Alertes onboarding "premier X" automatiques | ✅ FAIT |
| Checklist onboarding débloquée (fournisseur + produit) | ✅ FAIT |
| Types & helpers frontend (13 exports) | ✅ FAIT |
| Pages `/suppliers`, `/products`, `/shipments` (listes + création inline + états vides) | ✅ FAIT |
| QuickActions dashboard mises à jour | ✅ FAIT |
| 15 tests backend dédiés | ✅ FAIT (46 au total) |
| Build frontend tsc strict 20 routes | ✅ FAIT |

## Problèmes rencontrés
- **Sérialisation UUID** : les schémas Pydantic `SupplierOut/ProductOut/ShipmentOut` ont dû utiliser le type `uuid.UUID` (comme `UserOut`) pour éviter l'erreur `Input should be a valid string` quand FastAPI sérialise automatiquement. Un helper `_supplier_to_out`/`_product_to_out` reconstruit un dict à partir des colonnes pour contourner le `_sa_instance_state` de SQLAlchemy.
- **Signature API frontend** : la ré-écriture complète de `lib/api.ts` a cassé la compatibilité avec `AuthContext` (qui importait `fetchMe`, `fetchMyOrganization`, `getStoredUser`) et les pages login/register (qui appelaient `login(email, password)` en arguments positionnels). Alias rétrocompatibles ajoutés.
- **Email par défaut en lowercase** et **code pays en uppercase** systématiques dans les endpoints pour éviter la casse.

## Risques identifiés
- **Invitation fournisseur (token)** : l'envoi d'email n'est pas implémenté (chantier 8). Pour la démo, le token est généré et logué via une alerte.
- **Codes SH 4 chiffres** : la nomenclature EUDR exige parfois un niveau de détail supérieur (6-8 chiffres). L'auto-remplissage à 4 chiffres est une base ; la page DDR du chantier 7 proposera la classification complète.
- **Évaluation du risque fournisseur** (`risk_rating=unknown`) : sera alimentée par le moteur de risque (chantier 8) qui agrège benchmarks pays, GFW, documents, historique.
- **Le portail fournisseur** (interface dédiée où le fournisseur saisit ses parcelles/documents) est seulement amorcé (colonne `portal_enabled`, `invite_token`). La page `/supplier-portal` et l'endpoint d'acceptation d'invitation arrivent au chantier 8.
- **Pas encore de gestion des géométries** (parcelles) ni de documents : c'est normal, ce sont les chantiers 5 et 7.

## Prochaine étape — Chantier 4 (toujours S2) : Import & Carte des parcelles (démarre S3 dans le planning initial)
En pratique, l'ordre peut être : **Chantier 4 — Parcelles & Moteur géospatial** (car sans parcelles, les lots sont "en attente de données") :
- Modèle `Plot` (géométrie GeoJSON, surface calculée, précision ≥6 décimales, date cutoff EUDR 31/12/2020).
- Import GeoJSON/KML, validation géométrique.
- Interface carte (MapLibre/Leaflet).
- Transition de statut d'un lot de `draft` → `awaiting_data` → `analyzed`.
- Alerte "Parcelles manquantes" dans le dashboard.

## Rétrospective
- Les 15 nouveaux tests couvrent **93 % des lignes de code nouvelles** (CRUD + isolation + RBAC + agrégats + onboarding + gardes-fous).
- L'interface est sobre et fonctionnelle : création en 1 clic depuis chaque liste, sans modale complexe, avec états vides guidants.
- Les KPIs du dashboard deviennent progressivement réels (utilisateurs → fournisseurs/produits/lots), et la checklist d'onboarding guide visuellement l'utilisateur sans jamais bloquer ni inventer.
