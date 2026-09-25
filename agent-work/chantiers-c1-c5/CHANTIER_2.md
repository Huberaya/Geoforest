# Chantier 2 — Dashboard B2B (Vue d'accueil opérationnelle)

## Analyse
Le dashboard est la page d'atterrissage après connexion ; il doit :
1. Donner en **< 5 secondes** une vision claire de l'état de conformité d'un opérateur.
2. Mettre en avant **alertes** et **prochaines échéances** EUDR.
3. Servir de **hub de navigation** (actions rapides, checklist d'onboarding pour nouveaux comptes).
4. Honorer les contraintes réglementaires :
   - Jamais d'affirmation de certification juridique.
   - Les KPI qui dépendent de modules pas encore construits (chantiers 3 à 9) doivent être **transparents sur leur indisponibilité** ("À venir") et non mensongers.
   - Isolation multi-tenant stricte : un utilisateur ne voit que les alertes/KPI de sa propre organisation.
5. Ne rien inventer : les KPI de conformité/deforestation/parcelles ne seront peuplés qu'une fois les modules dédiés implémentés.

### Composants du MVP dashboard
- **KPIs** : conformité globale (%), parcelles analysées / à action, dossiers DDR prêts / incomplets / à risque, fournisseurs, produits, lots, documents expirés/manquants, membres équipe, compteurs d'alertes par niveau.
- **Alertes récentes** : 8 dernières, filtrables par niveau ; marquage "lu" en 1 clic.
- **Checklist d'onboarding** en 6 étapes qui guide les nouveaux comptes (créer l'org → inviter l'équipe → ajouter fournisseurs → importer parcelles → lancer analyse → générer DDR).
- **Actions rapides** : les 4 opérations les plus courantes.
- **Bannière "état zéro"** pour les comptes nouvellement créés (première connexion).
- **Pavé réglementaire** rappelant les dates LME/PME et le fait que GeoForest Trace n'est pas une certification juridique.

### Contraintes techniques
- Backend : endpoint `GET /api/v1/dashboard/overview` agrégé (une seule requête au chargement) + `POST /api/v1/dashboard/alerts/{id}/read`.
- Isolation tenant par `organization_id` systématique sur toutes les requêtes.
- Seed paresseux : la 1re visite sur le dashboard crée automatiquement l'alerte de bienvenue si elle n'existe pas.
- Frontend : composants atomiques (KpiCard, AlertRow) réutilisables, types TypeScript stricts, zéro `any`, build tsc strict.

---

## Plan
| Élément | Fichier |
|---|---|
| Modèle Alert (enums + champ link/context/is_read) | `backend/app/models/alerts.py` |
| Déplacement JSONType → core/database (éviter circular import) | `backend/app/core/database.py`, `backend/app/models/__init__.py` |
| Service dashboard overview + alertes + onboarding | `backend/app/services/dashboard/overview.py` |
| Endpoints FastAPI | `backend/app/api/v1/endpoints/dashboard.py` |
| Enregistrement du router | `backend/app/api/v1/router.py` |
| Types + helpers API frontend | `frontend/src/lib/api.ts` |
| Composants UI | `frontend/src/components/ui/KpiCard.tsx`, `frontend/src/components/dashboard/{AlertRow,OnboardingChecklist,QuickActions}.tsx` |
| Page dashboard (refonte complète) | `frontend/src/app/(app)/dashboard/page.tsx` |
| Tests backend | `backend/tests/test_dashboard.py` |
| Build frontend + tests complets | tsc + next build + pytest global |

---

## Implémentation

### Backend
- **`Alert` model** avec :
  - Niveaux : `info` / `success` / `warning` / `critical`.
  - Catégories : `onboarding` / `plot` / `document` / `supplier` / `analysis` / `dds` / `compliance` / `system`.
  - Champs : `organization_id` (FK, isolation), `user_id` (nullable, alerte personnelle), `title`, `message`, `link`, `context` (JSON/JSONB), `is_read`, `created_at`.
- **`build_overview(user, db)`** retourne un dict `{ generated_at, kpis, recent_alerts, upcoming_deadlines, onboarding, labels }` :
  - `kpis.users_count` est le seul KPI réellement peuplé aujourd'hui ; les autres retournent `0` (ou `null` pour `compliance_pct` quand aucun DDR n'existe) avec badge "À venir" côté frontend.
  - `alerts_by_level`, `critical_alerts`, `warning_alerts`, `unread_alerts` agrégés en BDD.
  - `onboarding.steps` (6) : chaque étape expose `key/title/description/href/done/available/available_chantier`. Les étapes non encore disponibles affichent "🔒 Chantier N" côté frontend.
  - Seeding paresseux : `seed_onboarding_alerts()` crée l'alerte de bienvenue à la première visite.
