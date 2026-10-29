# Frontières administratives — provenance et limites

Ce dossier contient les seules données géographiques statiques du produit.
Elles servent à **attribuer un pays à un point** (P2-16), et à rien d'autre.

## Fichiers

| Fichier | Contenu | Taille |
|---|---|---|
| `countries-50m.json` | Frontières des pays, TopoJSON, Natural Earth 1:50m | 756 420 octets (739 Kio) |
| `iso-numerique-alpha2.json` | Correspondance ISO 3166-1 numérique → alpha-2 | 3,5 Ko |
| `LICENSE-world-atlas.txt` | Notice de licence du paquet `world-atlas` (ISC) | 734 octets |

Empreintes **mesurées** (SHA-256), pour qu'un clone puisse vérifier qu'il
contient les mêmes octets que la version validée :

```
04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394  countries-50m.json
1a006da4c336a74a3e60e7230885a543ae72bcb46ca0717d962b83af8baf501e  iso-numerique-alpha2.json
```

Recalcul : `sha256sum data/frontieres/*.json`. Si l'empreinte diffère, le
fichier a changé et les résultats de résolution mesurés plus bas ne valent plus.

## Source

`countries-50m.json` provient du paquet npm **`world-atlas@2.0.2`**, lui-même
dérivé des données **Natural Earth 1:50m Cultural Vectors** (domaine public),
publiées par Natural Earth. Le fichier est copié tel quel : aucune géométrie
n'a été retouchée, simplifiée ni fabriquée.

## Licence

- **Données Natural Earth** : domaine public. Natural Earth demande seulement
  d'être cité, ce qui est fait ci-dessus.
- **Paquet `world-atlas`** : licence **ISC** (Copyright 2013-2019 Michael
  Bostock). Elle impose que la notice accompagne toute copie — c'est pourquoi
  `LICENSE-world-atlas.txt` est versionné à côté des données et non laissé dans
  `node_modules`, qui n'est pas distribué.
- **Table ISO 3166-1** : codes publics, extraits avec `pycountry` (licence
  LGPL-2.1 pour le paquet ; la table de codes elle-même n'est pas
  substantielle au sens du droit d'auteur).

`iso-numerique-alpha2.json` est la correspondance officielle **ISO 3166-1**
(numérique → alpha-2), extraite avec `pycountry 26.2.16`. C'est une table de
correspondance, pas une classification.

## Version et date

- `world-atlas` : **2.0.2** (version publiée du paquet, figée dans le dépôt).
- Natural Earth : millésime **1:50m**, diffusé avec `world-atlas` 2.0.2.
- Copie effectuée le **2026-10-19**.

Le fichier est versionné dans le dépôt pour que le résultat d'un audit reste
reproductible : une résolution de pays ne doit pas dépendre d'un
téléchargement ultérieur dont la version aurait changé.

## Limites — à lire avant d'interpréter un résultat

1. **Généralisation 1:50m.** Les frontières sont simplifiées à l'échelle
   régionale. Un point situé à moins de quelques centaines de mètres d'une
   frontière peut tomber du mauvais côté. La résolution ne convient pas au
   cadastre, ni à une parcelle riveraine d'une frontière.
   *Mesure* : au 1:110m, Tanger (−5,7998 ; 35,7595) et Nassau (−77,3396 ;
   25,0443) tombaient en mer — donc « non déterminé ». Au 1:50m, ils sont
   correctement attribués (MA, BS). Le 1:110m a été écarté pour cette raison.
2. **Trois entités n'ont pas de code ISO** dans ce jeu : `N. Cyprus`,
   `Somaliland`, `Kosovo`. Un point situé dans l'une d'elles n'est **pas**
   attribué par défaut à un pays voisin : il est rendu `XX` (« non déterminé »).
   C'est volontaire — deviner serait fabriquer une attribution.
3. **Territoires contestés.** Le jeu Natural Earth tranche implicitement certains
   litiges en rattachant chaque territoire à un seul État. Mesuré sur ce
   fichier : Crimée → `RU`, Cachemire → `IN`, Sahara occidental → `MA`,
   Abyei → `SD`. Aucun chevauchement de polygones n'a été trouvé, donc la branche
   « frontière contestée » de `resoudrePays` / `resoudre_pays` n'est jamais
   atteinte avec ce fichier. **Le produit ne se prononce pas sur ces
   souverainetés** : il rapporte l'attribution du jeu de données, et le niveau
   de risque qui en découle n'a aucune portée politique ou juridique.
4. **Pas de découpage maritime.** Les polygones sont terrestres. Un point en
   mer, ou une parcelle côtière arrondie vers le large, peut n'être attribué à
   aucun pays.
5. **Ce n'est pas une source de risque.** Le niveau de risque par pays reste
   une table interne non vérifiée (`COUNTRY_RISK_BENCHMARK.verified = false`).
   La résolution corrige **l'attribution géographique**, pas la classification
   réglementaire.
6. **Aucune validation terrain.** Aucun point de contrôle n'a été relevé sur
   le terrain. Les cas de test (Tunis, Alger, Tanger, Belgrade, Kiev…) sont des
   coordonnées de villes connues, pas des parcelles réelles.

## Reproduction

```bash
npm pack world-atlas@2.0.2
tar xzf world-atlas-2.0.2.tgz package/countries-50m.json
cp package/countries-50m.json data/frontieres/countries-50m.json
```
