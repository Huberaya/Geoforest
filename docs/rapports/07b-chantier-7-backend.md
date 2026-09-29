# Chantier 7 — deuxième incrément : stockage et API

> État actuel : voir le [troisième incrément interface/exports](07c-chantier-7-interface-exports.md). Les résultats ci-dessous sont historiques.
29 septembre 2026 · branche `chantier-7/due-diligence-exports`.

**EN COURS — chantier 7 non clôturé.** Le GO7 couvre la suite. Aucun GO8.

## Livré dans cet incrément

### Persistance et droits

Migration **0007** : dossiers, révisions immuables et décisions append-only. Les données sources d’une ancienne révision ne sont pas écrasées. Les états internes évoluent par transitions contrôlées et compteur de version. Une nouvelle révision doit annoncer la révision courante attendue.

RLS entreprise ; aucun accès Supplier/portail. Admin, Compliance Manager et Procurement peuvent préparer/soumettre pour revue. Admin/Compliance Manager seuls valident, demandent des corrections et retirent en interne. Analyst/Viewer consultent et exportent. Les identités de création/décision sont liées au contexte authentifié en base.

Écritures SERIALIZABLE, idempotence par identifiant de requête et empreinte du corps, verrous sur dossier/révision. Session et appartenance verrouillées pendant l’opération bornée : une révocation concurrente se sérialise avec la transaction, ou provoque un conflit, sans validation sous un ancien rôle. Le rôle runtime n’a pas reçu le droit de modifier des membres pour ce besoin : une fonction SQL privilégiée, limitée au verrou de sa propre appartenance, vérifie explicitement contexte absent/étranger, fixe son search_path et révoque EXECUTE à PUBLIC.

### Faits relus côté serveur

Le navigateur transmet les références de lots et les confirmations humaines, jamais un risque ou un statut « prêt » faisant autorité. Le serveur relit fournisseur, produit, matières, lot, géolocalisations versionnées, contexte de légalité/risque, pièces acceptées et actions.

Les preuves référencées sont également vérifiées physiquement dans le coffre : propriétaire/permissions, taille et empreinte. Ce contrôle ne prouve pas l’authenticité juridique. Un justificatif manquant interdit la validation. Les coordonnées et les références de preuves sont conservées dans le snapshot ; les octets des pièces et blocs raster ne sont pas dupliqués dans le JSON.

Avant mise en revue/validation : comparaison des sources actuelles avec l’empreinte de préparation et réexamen des blocages. Un produit modifié, des sources archivées, une ancienne évaluation ou des actions ouvertes ne deviennent pas « prêts » par simple clic.

### API ajoutée

Préfixe : `/api/v1/organizations/{org}/diligence`.

| Méthode | Route | Fonction |
|---|---|---|
| POST | `/revisions` | Nouveau dossier ou nouvelle révision ; idempotence, résolution des sources, snapshot et audit |
| GET | `?page=1` | Liste paginée, 20 dossiers/page, révision courante |
| GET | `/{dossier}/revisions/{revision}` | Snapshot, décisions, révision courante et réexamen des sources |
| POST | `/{dossier}/revisions/{revision}/decisions` | Mise en revue, corrections, validation interne ou retrait interne |
| GET | `/{dossier}/revisions/{revision}/export.json` | JSON privé en pièce jointe, empreinte, décisions, état interne et réexamen à l’export ; audit avant réponse |

Le corps de préparation est documenté dans OpenAPI. Il inclut `request_id`, `title`, `declaration`, éventuellement `dossier_id` et `expected_revision`. Une décision exige `request_id`, `version`, `action`, `note`, et confirmation explicite pour valider.

**Pas d’endpoint de soumission officielle.** Les exports restent marqués « NON SOUMIS PAR GEOFOREST ». Une validation historique reste conservée, mais l’export ne la présente pas comme validation courante si une nouvelle révision existe, si les sources ont changé, si des blocages réapparaissent ou si elle est retirée.

## Bornes et configuration

