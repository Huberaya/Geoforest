# Spécification du moteur de preuves (Evidence Engine)

Statut : **état réel du code au 08/10/2026**, branche `arena/c73246d2-geoforest`.
Cette spécification décrit ce qui existe, ce qui est garanti, et ce qui ne l'est pas.
Elle ne décrit pas une cible.

## 1. Principe

Une preuve n'a de valeur que si l'on peut dire **d'où elle vient, quand elle a été
obtenue, par quelle méthode, et ce qui n'a pas été mesuré**. Le moteur applique trois règles :

1. **Aucun verdict sans source probante.** Une analyse qui n'a pas consulté de données
   satellite réelles ne produit ni « conforme » ni « non conforme ».
2. **Une preuve est un fait horodaté et empreinté.** Un fichier n'existe, pour le moteur,
   que s'il est stocké et que son condensat SHA-256 est calculé côté serveur.
3. **Ce qui n'a pas été vérifié est déclaré.** Antivirus absent, source non officielle,
   stockage non validé : chaque cas porte un statut explicite, jamais un statut « sain » par défaut.

## 2. Analyse satellite (verdict de conformité)

### 2.1 Vocabulaire

| Statut produit (`parcel_audits.status`) | `analysis_probative` | `analysis_source` | Signification | Usage commercial |
|---|---|---|---|---|
| `COMPLIANT` | vrai | `gfw-umd-loss-gain` (service officiel) | Aucune perte de couvert post-31/12/2020 détectée sur données réelles | Recevable, sous réserve de la revue humaine |
| `NON_COMPLIANT` | vrai | `gfw-umd-loss-gain` | Perte post-2020 détectée (année et surface enregistrées) | Bloque l'export et la déclaration |
| `ANALYSIS_UNAVAILABLE` | faux | `unavailable` | Aucune donnée réelle obtenue (source absente, défaillante ou non officielle) | **Aucun verdict.** Bloque la déclaration |
| `SIMULATED_NON_PROBATIVE` | faux | `simulated` | Résultat du mode démonstration, aucune donnée satellite consultée | **Jamais COMPLIANT.** Bloque la déclaration et l'export |
| `INVALID_GEOMETRY` | faux | `unavailable` | Géométrie rejetée avant toute analyse | Bloque (corriger la géométrie) |

Équivalence avec le vocabulaire cible du brief : `PROBATIVE` = `analysis_probative = true`
(statuts `COMPLIANT` ou `NON_COMPLIANT`) ; `ANALYSIS_UNAVAILABLE` et `SIMULATED_NON_PROBATIVE`
sont repris tels quels ; `UNKNOWN` n'existe pas comme statut d'analyse : son équivalent est
`ANALYSIS_UNAVAILABLE`, qui ne doit jamais être lu comme favorable.

### 2.2 Règles de décision (`src/lib/eudr/satellite-checker.ts`, `backend/app/services/satellite_checker.py`)

