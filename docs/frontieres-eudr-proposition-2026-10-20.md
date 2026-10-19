# Attribution géographique EUDR — proposition de frontières versionnées

**Statut : PROPOSITION — non approuvée, non implémentée, aucun jeu de données ajouté au dépôt.**

**Date** : 20 octobre 2026
**Contexte** : phase 13, chantier E. Aucun fichier de frontières n'a été
réintroduit, aucun moteur de l'Agent C n'a été fusionné, et la règle juridique
de la date de récolte (`EUDR_CUTOFF_DATE`) n'a pas été modifiée.

---

## 1. Pourquoi cette proposition

Le code résout le pays d'une parcelle par **boîtes englobantes**
(`COUNTRY_BOXES` dans `src/lib/eudr/satellite-checker.ts`). Ce n'est pas une
frontière : les boîtes se chevauchent et ignorent les enclaves, les côtes et
les frontières contestées. Mesures du 20 octobre 2026 :

| Point | Coordonnées (lon, lat) | Résultat actuel | Pays réel |
|---|---|---|---|
| Lomé | 1.2228, 6.1319 | `XX` « Non déterminé » | Togo |
| Arica | −70.3126, −18.4783 | `BR` Brésil | Chili |
| Ciudad del Este | −54.6111, −25.5097 | `BR` Brésil | Paraguay |
| Abidjan | −4.0083, 5.3599 | `CI` Côte d'Ivoire | Côte d'Ivoire |
| Accra | −0.187, 5.6037 | `GH` Ghana | Ghana |
| (0, 0) | 0, 0 | `XX` | océan |

