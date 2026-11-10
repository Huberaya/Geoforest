# Rapport de tests E2E

Date : 08/10/2026 · Branche : `arena/c73246d2-geoforest` · Build : `next build` (production).
Harnais : `scripts/e2e/parcours.ts` (`npm run test:e2e`).

## 1. Résultat

**49 / 49 contrôles réussis**, sur un serveur de production (`next start`) joint en HTTP, avec
PostgreSQL réel, rôle applicatif `geoforest_app` (RLS active), sessions réelles, MFA enrôlé
via l'API pour les rôles qui l'exigent.

Le harnais n'écrit jamais directement en base. Chaque opération passe par l'API, avec le rôle
qui la porte. Aucune permission n'est contournée pour faire passer un test.

## 2. Scénarios

Les intitulés `E2E-001` à `E2E-008` ci-dessous sont ceux du harnais. Ils suivent le découpage
fonctionnel de la mission ; à recouper avec la liste officielle du brief avant de conclure à
une couverture complète (cf. `PRODUCTION_READINESS_REPORT.md`, §7).

| Scénario | Contrôles | Résultat |
|---|---|---|
| **E2E-001 Authentification** : mot de passe faux refusé (401), réponse identique pour compte inexistant (pas d'énumération), enrôlement MFA pour admin, session valide avec rôle | 5 | ✅ 5/5 |
| **E2E-002 Analyse sans verdict** : analyse créée (201), statut jamais COMPLIANT sans source probante, statut `ANALYSIS_UNAVAILABLE` | 3 | ✅ 3/3 |
| **E2E-003 Dossier** : fournisseur, produit, parcelle, dossier créés ; analyse rattachée à la parcelle et au dossier ; readiness calculée côté serveur ; état BLOCKED ; transmission `NOT_TRANSMITTED` ; parcelle en `PENDING` (pas COMPLIANT) ; analyse visible par `plot_id` | 11 | ✅ 11/11 |
| **E2E-004 Gouvernance** : saisie manuelle du risque et de la complétude refusée (409) ; passage en IN_ANALYSIS puis UNDER_REVIEW ; READY_FOR_DECLARATION refusé (409) avec état de readiness | 6 | ✅ 6/6 |
| **E2E-005 Rattachement** : second rattachement (201) ; double rattachement refusé (409) ; détachement (204) ; l'analyse détachée existe toujours ; readiness exposée | 5 | ✅ 5/5 |
| **E2E-006 Cross-tenant** : le tenant B ne voit ni le dossier, ni la parcelle, ni l'analyse, ne peut ni rattacher ni modifier, et n'obtient pas le dossier dans sa liste | 6 | ✅ 6/6 |
| **E2E-007 Export TRACES** : export refusé (409, `is_probative: false`) pour une analyse sans source probante ; aucune transmission annoncée ; même décision pour la conformité et l'admin | 4 | ✅ 4/4 |
| **E2E-008 Permissions et session** : sans session (401) ; lecteur refusé en écriture (403), autorisé en lecture (200) ; auditeur refusé en modification de dossier (403) ; URL déclarée refusée comme pièce (422) ; pièce sans fichier non validable (422) ; auditeur ne valide pas une pièce (403) ; jeton forgé refusé (401) | 9 | ✅ 9/9 |

## 3. Ce que les tests démontrent, et ce qu'ils ne démontrent pas

**Démontré** : le cycle parcelle → analyse → dossier → readiness → refus de déclaration fonctionne
de bout en bout sur une base réelle, avec les protections de session, de rôle et de tenant actives.

**Non démontré** :
- **Aucune analyse probante réelle.** Le serveur de test ne peut pas joindre Global Forest Watch.
  Les chemins « COMPLIANT » et « NON_COMPLIANT » sur données réelles ne sont donc pas exercés en E2E.
  Ils sont couverts par les tests unitaires (substitution de la requête GFW) et ne valent pas validation métier.
- **Export d'une déforestation** de bout en bout (même raison). Couvert par `pytest` (moteur FastAPI).
- **Parcours fournisseur** (portail, dépôt de pièce par un fournisseur) : aucun compte fournisseur dans le jeu de test.
- **Soumission TRACES** : elle n'existe pas dans le produit, donc elle n'est pas testée.
- **Charge** et **concurrence** : non mesurées.

## 4. Conditions d'exécution

```bash
# 1. Base PostgreSQL migrée, rôle applicatif geoforest_app créé (cf. docs/DEPLOYMENT_VERCEL.md)
npm run db:migrate
# 2. Comptes de démonstration (hors production uniquement) — mot de passe choisi par l'opérateur
SEED_DEMO_PASSWORD='…' npm run seed:auth -- --reset
# 3. Serveur de production
npm run build && npm run start
# 4. Parcours
E2E_BASE_URL=http://127.0.0.1:3000 E2E_PASSWORD='…' npm run test:e2e
```

**Contrainte** : le premier login d'un compte passant par le MFA déclenche un enrôlement. Le
harnais ne lit pas le secret TOTP en base : il le reçoit dans la réponse de login. Un compte déjà
enrôlé fait donc échouer le parcours avec un message explicite ; il faut relancer le seed avec `--reset`.

`E2E_PASSWORD` est lu dans l'environnement et n'est jamais écrit dans le dépôt.

## 5. Corrections qui ont précédé le passage final

Cette passe a ajouté au harnais trois contrôles sur la validation des pièces (pièce sans fichier
créée ; validation refusée à la conformité, 422 ; validation refusée à l'auditeur, 403), puis le
harnais a été relancé sur le code final : 49/49.

Les résultats des passages intermédiaires n'ont pas été conservés dans ce rapport : seul le passage
final fait foi.

## 6. Ce que ce rapport ne couvre pas

- Le détail des scénarios `E2E-001` à `E2E-008` tel que défini dans le brief initial n'était pas
  disponible dans le contexte de cette passe ; la correspondance est à vérifier (B8 du rapport maître).
- Le dépôt de fichier de pièce de bout en bout n'est pas couvert.
