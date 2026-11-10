# GeoForest Trace — adéquation au règlement (UE) 2023/1115 (EUDR)

**Révisé le 05/11/2026.** Chaque ligne de ce tableau a été confrontée au code,
pas à une intention. Là où un dispositif est absent ou insuffisant, c'est écrit.

> ⚠️ **Ce document n'est pas un avis juridique.** Il décrit ce que le logiciel
> fait, et ne fait pas. La conformité EUDR est une obligation de l'**opérateur**
> ou du **commerçant**, pas de son prestataire.

---

## 1. Calendrier applicable — vérifié au 05/11/2026

| Date | Ce qu'elle concerne |
|---|---|
| **30/12/2026** | Application aux **opérateurs et commerçants** grands et moyens |
| **30/06/2027** | Application aux **micro et petites entreprises** établies au 31/12/2024 |
| 31/12/2020 | Date butoir de déforestation (« zéro-déforestation ») |
| 29/06/2023 | Date de production des produits (art. 1(2)) |
| 30/06/2030 | Revue générale reportée |

Ces dates résultent du **Règlement (UE) 2025/2650** (second report, adopté le
18/12/2025), après un premier report par le Règlement (UE) 2024/3234.

**Ce que cela change pour un client** : un produit mis sur le marché en 2026
n'a pas à être déclaré avant le 30/12/2026. En revanche, la **date butoir de
déforestation (31/12/2020) n'a jamais bougé** : elle reste la ligne de partage
sur laquelle porte toute analyse.

⚠️ Toute documentation annonçant une échéance de 2025 est périmée. Les deux
reports sont acquis ; ne pas les présenter comme incertains.

---

## 2. Matrice articles ↔ implémentation

| Article | Obligation | Ce que GeoForest fait réellement | État |
|---|---|---|---|
| **art. 2(13)** | Produit « zéro-déforestation » | Détection de perte forestière **Hansen / UMD 30 m** après le 31/12/2020 | ⚠️ **PARTIEL** — Hansen seul ; **ni Sentinel-2 ni ESA WorldCover ne sont implémentés**, malgré ce qu'annonçaient les versions antérieures de ce document |
| **art. 9(1)(d)** | Géolocalisation ≥ 6 décimales, WGS84, polygone **> 4 ha** | Validateur géodésique : nombre de décimales, fermeture d'anneau, ordre GeoJSON `[lon, lat]`, rejet des CRS projetés | ✅ **implémenté et testé** (24 contrôles) |
| **art. 9** — période de production | Date ou période de production par parcelle | Non vérifié dans le schéma ; à confirmer au chantier C7 | ⚠️ **NON VÉRIFIÉ** |
| **art. 2(40)** — FPIC | Droits des peuples autochtones | ⚠️ **ABSENT** — aucune catégorie documentaire `FPIC` dans le code. Les catégories réelles sont : `LAND_TENURE`, `HARVEST_PERMIT`, `TAX_CLEARANCE`, `LABOR_COMPLIANCE`, `CERTIFICATE_FSC_PEFC` | 🔴 **ABSENT** |
| **art. 3** | Conditions de mise sur le marché | Contrôle bloquant la validation DDR si une parcelle n'est pas conforme | ⚠️ Non vérifié de bout en bout |
| **art. 4** | Diligence raisonnée et DDS | Cycle de vie DDR à **9 statuts** — présent dans `DDS_STATUSES` (`DRAFT` → `ARCHIVED`) | ✅ **existe** |
| **art. 8** | Système de diligence | Collecte → évaluation → plan de mitigation | ⚠️ **PARTIEL** |
| **art. 10** | Évaluation des risques | Matrice à 4 piliers, score 0-100, `countryRisk` exposé dans l'export | ✅ **implémenté** — résolution par contours et référentiel officiel (§2 bis) |
| **art. 11** | Réduction des risques | `/risks` : *À traiter → En cours → Résolu → Validé* | ⚠️ **PARTIEL** |
| **art. 12** | Conservation 5 ans | Piste d'audit horodatée, chaîne vérifiable, RLS, `DELETE` retiré au rôle applicatif | ✅ **implémenté** — purge de rétention à configurer |
| **art. 29** | Benchmarking pays par la Commission | Annexe du règlement d'exécution (UE) 2025/1093 : 140 LOW, 4 HIGH, STANDARD par défaut | ✅ **implémenté** — table datée et versionnée |
| DDS dans le SI EUDR (TRACES NT) | Dépôt officiel | **Export** de flux normalisé | ⚠️ **Un export n'est pas une déclaration soumise.** Aucun dépôt automatique n'existe |

### 2 bis — Résolution du pays et benchmark, état au 05/11/2026

