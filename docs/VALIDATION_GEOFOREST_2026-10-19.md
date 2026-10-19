# Validation métier EUDR et géospatiale — rapport de chantier

**Rapport :** « Validation métier EUDR et géospatiale — rapport de chantier (Geoforest, 2026-10-19) »
**Auteur :** Agent Arena.ai (Arena.ai — Agent Mode)
**Version :** 3 — intègre la phase 3 (consolidation, preuves distantes, préparation à l'intégration)

| | |
|---|---|
| Rapport | `VALIDATION_GEOFOREST_2026-10-19` — Validation métier EUDR et géospatiale |
| Auteur | Agent Arena.ai (Arena.ai — Agent Mode) |
| Dépôt | `Huberaya/Geoforest` |
| Commit inspecté | `1c95f4c585ed8303f887089ae7450c9235523fd0` — « Retrait d'une marque de sondage laissée dans le résumé d'audit » |
| Branche de travail | `arena/837c5c36-geoforest` (créée depuis `main` au commit ci-dessus ; `main` non modifiée) |
| Date | 2026-10-19 |
| Périmètre | validateurs GIS TypeScript et Python, moteur satellite, risque pays, export de trace, tests et CI |
| Appels externes | **aucun** — toutes les réponses fournisseur sont simulées localement |
| Données de production | non modifiées ; aucun déploiement |

> **Ce que ce rapport ne prouve pas.** Aucune conclusion de conformité au règlement
> (UE) 2023/1115 n'est tirée ici. Les validations ci-dessous portent sur le
> **comportement du logiciel** face à des entrées et des réponses contrôlées. Elles
> ne portent ni sur la disponibilité réelle de Global Forest Watch, ni sur la
> couverture de son jeu de données, ni sur l'acceptation des fichiers par le
> système d'information EUDR, ni sur la situation d'une parcelle sur le terrain.

---

## 1. Résultat synthétique

### 1.1 Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npm run test:gis` | **128/128** contrôles réussis (24 règles EUDR + 66 cas limites géospatiaux et réponses dégradées + 16 topologie différentielle + 22 démarrage, réflexion et chemin configuré) |
| `npm run test:securite` | **48/48** (22 démarrage + 13 migration 0007 + 7 seed + 6 limitation de débit) |
| `npx tsc --noEmit` | aucune erreur |
| `cd backend && pytest -q` | **121 passés, 3 xfailed** (les 3 xfail sont documentés au §5.2) |
| `npm run lint` | 0 erreur, 5 avertissements **préexistants** (directives `eslint-disable` inutiles dans 5 pages) |
| `npm run build` | **réussit** — voir P2-14. Échouait avant cette phase, y compris sur le commit de base |

**Commit validé :** `eacab9bf248860ec0bcdad230c83e60978906e7b`
(parent `1c95f4c585ed8303f887089ae7450c9235523fd0`, branche
`arena/837c5c36-geoforest`, poussée sur `origin`). Les cinq suites ci-dessous
ont été **relancées depuis ce commit**, après le push. Le présent document est
mis à jour par un commit séparé qui ne touche aucun fichier de code.

### 1.2 Classement des résultats

| Code | Correction | Classement |
|---|---|---|
| P2-01 | Risque pays : résolution approximative, métadonnées de source, plancher STANDARD | validé par test logiciel — **attribution géographique non validée faute de données** |
| P2-02 | Réponse GFW malformée : jamais un verdict conforme fabriqué | validé par test logiciel |
| P2-03 | Géométrie absente dans un lot : refus, plus d'omission silencieuse | validé par test logiciel |
| P2-04 | Franchissement de l'antiméridien : refus explicite | validé par test logiciel |
| P2-05 | Écart entre surface déclarée et surface calculée signalé | validé par test logiciel |
| P2-06 | Trace exportée : trois états, règle des 4 ha par parcelle | validé par test logiciel |
| P2-07 | Collection vide : plus d'analyse au large du golfe de Guinée | validé par test logiciel |
| P2-08 | Fournisseur nommé d'après l'hôte réellement appelé | validé par test logiciel |
| P2-09 | Formes GeoJSON malformées : refus au lieu d'un plantage | validé par test logiciel |
| P2-10 | Liste des audits avec verdict absent : plus d'erreur 500 | validé par test logiciel |
| P2-11 | Chaîne de tests TS réparée, tests obsolètes explicitement xfail | validé par test logiciel |
| P2-12 | Analyse sur la géométrie normalisée, surface analysée consignée | validé par test logiciel |
| P2-13 | Calcul de surface : sphère équatoriale → ellipsoïde WGS84 | validé par test logiciel (référence pyproj) |
| P2-14 | Build Next.js : connexion base créée à l'import | validé par test logiciel **et par le build** |
| P2-15 | Identité de l'opérateur : plus de valeur de remplissage | validé par test logiciel |
| P2-16 | Pays : frontières réelles Natural Earth 1:50m | validé par test logiciel (points de contrôle) — **non validé terrain** |
| — | Validation GFW réelle (accès, couverture, version servie) | **non validé faute de données** |
| — | Acceptation par le SI EUDR | **non validé faute de données** |
| — | Cas de référence A, B, C, D, E | **non validé faute de données** (document absent, cf. §2) |


| — | Recette GFW / SI EUDR / terrain | **non exécutée** — voir `docs/RECETTE_VALIDATION_EXTERNE_2026-10-19.md` |
| — | Reprise des dossiers historiques `legacy_placeholder` | **décision produit requise** (liste fournie par la vue, aucune réécriture) |

---

## 2. Commit de référence et document de chantier

### 2.1 Commit

Le commit inspecté est `1c95f4c585ed8303f887089ae7450c9235523fd0`, tête de `main`
au moment de l'ouverture du chantier. **Aucun enregistrement d'approbation** de ce
commit n'existe dans le dépôt (pas de tag, pas de note, pas de fichier de décision) :
« approuvé » ne peut donc pas être vérifié depuis le dépôt. Le commit a été traité
comme référence de fait, et `main` n'a pas été modifiée.

### 2.2 `docs/CHANTIERS_GEOFOREST_2026-10-19.md` : absent

Le document demandé **n'existe pas**. Trois vérifications indépendantes :

1. `ls docs/` → `ARCHITECTURE.md`, `DEPLOYMENT_VERCEL.md`, `EUDR_COMPLIANCE_GUIDE.md`, `TEST_REPORT.md` ;
2. `git log --all -- 'docs/CHANTIERS*'` → aucun commit, sur aucune branche ;
3. `gh api repos/Huberaya/Geoforest/contents/docs` → les quatre mêmes fichiers, à distance.

Les cas de référence A, B, C, D et E ne sont donc **pas connus**. Ils n'ont pas été
inventés. Les corrections ci-dessous sont fondées sur des cas reproduits localement,
identifiés comme tels.

### 2.3 Éléments exacts à fournir pour les cas de référence

Pour **chacun** des cas A, B, C, D et E, il faut :

- l'identifiant du cas et le fichier GeoJSON exact (ou son chemin dans le dépôt),
  avec **au moins 6 décimales écrites** et la propriété `crs` si elle existe ;
- la surface déclarée par l'opérateur, la date de récolte, la matière première et
  la référence de parcelle ;
- le **résultat attendu** : `status`, `compliant`, `risk_level`, `eudr_geometry_rule`,
  codes d'erreur/avertissement attendus, `source` et `is_probative` ;
- la **preuve externe attendue** : réponse GFW de référence (corps JSON, en-têtes,
  version servie, date), ou capture du SI EUDR, ou décision d'exploitation ;
- la **date de préenregistrement** de ces attentes, antérieure à toute requête externe.

Sans ces éléments, les cas A, B et E ne peuvent pas être rejoués. Le §5.3 donne les
attentes préenregistrées pour la future validation externe, à titre de préparation —
elles ne remplacent pas les cas de référence.

---

## 3. Corrections

Chaque correction suit le même plan : règle, cas reproduit, attendu, observé avant,
observé après, test, classement. Les observations « avant » ont été produites sur le
commit `1c95f4c` (worktree séparé), les observations « après » sur la branche de travail.

### P2-01 — Risque pays : table non sourcée, boîtes qui se recouvrent, faux risque faible

**Règle.** L'absence de donnée ne doit jamais produire un risque faible ; un référentiel
de risque doit déclarer sa source, sa version et sa date d'application ; un résultat
d'audit ne doit pas présenter comme établi un niveau de risque que la méthode ne peut
pas établir.

**Cas reproduits** (`resolveCountry` / `resolve_country`) :

| Point | Avant | Après |
|---|---|---|
| Tunis (10,0 ; 36,5) | `EU` / **LOW** | `EU` / LOW, `ambiguous=false` — **non corrigé** (limite §4.2) |
| Alger (3,0 ; 36,7) | `EU` / **LOW** | `EU` / LOW — **non corrigé** |
| Tanger (−5,8 ; 35,8) | `EU` / **LOW** | `EU` / LOW — **non corrigé** |
| Belgrade (20,4 ; 44,8) | `EU` / **LOW** | `EU` / LOW — **non corrigé** |
| Hokkaido (142,0 ; 43,0) | `RU` / HIGH | `JP` / LOW, `ambiguous=true`, candidats `JP,RU` |
| Kiev (30,5 ; 50,4) | `RU` / HIGH | `EU` / LOW, `ambiguous=true`, candidats `EU,RU` |
| Oulan-Bator (106,9 ; 47,9) | `RU` / HIGH | `CN` / LOW, `ambiguous=true`, candidats `CN,RU` |
| Nassau (−77,3 ; 25,0) | `US` / **LOW** | `US` / LOW — inchangé (une seule boîte) |
| El Salvador (−89,2 ; 13,7) | `HN` / STANDARD | `GT` / STANDARD, `ambiguous=true`, candidats `GT,HN` |

**Constat sur les métadonnées.** Avant, la table des pays ne portait **ni source, ni
version, ni date d'application**, et le commentaire Python affirmait qu'elle était
« conforme à la classification publiée par la Commission ». C'était une affirmation non
étayée. Le README la présentait également comme « classification Commission ».

**Attendu.** Toute résolution doit exposer son ambiguïté, la table doit déclarer son
statut non vérifié, et un risque faible ne doit jamais être retenu au niveau de l'audit.

**Après.**

- `resolveCountry` / `resolve_country_detail` retiennent la boîte **la plus spécifique**
  et renvoient `ambiguous` + la liste des candidats ;
- `COUNTRY_RISK_BENCHMARK` / `COUNTRY_BENCHMARK` expose `source`,
  `source_url = null`, `version = "2026-10-19"`, `applied_from = null`,
  `verified = false`, `resolution_method = "bounding-box"` ;
- ces métadonnées sont consignées dans `provenance.params.benchmark_pays` ;
- `LIMITE_BENCHMARK_PAYS` est ajoutée aux limites de **tout** résultat ;
- `risqueRetenu("LOW") → "STANDARD"` : un dossier parisien sans source affiche
  désormais `risk_level = STANDARD` et `country_risk = LOW` (benchmark informatif),
  au lieu de `risk_level = LOW` ;
- le README et le commentaire Python ne revendiquent plus une source Commission.

**Résidu assumé.** L'attribution du pays reste fausse pour Tunis, Alger, Tanger et
Belgrade : une boîte englobante « Union européenne » ne peut pas distinguer la Tunisie
de la Sicile. Le risque d'audit n'est plus faible pour autant (plancher STANDARD), et
l'ambiguïté est tracée. La correction complète exige un jeu de frontières administratives
(cf. §6, point 4).

**Tests.** `scripts/check-eudr-geo-edge-cases.ts` (section P2-01) ;
`backend/tests/test_gis_edge_cases.py::TestPays` et
`test_gfw_degraded.py::TestAbsenceDeSource::test_aucun_risque_faible_sans_preuve`.

**Classement.** Validé par test logiciel pour le comportement ; **non validé faute de
données** pour l'attribution géographique réelle.

---

### P2-02 — Réponse GFW malformée : un verdict conforme fabriqué

**Règle.** Une réponse fournisseur illisible n'est pas une absence de perte. Aucun
verdict ne doit être produit à partir d'une charge utile qui n'a pas été comprise.

**Cas reproduits** (fetch / `requests.post` simulés, hôte non routable) :

| Charge utile | Avant (TS et Python) | Après |
|---|---|---|
| `{"data": null}` | `compliant=true`, `source=gfw-live`, `is_probative=true` | `unavailable`, `compliant=null` |
| `{"statut": "ok"}` | `compliant=true`, probant | `unavailable` |
| `{"data": {"rows": []}}` | TS : `unavailable` ; Python : `compliant=true` | `unavailable` |
| ligne sans année (`{"area__ha": 2}`) | `compliant=true` (2 ha de perte ignorés) | `unavailable` |
| ligne `year=2022, area=null` | `compliant=true` (perte post-2020 ignorée) | `unavailable` |
| surface négative (`-3`) | `compliant=true`, `loss_area_ha=-3.0` | `unavailable` |
| année en texte libre | `unavailable` | `unavailable` |
| `payload = [1, 2]` | Python : **`AttributeError` non interceptée** (500) | `unavailable` |
| corps non JSON | TS : `unavailable` ; Python : `unavailable` | `unavailable` |
| `{"data": []}` | `compliant=true` (sans limite) | `compliant=true` + `LIMITE_REPONSE_VIDE` + `LIMITE_VERSION_NON_EPINGLEE` |

**Attendu.** Toute ligne douteuse invalide la réponse entière ; un tableau vide reste
une observation négative, mais la limite de couverture est consignée.

**Après.**

- `parseGfwRows` (TS) et `_parse_observations` (Python) valident la forme de la charge
  utile, l'année (entier 1900–2100) et la surface (finie, ≥ 0) ;
- `GfwResponseError` est levée puis convertie en `unavailable` — jamais en verdict ;
- les erreurs `TypeError`/`AttributeError` du décodage sont interceptées côté Python ;
- la surface de référence du seuil est celle **réellement envoyée** au fournisseur
  (`analyzedAreaHa` / `surface_analysee_ha`), et non `1 ha` par défaut ;
- `date_recolte`, `date_butoir`, `fournisseur_officiel` et la version sont consignés
  dans la provenance.

**Limite maintenue.** Une réponse **vide mais bien formée** reste interprétée comme
« aucune perte retournée ». C'est la réponse normale d'un jeu de données sans perte ;
la traiter comme indéterminée rendrait tout dossier sans perte inévaluable. La
distinction entre « aucune perte » et « hors couverture » n'est pas tranchable avec
cette seule requête : elle est écrite dans les limites du résultat et classée
**non validée faute de données de référence**.

**Tests.** `backend/tests/test_gfw_degraded.py::TestChargesUtilesMalformees` (8 cas
paramétrés + corps non JSON + erreur HTTP), `::TestReponseVide` ;
`scripts/check-eudr-geo-edge-cases.ts` (section P2-02).

**Classement.** Validé par test logiciel.

---

### P2-03 — Géométrie absente dans un lot : omission silencieuse

**Règle.** Un lot partiellement géolocalisé ne doit pas être validé et analysé sur ses
seules parcelles valides : la surface et le verdict porteraient sur un autre lot que
celui déposé.

**Cas reproduit.** `FeatureCollection` de 2 features, dont la seconde a
`"geometry": null`.

**Attendu.** Le lot est refusé en entier (`MISSING_GEOMETRY`) ; aucune parcelle n'est
validée partiellement.

**Avant.** TS : `valid=true`, `vertex_count=5`, aucune erreur. Python : le validateur
ignorait la feature ; le moteur satellite remplaçait la collection par un disque autour
de (0, 0) et rendait `compliant=true` (cf. P2-07).

**Après.** `valid=false`, `MISSING_GEOMETRY` — « Parcelle #2 : géométrie absente ou
invalide — le lot ne peut pas être validé partiellement ». Une feature qui n'est pas un
objet produit `INVALID_FEATURE` / `INVALID_GEOMETRY`.

**Tests.** `backend/tests/test_gis_edge_cases.py::TestTopologie::test_geometrie_absente_dans_un_lot_refusee` ;
`scripts/check-eudr-geo-edge-cases.ts` (section P2-03).

**Classement.** Validé par test logiciel.

---

### P2-04 — Antiméridien : une parcelle de 42,8 millions d'hectares

**Règle.** Une surface ou une emprise fausse ne doit pas être rendue ; un cas non
supporté doit être refusé explicitement.

**Cas reproduit.** Polygone fidjien de 179,900001° à −179,900001°.

**Attendu.** Le cas non supporté est refusé avec un code explicite ; aucune surface
n'est rendue.

**Avant.**
- TS : `valid=true`, `area_ha = 42 826 987,62`, `bbox = [-179.9, -16.1, 179.9, -16.2]`,
  seul un avertissement `SUSPICIOUS_AREA` — le dossier était **accepté** avec cette
  surface (mesuré à 6 décimales sur `1c95f4c`).
- Python : même calcul, aucune détection.

**Après.** `valid=false`, `ANTIMERIDIAN_UNSUPPORTED`, `area_ha = 0` — « découpez la
parcelle de part et d'autre de la ligne de changement de date ». Le produit ne sait pas
encore traiter ce cas ; il ne rend plus une mesure inventée.

**Tests.** `test_gis_edge_cases.py::TestTopologie::test_antimeridien_refuse` ;
`check-eudr-geo-edge-cases.ts` (section P2-04).

**Classement.** Validé par test logiciel. Le **support** de l'antiméridien reste à
implémenter (dépendance : décision de représentation).

---

### P2-05 — Surface déclarée et surface calculée : aucun rapprochement

**Règle.** Une divergence entre la surface déclarée par l'opérateur et la surface
géodésique calculée est un signal de qualité à porter à sa connaissance.

**Cas reproduit.** Polygone de 1,48 ha avec `declaredAreaHa = 8`.

**Attendu.** Un avertissement `DECLARED_AREA_MISMATCH` est émis au-delà de la tolérance ;
le dossier reste validable (avertissement, pas refus).

**Avant.** Aucun avertissement : la surface déclarée était ignorée pour les polygones.

**Après.** Avertissement `DECLARED_AREA_MISMATCH` si l'écart dépasse
`max(0,1 ha ; 10 %)`. La comparaison est réservée aux dossiers sans point (pour un
point, la surface déclarée est la seule mesure disponible).

**Tests.** `test_gis_edge_cases.py::TestSurfaces` (écart signalé + écart toléré) ;
`check-eudr-geo-edge-cases.ts` (section P2-05).

**Classement.** Validé par test logiciel. Le **seuil** de 10 % est une convention
d'exploitation, pas une valeur réglementaire — à confirmer par un avis métier.

---

### P2-06 — Trace exportée : « aucun verdict » devenait « non conforme »

**Règle.** Trois états, pas deux : conforme, non conforme, non vérifié. La règle des
4 ha s'applique **par parcelle**, pas sur la surface totale du dossier.

**Cas reproduits.**
- Audit `status = ANALYSIS_UNAVAILABLE`, `compliant = null`, `area_ha = 6`,
  `validation.eudr_geometry_rule = POINT_ALLOWED`.

**Attendu.** `status = "NOT_VERIFIED"`, `deforestation_detected_post_cutoff = null`, et
`geometry_rule` égale à la règle réellement validée.

**Avant.**
- `verification.status = "VERIFIED_NON_COMPLIANT"` — la trace affirmait une
  déforestation que personne n'avait mesurée ;
- `deforestation_detected_post_cutoff = true` ;
- `geometry_rule = "POLYGON_REQUIRED"` parce que la surface totale (6 ha) dépasse 4 ha,
  alors que la règle validée était `POINT_ALLOWED`.

**Après.**
- `status = "NOT_VERIFIED"`, `deforestation_detected_post_cutoff = null` ;
- `geometry_rule` reprend `validation.eudr_geometry_rule` (repli sur la surface totale
  uniquement pour les dossiers antérieurs au champ).

**Tests.** `test_gfw_degraded.py::TestExportTrace` ;
`check-eudr-geo-edge-cases.ts` (section P2-06).

**Classement.** Validé par test logiciel.

---

### P2-07 — Collection vide analysée au large du golfe de Guinée

**Règle.** Une géométrie vide ne doit pas être remplacée par une géométrie arbitraire.

**Cas reproduit.** `{"type": "FeatureCollection", "features": []}` et
`{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}`,
avec une réponse GFW vide simulée.

**Attendu.** Aucune géométrie n'est inventée : `source = "unavailable"`, `compliant = null`,
pays `XX`, et aucune requête n'est émise.

**Avant (mesuré sur `1c95f4c`).**

```
FeatureCollection vide                       → source=gfw-live compliant=True pays=XX
FeatureCollection avec géométrie nulle       → source=gfw-live compliant=True pays=XX
```

Cause : `unary_union([])` était remplacé par `Point(0, 0).buffer(0.0005)`. Le moteur
analysait une parcelle imaginaire et rendait un verdict **probant**.

**Après.** `source = "unavailable"`, `compliant = null`, pays `XX` ; aucune requête
n'est émise. Détail Python : « FeatureCollection sans géométrie exploitable : aucune
analyse possible » ; TS : « Aucune coordonnée exploitable : le pays n'a pas pu être
déterminé ».

**Défaut résiduel trouvé pendant la rédaction.** Côté TS, `unavailableResult`
calculait le centroïde **avant** de construire le résultat : sur une collection vide,
le refus se transformait en exception « Centroïde incalculable ». Le calcul est
désormais tolérant à l'absence de coordonnée (pays `XX`, risque STANDARD) et deux
contrôles supplémentaires couvrent ce cas.

**Tests.** `test_gfw_degraded.py::TestAbsenceDeSource::test_collection_vide_n_est_pas_analysee_au_large_du_golfe_guineen` ;
`check-eudr-geo-edge-cases.ts` (section P2-07 : collection vide et collection sans
geometry, toutes deux refusées sans exception).

**Classement.** Validé par test logiciel.

---

### P2-08 — Le fournisseur était nommé « Global Forest Watch » quel que soit l'hôte

**Règle.** Une trace d'analyse doit nommer le service réellement interrogé.

**Cas reproduit.** `GFW_API_URL = https://cache-interne.exemple.invalid`, réponse vide.

**Attendu.** Le fournisseur est nommé d'après l'hôte réellement appelé ; `is_official_source`
vaut `false` hors de l'hôte officiel.

**Avant.** `evidence.provider = "Global Forest Watch (World Resources Institute)"` ;
aucun champ `is_official_source` côté Python.

**Après.** `provider = "Service configuré (cache-interne.exemple.invalid) — distinct de
Global Forest Watch"`, `is_official_source = false` ; le contrat Pydantic
`AnalysisEvidence` porte désormais ce champ. L'hôte officiel reste reconnu
(`is_official_source = true`).

**Tests.** `test_gfw_degraded.py::TestProvenanceFournisseur` ;
`check-eudr-geo-edge-cases.ts` (section P2-02).

**Classement.** Validé par test logiciel.

---

### P2-09 — Formes GeoJSON malformées : plantages au lieu de refus

**Règle.** Une entrée invalide est refusée avec un code, jamais par une exception non
gérée (500).

**Attendu.** Chaque entrée produit un refus codé (`valid=false` + code d'erreur), sans
exception non gérée.

**Cas reproduits et observés avant.**

| Entrée | TS avant | Python avant |
|---|---|---|
| `{"type":"Polygon"}` | `TypeError` | `EMPTY_COORDINATES` |
| `{"type":"Polygon","coordinates":[]}` | `EMPTY_COORDINATES` | `EMPTY_COORDINATES` |
| `{"type":"MultiPolygon","coordinates":[null]}` | `TypeError` | `EMPTY_COORDINATES` |
| `{"type":"MultiPolygon","coordinates":[[anneau], null]}` | `TypeError` | `TypeError` |
| `{"type":"GeometryCollection","geometries":[null]}` | `TypeError` | `AttributeError` |
| `{"type":"Polygon","coordinates":[null]}` | `EMPTY_COORDINATES` | `EMPTY_COORDINATES` |

**Après.** Refus explicites (`EMPTY_COORDINATES`, `INVALID_GEOMETRY`,
`MISSING_GEOMETRY`). Côté moteur satellite Python, une géométrie vide ou illisible
produit `unavailable` au lieu d'une `GEOSException`.

**Tests.** `test_gis_edge_cases.py::TestFormesMalformees` (6 entrées × 2 moteurs) ;
`check-eudr-geo-edge-cases.ts` (section P2-09).

**Classement.** Validé par test logiciel.

---

### P2-10 — Liste des audits : erreur 500 dès qu'un verdict est absent

**Règle.** Un dossier « analyse indisponible » doit rester consultable.

**Cas reproduit.** `POST /api/v1/audit/parcel` sans source, puis `GET /api/v1/audits`.

**Attendu.** L'historique renvoie 200 et conserve `compliant = null`.

**Avant.** `pydantic_core.ValidationError` sur `AuditSummary.compliant: bool` (la
valeur en base est `null`) → **500**. Reproduit par un `POST` (201, `compliant: null`)
suivi d'un `GET /api/v1/audits` (500) ; le même `GET` renvoie 200 après correction.

**Après.** `compliant: Optional[bool]` ; réponse 200 avec `compliant = null`.

**Test.** `test_gfw_degraded.py::TestApiAuditsNonProbants::test_un_dossier_indisponible_reste_listable`.

**Classement.** Validé par test logiciel.

---

### P2-11 — Chaîne de tests : cassée, et trois tests obsolètes non signalés

**Règle.** Une vérification qui ne s'exécute pas ne vérifie rien.

**Attendu.** Les suites s'exécutent réellement ; un test qui décrit du code absent est
signalé (`xfail strict`), jamais silencieusement vert.

**Avant.**
- `npm run test:eudr` s'arrêtait sur
  `Error: This module cannot be imported from a Client Component module`
  (`server-only`, importé par `satellite-checker` → `observability/metriques`) ;
- `pytest` : 3 échecs (`test_geospatial.py`) sur des routes **inexistantes**
  `/api/v1/geospatial/sources` et `/api/v1/geospatial/analyze` (404).

**Après.**
- `test:eudr` s'exécute via `node --conditions=react-server --import tsx` ;
- nouveau script `test:gis` qui enchaîne les trois suites (81 contrôles) ;
- la CI exécute `npm run test:gis` **avant** le build ;
- les 3 tests obsolètes sont marqués `xfail(strict=True)` avec un motif explicite :
  les routes n'existent pas, et leurs attentes supposent de surcroît qu'une analyse
  **simulée** rende un verdict `compliant: true`, ce qui contredit P0-04. Ils n'ont pas
  été supprimés ni réécrits pour « passer ».

**Preuve.** `87 passed, 3 xfailed` ; `npm run test:gis` → 24/24, 41/41, 16/16.

**Classement.** Validé par test logiciel.

---

### P2-12 — La géométrie analysée n'était pas la géométrie validée

**Règle.** Le moteur doit analyser la géométrie qui a été contrôlée et arrondie à
6 décimales, pas le fichier brut.

**Cas reproduit.** Polygone à 8 décimales déposé via `POST /api/v1/audit/parcel`.

**Attendu.** Le fournisseur reçoit exactement la géométrie validée, arrondie à 6 décimales.

**Avant.** L'endpoint Python transmettait `payload.geojson` au moteur : la géométrie
analysée pouvait différer de la géométrie enregistrée (normalisée). Le TS utilisait déjà
la géométrie normalisée.

**Après.** `validation.normalized_geometry` est transmis ; un test capture le corps
réellement envoyé au fournisseur et vérifie qu'aucune coordonnée ne dépasse 6 décimales.
La surface analysée est consignée (`surface_analysee_ha`).

**Test.** `test_gfw_degraded.py::TestGeometrieEnvoyee`.

**Classement.** Validé par test logiciel.

---

### P2-13 — Surface : sphère de rayon équatorial au lieu de l'ellipsoïde WGS84

**Règle.** Le calcul de surface doit être géodésique, et les deux validateurs doivent
rendre la même valeur sur le même fichier.

**Cas reproduit.** Carré de 0,01° × 0,01° à l'équateur.

**Attendu.** Les deux validateurs rendent la même surface, à la tolérance de calcul près.

| Implémentation | Avant | Après | Référence pyproj |
|---|---|---|---|
| TS | **123,9203 ha** | **123,0907202 ha** | 123,0907205 ha |
| Python | 123,0907 ha | 123,0907 ha | 123,0907 ha |

**Écart avant : +0,67 %** — de quoi faire basculer un dossier au voisinage du seuil de
4 ha, et de quoi rendre des surfaces différentes selon l'interface appelée.

**Après.** Le TS applique la somme de Chamberlain & Duquette à la **sphère authalique**
(rayon 6 371 007,18 m), qui conserve exactement les surfaces de l'ellipsoïde. Écart
résiduel avec pyproj : 2,5 × 10⁻⁹ en relatif pour une parcelle ordinaire ; il atteint
0,003 % pour un carré d'un degré et 0,125 % pour un polygone de 10° (pyproj traite les
arêtes comme des géodésiques, le GeoJSON comme des segments en longitude/latitude).
Le README ne revendique plus une « correction ellipsoïdale » inexistante.

**Tests.** `test_gis_edge_cases.py::TestSurfaces::test_surface_geodesique_de_reference`
(tolérance 0,1 %) ; `check-eudr-geo-edge-cases.ts` (section P2-05).

**Classement.** Validé par test logiciel, avec une **référence externe** au sens
algorithmique (`pyproj` / PROJ, bibliothèque géodésique de référence) — pas une
validation terrain.

---

## 3 bis. Phase 2 — corrections bloquantes

Ces quatre chantiers étaient annoncés comme « restants » dans la version 1 de ce
rapport. Ils sont traités ci-dessous.

### P2-14 — Build Next.js : la connexion base était créée à l'import

**Règle.** Un build ne doit dépendre ni d'une base de données, ni d'un secret
d'exécution : il produit un artefact, il ne sert pas de requête.

**Cause confirmée — et le diagnostic précédent était faux.** Le rapport v1
pointait `path.resolve()` dans `src/lib/storage/index.ts`. C'était un
**avertissement de traçage** de Turbopack, pas la cause. La cause est :

```
Error: Failed to collect configuration for /api/metrics
  [cause]: Error: DATABASE_URL_ADMIN est requis pour les opérations système.
      at src/db/admin.ts:24:11
      at src/lib/auth/session.ts:7:1
      at src/lib/auth/roles.ts:20:1
```

`src/db/admin.ts` construisait le pool **au niveau du module**
(`export const adminPool = … ?? createAdminPool()`). Or `next build` évalue les
modules de route pendant « Collecting page data », sans base et sans qu'aucune
requête ne soit servie. `/api/metrics` importe `route-supervision` →
`auth/session` → `db/admin`, et le build levait.

**Correction.** Connexion créée **au premier usage** (`getAdminPool` /
`getDbAdmin`), exposée derrière un `Proxy` pour que `adminPool.query(...)` et
`dbAdmin.select(...)` continuent de fonctionner sans modification chez les
appelants. Aucune valeur de repli n'a été inventée : un pool factice aurait
rendu le produit silencieusement inopérant au lieu de le signaler.

**Preuve du caractère fail-closed.** Le banc `scripts/check-demarrage-sans-config.ts`
(7 contrôles) vérifie les **deux** moitiés de la propriété :

| Contrôle | Résultat |
|---|---|
| la fabrique refuse toujours l'absence d'URL | ✅ |
| aucune initialisation de connexion à l'évaluation du module | ✅ |
| les deux exports restent disponibles | ✅ |
| l'import ne lève pas sans `DATABASE_URL` | ✅ |
| aucun pool n'est instancié par le seul import | ✅ |
| `adminPool.query` lève sans configuration | ✅ |
| `dbAdmin.select` lève sans configuration | ✅ |

**Tests exécutés.** `npm run build` → **code de sortie 0**, 18 pages générées.
`npm run test:gis` inclut désormais `test:demarrage`. La CI commente l'étape et
lance le build sans base.

**Risque résiduel.** Le proxy ne piège que `get` et `has`. Un appel qui
utiliserait `Object.keys(adminPool)` verrait un objet vide ; aucun appelant ne le
fait aujourd'hui.

---

### P2-15 — Identité de l'opérateur : plus aucune valeur de remplissage

**Règle.** Trois états distincts, jamais confondus : identité **réelle**,
identité **inconnue**, donnée **invalide**. Un dossier sans identité ne doit pas
être exporté comme complet.

**Cas reproduit.** `POST /api/v1/audit/parcel` sans champ `operator`, puis export.

**Avant.** La route fabriquait
`{ nom: "Opérateur non renseigné", eori: "XX0000000000000", pays: "XX" }`,
persisté dans des colonnes `NOT NULL` (`operator_country` avec `DEFAULT 'FR'`).
Ce triplet traversait l'historique puis la déclaration : **une fois en base, rien
ne le distinguait d'une identité réelle**.

**Après.**

| Chemin | Avant | Après |
|---|---|---|
| Création (route d'audit) | EORI `XX0000000000000` fabriqué | `operator: null`, `operator_identity: "missing"` |
| Persistance SQL | colonnes `NOT NULL`, pays `FR` par défaut | colonnes nullables, aucune valeur par défaut |
| Historique (`GET /audits`) | `operator_name` toujours renseigné | `null` accepté, dossier listable |
| Export de déclaration | EORI de remplissage dans le DDS | **422 `OPERATOR_IDENTITY_MISSING`** — aucune déclaration émise |
| Pays d'activité | `"FR"` codé en dur | saisi, sinon déduit du pays réel de l'opérateur |
| Nœud `producers` | nom de l'**opérateur**, pays de la **parcelle** | vide tant que le producteur n'est pas déclaré |
| Export GeoJSON (`ProducerName`) | nom de l'opérateur | producteur déclaré, sinon vide |

**Migration.** `drizzle/0007_operateur_non_renseigne.sql` : `DROP NOT NULL` sur
les trois colonnes, `DROP DEFAULT` sur le pays. Côté backend (SQLite), la
reconstruction de table suit la procédure officielle et **ne perd aucune ligne**.

**Dossiers historiques.** Aucune réécriture. Une vue `v_parcel_audits_identite`
(classe `declared` / `legacy_placeholder` / `missing`) rend la liste visible.
⚠️ La vue est créée `WITH (security_invoker = true)` : sans cela elle aurait
contourné la RLS et exposé les audits de toutes les organisations. La décision de
reprise reste **à prendre** (cf. §6).

**Tests.** `backend/tests/test_operateur_identite.py` — 10 tests : création sans
identité, persistance `NULL`, identité réelle conservée, identité invalide
refusée, historique, export refusé puis accepté avec identité fournie, pays
d'activité déduit, migration d'une base ancienne (lignes conservées, contrainte
levée), idempotence, dossier historique refusé à l'export. Côté TypeScript,
7 contrôles dans `check-eudr-geo-edge-cases.ts` (dont l'absence de
`XX0000000000000` dans la déclaration sérialisée).

---

### P2-16 — Attribution du pays : frontières réelles au lieu de rectangles

**Règle.** Une résolution qui ne peut pas conclure rend `XX`, jamais un pays
« probable ». Le plancher de risque et la résolution du pays sont **deux
contrôles distincts** : corriger l'un ne valide pas l'autre.

**Cas reproduits.** La boîte « Union européenne » allait de −10,5° à 31,6° de
longitude et de 35° à 71° de latitude : elle couvrait la Tunisie, l'Algérie, le
Maroc, la Serbie, le Monténégro, la Turquie et l'Ukraine.

| Point | Avant | Après |
|---|---|---|
| Tunis (10,1815 ; 36,8065) | `EU` | **`TN`** |
| Alger (3,0588 ; 36,7538) | `EU` | **`DZ`** |
| Tanger (−5,7998 ; 35,7595) | `EU` | **`MA`** |
| Belgrade (20,4573 ; 44,7872) | `EU` | **`RS`** |
| Kiev (30,5234 ; 50,4501) | `RU` | **`UA`** |
| Hokkaido (142,0 ; 43,0) | `RU` | **`JP`** |
| Oulan-Bator (106,9057 ; 47,8864) | `RU` | **`MN`** |
| Nassau (−77,3396 ; 25,0443) | `US` | **`BS`** |
| San Salvador (−89,2182 ; 13,6929) | `HN` | **`SV`** |
| Pristina (21,1655 ; 42,6629) | `EU` | **`XX`** (Kosovo sans code ISO) |
| Pleine mer (−30 ; 20) | `XX` | `XX` |

**Source employée.** Natural Earth **1:50m** via `world-atlas@2.0.2`, copiée dans
`data/frontieres/` avec la correspondance ISO 3166-1 (`pycountry 26.2.16`). La
provenance, la version, la date de copie et les limites sont écrites dans
`data/frontieres/PROVENANCE.md`.

**Pourquoi 1:50m et non 1:110m.** Mesuré : au 1:110m, Tanger et Nassau tombaient
en mer (donc « non déterminé ») ; au 1:50m, ils sont correctement attribués. Le
fichier pèse 756 Ko, une fois, versionné.

**Parité.** `src/lib/eudr/frontieres.ts` et `backend/app/services/frontieres.py`
décodent le **même fichier** avec le même algorithme (delta-decoding TopoJSON,
lancer de rayon pair-impair, trous déduits). Les deux suites testent les mêmes
points de contrôle.

**Fail-closed.** Si le référentiel est absent ou illisible, le backend **refuse
l'analyse** (`unavailable`, `compliant: null`, pays `XX`, limite explicite) au
lieu de retomber sur une méthode approximative. Testé par
`TestFrontieresIndisponibles`.

**Ce que cela ne corrige pas.** La **classification de risque** reste une table
interne non vérifiée (`verified: false`) : un risque « faible » n'est toujours
pas retenu au niveau de l'audit. Résoudre correctement « France » ne rend pas la
classification réglementaire exacte.

**Limite supplémentaire découverte.** Le jeu Natural Earth tranche implicitement
certains litiges (Crimée → `RU`, Cachemire → `IN`, Sahara occidental → `MA`,
Abyei → `SD`). Le produit rapporte l'attribution du jeu, **il ne l'endosse pas**.
Ce point est consigné dans `PROVENANCE.md` §3.

**Tests.** `backend/tests/test_gis_edge_cases.py::TestPays` (11 points de
contrôle + 7 gardes anti-régression + 2 cas hors couverture) ;
`scripts/check-eudr-geo-edge-cases.ts` (10 points + 6 gardes + provenance).

---

## 4. Cas examinés qui n'ont pas révélé de défaut, ou dont la limite est assumée

### 4.1 Déjà corrects

- **Polygones vides / coordonnées vides** : refusés (`EMPTY_COORDINATES`).
- **Auto-intersection** : détectée des deux côtés ; le contrôle différentiel TS
  (`check-gis-topology.ts`) compare l'ancienne recherche exhaustive et le balayage sur
  9 220 géométries aléatoires, 8 cas construits et 1 200 validations complètes → 16/16.
  La limite « contact en un sommet » est **identique entre l'ancienne recherche
  exhaustive et le balayage** (le test différentiel le vérifie : les deux détectent),
  donc ce n'est pas une régression ; elle est documentée et non corrigée.
- **Anneaux non fermés** : refusés (`RING_NOT_CLOSED`).
- **Précision < 6 décimales** : refusée, y compris quand `JSON.parse` détruit les zéros
  de fin (`-5.500000` → `-5.5`) : la mesure se fait sur le texte source (P0-05).
- **Seuil des 4 ha** : la règle est **strictement supérieure** à 4 ha ; un point déclaré
  à exactement 4 ha reste autorisé (art. 9(1)(d)). Le code était correct et testé ; c'est
  le README qui annonçait « ≥ 4 ha ». Il a été corrigé, ainsi que la mention de la
  « correction ellipsoïdale » du calcul de surface.
- **Lots composites** (points < 4 ha + polygones) : acceptés avec l'avertissement
  `COMPOSITE_BATCH`.
- **Points sans surface déclarée** : avertis, jamais extrapolés depuis le fichier
  (`area_ha` du GeoJSON ignorée — P0-03).
- **Coordonnées hors WGS84** : refusées.
- **Plafond de sommets** : 10 000 dans le TS ; le backend n'en avait aucun. Il applique
  désormais le même plafond, avec le décompte réel dans le refus.

### 4.2 Limites conservées, explicitement tracées

1. **Attribution du pays** : résolue par les frontières Natural Earth 1:50m
   (P2-16). Les attributions fautives mesurées (Tunis, Alger, Tanger, Belgrade → UE ;
   Kiev, Hokkaido, Oulan-Bator → RU) sont corrigées et verrouillées par des tests
   anti-régression. Restent deux limites : la généralisation 1:50m (quelques centaines
   de mètres près d'une frontière) et l'absence de code ISO pour le Kosovo, Chypre-Nord
   et le Somaliland (`XX`). Le risque d'audit n'est jamais LOW.
2. **Réponse GFW vide** : interprétée comme « aucune perte retournée ». La couverture
   réelle (océan, zone non couverte, géométrie non intersectée) n'est pas mesurable avec
   cette requête. Limite consignée dans le résultat.
3. **Score de confiance** : 0,95 (aucune perte significative) ou
   `0,80 + 0,5 × fraction` (perte) — ce sont des **conventions d'affichage**, pas une
   mesure de qualité du fournisseur. C'est désormais écrit dans les limites.
4. **Date de récolte** : elle est consignée dans la provenance, mais elle **n'entre pas**
   dans la règle de conformité du moteur live : une perte post-2020 rend le dossier non
   conforme même si la récolte est antérieure au 31/12/2020. Le moteur déterministe
   affiche au contraire « hors champ temporel ». Cette divergence est une **question de
   droit non tranchée** ; elle n'a pas été corrigée sans avis expert (cf. §6, point 5).
5. **Géométries stockées avant correctif** : un polygone à trous déjà enregistré reste
   analysable (l'aplatissement conserve les anneaux), mais il ne peut plus être validé
   ni réexporté sans découpage.

---

## 5. Validation externe

### 5.1 Ce qui n'a pas été fait

- **Aucun appel réel à Global Forest Watch** n'a été exécuté avec une clé autorisée.
  Les seules tentatives du diagnostic initial ont échoué au niveau TLS, sans réponse
  vérifiable ; elles ne constituent pas une validation.
- **Aucune clé fictive n'a été utilisée pour prétendre à une validation réelle.** Les
  clés présentes dans les tests (`cle-de-test-locale-jamais-reelle`) servent uniquement
  à activer le chemin de code ; l'hôte est remplacé par `gfw-test.invalid`, non routable.
- **Aucun dépôt au SI EUDR** (ACCEPTANCE ou PRODUCTION), aucun TRACES-NT.
- **Aucune vérification terrain**, aucune orthophoto, aucun relevé GPS.

### 5.2 Ce que les tests prouvent — et ce qu'ils ne prouvent pas

| Prouvé | Non prouvé |
|---|---|
| Le logiciel refuse une charge utile GFW malformée | Que GFW renvoie effectivement ces charges utiles |
| Le logiciel ne fabrique pas de verdict sans donnée | Que les données GFW sont exactes ou complètes |
| Le calcul de surface est conforme à pyproj | Que la parcelle déclarée correspond au terrain |
| Les règles topologiques sont appliquées | Que le SI EUDR les accepte |
| La trace conserve méthode, version, paramètres, limites | Que cette trace suffise à une autorité |

### 5.3 Attentes préenregistrées pour une future validation externe

Ces attentes sont inscrites **avant** tout accès. Elles ne sont pas des résultats.

| Objet | Attente préenregistrée | Critère de succès | Critère d'échec |
|---|---|---|---|
| GFW, jeu `umd_tree_cover_loss`, version épinglée | Une requête sur une géométrie de référence renvoie `{"data": [...]}` avec des lignes `{year: int, area__ha: float ≥ 0}` | Schéma conforme, version servie identique à la version demandée | Schéma inattendu, version `latest`, ou réponse vide sur une géométrie de référence connue comme déboisée |
| GFW, géométrie hors couverture (océan) | Réponse vide, indistinguable d'une absence de perte | La limite `LIMITE_REPONSE_VIDE` est présente dans la trace | Le logiciel conclut « conforme » sans limite |
| GFW, perte connue (emprise de référence) | `compliant = false`, `loss_year` attendu, `loss_area_ha` dans une tolérance à fixer | Valeurs dans la tolérance | Valeur hors tolérance, ou verdict conforme |
| GFW, panne (401/429/500, délai) | `source = "unavailable"`, `compliant = null`, aucun repli | Aucun verdict, erreur journalisée | Verdict émis, ou repli silencieux |
| SI EUDR ACCEPTANCE | Dépôt d'un GeoJSON à 6 décimales, sans trou, sans auto-intersection | Acceptation et numéro d'accusé | Refus non expliqué par les règles documentées |
| Frontières pays | Jeu administratif versionné (Natural Earth admin-0 ou équivalent), date de version | Point de contrôle par pays attendu | Désaccord avec la frontière de référence |
| Benchmark Commission | Décision publiée, version, date d'application | Correspondance exacte des pays classés | Absence de publication, ou valeurs non conformes |

### 5.4 Limites de couverture, de source, de date et de terrain

- **Résolution** : 30 m (Hansen/UMD) ; une perte de moins de 0,09 ha n'est pas détectable.
- **Cause** : le jeu de données mesure la perte de couvert, **pas** la déforestation au
  sens de l'art. 2(13) ; une coupe légale et une coupe illégale y sont indiscernables.
- **Date** : la perte est datée à l'année, pas au jour ; la chronologie fine d'une
  récolte n'est pas établie.
- **Couverture** : aucune vérification de couverture réelle n'a été effectuée ; une
  réponse vide ne prouve pas l'absence de forêt.
- **Terrain** : aucune donnée de terrain, aucune vérification des titres fonciers, des
  droits coutumiers ni du consentement des communautés (art. 10).
- **Source pays** : table interne non vérifiée, sans date d'application.
- **Frontières** : Natural Earth 1:50m, versionnée. Précision de quelques centaines de
  mètres ; aucun découpage maritime ; les territoires contestés sont rattachés par le
  jeu de données, et ce rattachement n'est pas endossé par le produit.

### 5.5 Défauts bloqués par une dépendance

| Défaut | Dépendance nécessaire | Pourquoi il n'a pas été corrigé ici |
|---|---|---|
| Reprise des dossiers historiques `legacy_placeholder` | Décision produit | La valeur héritée n'a **pas** été réécrite : on ne sait pas, pour un dossier, si l'opérateur était réellement inconnu ou si la saisie a été perdue. La vue `v_parcel_audits_identite` fournit la liste. |
| Routes `/api/v1/geospatial/*` attendues par 3 tests | Spécification du moteur multi-sources + accès fournisseurs | Les implémenter pour faire passer des tests qui supposent un verdict simulé contredirait P0-04. |
| Date de récolte vs date butoir | Avis juridique | Deux comportements opposés coexistent ; trancher sans source serait inventer une règle. |

---

## 6. Éléments exacts à obtenir avant de poursuivre

1. **`docs/CHANTIERS_GEOFOREST_2026-10-19.md`** (ou son contenu), avec les cas A à E
   et, pour chacun, les éléments listés au §2.3.
2. **Accès GFW** : clé autorisée, jeu de données, **version épinglée**, et une réponse
   de référence (corps JSON + en-têtes + URL finale) pour une géométrie connue.
3. **Accès SI EUDR ACCEPTANCE** : identifiants, spécification GeoJSON datée, jeu de
   test d'acceptation.
4. **Décision de benchmark pays** (version, date d'application, pays classés). Le
   référentiel de frontières, lui, est désormais versionné dans le dépôt ; il reste à
   décider s'il fait foi pour un contrôle.
5. **Avis expert** sur le champ temporel : une récolte antérieure au 31/12/2020 sur une
   parcelle ayant subi une perte postérieure est-elle dans le champ ? Quelle date
   retenir (récolte, mise sur le marché) ?
6. **Décision produit** sur le sort des dossiers historiques portant
   `XX0000000000000` (migration 0007 appliquée, vue de reprise fournie, aucune
   réécriture faite).
7. ~~Arbitrage sur le build Next.js~~ — **traité** (P2-14). Le build réussit sans base.
8. **Validation terrain** : au moins une parcelle avec relevé GPS indépendant et
   orthophoto datée, pour confronter surface et occupation du sol.

---

## 7. Reproduction

```bash
# 1. Dépendances
npm install
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt

# 2. Suites logicielles
npm run test:gis          # 24/24 + 66/66 + 16/16 + 22/22
npm run test:securite     # 22/22 + 13/13 + 7/7 + 6/6
npm run audit:sec         # 0 vulnérabilité de production
npm run audit:dev         # échoue : `braces` sans version corrigée — voir rapport sécurité
npm run audit:controle    # bloque sur toute nouveauté ; 7/7
npx tsc --noEmit          # aucune erreur
cd backend && pytest -q   # 117 passed, 3 xfailed

# 3. Build de production, sans base de données (cf. P2-14)
npm run build             # code de sortie 0
```

Les observations « avant » citées dans ce rapport ont été produites dans un worktree
du commit `1c95f4c`, avec les mêmes dépendances, puis le worktree a été supprimé.

---

## 8. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `src/db/admin.ts` | **P2-14** — connexion créée au premier usage, jamais à l'import |
| `scripts/check-demarrage-sans-config.ts` | **nouveau** — 7 contrôles de non-régression du build |
| `src/db/schema.ts` | **P2-15** — identité de l'opérateur nullable, sans défaut |
| `drizzle/0007_operateur_non_renseigne.{sql,down.sql}` | **nouveau** — migration + vue de reprise |
| `drizzle/meta/0007_snapshot.json`, `_journal.json` | **nouveau / modifié** — suivi de migration |
| `backend/app/core/database.py` | **P2-15** — reconstruction SQLite sans perte de ligne |
| `backend/tests/test_operateur_identite.py` | **nouveau** — 10 tests d'identité |
| `src/lib/eudr/frontieres.ts` | **P2-16** — décodage TopoJSON et point-dans-polygone |
| `backend/app/services/frontieres.py` | **P2-16** — même algorithme, même fichier |
| `data/frontieres/` | **nouveau** — Natural Earth 1:50m + table ISO + `PROVENANCE.md` |
| `docs/RECETTE_VALIDATION_EXTERNE_2026-10-19.md` | **nouveau** — checklist externe, aucun cas exécuté |
| `src/lib/eudr/gis-validator.ts` | forme des géométries, trous/antiméridien, surface authalique, écart entre surface déclarée et calculée |
| `src/lib/eudr/satellite-checker.ts` | validation GFW, métadonnées pays, plancher de risque, provenance, surface analysée |
| `src/lib/eudr/traces-exporter.ts` | trois états de vérification, règle des 4 ha par parcelle |
| `backend/app/services/gis_validator.py` | parité des règles, plafond de sommets, formes malformées, surface normalisée à 6 décimales |
| `backend/app/services/satellite_checker.py` | validation GFW, fournisseur réel, plancher de risque, provenance, géométrie vide |
| `backend/app/services/traces_exporter.py` | `NOT_VERIFIED`, règle des 4 ha par parcelle |
| `backend/app/api/v1/endpoints.py` | analyse sur la géométrie normalisée |
| `backend/app/models/schemas.py` | `compliant` nullable, `is_official_source`, `provenance` |
| `backend/tests/test_gis_edge_cases.py` | **nouveau** — 39 tests |
| `backend/tests/test_gfw_degraded.py` | **nouveau** — 20 tests |
| `backend/tests/test_geospatial.py` | `xfail(strict=True)` documenté |
| `backend/tests/test_eudr_pipeline.py` | trace d'analyse : `is_official_source` |
| `scripts/check-eudr-geo-edge-cases.ts` | **nouveau** — 63 contrôles |
| `scripts/check-eudr-rules.ts` | hôte non routable pour le test de panne |
| `package.json` | `test:eudr` corrigé, `test:gis` et `test:demarrage` ajoutés |
| `.github/workflows/ci.yml` | contrôles EUDR/GIS avant le build |
| `README.md` | règles corrigées, simulation explicitement opt-in, limites déclarées |
| `docs/VALIDATION_GEOFOREST_2026-10-19.md` | ce rapport |

Aucun secret n'a été ajouté. Aucune donnée de production n'a été modifiée. Aucun
déploiement n'a été effectué.

---

## 7. Rapport final par chantier (phase 2)

Un tableau par chantier : cause confirmée, correction, preuve, risque résiduel.

### 7.1 Build `/api/metrics`

| | |
|---|---|
| **Cause confirmée** | `src/db/admin.ts` construisait le pool au niveau du module ; `next build` évalue ce module pendant la collecte des données, sans base ni secret. Reproduit deux fois, y compris sur le commit de base. |
| **Fichiers** | `src/db/admin.ts`, `scripts/check-demarrage-sans-config.ts` (**nouveau**), `package.json`, `.github/workflows/ci.yml` |
| **Correction** | Connexion créée au premier usage, derrière un `Proxy` ; message d'erreur d'origine conservé ; aucune valeur de repli |
| **Tests** | `test:demarrage` 7/7 (dont 2 vérifiant que l'usage **lève** sans configuration) + `npm run build` |
| **Résultat** | build **exit 0**, 18/18 pages, 0 erreur ; 8 avertissements de traçage non bloquants |
| **SHA** | `eacab9b` |
| **Risque résiduel** | le proxy ne piège que `get`/`has` ; un `Object.keys` verrait un objet vide (aucun appelant) |

### 7.2 Identité de l'opérateur

| | |
|---|---|
| **Cause confirmée** | la route d'audit fabriquait `XX0000000000000` / `XX` pour un opérateur absent, dans des colonnes `NOT NULL` (`DEFAULT 'FR'` pour le pays) ; le triplet devenait indiscernable d'une identité réelle |
| **Fichiers** | `src/db/schema.ts`, `drizzle/0007_*`, `src/app/api/v1/audit/parcel/route.ts`, `src/lib/eudr/{types,traces-exporter}.ts`, `src/app/api/v1/export/traces/route.ts`, `backend/app/{models/schemas.py,models/sql_models.py,core/database.py,api/v1/endpoints.py,services/traces_exporter.py}`, `backend/tests/test_operateur_identite.py` (**nouveau**), `scripts/sql/post-migrate/010_row_level_security.sql` |
| **Correction** | trois états (`declared` / `missing` / `legacy_placeholder`) ; absence = `NULL` ; export **422** ; pays d'activité déduit ; nœuds producteur vidés ; vue de reprise `security_invoker` en lecture seule |
| **Tests** | 10 tests Python (création, lecture, mise à jour, export accepté/refusé, migration, historique, idempotence) + 7 contrôles TS |
| **Résultat** | `pytest` 117 passed ; `test:gis` 110/110 |
| **SHA** | `eacab9b` |
| **Risque résiduel** | les dossiers historiques portent encore la valeur de remplissage ; leur reprise est une **décision produit** non prise |

### 7.3 Attribution du pays

| | |
|---|---|
| **Cause confirmée** | résolution par rectangles (`COUNTRY_BOXES`) ; la boîte « UE » couvrait la Tunisie, l'Algérie, le Maroc, la Serbie et l'Ukraine |
| **Fichiers** | `src/lib/eudr/frontieres.ts` (**nouveau**), `backend/app/services/frontieres.py` (**nouveau**), `src/lib/eudr/satellite-checker.ts`, `backend/app/services/satellite_checker.py`, `data/frontieres/*` (**nouveau**, 756 Ko + table ISO + provenance) |
| **Correction** | Natural Earth 1:50m (world-atlas 2.0.2), TopoJSON décodé à l'identique en TS et Python ; `XX` hors couverture ; analyse **refusée** si le référentiel manque |
| **Tests** | `TestPays` 39 tests Python ; 10 points + 6 gardes TS ; parité sur les mêmes coordonnées |
| **Résultat** | Tunis `TN`, Alger `DZ`, Tanger `MA`, Belgrade `RS`, Kiev `UA`, Hokkaido `JP`, Oulan-Bator `MN`, Nassau `BS`, San Salvador `SV`, Pristina `XX` |
| **SHA** | `eacab9b` |
| **Risque résiduel** | précision de quelques centaines de mètres ; territoires contestés rattachés par le jeu (Crimée `RU`, Cachemire `IN`, Sahara occidental `MA`) — attribution rapportée, non endossée ; classification de risque **toujours** non vérifiée |

### 7.4 Moteur GIS et validation externe

| | |
|---|---|
| **Cause confirmée** | deux tests encodaient l'ambiguïté des rectangles comme un attendu ; les autres défauts (surface sphérique, `data: []` lu comme conforme) étaient déjà corrigés avant cette phase |
| **Fichiers** | `backend/tests/test_gis_edge_cases.py`, `scripts/check-eudr-geo-edge-cases.ts`, `docs/RECETTE_VALIDATION_EXTERNE_2026-10-19.md` (**nouveau**) |
| **Correction** | attendus réécrits vers la certitude géométrique (et non assouplis) ; gardes anti-régression ; recette externe formalisée |
| **Tests** | `test:gis` 110/110 ; `tsc` 0 erreur ; `pytest` 117 passed ; `lint` 0 erreur ; `build` exit 0 |
| **Résultat** | les 5 suites passent ; **aucun** cas de la recette externe n'a été exécuté |
| **SHA** | `eacab9b` |
| **Risque résiduel** | GFW, SI EUDR et terrain restent **non validés** ; la question de la date de récolte n'est **pas tranchée** |

### 7.5 Intégration

| | |
|---|---|
| Branche | `arena/837c5c36-geoforest` |
| Commit de code | `eacab9b` (parent `1c95f4c`) |
| `main` | **intacte** — `1c95f4c`, aucun commit ajouté, aucun merge |
| Push | non destructif (`git push -u origin`), pas de force push, pas de reset |
| `git diff --check` | propre |
| Secrets | aucun ajouté (scan du diff indexé) |

---

*Rapport « Validation métier EUDR et géospatiale — rapport de chantier (Geoforest, 2026-10-19) »
établi par **Agent Arena.ai** (Arena.ai — Agent Mode).*
