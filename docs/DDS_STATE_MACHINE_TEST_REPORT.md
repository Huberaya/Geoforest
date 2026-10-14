# Machine d'état des dossiers DDS — rapport de test (chantier 3, B-12)

Date : 14/10/2026. Branche : `arena/c73246d2-geoforest`. Périmètre : statuts `EXPORTED`, `SUBMITTED`, `DECLARED`
de la section 18 de la mission de finalisation. Source unique : `src/lib/eudr/dds-etats.ts`.

## 1. Décision de conception (validée par l'utilisateur)

| Statut | Atteignable ? | Par quoi | Motif |
|---|---|---|---|
| `READY_FOR_DECLARATION` | oui | PATCH, après revue et readiness complète | inchangé (P0) |
| `EXPORTED` | **oui** | **uniquement** l'export d'une analyse rattachée à un dossier prêt | brouillon généré, non transmis |
| `SUBMITTED` | **non** | aucune action | suppose un accusé de soumission TRACES : intégration absente. **BLOCKED_EXTERNAL** |
| `DECLARED` | **non** | aucune action | suppose un accusé du SI EUDR : intégration absente. **BLOCKED_EXTERNAL** |

Le texte exact de la section 18 n'est pas dans l'espace de travail. La conception s'appuie sur la règle déjà écrite
dans `docs/TRACES_SCOPE.md` (aucune transmission, « Déclaré » interdit tant qu'aucun accusé n'existe) et sur P0-06.
Elle a été soumise à l'utilisateur avant codage.

## 2. Règles implémentées

1. **PATCH** : `EXPORTED`, `SUBMITTED` et `DECLARED` ne sont jamais des cibles manuelles (409 avec motif explicite).
   Aucun état source ne mène à ces trois cibles : 33 couples testés, 0 admis.
2. **Export** (`POST /api/v1/export/traces`) : si l'analyse est rattachée à un dossier `READY_FOR_DECLARATION`
   ou `EXPORTED`, l'export **revérifie la readiness** (409 si elle ne tient plus, sans aucune écriture) puis pose
   `EXPORTED` dans la même transaction, avec une entrée `EXPORT` au journal. Le `UPDATE` est conditionné au statut
   lu, donc un export concurrent ne rejoue pas la transition. Un dossier `SUBMITTED` ou `DECLARED` ne reçoit aucun export (409).
3. **Dossier figé** (`READY_FOR_DECLARATION`, `EXPORTED`, `SUBMITTED`, `DECLARED`) : refus de rattacher ou de détacher
   une analyse (routes `audit/parcel`, `due-diligence/{id}/audits`, `…/audits/{auditId}`, remplacement des listes en dur
   par `estFige`), et **nouveau** : refus de modifier l'intitulé ou le poids net (409). Pour modifier, repasser en `UNDER_REVIEW`.
4. **Sortie de `EXPORTED`** : `UNDER_REVIEW` (l'export précédent ne vaut plus) ou `ARCHIVED`.
5. **Readiness** : un dossier `EXPORTED` (ou `SUBMITTED`/`DECLARED`) qui satisfait les contrôles se lit `READY_FOR_DDS`,
   et non `COMPLETE`. Sans cette correction, un dossier exporté aurait été présenté comme non prêt.
6. **Libellés** : `DECLARED` n'est plus affiché « Déclaré » seul. `EXPORTED` = « Brouillon exporté (non transmis) ».

## 3. Défauts trouvés et corrigés pendant le chantier

| Réf. | Constat | Correction |
|---|---|---|
| D2 | `POST /api/v1/due-diligence` acceptait `netWeightKg` puis **l'ignorait en silence**. La readiness signalait ensuite « poids non renseigné ». | Poids stocké, validé (≥ 0, fini ; sinon 422), même règle que la PATCH. |
| — | Le build Next.js **typecheck aussi `scripts/`** : une erreur de typage dans le client de test aurait fait échouer le build sans que `npm run typecheck` ne le montre. | Typage corrigé ; à retenir pour tout script ajouté. |

## 4. Preuves

| Contrôle | Commande | Résultat |
|---|---|---|
| Machine d'état (pur) | `npm run test:unit` → `check-dds-etats.ts` | **25/25** |
| Parcours HTTP serveur réel | `npm run test:dds-etats:http` | **39/39** |
| Cross-tenant HTTP (régression, D2 et export modifiés) | `npm run test:cross-tenant` | **262/0** |
| Cross-tenant RLS (rôle applicatif) | `npm run test:cross-tenant:rls` | **96/0** |
| E2E entreprise (régression) | `npm run test:e2e` | **49/49** |
| Typecheck / lint / build | `typecheck`, `lint`, `build` | 0 / 0 / 0 |
| `test:unit` (tous contrôles) | | 40 + 40 + 25 contrôles, 0 échec |
| `test:eudr` | | 40/40 |
| `test:db` | | 0 (rôle applicatif conforme, RLS 13/13) |
| pytest backend | | 64 passed, 5 xfailed (inchangé) |

Le parcours HTTP (`scripts/check-dds-etats-http.ts`) crée de vraies ressources (fournisseur, produit, dossier, analyse,
pièce validée par la conformité), puis vérifie : refus des cibles réservées ; `DRAFT → READY` refusé ; export en revue
sans changement de statut ; figement (titre, détachement, rattachement) ; export d'un dossier prêt qui pose `EXPORTED`
et journalise la transition une seule fois ; ré-export sans seconde transition ; export **refusé** quand une pièce
obligatoire expire, statut conservé ; cloisonnement (organisation B : 404 sur lecture, modification et export) ;
permissions (lecteur : 403) ; sortie de `EXPORTED` ; aucune réponse 5xx.

### Sensibilité (mutations)

| Mutation | Attendu | Obtenu |
|---|---|---|
| M1 (pur) : `SUBMITTED` ajouté aux transitions de `DRAFT` | échec | **1 échec** (exit 1) ; restauré, 25/25 |
| MA (HTTP) : la transition `READY → EXPORTED` n'est plus appliquée | échecs sur EXPORTED et journal | **5 échecs** (34/39) ; restauré, 39/39 |
| MB (HTTP) : revérification de la readiness à l'export supprimée | refus d'export à pièce expirée | **1 échec** (38/39) ; restauré, 39/39 |

Non couvert par une mutation : la règle de figement sur les données (titre, poids). Elle est vérifiée par le parcours,
mais sa sensibilité n'a pas été mesurée séparément.

## 5. Fixture déclarée — à lire avant toute conclusion satellite

Aucune analyse satellite réelle n'est disponible dans cet environnement (**B1, BLOCKED_EXTERNAL** : clé GFW absente,
`data-api.globalforestwatch.org` injoignable). Pour atteindre `READY_FOR_DECLARATION`, le parcours pose le drapeau
`analysis_probative` sur l'analyse de test, avec la source **`fixture-test-probant`** (jamais une source satellite).
Cette preuve porte sur la **machine d'état et le contrôle de l'export**. Elle ne dit rien de la qualité des données
satellitaires, qui reste à démontrer sur GFW réel.