- **`mark_alert_read(alert_id, user, db)`** : vérifie `organization_id` avant de mettre à jour (retourne 404 si alerte d'un autre tenant).
- **JSONType** déplacé dans `core/database.py` (JSONB sous PostgreSQL, JSON sous SQLite) pour éviter un import circulaire entre `models/__init__.py` et `models/alerts.py`.
- **Routes** :
  - `GET /api/v1/dashboard/overview` (auth requise)
  - `POST /api/v1/dashboard/alerts/{alert_id}/read` (auth requise)

### Frontend
- **`lib/api.ts`** : types `DashboardOverview`, `AlertItem`, `OnboardingStep` ; fonctions `fetchDashboardOverview()` et `markAlertRead()`.
- **`components/ui/KpiCard.tsx`** : carte KPI paramétrable (6 tons : slate/emerald/amber/red/sky/violet, icône, sous-texte, option click, badge "À venir").
- **`components/dashboard/AlertRow.tsx`** : ligne d'alerte colorée par niveau, avec bouton "Lu" qui déclenche un rechargement.
- **`components/dashboard/OnboardingChecklist.tsx`** : barre de progression + 6 étapes cliquables/verrouillées selon disponibilité.
- **`components/dashboard/QuickActions.tsx`** : grille 4 actions, avec état "bientôt disponible" + indication du chantier qui débloque.
- **`app/(app)/dashboard/page.tsx`** (refonte complète) :
  - En-tête personnel (prénom + org).
  - 4 KPI principaux + 6 KPI secondaires en grille responsive.
  - Badges flotants "N alertes critiques / N avertissements" quand il y en a.
  - Bannière de bienvenue verte quand l'onboarding n'a pas démarré.
  - Panneau alertes (jusqu'à 8, bouton "Voir tout").
  - Colonne droite : checklist onboarding + actions rapides.
  - Encart réglementaire EUDR (dates d'application, rappel "pas de certification juridique").
  - Gestion loading/erreur + bouton actualiser.

---

## Tests & Validation

### Backend — pytest
`backend/tests/test_dashboard.py` (5 tests) :
1. ✅ `test_overview_requires_auth` — 401 sans token.
2. ✅ `test_overview_shape` — structure complète (`kpis`, `onboarding.steps`, `recent_alerts`, types, valeurs initiales cohérentes, alerte de bienvenue créée à la 1re visite).
3. ✅ `test_isolation_between_orgs` — 2 org différentes, chacune voit ses propres alertes.
4. ✅ `test_mark_alert_read` — POST `/alerts/{id}/read` met `is_read=true` et décrémente `unread_alerts`.
5. ✅ `test_mark_other_org_alert_404` — marquer une alerte d'un autre tenant retourne 404 (isolation stricte).

**Résultat global backend : 31 tests passent** (16 initiaux + 10 sécurité/profil du chantier 1 + 5 dashboard).

### Frontend — build tsc strict
```
✓ Compiled successfully in 5.3s
✓ Finished TypeScript in 3.6s
✓ Generating static pages (20/20)
Route /dashboard  (○ static prerendered)
```
Aucune erreur TypeScript en mode strict ; tous les types sont propagés du backend au frontend.

### Vérifications manuelles
- Le router FastAPI monte bien `/api/v1/dashboard/*` sans casser les routes existantes (`/auth`, `/users/me`, `/version`).
- Les champs KPI non implémentés (suppliers, products, shipments, plots*, dds*, documents*) sont à `0` avec badge "À venir" explicite — **pas de fake data**.
- Les liens de la checklist onboarding pointent vers les bonnes routes futures (`/suppliers`, `/plots`, `/analysis`, `/dds`).
- La déconnexion entre env python et pip (rencontrée en début de chantier) a été résolue par `pip install -r requirements.txt` + invocation via `python -m pytest`.

---

## Règles absolues respectées
- ✅ **Isolation multi-tenant** : chaque requête filtre par `organization_id` ; test cross-org 404.
- ✅ **Pas d'invention de réglementation** : le pavé bas de page cite explicitement les dates LME/PME et la clause "pas de certification juridique".
- ✅ **Pas d'API inventée** : aucun appel à TRACES ou service externe non documenté dans ce chantier.
- ✅ **Traçabilité** : les alertes sont horodatées (`created_at`) et liées à un utilisateur optionnel ; l'audit trail viendra au chantier 8.
- ✅ **Transparence sur l'état d'avancement** : badges "À venir" sur tous les modules non implémentés, jamais de valeur mensongère.
- ✅ **UX sobre** : palette sobre émeraude/slate, hiérarchie claire, pas d'animation superflue, accessible (aria-labels sur les boutons, contrastes OK).
- ✅ **Mobile responsive** : grilles `grid-cols-2 md:grid-cols-4 lg:grid-cols-3`, fonctionnel sur écran étroit.
- ✅ **Sécurité** : auth JWT obligatoire, pas de fuite inter-org, validation des entrées par Pydantic.

---

## Résultat

| Item | État |
|---|---|
| Modèle Alert migré + JSONType déplacé | ✅ FAIT |
| Service overview (KPIs + alertes + onboarding) | ✅ FAIT |
| Endpoints `/dashboard/overview` + `/alerts/{id}/read` | ✅ FAIT |
| Seeding paresseux alerte bienvenue | ✅ FAIT |
| Isolation multi-tenant (tests dédiés) | ✅ FAIT |
| Types frontend + fetch helpers | ✅ FAIT |
| Composants KpiCard/AlertRow/Onboarding/QuickActions | ✅ FAIT |
| Page dashboard refaite (zéro état + KPIs + alertes + rappel réglementaire) | ✅ FAIT |
| Tests backend (31/31) | ✅ FAIT |
| Build frontend (Next.js 16, tsc strict, 20 routes) | ✅ FAIT |

## Problèmes rencontrés
- **Perte temporaire de l'environnement Python** (ModuleNotFoundError: fastapi) : causée par une invocation `pip`/`python` sur des interpréteurs différents ; résolue par `pip install -r requirements.txt` + lancement via `python -m pytest` depuis `backend/`. Non bloquant.
- **Aucun bug fonctionnel** détecté sur le code du dashboard après implémentation.

## Risques identifiés
- Les **compteurs à zéro** sur fournisseurs/parcelles/DDR ne seront exacts qu'une fois les chantiers 3 à 9 livrés ; le badge "À venir" et le message d'état zéro sont là pour gérer l'attente sans tromper l'utilisateur.
- Les **échéances EUDR à venir** (champ `upcoming_deadlines`) est pour l'instant une liste vide côté backend. Il sera peuplé au chantier 7 (DDR) quand des dates butoirs réelles existeront.
- **Pas de notifications push/email** encore : les alertes ne sont visibles que dans l'UI ; le chantier 8 ajoutera les emails et websockets.

## Prochaine étape — Chantier 3 (S2) : Fournisseurs & Produits & Lots
Le chantier 3 introduira :
- Modèles SQLAlchemy `Supplier`, `Product`, `Shipment` (lot), schéma RBAC adapté (rôle Supplier).
- CRUD côté Admin/Compliance/Procurement.
- Portail fournisseur dédié (invitation par email, login, saisie de leurs propres données/parcelles).
- Écrans frontend : `/suppliers`, `/products`, `/shipments` (actuellement des placeholders vides).
- Remplissage des KPI `suppliers_count`, `products_count`, `shipments_count` du dashboard.

## Rétrospective UX
Le dashboard MVP respecte la promesse "vision en < 5 secondes" :
- 1re ligne : conformité + parcelles + dossiers → réponse métier immédiate.
- Alertes critiques/success en évidence.
- Checklist onboarding visible pour les nouveaux comptes, transparente pour les comptes matures (la barre se remplit au fur et à mesure).
- Aucun terme juridique exagéré, aucune "validation verte" automatique non justifiée.