**Ce qui a changé.** Jusqu'à C6c, le pays était déduit d'un **rectangle
englobant** avec un niveau de risque propre à chaque rectangle. Ce dispositif
n'existe plus. Il produisait des faux verdicts mesurés :

| Point testé | Avant (rectangles) | Après (contours) |
|---|---|---|
| Bangkok (TH) | `MM` / **HIGH** | `TH` / LOW |
| Oulan-Bator (MN) | `RU` / **HIGH** | `MN` / LOW |
| Kuala Lumpur (MY) | `ID` | `MY` / STANDARD |
| Phnom Penh (KH) | `VN` | `KH` / STANDARD |
| Tanger, Alger, Tunis | `EU` / LOW | `MA`, `DZ`, `TN` / LOW |
| Kyiv (UA) | `RU` / HIGH | `UA` / LOW |

Une parcelle **thaïlandaise** — 4ᵉ producteur mondial de caoutchouc, LOW à
l'annexe — héritait donc d'un risque **HIGH**. Ce n'est pas une imprécision
d'affichage : c'est un dossier refusé à un opérateur qui y a droit.

**Le dispositif actuel.**

| Élément | Réalisation |
|---|---|
| Classement | Annexe du règlement d'exécution **(UE) 2025/1093** — 140 LOW, 4 HIGH, STANDARD par défaut (art. 1(2)) |
| Source du fichier | `src/lib/eudr/benchmark-pays.ts`, avec source et date de vérification |
| Géométrie | Contours **Natural Earth 1:50m**, domaine public, générés et commités |
| Méthode | Point-dans-polygone par lancer de rayon, trous exclus (le Lesotho n'est pas l'Afrique du Sud) |
| Vérification | `check:banc-pays` — 52 cas ; `check:referentiel-pays` 19 ; `check:frontieres-pays` 16 |

⚠️ **L'annexe classe des pays entiers.** L'article 29 autorise la Commission à
classer « des pays ou des parties de pays » ; le texte en vigueur ne le fait
pas. Le code ne prétend donc à aucune granularité infranationale.

⚠️ **Le classement est révisable** (art. 29(2)). Au 05/11/2026, 2025/1093 reste
la dernière itération : aucun nouvel acte d'exécution n'a été publié depuis son
entrée en vigueur le 26/05/2025, et les lignes directrices de la Commission du
20/07/2026 (OJ C/2026/3896, note 11) la citent comme telle.

### 2 quater — Rectification d'une affirmation antérieure

⚠️ Une version précédente de ce guide affirmait qu'« un pays tiers hors
benchmarking n'est ni faible ni standard par construction ». **C'est faux**, et
l'erreur méritait d'être corrigée plutôt que retirée.

L'article 29 du règlement (UE) 2023/1115 attribue le niveau **STANDARD à tous
les pays** à l'entrée en vigueur, et l'article 1(2) du règlement d'exécution
(UE) 2025/1093 le confirme : *tout pays non listé à l'annexe est standard*. Le
STANDARD n'est donc pas une catégorie résiduelle que le code pourrait
librement redéfinir — c'est le **défaut réglementaire**.

Et 140 pays y compris de nombreux pays tiers sont explicitement **LOW** :
Ghana, Inde, Kenya, Thaïlande, Vietnam, Turquie, Maroc, Tunisie, Ukraine… Un
pays tiers n'est donc nullement standard par nature.

**Ce qui reste vrai, et distinct** : un point **non résolu** (haute mer, ou zone
hors couverture) n'est pas un pays. Le code lui applique STANDARD faute de
mieux, mais le signale par `country_statut = HORS_COUVERTURE`. Confondre
« pays standard » et « pays inconnu » ferait passer un défaut de résolution
pour une classification réglementaire.

---

## 2 ter — Diligence raisonnée simplifiée : volontairement non implémentée

L'**article 13** du règlement (UE) 2023/1115 ouvre une diligence raisonnée
simplifiée aux produits dont **toutes** les matières proviennent de pays classés
low-risk. L'annexe du règlement d'exécution (UE) 2025/1093 en compte 140,
dont le Ghana, l'Inde, le Kenya, la Thaïlande, le Vietnam et le Costa Rica.

**GeoForest ne l'implémente pas.** Toutes les origines passent par le parcours
complet. C'est la décision **D-001** de `docs/DECISIONS.md`.

**Ce que cela coûte à l'opérateur.** Sur une origine ghanéenne ou indienne,
l'outil demande une évaluation et une atténuation des risques que le règlement
n'exige pas. C'est un **surcroît de travail délibéré**, pas une non-conformité.

**Pourquoi.** La simplification ne vaut que si *tout* le produit est low-risk.
Une seule parcelle d'origine standard fait retomber l'ensemble sous le régime
complet. Un parcours allégé déclenché par le pays d'une parcelle, alors que le
produit en mélange plusieurs, produirait une diligence insuffisante sur un
dossier qui se présente comme complet. Le coût d'un parcours en trop est nul
pour l'opérateur ; le coût d'un parcours en moins est un dossier non opposable.

