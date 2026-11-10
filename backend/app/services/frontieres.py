"""Attribution d'un pays à un point — P2-16 (parité Python).

⚠️ Pourquoi ce module existe.

La résolution précédente testait l'appartenance à des **rectangles**
(`COUNTRY_BOXES`). Un rectangle n'est pas un pays : la boîte « Union
européenne » s'étendait de −10,5° à 31,6° de longitude et de 35° à 71° de
latitude, ce qui recouvre la Tunisie, l'Algérie, le Maroc, la Serbie, le
Monténégro, la Turquie et l'Ukraine. Tunis, Alger, Tanger et Belgrade étaient
donc attribués à l'Union européenne, Kiev et Oulan-Bator à la Russie, et
Hokkaido à la Russie.

La résolution se fait désormais sur les **frontières réelles** du jeu Natural
Earth 1:50m versionné dans `data/frontieres/` (cf. le `PROVENANCE.md` de ce
dossier pour la source, la version et les limites).

⚠️ Parité avec le TypeScript.

`src/lib/eudr/frontieres.ts` applique exactement le même algorithme au même
fichier. Les deux implémentations sont confrontées par les tests
(`backend/tests/test_pays_frontieres.py` et le banc TypeScript), sur les mêmes
points de contrôle, avec les mêmes attendus.

⚠️ Ce que ce module ne fait pas.

Il ne choisit pas un pays « le plus probable ». Un point hors de tout polygone
— haute mer, zone non couverte, entité sans code ISO — vaut `XX`
(« non déterminé »). Un point contesté entre deux riverains expose ses
candidats sans arbitrage.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# `backend/app/services/frontieres.py` → racine du dépôt : parents[3].
_RACINE = Path(__file__).resolve().parents[3]
_DOSSIER = _RACINE / "data" / "frontieres"
_FICHIER_FRONTIERES = _DOSSIER / "countries-50m.json"
_FICHIER_CODES = _DOSSIER / "iso-numerique-alpha2.json"

METHODE = "natural-earth-50m"

NON_DETERMINE: Dict[str, Any] = {
    "iso2": "XX",
    "name": "Non déterminé",
    "ambiguous": False,
    "candidates": [],
    "method": METHODE,
}


class FrontieresIndisponibles(RuntimeError):
    """Le jeu de frontières est absent ou illisible.

    ⚠️ Le moteur doit alors **refuser d'attribuer** un pays, jamais retomber sur
    une méthode approximative silencieuse : une attribution fausse est pire
    qu'une absence d'attribution, parce qu'elle se présente comme un fait.
    """


@lru_cache(maxsize=1)
def _charger() -> Tuple[Tuple[Tuple[str, str, List[List[List[Tuple[float, float]]]], Tuple[float, float, float, float]], ...], Dict[str, str]]:
    """Décode le TopoJSON une seule fois (177 pays, ~50 000 sommets)."""
    try:
        topologie = json.loads(_FICHIER_FRONTIERES.read_text(encoding="utf-8"))
        codes = json.loads(_FICHIER_CODES.read_text(encoding="utf-8"))["codes"]
    except (OSError, KeyError, ValueError) as exc:  # pragma: no cover - garde
        raise FrontieresIndisponibles(str(exc)) from exc

    ech = topologie.get("transform") or {"scale": [1, 1], "translate": [0, 0]}
    sx, sy = ech["scale"]
    tx, ty = ech["translate"]

    arcs: List[List[Tuple[float, float]]] = []
    for arc in topologie["arcs"]:
        x = y = 0
        points: List[Tuple[float, float]] = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * sx + tx, y * sy + ty))
        arcs.append(points)

    def anneau(indices: List[int]) -> List[Tuple[float, float]]:
        points: List[Tuple[float, float]] = []
        for index in indices:
            # Indice négatif : arc parcouru à l'envers (`~i` == `-i-1`).
            arc = list(reversed(arcs[~index])) if index < 0 else arcs[index]
            points.extend(arc[1:] if points else arc)
        return points

    pays = []
    for geometrie in topologie["objects"]["countries"]["geometries"]:
        iso2 = codes.get(str(geometrie.get("id"))) if geometrie.get("id") else None
        # Sans identifiant numérique, aucune correspondance ISO : le pays n'est
        # pas attribuable (N. Cyprus, Somaliland, Kosovo). Un point qui s'y
        # trouve ressort « non déterminé » — jamais le pays voisin.
        if not iso2:
            continue
        type_geo = geometrie.get("type")
        if type_geo == "Polygon":
            polygones = [[anneau(anneau_arcs) for anneau_arcs in geometrie["arcs"]]]
        elif type_geo == "MultiPolygon":
            polygones = [
                [anneau(anneau_arcs) for anneau_arcs in polygone]
                for polygone in geometrie["arcs"]
            ]
        else:
            continue

        lats = [p[1] for poly in polygones for p in poly[0]] if polygones else []
        lons = [p[0] for poly in polygones for p in poly[0]] if polygones else []
        if not lons:
            continue
        bbox = (min(lons), min(lats), max(lons), max(lats))
        nom = (geometrie.get("properties") or {}).get("name") or iso2
        pays.append((iso2, nom, polygones, bbox))

    if not pays:
        raise FrontieresIndisponibles("aucun pays décodé")
    return tuple(pays), codes


def frontieres_disponibles() -> bool:
    try:
        _charger()
        return True
    except FrontieresIndisponibles:
        return False


def _point_dans_anneau(lon: float, lat: float, anneau: List[Tuple[float, float]]) -> bool:
    """Lancer de rayon (règle pair-impair), identique à la version TS."""
    dedans = False
    j = len(anneau) - 1
    for i in range(len(anneau)):
        xi, yi = anneau[i]
        xj, yj = anneau[j]
        if (yi > lat) != (yj > lat):
            if lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                dedans = not dedans
        j = i
    return dedans


def _point_dans_polygone(lon: float, lat: float, polygone: List[List[Tuple[float, float]]]) -> bool:
    if not polygone:
        return False
    if not _point_dans_anneau(lon, lat, polygone[0]):
        return False
    # Les anneaux suivants sont des trous (lacs, enclaves).
    for trou in polygone[1:]:
        if _point_dans_anneau(lon, lat, trou):
            return False
    return True


def resoudre_pays(lon: float, lat: float) -> Dict[str, Any]:
    """Résout le pays d'un point par ses frontières réelles.

    :return: dict `{iso2, name, ambiguous, candidates, method}`. `iso2 = "XX"`
        si le point n'est attribuable à aucun pays.
    :raises FrontieresIndisponibles: si le jeu de frontières est absent.
    """
    if lon != lon or lat != lat:  # NaN
        return dict(NON_DETERMINE)

    pays, _ = _charger()
    trouves = []
    for iso2, nom, polygones, (lon_min, lat_min, lon_max, lat_max) in pays:
        if lon < lon_min or lon > lon_max or lat < lat_min or lat > lat_max:
            continue
        if any(_point_dans_polygone(lon, lat, polygone) for polygone in polygones):
            trouves.append((iso2, nom))

    if not trouves:
        return dict(NON_DETERMINE)
    if len(trouves) == 1:
        iso2, nom = trouves[0]
        return {
            "iso2": iso2,
            "name": nom,
            "ambiguous": False,
            "candidates": [iso2],
            "method": METHODE,
        }

    # Frontière contestée : deux polygones contiennent le point. On expose les
    # candidats sans arbitrer — choisir serait inventer une souveraineté.
    candidats = sorted({iso2 for iso2, _ in trouves})
    return {
        "iso2": "XX",
        "name": "Non déterminé (frontière contestée)",
        "ambiguous": True,
        "candidates": candidats,
        "method": METHODE,
    }
