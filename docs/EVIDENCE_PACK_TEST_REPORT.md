# Pack de preuves d'un dossier — rapport de test (chantier 4, « B-10 »)

Date : 14/10/2026. Branche `arena/c73246d2-geoforest`. Environnement : PostgreSQL local, stockage disque local
(`var/storage`), build de production Next.js, serveur `next start` sur le port 3100.

## 1. Périmètre

Un dossier DDS produit une archive ZIP autoportante : dossier, readiness, analyses avec leur provenance, pièces telles
que déposées, extrait du journal, condensats, et liste de ce qui n'est pas vérifié. Un vérificateur hors ligne relit
l'archive sans accès au produit.

**Hypothèse à confirmer.** La liste exacte des fichiers attendus dans le pack figurait dans le brief de la mission, dont
le texte complet n'est pas dans l'espace de travail. Le contenu retenu est celui de `EVIDENCE_ENGINE_SPEC.md` existant
(analyse, pièces, journal), complété par le manifeste et les condensats. Si le brief énumère d'autres fichiers, le
manifeste et `SHA256SUMS.txt` les recevront sans changement de structure.

Hors périmètre, et déclaré comme tel : signature externe et horodatage qualifié (non implémentés), analyse
antivirus (B4), stockage S3 (B6, jamais exécuté).

## 2. Ce qui a été livré

| Élément | Fichier |
|---|---|
| Construction et vérification de l'archive (pur) | `src/lib/evidence/pack.ts` |
| Assemblage depuis la base, contrôle des pièces | `src/lib/evidence/assembler.ts` |
| Route `GET /api/v1/due-diligence/{id}/evidence-pack` | `src/app/api/v1/due-diligence/[id]/evidence-pack/route.ts` |
| Lecteur de pièces partagé avec la readiness | `src/lib/eudr/readiness-db.ts` (`lireDocumentsDuDossier`) |
| Vérificateur autonome | `scripts/verifier-pack.ts` (`npm run verifier:pack`) |
| Tests purs | `scripts/check-evidence-pack.ts` (inclus dans `test:unit`) |
| Tests HTTP sur serveur réel | `scripts/check-evidence-pack-http.ts` (`npm run test:evidence:http`) |
| Dépendance | `fflate` 0.8.3, sans dépendance transitive, pure JavaScript |
| Spécification | `docs/EVIDENCE_ENGINE_SPEC.md` §7 |

## 3. Règles retenues

1. **Incident = refus (500), jamais une archive partielle.** Une pièce déclarée dont le fichier manque, dont le
   contenu ne correspond plus au condensat déposé, ou dont la taille diffère, fait échouer le pack. La réponse désigne
   la pièce. Aucun export n'est journalisé.
2. **Absence = fait.** Une pièce sans fichier figure dans le pack comme `sans_fichier`. Elle ne compte pas comme preuve.
3. **Pas de déclaration.** Le pack peut être produit à tout statut, y compris `DRAFT`. Il ne transmet rien à TRACES.
4. **Export journalisé** dans la transaction, avec le condensat de l'archive (`details.sha256_archive`). La réponse
   porte le même condensat (`X-GeoForest-SHA256`).
5. **Une seule source pour les pièces.** La readiness et le pack lisent les pièces par la même fonction.
6. **Non vérifié déclaré.** Le manifeste liste explicitement : pièces non analysées par antivirus, pièces sans fichier,
   analyses non probantes, analyses probantes de source non officielle, absence de transmission TRACES, absence de
   signature externe, journal partiel.

## 4. Preuves

### 4.1 Tests purs — `scripts/check-evidence-pack.ts` : 27/27

Construction reproductible octet pour octet ; SHA-256 conforme à `node:crypto` ; modification d'une pièce, retrait
d'une pièce, fichier ajouté, manifeste altéré, `SHA256SUMS.txt` absent, manifeste absent, pièce non décrite,
archive illisible : tous refusés avec anomalie nommée ; chemins `..`, absolus, antislash, segment vide, nom réservé,
doublon : refusés.

### 4.2 Tests HTTP — `scripts/check-evidence-pack-http.ts` : 45/45 (exécution finale)

- Pack complet : 200, type ZIP, condensat d'en-tête = condensat du corps, archive cohérente, pièce déposée décrite avec
  son condensat et ses octets identiques à ceux déposés, pièce sans fichier marquée, trois non-vérifiés présents,
  analyse décrite avec sa provenance, journal présent.
- Journal : chaque pack réussi est journalisé (1 → 2) ; le condensat journalisé est celui renvoyé.
- Autorisations : lecteur 403 ; autre organisation 404 ; sans session refusé ; dossier inexistant 404 ; identifiant
  mal formé 404.
