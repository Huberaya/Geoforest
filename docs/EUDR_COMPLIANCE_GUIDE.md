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
| **art. 10** | Évaluation des risques | Matrice à 4 piliers, score 0-100, `countryRisk` exposé dans l'export | 🔴 **DÉFAILLANT** — voir §2 bis : la résolution pays par rectangle englobant produit de **faux verdicts mesurés** |
| **art. 11** | Réduction des risques | `/risks` : *À traiter → En cours → Résolu → Validé* | ⚠️ **PARTIEL** |
| **art. 12** | Conservation 5 ans | Piste d'audit horodatée, chaîne vérifiable, RLS, `DELETE` retiré au rôle applicatif | ✅ **implémenté** — purge de rétention à configurer |
| **art. 29** | Benchmarking pays par la Commission | Table de 43 pays, risque par défaut | ⚠️ **PARTIEL** — la table existe, mais sa résolution géographique est fausse (§2 bis) |
| DDS dans le SI EUDR (TRACES NT) | Dépôt officiel | **Export** de flux normalisé | ⚠️ **Un export n'est pas une déclaration soumise.** Aucun dépôt automatique n'existe |

### 2 bis — La classification pays, mesurée le 05/11/2026

Le pays est résolu par **rectangle englobant** (`resolveCountry`, dans
`src/lib/eudr/satellite-checker.ts`), pas par géométrie administrative. Une
seule boîte `EU` couvre `[-10.5, 35.0, 31.6, 71.2]`. Mesures réelles :

| Point testé | Résultat | Attendu |
|---|---|---|
| Helsinki (FI) | `EU` / LOW | ✅ correct |
| Tanger (**Maroc**) | `EU` / LOW | ❌ **devrait être hors UE** |
| Alger (**Algérie**) | `EU` / LOW | ❌ **devrait être hors UE** |
| Tunis (**Tunisie**) | `EU` / LOW | ❌ **devrait être hors UE** |
| Istanbul (**Turquie**) | `EU` / LOW | ❌ **devrait être hors UE** |
| **Kiev (Ukraine)** | `RU` / **HIGH** | ❌ **devrait être UA** |
| Moscou (RU) | `RU` / HIGH | ✅ correct |

**Conséquence pour un client** : une parcelle marocaine ou tunisienne est
classée à faible risque « Union européenne ». Sur un dossier réel, ce n'est pas
une approximation : c'est un faux verdict, dans le sens qui **minore** le
risque. Un audit de conformité le relèvera.

Chantier **C6** (frontières et classification pays versionnées). Tant qu'il
n'est pas traité, `country_benchmark_risk` dans l'export TRACES doit être
considéré comme **non fiable**.

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