- Source configurée **et** hôte officiel (`data-api.globalforestwatch.org`) : verdict sur données réelles.
- Source configurée **mais** hôte non officiel (miroir, cache, banc d'essai) : **aucun verdict**.
  La réponse nomme l'hôte. Aucune requête n'est émise dans ce cas.
- Source configurée mais défaillante (délai, erreur réseau, réponse invalide) : **aucun verdict**,
  pas de repli silencieux vers la simulation.
- Source non configurée : simulation **uniquement** si `GFW_DEMO_MODE=true` (résultat non probant) ;
  sinon `ANALYSIS_UNAVAILABLE`.
- **Seuil de tolérance : aucun.** Toute perte de couvert détectée après le 31/12/2020 est
  non conforme. (Le seuil de 0,5 % de la parcelle, qui classait 0,4 ha sur 100 ha en « conforme »,
  a été supprimé.) L'erreur de détection se corrige par revue humaine, pas par un seuil codé en dur.
- Une année de perte portée par le fichier déposé (`simulated_loss_year` ou toute autre propriété)
  n'est **jamais lue** : le déposant ne peut pas dicter le verdict.
- Dates : seules les pertes d'année strictement supérieure à l'année de la date butoir comptent.

### 2.3 Provenance persistée avec le verdict

Chaque analyse enregistre, dans la même ligne que le verdict (`parcel_audits`) :
`analysis_method`, `analysis_version`, `analysis_params`, `analysis_limits`, `analysis_evidence`,
`analysis_source`, `analysis_probative`, `confidence_score`, `loss_year`, `country_code`,
`country_risk`. Un verdict sans sa méthode n'est pas opposable : c'est pourquoi la provenance
est dans la même écriture que le résultat.

**Limite connue :** la source officielle n'a pas été interrogée en conditions réelles pendant
cet audit (cf. `PRODUCTION_READINESS_REPORT.md`, blocage B1). Le chemin « probant » est donc
couvert par des tests unitaires à source simulée par substitution (`gfwLive` / `_gfw_query`),
pas par une analyse réelle validée.

## 3. Preuves documentaires (pièces justificatives)

### 3.1 Dépôt

- Un document (`gf_documents`) est une **déclaration** : titre, catégorie, fournisseur ou parcelle,
  date d'expiration. Il ne prouve rien tant qu'aucune pièce n'est déposée.
- Une pièce est déposée par `multipart/form-data` (déclaration + dépôt) ou par
  `POST /api/v1/documents/{id}/file`. Le dépôt calcule le **condensat SHA-256 côté serveur**,
  détecte le type réel du fichier (signature d'octets, `src/lib/storage/file-type.ts`), enregistre
  le type déclaré, et marque tout écart (`mime_mismatch`).
- **Le chemin JSON ne reçoit aucun fichier.** Une `fileUrl` est refusée (422) : une adresse
  n'est pas une preuve. Depuis le correctif P0-09, aucune URL ni taille déclarée n'est enregistrée
  sans fichier réel.
- Stockage : `disque-local` (validé : aller-retour vérifié par `/api/health`, composant « stockage » ; le
  cloisonnement des clés par organisation n'a pas fait l'objet d'un test dédié). Le backend S3 est écrit mais **jamais exécuté** : non validé.
  L'écriture sur un stockage non validé est refusée, sauf `GF_STORAGE_ACCEPT_NON_VALIDE=1`
  (exception explicite, à éviter en production).

### 3.2 Statuts d'une pièce

| Champ | Valeurs | Règle |
|---|---|---|
| `status` | `TO_VERIFY` (défaut), `VALID`, `EXPIRED`, `REJECTED` | `VALID` exige le droit `dds:validate` (admin, conformité), une pièce déposée (stockage + SHA-256) et un `scan_status` différent de `INFECTED` |
| `scan_status` | `NOT_SCANNED` (défaut), `CLEAN`, `INFECTED` | Voir §3.3 |
| `expiry_date` | date ou vide | Une pièce expirée n'est plus valide ; une pièce obligatoire expirée bloque le dossier |

### 3.3 Antivirus

Le module `src/lib/storage/antivirus.ts` définit l'interface et distingue `CLEAN`, `INFECTED` et
`NOT_SCANNED`. **Aucun moteur antivirus n'est installé ni intégré.** Toutes les pièces sont donc
`NOT_SCANNED`. Ce statut ne doit jamais être présenté comme « sain ».
La validation d'une pièce `NOT_SCANNED` reste possible par un humain habilité : c'est un risque
accepté et tracé, pas une garantie (blocage B4).

### 3.4 Règle de validité utilisée par la readiness

Une pièce compte comme **valide** pour le dossier si, et seulement si : `status = VALID`,
`storage_key` renseigné, `sha256` renseigné, et non expirée (la date d'expiration du jour est
encore valide). Cette règle est testée (`scripts/check-readiness.ts`, 40 contrôles).

## 4. Journal d'audit

- Table `gf_audit_log` : chaque création, modification, suppression logique, analyse et
  validation y écrit une ligne, avec l'état avant et après, l'acteur et son rôle.
- Chaînage : `hash_precedent` et `hash` (script `021_chaine_continue.sql`), avec vérification
  `scripts/verifier-chaine.ts` qui signale une rupture **et son nombre de lignes manquantes**.
- Les analyses sont journalisées avec leur statut, leur source et leur caractère probant.
- Le rattachement et le détachement d'une analyse à un dossier sont journalisés (`UPDATE` sur `DDS`,
  avec `audit_rattache` ou `audit_detache`).

## 5. Liens de preuve (migration 0007)

`parcel_audits.plot_id` et `parcel_audits.due_diligence_id` relient une analyse à une parcelle
et à un dossier. Les deux liens sont **composites avec `organization_id`** : une analyse ne peut
pas être rattachée à une parcelle ou à un dossier d'une autre organisation, même par erreur de
code. Pas de `ON DELETE SET NULL` : il mettrait `organization_id` à NULL. Les suppressions sont logiques.
Migration et retour arrière testés (`npm run db:rollback` puis `npm run db:migrate`).

## 6. Ce que le moteur ne fait pas

- Il n'interroge aucune source satellite réelle depuis cet environnement (pas de clé GFW valide, réseau sortant limité).
- Il ne détecte aucun malware.
- Il ne produit pas de preuve de légalité du foncier : il vérifie la présence et l'intégrité d'une pièce, pas son contenu juridique.
- Il ne transmet rien à TRACES NT.