- Incident 1, contenu altéré sans changement de taille (un octet) : 500, désigne la pièce, mentionne l'empreinte,
  JSON et non archive, aucune trace d'export. Après restauration : 200.
- Incident 2, fichier absent : 500, désigne la pièce. Après remise en place : 200.
- Incident 3, taille différente : 500, désigne la pièce, aucune trace d'export.
- Aucune réponse 5xx hors des trois incidents provoqués.

### 4.3 Vérification hors ligne — archive réelle

| Archive | Résultat | Sortie |
|---|---|---|
| Archive du test, intacte | « Pack cohérent : 7 fichiers vérifiés » | 0 |
| Même archive, un octet modifié dans une pièce (ré-empaquetée) | 2 anomalies : condensat du fichier, condensat du manifeste | 1 |
| Fichier inexistant | « Lecture impossible » | 1 |

### 4.4 Sensibilité des tests (mutation)

- **Mutation A** (contrôle de condensat à la lecture désactivé). Première tentative : 41/41, donc **non détectée**. Le
  contrôle de taille refusait la même altération, car le contenu altéré était plus court. Le test a été corrigé pour
  utiliser une altération de même taille, et un test distinct de taille a été ajouté. Après correction : la mutation
  est **détectée** (7 échecs : refus absent, pièce non désignée, réponse 200 au lieu de 500, export journalisé à tort).
  Le code a été restauré (identité vérifiée), reconstruit, et le test refait : 45/45.
- **Mutation B** (absence de fichier traitée en silence). **Non exécutée.** Le test d'absence (incident 2) la couvrirait
  par la désignation de la pièce. Ce point reste à confirmer par une mutation.

### 4.5 Non-régression sur le code final

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | 0 |
| `npm run lint` | 0 |
| `npm run test:unit` (dont `check-evidence-pack.ts` 27/27) | 0 |
| `npm run build` | 0 |
| `npm run test:db` | 0 |
| `npm run test:eudr` | 0 |
| `npm run test:evidence:http` | 45/45 |
| `npm run test:dds-etats:http` (chantier 3) | 39/39 |
| `npm run test:cross-tenant` (HTTP) | 262/0 |
| `npm run test:cross-tenant:rls` | 96/0 |
| `npm run test:e2e` | 49/49 |
| pytest backend | 64 réussis, 5 xfail (inchangé) |
| Chaîne du journal (`scripts/verifier-chaine.ts`) | intacte, 2 organisations, ancres aux rangs 457 et 446 |
| `DEBUG` dans `src` et `scripts` | aucun |

## 5. Limites et restes

- **Signature et horodatage.** Une archive peut être refaite entièrement par quiconque contrôle la base. Une signature
  externe et un horodatage qualifié seraient nécessaires pour une preuve opposable à un tiers. **OPEN**, non bloquant
  pour un pilote interne.
- **Chaîne du journal.** Le pack ne joint qu'un extrait, avec l'ancre de l'organisation. La chaîne complète se
  vérifie avec `scripts/verifier-chaine.ts`, qui exige un accès à la base. Le vérificateur hors ligne ne recalcule
  pas les condensats du journal (ils dépendent de la sérialisation de PostgreSQL).
- **Données personnelles.** Le journal joint contient les adresses e-mail des auteurs. Leur communication relève de la
  politique de conservation, à trancher.
- **Antivirus (B4).** Toutes les pièces restent `NOT_SCANNED`. Le pack le déclare ; il ne le corrige pas.
- **Stockage S3 (B6).** Le pack lit les pièces par le stockage courant. Le chemin S3 n'a jamais été exécuté : pour une
  mise en production sur S3, B6 reste BLOCKED_EXTERNAL.
- **Analyse satellite (B1).** Le test utilise une fixture `fixture-test-probant`. Le pack le signale comme source non
  officielle, ce qui est le comportement voulu. La donnée satellite réelle reste BLOCKED_EXTERNAL.
- **Mutation B** non exécutée (voir 4.4).
- **Liste de fichiers du brief** à confirmer (voir 1).

## 6. Statut

**B-10 (evidence pack) : VERIFIED sur l'environnement local**, pour le périmètre décrit au §1 : pack réel, pièces
réelles, vérification hors ligne, incidents refusés, export journalisé. Les éléments hors périmètre restent ouverts
(signature externe, antivirus, S3, analyse satellite).

Preuves : `/home/user/pgtest/f4-pack-http.log`, `/home/user/pgtest/f4-unit.log`, `/home/user/pgtest/pack-mA2-c4.log`
(mutation A détectée), archive de référence `/home/user/pgtest/evidence/pack-dossier-test.zip` (hors dépôt).