## 6. Ce qui n'est pas fait

- **Soumission officielle (`SUBMITTED`) et déclaration (`DECLARED`)** : intégration TRACES NT absente. BLOCKED_EXTERNAL.
  Procédure de levée : intégration au service officiel, puis test sur l'environnement officiel avec accusé réel.
- **Export au niveau dossier** : l'export reste par analyse. Un dossier `DRAFT` ou `UNDER_REVIEW` peut être exporté en
  brouillon sans changer de statut. C'est voulu : l'export ne vaut pas déclaration.
- **Conséquence à connaître** : l'export d'**une** analyse d'un dossier prêt fait passer **tout** le dossier à `EXPORTED`.
  Le brouillon d'une analyse vaut alors pour l'ensemble du dossier. Le pack de preuves du dossier entier existe depuis le chantier 4 (`docs/EVIDENCE_PACK_TEST_REPORT.md`).
- **Environnement de test** : PostgreSQL 16.14 est un binaire `embedded-postgres` installé depuis npm (apt et Docker indisponibles).
  Cluster sur `127.0.0.1` uniquement. Ce n'est pas un test sur le PostgreSQL de production.
- **CI** : les contrôles HTTP et base ne tournent pas en CI (pas de serveur ni de base dans le workflow).

## 7. Idempotence (P1-11) : comportement attendu, pas un défaut

Une écriture identique, sans clé `Idempotency-Key`, est rejouée pendant 30 secondes avec la réponse de la première.
Le premier essai du parcours a donc rejoué un export et une transition réelles. Le client de test envoie désormais une
clé unique par écriture (`scripts/e2e/client.ts`, paramètre d'en-têtes optionnel, rétrocompatible).

## 8. Fichiers modifiés

- Machine : `src/lib/eudr/dds-etats.ts` (nouveau), `src/lib/eudr/types.ts`, `src/lib/eudr/readiness.ts`.
- Routes : `src/app/api/v1/export/traces/route.ts`, `src/app/api/v1/due-diligence/route.ts`,
  `…/due-diligence/[id]/route.ts`, `…/due-diligence/[id]/audits/route.ts`, `…/audits/[auditId]/route.ts`,
  `src/app/api/v1/audit/parcel/route.ts`.
- Interface : `src/app/(app)/due-diligence/page.tsx`, `src/app/(app)/reports/page.tsx`, `src/app/(app)/page.tsx`.
- Tests : `scripts/check-dds-etats.ts` (nouveau, dans `test:unit`), `scripts/check-dds-etats-http.ts` (nouveau),
  `scripts/e2e/client.ts` (en-têtes optionnels).
- Infrastructure (décision FastAPI) : `docker-compose.yml` (publication du port 8000 retirée).
- Docs : `docs/TRACES_SCOPE.md` §5 (machine réelle), `docs/BLOCKERS_RESOLUTION_REPORT.md`.
