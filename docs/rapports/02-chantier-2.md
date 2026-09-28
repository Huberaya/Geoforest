# GEOFOREST TRACE — Livraison chantier 2

**Collecte fournisseurs, produits et lots · version 0.3.0 · 28 septembre 2026**

| Décision | État |
|---|---|
| Périmètre chantier 2 en recette locale | **PRÊT** — implémenté et testé |
| Mise en production | **À FINALISER** — infrastructure cible, sécurité opérationnelle et exploitation à qualifier |
| Conformité réglementaire / déclaration officielle | **NON ÉVALUÉE** — aucun verdict ni transmission aux autorités |
| Chantier 3 : carte, imports et parcelles | **EN ATTENTE DE GO** — non commencé |
| GitHub | Branche locale `chantier-2/collecte-fournisseurs`, aucun push ; base `fbd1713` |

## 1. Objectif et décisions

Le GO reçu concernait exclusivement le chantier 2. L’ADR `docs/adr/002-collecte.md` a cadré les référentiels, la collecte fournisseur et la séparation entre données proposées et données de l’entreprise.

L’architecture du chantier 1 est conservée : Next.js, FastAPI, PostgreSQL/PostGIS, identité OIDC, RLS et audit. Les routes métier ont leur module backend ; les écrans utilisent des composants dédiés plutôt que d’ajouter toute la logique au composant d’accueil. Migration incrémentale `0002`, sans réinterprétation de l’ancien prototype.

**Principe central : la collecte et sa revue ne sont pas la conformité.** Aucun automatisme ne décide de l’assujettissement EUDR, du risque pays, de la légalité ou de l’absence de déforestation. Les vérifications documentaires du socle restent le contexte de conception ; il n’y a pas de nouveau moteur réglementaire dans ce lot. Les futurs calculs/exigences devront faire l’objet d’une vérification officielle actualisée au chantier concerné.

## 2. FAIT

### Référentiels entreprise
- Fournisseurs : référence unique par organisation, identité, pays ISO, adresse/email, type et immatriculation facultatifs, notes internes, contacts multiples.
- Produits : références, noms, matières multiples, codes SH/NC déclaratifs, relations N:N fournisseurs/produits. Aucun classement légal déduit d’une matière.
- Lots : fournisseur et produit obligatoires avec association valide, quantité décimale exacte positive, unité, pays et période de production facultatifs mais signalés s’ils manquent.
- Création/modification, contrôle de version, archivage sans suppression de l’historique ; refus des objets archivés pour une nouvelle relation.
- Recherche, pagination et inclusion optionnelle des archives ; sélecteurs recherchables, filtrage des produits par fournisseur.
- Import CSV fournisseurs : aperçu, validation stricte, numéros de lignes, 100 enregistrements max, transaction tout-ou-rien, idempotence du même contenu ; aucun écrasement des références existantes.
- Source de lot facultative : collecte revue du même fournisseur. Clés étrangères composites interdisant le rattachement inter-organisation.

### Portail fournisseur mobile
- `/portail`, sans compte entreprise créé artificiellement.
- Invitation par secret à usage unique dans le fragment d’URL, retiré avant échange explicite ; hash uniquement en base ; lien affiché une seule fois.
- Durée par défaut 72 h, configurable 1..168 h via API ; session max 8 h bornée par l’invitation. Expiration, révocation, renouvellement et archivage revalidés aux accès suivants.
- Cookie fournisseur distinct, HttpOnly/Secure/Lax en HTTPS ; CSRF/Origin ; limitation des tentatives.
- Trois étapes : organisation, produits, vérification/envoi ; sauvegarde explicite du brouillon, avertissement de modifications non enregistrées, confirmation avant soumission.
- Complétude des seuls champs de collecte initiale, explicitement distinguée d’un taux de conformité.
- Brouillon → soumission → revue ou corrections. Version soumise figée, snapshots successifs append-only pour le rôle applicatif ; nouvelle collecte après une version revue.
- Propositions conservées séparément : aucune réécriture automatique du fournisseur, du produit ou du lot canonique.
- **Transmission manuelle du lien. Aucun email envoyé.**