Une attribution erronée peut changer le **benchmark pays** et le pays publié
dans une déclaration : elle ne doit jamais être présentée comme fiable. Le
code actuel le reconnaît déjà (`country_reliable: false`, avertissement UI,
`country_attribution: "approximate_bbox"` dans l'export).

---

## 2. Exigences d'une intégration approuvée

Aucune donnée ne sera ajoutée avant que les six points suivants soient
instruits et approuvés par le responsable produit et le conseil juridique :

1. **Source et version** : nom du jeu, version, date de publication, URL
   d'origine, empreinte **SHA-256** du fichier effectivement importé.
2. **Licence et redistribution** : droit d'usage, d'archivage et de
   redistribution ; attribution obligatoire ou non ; compatibilité avec le
   dépôt public et avec un déploiement commercial.
3. **Frontières contestées** : politique explicite (par exemple, ne jamais
   choisir un camp ; marquer `disputed=true` et retourner les deux entités),
   et revue des cas connus (Sahara occidental, Crimée, Cachemire, Taïwan,
   frontières fluviales).
4. **Méthode point-dans-polygone** : bibliothèque et version, gestion des
   trous, de l'antiméridien, des polygones invalides et des points sur une
   frontière ; jamais de « premier polygone trouvé » silencieux.
5. **Comportement sans données ou en erreur** : `country_code = null`,
   `country_attribution = "unavailable"`, `country_reliable = false` ; aucun
   repli sur `FR`, `XX` ou sur le pays de l'opérateur.
6. **Tests de non-régression** : au minimum Lomé → TG, Arica → CL,
   Ciudad del Este → PY, Abidjan → CI, Accra → GH, (0,0) → aucun pays, et un
   polygone traversant une frontière → `ambiguous=true` avec la liste des pays.

---

## 3. Sources candidates (aucune n'est approuvée à ce stade)

| Source | Version à figer | Licence | Avantages | Points de vigilance |
|---|---|---|---|---|
| **Natural Earth — Admin 0 Countries** | 5.1.2 (à vérifier au téléchargement) | Domaine public (Natural Earth) | Diffusable sans contrainte de partage à l'identique ; champs `disputed` ; large adoption cartographique | Données non officielles ; frontières parfois simplifiées ; politique de conflit à documenter |
| **geoBoundaries — gbOpen ADM0** | version datée à figer | CC BY 4.0 | Mise à jour fréquente, API traçable, sources locales documentées | Attribution obligatoire ; qualité variable selon pays ; vérifier chaque géométrie |
| **OpenStreetMap — limites administratives** | extrait daté | ODbL 1.0 | Précision locale, frontières réelles | Partage à l'identique et attribution ; données mouvantes ; revue juridique nécessaire |
| **GAUL / source FAO-UE** | édition à figer | à vérifier | Référence institutionnelle possible | Conditions d'utilisation à établir par écrit ; ne pas supposer qu'elle est libre |

Recommandation **à instruire**, pas à appliquer : Natural Earth 5.1.2 pour le
socle, avec une politique de frontières contestées explicite et un fichier
`data/frontieres/<version>/countries.geojson` accompagné de
`SOURCE.md` (URL, version, licence, SHA-256, date d'import). Le fichier restera
**hors du dépôt** tant que la licence et la taille ne sont pas validées ; un
script d'import le téléchargera et vérifiera l'empreinte.

---

## 4. Méthode proposée

1. **Point d'entrée** : centroïde géodésique de la parcelle (déjà calculé),
   plus un test sur un point intérieur si le centroïde tombe hors du polygone
   (parcelle concave).
2. **Point-dans-polygone** : `@turf/boolean-point-in-polygon` (ou équivalent
   maintenu), sur des coordonnées WGS84, avec gestion des trous.
3. **Antiméridien** : découpage préalable des géométries traversant ±180°.
4. **Plusieurs pays** : si le polygone intersecte plusieurs entités,
   retourner `country_codes: string[]`, `country_code: null`,
   `country_ambiguous: true`. **Ne jamais choisir un pays arbitrairement.**
5. **Frontière contestée** : retourner les deux entités, `disputed: true`,
   et ne pas appliquer de benchmark pays tant que le litige n'est pas tranché.
6. **Cache** : chargement en mémoire au démarrage, versionné ; un changement de
   fichier impose un redémarrage (pas de rechargement à chaud silencieux).

---

## 5. Modèle de données et d'export proposé

Champs à ajouter (ou à exposer dans les réponses existantes) :

```jsonc
{
  "country_code": "TG",              // null si inconnu ou ambigu
  "country_name": "Togo",
  "country_reliable": true,          // false tant que la proposition n'est pas approuvée
  "country_source": "natural-earth-5.1.2",
  "country_source_sha256": "…",
  "country_attribution": "point_in_polygon", // ou "approximate_bbox", "unavailable"
  "country_ambiguous": false,
  "country_disputed": false
}
```

Dans l'export TRACES, `country_benchmark_risk` ne doit être renseigné que si
`country_reliable && country_code !== null`. `country_of_activity` reste
**obligatoire** et n'est jamais déduit.

---

## 6. Tests attendus (à écrire avec l'intégration)

| Test | Attendu |
|---|---|
| Lomé (1.2228, 6.1319) | `TG`, non ambigu |
| Arica (−70.3126, −18.4783) | `CL`, non ambigu |
| Ciudad del Este (−54.6111, −25.5097) | `PY`, non ambigu |
| Abidjan, Accra | `CI`, `GH` |
| (0, 0) | `country_code = null`, `country_attribution = "unavailable"` |
| Polygone traversant FR/BE | `country_codes = ["FR","BE"]`, `country_ambiguous = true`, aucun benchmark |
| Fichier absent / empreinte invalide | démarrage refusé ou `country_reliable=false` explicite ; **jamais** de pays par défaut |
| Frontière contestée | `disputed=true`, deux entités, aucun choix silencieux |

---

## 7. Ce que cette proposition ne fait pas

- Elle ne réintroduit **aucune** donnée de frontières dans le dépôt.
- Elle ne fusionne **aucun** moteur de l'Agent C.
- Elle ne modifie **pas** la date de récolte ni la règle EUDR applicable.
- Elle ne transforme **pas** les résultats actuels en attribution fiable : tant
  que l'intégration n'est pas approuvée et testée, `country_reliable` reste
  `false` et l'export conserve l'avertissement.
- Elle ne vaut **pas** validation juridique des frontières représentées.

**Décision demandée** : choisir la source, la politique de frontières
contestées et la licence ; autoriser l'ajout du fichier et du script d'import ;
planifier la revue juridique. Sans cette décision, le statut reste
**PROPOSITION — NON APPLIQUÉE**.