⚠️ Ce choix doit être **annoncé** au client, pas découvert. Un opérateur qui
sait pourquoi l'outil en demande plus ne le vit pas comme un défaut.

---

## 3. Ce que l'export TRACES n'est pas

L'application produit un **fichier** conforme au format attendu. Elle ne
**dépose pas** de déclaration dans le système d'information de l'Union.

Le SI EUDR a rouvert le 03/07/2026, avec trois voies de dépôt : formulaire web
(une DDS à la fois), **GeoJSON**, et **API machine-à-machine**. Un export GeoJSON
est donc exploitable, mais c'est **l'opérateur** qui dépose, et qui reçoit en
retour le **numéro de référence** et le **numéro de vérification**.

⚠️ Le statut `DECLARED` du produit a été conçu pour n'être posé qu'à la saisie
du véritable numéro TRACES. Il ne doit jamais être déduit d'un export réussi.

**Ce que l'export refuse, et pourquoi.** Un dossier n'est exportable que si
l'origine du produit est établie. Trois cas de refus, chacun avec une action
corrective :

| Situation | Refus | Ce qu'il faut faire |
|---|---|---|
| Pays non résolu (`XX`) | `ORIGINE_INDETERMINEE` | Corriger la géolocalisation, relancer l'audit |
| Point hors couverture terrestre | `HORS_COUVERTURE` | Vérifier l'ordre `[longitude, latitude]` |
| Point dans plusieurs pays | `CONFLIT` | Déplacer le point dans le pays attendu |

Un champ `country_benchmark_risk` vide se lirait, dans un dossier destiné à une
autorité, comme une omission par négligence — et une origine prise au hasard
se lirait comme une affirmation. On n'exporte donc pas ce qu'on ne sait pas
nommer.

---

## 2 quinquies — Analyse satellite : trois issues, pas deux

Depuis C9, une analyse de parcelle rend exactement l'un de ces trois états, et le
produit refuse de les confondre.

| État | Ce que le produit sait | Déclarable ? |
|---|---|---|
| Perte observée après le 31/12/2020 | Oui — un fait mesuré | Non : la parcelle est non conforme |
| Aucune perte observée, données présentes | Oui — un fait mesuré | **Oui** |
| Aucune observation | Rien | **Non — et ce n'est pas une conformité** |

**La troisième ligne est la correction de C9.** Le fournisseur Hansen/UMD ne
couvre que ce qui a été observé. Une parcelle sous nuage permanent, sous une
couverture non observée, ou hors de l'emprise du produit renvoie le même tableau
vide qu'une parcelle intacte. Le produit répondait `compliant: true` dans les deux
cas, ce qui transformait un silence en certificat.

**Ce qu'il faut retenir, et qui vaut au-delà du produit** : une absence de perte
**détectée** n'est pas une absence de déforestation. Un dossier EUDR peut être
refusé pour ce motif aussi longtemps qu'une analyse n'a rien observé — c'est un
refus honnête, pas un défaut de l'outil.

**Ce que la source certifie, et ce qu'elle ne certifie pas.** Le verdict repose
sur `umd_tree_cover_loss` à un seuil de densité de couvert de 30 % en l'an 2000.
Hors de cette définition — une parcelle boisée à moins de 30 % en 2000, une
dégradation sans perte de couvert, une déforestation avant 2000 — le produit ne
dit rien. `docs/DECISIONS.md` (D-009, D-010) porte les décisions.

**Ce qui n'est toujours pas vérifié.** Le chemin réel vers Global Forest Watch n'a
jamais été exécuté avec une clé de production : personne n'a encore vu, dans ce
projet, une réponse authentique du service. `npm run check:satellite` prouve le
comportement du produit contre un faux fournisseur local, ce qui est une autre
chose. Tant que la clé n'est pas fournie, aucun dossier ne peut atteindre
`READY_FOR_DECLARATION` — et c'est conforme au produit, pas un défaut.

---

## 3 bis — Chevauchement de parcelles : ce que la détection ne voit pas

Depuis C8, la création d'une parcelle compare son tracé aux parcelles de la
**même organisation** et signale les recouvrements (`src/lib/eudr/chevauchement.ts`,
`npm run check:chevauchement`).

**Ce qui est détecté.** Deux parcelles dont les surfaces se chevauchent, y
compris lorsqu'une est entièrement contenue dans l'autre — cas où aucune arête
ne se croise et qu'un test limité aux intersections de segments manquerait.