### Isolation, permissions et traçabilité
- 11 nouvelles tables tenantées avec RLS ; catalogue global de sept matières en lecture.
- Écriture canonique : Admin, Compliance Manager, Procurement. Revue : Admin, Compliance Manager. Analyst/Viewer en lecture ; Supplier OIDC limité à sa propre fiche et ses relations.
- Portail limité à une collecte fournisseur ; pas d’accès aux routes entreprise avec son cookie.
- Contexte SQL LOCAL remis à chaque transaction ; contrôle des liens composites ; versions concurrentes refusées en 409.
- Audit atomique avec distinction entre utilisateur OIDC et acteur portail. Aucun secret d’invitation dans le journal.
- Attributions OIDC Supplier vérifiées contre une fiche active du tenant. Un ancien périmètre orphelin n’expose pas de données.
- Readiness contrôle le schéma `0002` ; réponse 503 si incompatible.

## 3. Recette réellement exécutée

Preuves dans [`preuves-chantier-2/`](preuves-chantier-2/).

| Vérification | Résultat |
|---|---|
| Pytest, vrai PostgreSQL/PostGIS avec rôle runtime RLS | **78 passed**, 1 avertissement connu |
| Playwright, vrai OIDC Keycloak + API + base, sans mocks métier | **3 passed**, aucun test ignoré |
| ESLint | Réussi |
| TypeScript `tsc --noEmit` | Réussi |
| Build Next standalone + purge dotenv | Réussi ; `/` et `/portail` générés ; aucun `.env*` à la racine de l’artefact |
| Ruff backend/migrations/tests | Réussi |
| Audit npm | **0 vulnérabilité connue** au moment de la recette |
| Audit Python sur lock | **0 vulnérabilité connue** au moment de la recette |
| Base vierge : migrations 0001 → 0002 puis répétition | Réussies ; 11 tables tenantées RLS vérifiées |
| Sauvegarde/restauration locale de données synthétiques | Réussie ; comptages des 10 tables contrôlées identiques, schéma 0002 |
| Readiness API locale | `status=ok`, migration `0002`, PostGIS disponible |

Les 78 tests incluent les 30 du socle, adaptés à l’existence réelle des fournisseurs, plus 48 cas de collecte/approvisionnement : CRUD, unicité, précision décimale, pays/dates/quantités invalides, rôles, isolation tenant/fournisseur API et SQL, liens composites, CSV malformé/atomique/rejoué, archives, token réutilisé/expiré/révoqué, session expirée, renouvellement, CSRF/Origin, rate limit, champs supplémentaires refusés, soumission incomplète/confirmation, concurrence de version, corrections, revue, invariance du canonique et révisions non modifiables.

Le scénario navigateur de collecte réalise réellement : connexion → organisation → fournisseur → CSV → produit associé → lot → contact → invitation → portail dans un contexte navigateur distinct → sauvegarde/rechargement → déclaration produit → transmission → revue humaine → actualisation fournisseur → déconnexion. Les deux autres scénarios revalident l’accueil responsive et le parcours OIDC du socle (PKCE/state/nonce, paramètres, journal, déconnexion).

Responsive entreprise vérifié à 1440/768/390/360 px ; portail à 390/360 px. Captures finales :
- [`fournisseurs-desktop.png`](preuves-chantier-2/fournisseurs-desktop.png)
- [`fournisseurs-mobile.png`](preuves-chantier-2/fournisseurs-mobile.png)
- [`portail-produits-mobile.png`](preuves-chantier-2/portail-produits-mobile.png)
- [`portail-transmis-mobile.png`](preuves-chantier-2/portail-transmis-mobile.png)
- [`revue-collecte.png`](preuves-chantier-2/revue-collecte.png)

**Portée des preuves :** recette locale sandbox avec TLS local sur le même hostname pour tester le vrai OIDC. Cela ne qualifie pas l’accès externe à l’URL proxifiée Arena, ni Docker, la CI distante ou l’infrastructure de production. Les audits de dépendances ne remplacent pas un pentest. Pas de tests de charge à grande échelle dans ce chantier.

## 4. Problèmes rencontrés et corrections