- **500 révisions/organisation**, 20 lots/révision maximum.
- Géométries et analyses géométriques : budget vérifié en SQL avant chargement, 1 000 000 octets par lot.
- Jusqu’à **80 Mio de justificatifs distincts** vérifiés par résolution ; doublons comptés une seule fois.
- JSON canonique/export borné à **2 Mio**, refus explicite sans troncature.
- Le contrôleur de coffre hors ligne accepte désormais les schémas 0006 et 0007, sans changement de politique de suppression.
- `DILIGENCE_ENABLED=false` par défaut. Le flag est activé uniquement dans les tests de ce bloc. L’API refuse les opérations si désactivée.
- Backend **0.8.0-dev**, readiness attend 0007. Frontend non modifié : ne pas déployer ce backend sur une base 0006 sans migration revue. Aucune base de production n’a été migrée.

## Tests et résultats réels

| Vérification | Résultat |
|---|---|
| Régression backend sur base neuve 0007 | **802 réussis, 13 avertissements**, 457,79 s |
| Nouveaux tests API | **22 réussis**, inclus dans la régression |
| Noyau pur précédent | 97 tests inclus dans la régression |
| Ruff | Réussi sur backend/app, backend/tests, migration 0007 et contrôleur de coffre |
| Migration neuve | 0001 → 0007, puis second upgrade sans effet |
| Migration peuplée 0006 → 0007 | Dix tables antérieures identiques par comparaison des lignes et SHA-256 ; second upgrade sans effet |
| Restauration backend 0007 | Sept tables comparées identiques ; 1 dossier, 2 révisions, décisions et 1 blob de recette conservés |
| API après restauration | Export autorisé 200, empreinte et sources concordantes ; export anonyme 401 ; session temporaire révoquée |

Les avertissements sont ceux des dépendances Starlette/TestClient et Rasterio. Après un premier passage à 801 tests, un contrôle supplémentaire de l’expiration de session **avant commit et avant libération de l’export** a été ajouté et testé : la régression finale s’est terminée avec un code de sortie 0 et **802 passed**. Une session expirée en cours d’opération annule également les écritures et l’audit de préparation.

Les tests documentaires API utilisent le scanner synthétique déjà identifié au chantier 6, avec vrai stockage/contrôle de format. **Aucun nouveau scan antivirus réel ni scénario navigateur n’est revendiqué pour ce bloc.**

Couverture API : idempotence et rejouage divergent, historique, export/audit, blocage de dossier incomplet, changements produit et archives, tous rôles internes pertinents, refus Supplier/portail, isolation tenant et contexte RLS absent, immutabilité SQL, session révoquée, feature flag, décisions concurrentes, créations concurrentes et interdiction d’injecter des faits/états officiels depuis le client. Parcours positif complet alimenté via les API 2–6 avec justificatif fictif accepté, légalité et risque revus. Cas de blob supprimé et de validation ancienne remplacée par une nouvelle révision.

## Ce qui reste avant clôture

1. Interface professionnelle de préparation/revue/historique et gestion claire des erreurs/conflits.
2. PDF lisible sécurisé ; CSV intégré au téléchargement autorisé (le précédent aperçu CSV reste un module pur, pas une route).
3. Parcours de saisie assistée et éventuel suivi manuel d’une référence externe, sans assimiler une saisie à une vérification officielle.
4. Recette E2E desktop/mobile, lecture indépendante des exports, vérification des limites et bilan final.

Les régimes non ordinaires restent « parcours à qualifier », pas interdictions juridiques inventées. L’API officielle existe, mais aucun accès authentifié ni adaptateur opérationnel n’est qualifié ici. Les réserves d’hébergement/chiffrement/antivirus/sandbox/SMTP/OCR du chantier 6 restent applicables.

## Preuves

`preuves-chantier-7/backend-increment2.txt`, `api-increment2.txt`, `migration-peuplee.json`, `migration-vide.json`, `restauration-backend.json`, `ruff.txt` et `../openapi.json`.

Les dumps, blobs et sessions de restauration sont hors Git, dans un espace privé. La restauration utilise une base distincte et révoque les sessions/invitations copiées ; les données comparées ne contiennent que des fixtures fictives. Aucun push GitHub, aucun token antérieur réutilisé.