**Ce qui n'est PAS un recouvrement, et ne doit pas être signalé comme tel.**
Deux parcelles voisines qui partagent une clôture se **touchent** sans se
recouvrir. Le module distingue les deux (`CONTACT` contre `RECOUVREMENT`) et
n'expose que le second. Un contrôle qui signalerait le contact produirait une
alerte sur chaque parcelle voisine — et une alerte permanente n'est plus lue.

**Les trois limites, à connaître avant de s'appuyer dessus.**

1. **La visibilité s'arrête à l'organisation.** Une parcelle d'une autre
   organisation cliente n'est jamais lue : la RLS l'interdit, et c'est voulu.
   Deux exploitations clientes différentes peuvent donc se recouvrir sans que
   le produit le sache. Personne, dans l'application, ne peut le constater — il
   faut un rapprochement entre opérateurs ou une autorité pour le révéler.
2. **Aucune surface d'intersection n'est calculée.** Le produit dit « ces deux
   parcelles se recouvrent », avec leurs noms. Il ne dit pas « sur 0,8 ha ».
   Calculer cette surface demande un algorithme de découpage de polygones dont
   les cas dégénérés produisent des résultats faux ; un chiffre faux en
   hectares entrerait dans une déclaration, ce qui serait pire que son absence.
3. **Les parcelles sans surface (points) n'y participent pas.** Un point n'a
   pas de surface à recouvrir. En dessous de 4 ha, l'EUDR admet un point
   (`art. 9(1)(d)`) : ces parcelles échappent donc structurellement à la
   détection, et deux points identiques ne sont pas signalés.

**Ce que la détection garantit, et ce qu'elle ne garantit pas.** Un recoupement
signalé est réel. L'absence de signal **ne prouve pas** l'absence de
recouvrement — ni hors organisation, ni pour les points, ni si les cadres
englobants n'ont pas été remplis (`npm run db:backfill-bbox`).

---

## 3 ter — Ce que le parcours de bout en bout prouve, et ce qu'il ne prouve pas

Depuis C10, `npm run check:e2e:complet` traverse le parcours DDR sur
l'application **démarrée** et une vraie base : fournisseur, parcelle rattachée,
analyse, dossier de diligence, transitions d'état, refus motivé du passage en
« prêt à déclarer », refus d'export (57 contrôles).

**Ce qu'il prouve.** Que les pièces sont branchées entre elles : que la route de
dossier consulte réellement le validateur, que la base rend les parcelles
rattachées par le fournisseur, que le statut `DECLARED` est inatteignable, que
l'export refuse une analyse non probante **côté serveur** — l'écran n'étant pas
une barrière.

**Ce qu'il ne prouve pas, et pourquoi c'est écrit.** Il s'exécute sans clé GFW.
Aucune analyse n'y est donc probante, et **le chemin « dossier complet → prêt à
déclarer » n'est couvert par aucun contrôle**. Le faire passer demanderait une
clé de production et un accès réseau ; le simuler reviendrait à éprouver un
produit qui n'existe pas. Ce qui est vérifié aujourd'hui est le refus — avec le
motif, le score calculé, et un dossier qui reste lisible pour être corrigé.

**Conséquence pratique pour un opérateur.** Tant qu'aucune clé GFW n'est
configurée, un dossier de ce produit ne peut pas être déclaré. Ce n'est pas une
panne : c'est le produit qui refuse de certifier ce qu'il n'a pas observé
(D-009). Le contrôle de bout en bout le vérifie à chaque exécution.

---

## 4. Les huit confusions à ne pas commettre

Celles-ci ont toutes été observées dans la documentation du dépôt ou dans les
échanges du projet.

1. **Codé ≠ opérationnel.** Une route peut exister et renvoyer 500.
2. **Test existant ≠ test pertinent.** Les 3 tests géospatiaux du backend portent sur des routes inexistantes.
3. **Donnée satellitaire ≠ preuve juridique.** Un score Hansen n'est pas un constat d'absence de déforestation.
4. **Géométrie valide ≠ parcelle réglementairement conforme.** La conformité dépend aussi de la légalité et du titre.
5. **Export DDR ≠ déclaration officiellement soumise.** Voir §3.
6. **Code présent ≠ code déployé.**
7. **Déploiement réussi ≠ application fonctionnelle.**
8. **Document qui affirme ≠ document vérifié.** Ce document-ci a déjà été faux une fois ; il porte désormais ses commandes de vérification.

---

## 5. Décharge

GeoForest Trace est un outil d'aide à la décision, de gestion des risques et
d'orchestration de la diligence raisonnée. Les calculs et analyses géospatiales
constituent des **indicateurs techniques**. Ils ne remplacent ni les
vérifications physiques sur le terrain, ni les audits des autorités compétentes
désignées par les États membres.

**Aucun score algorithmique, aucune analyse satellitaire ne constitue la preuve
juridique d'une absence de déforestation.**