- Un ancien test acceptait un UUID fournisseur sans fiche : remplacé par le refus d’un périmètre inexistant et le succès avec une vraie fiche du tenant.
- Le parser CSV permissif acceptait certaines citations mal fermées : mode strict, erreurs 422 testées, aucune insertion partielle.
- Une première compilation incrémentale réutilisait un CSS obsolète ; un build propre a rétabli les styles. Le scan Tailwind est limité aux sources frontend. Un build propre a aussi rencontré la limite mémoire de la sandbox ; reprise réussie après arrêt temporaire de Keycloak et limitation du heap de build. Ce n’est pas une qualification du budget de production.
- Un libellé accessible positionné hors du conteneur faisait déborder la table sur tablette : conteneur de défilement positionné, revalidation 360–1440 px réussie.
- Sélecteur de test « Pays » corrigé pour viser le nom accessible du combobox, sans modifier la validation applicative.
- Le cumul des exécutions E2E a atteint le quota volontaire de dix organisations administrées. Six espaces **vides, synthétiques et créés par nos tests** ont été nettoyés dans la démo locale ; les données de collecte ont été conservées. Quota applicatif inchangé, recette finale repassée. Utiliser un compte/environnement de recette renouvelé pour des exécutions répétées.
- Avertissement restant : dépréciation Starlette TestClient/httpx ; non masqué, tests réussis.

## 5. NON FAIT / limites

- Parcelles, géométries, carte, GPS, GeoJSON/KML/SHP : chantier 3 et suivants, pas simulés.
- Documents, coffre/versionnement documentaire, OCR, légalité, analyses satellite/déforestation et risque : non livrés.
- Diligence complète, atténuation, export de dossier/PDF/JSON/CSV, préparation de déclaration et connecteur officiel : non livrés.
- SMTP, relances, tâches/alertes, ERP, IA, facturation : non livrés.
- Portail hors ligne/multilingue et récupération autonome d’accès : non livrés.
- Archivage sans fonction de restauration UI ; contacts retirables, audit conservé.
- L’écran affiche les 30 collectes et 10 invitations récentes ; les révisions sont conservées en base et les mutations dans le journal, mais pas d’écran dédié de comparaison des anciennes soumissions.
- DTO frontend manuels ; génération de client API non faite.
- Pas de décision sur une politique universelle de rétention des brouillons/coordonnées personnelles. À qualifier selon les obligations et bases légales applicables.

## 6. Risques et prérequis production

| Catégorie | Évaluation / action |
|---|---|
| **RISQUE RÉGLEMENTAIRE** | Ne jamais présenter « collecte revue » ou 100 % renseigné comme conformité. Géolocalisation, preuves, diligence et déclarations ne sont pas couvertes. |
| Sécurité du lien | Le porteur du secret peut ouvrir la collecte ; transmettre uniquement au contact autorisé. Pas d’identité personnelle certifiée. |
| Révocation | Effective aux prochaines requêtes ; une requête déjà en cours n’est pas rappelée. Un compte OIDC Supplier se révoque séparément par son appartenance. |
| Production | MFA réelle IdP, TLS, proxy de confiance/limites par vrai client, chiffrement/sauvegardes, rétention, monitoring, reprise et tests Docker/CI cibles à finaliser. |
| RLS / audit | Défense contre les erreurs de périmètre, pas contre un serveur entièrement compromis ni un DBA malveillant. |
| Disponibilité | API sans fallback silencieux ; connexions, migrations et quotas doivent être supervisés. Pas de preuve de disponibilité externe depuis la sandbox. |
| Dépendances | Audits sans vulnérabilité connue à cette date ; maintenir surveillance et mises à jour. |

## 7. Livrables et utilisation

- Code application, migration, tests et configuration CI dans la branche locale du chantier 2.
- Contrats : `docs/API.md`, `docs/openapi.json`.
- Guide : [`docs/GUIDE_COLLECTE.md`](../GUIDE_COLLECTE.md).
- Exploitation : `docs/SECURITE_ET_EXPLOITATION.md`.
- Architecture : `docs/adr/002-collecte.md`.
- Démo locale : services mis à jour en 0.3.0. Les accès synthétiques déjà fournis restent dans `/home/user/acces-demo-geoforest.txt`, **hors dépôt**. Choisir un espace « Collecte Démo … » issu de la recette pour voir fournisseurs, produit, lot et collecte revue.

Aucun PAT n’a été utilisé ou enregistré ; aucun push GitHub effectué. Le secret précédemment publié doit être révoqué ; une éventuelle publication exige un nouveau mécanisme sécurisé et un accord distinct.

## 8. Prochaine étape — seulement après GO

**Chantier 3 : parcelles, carte et géolocalisation.** Avant implémentation : préciser les flux parcelle/fournisseur/produit/lot, recontrôler les exigences officielles applicables de géolocalisation, définir les formats supportés et limites, puis ajouter validations géométriques et tests d’isolation/import/GPS/mobile. Les analyses de déforestation et le verdict réglementaire resteront des périmètres distincts.

**Arrêt ici conformément à la consigne : aucun chantier suivant sans GO explicite.**
