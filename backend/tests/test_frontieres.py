"""P2-16 — attribution du pays par frontières réelles (parité Python).

Les points de contrôle sont lus dans `data/frontieres/points-de-controle.json`,
partagé avec `scripts/check-frontieres.ts` : une divergence entre les deux
implémentations échoue dans les DEUX suites.

Les rattachements des territoires contestés (Crimée, Cachemire, Sahara
occidental) sont ceux du jeu Natural Earth : ils sont rapportés, pas endossés.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from app.services import frontieres as fr
from app.services import satellite_checker as sc

RACINE = Path(__file__).resolve().parents[2]
DOSSIER = RACINE / "data" / "frontieres"
POINTS = json.loads((DOSSIER / "points-de-controle.json").read_text(encoding="utf-8"))

# Empreintes publiées dans PROVENANCE.md : le fichier décodé est celui qui a été validé.
EMPREINTES = {
    "countries-50m.json": "04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394",
    "iso-numerique-alpha2.json": "1a006da4c336a74a3e60e7230885a543ae72bcb46ca0717d962b83af8baf501e",
}


@pytest.mark.parametrize("fichier,attendu", sorted(EMPREINTES.items()))
def test_empreinte_du_referentiel(fichier: str, attendu: str) -> None:
    empreinte = hashlib.sha256((DOSSIER / fichier).read_bytes()).hexdigest()
    assert empreinte == attendu, f"{fichier} a changé : PROVENANCE.md et les points de contrôle ne valent plus"


def test_provenance_et_licence_versionnees() -> None:
    assert (DOSSIER / "PROVENANCE.md").is_file()
    assert (DOSSIER / "LICENSE-world-atlas.txt").is_file()
    assert "world-atlas@2.0.2" in (DOSSIER / "PROVENANCE.md").read_text(encoding="utf-8")


def test_frontieres_disponibles() -> None:
    assert fr.frontieres_disponibles() is True
    assert POINTS["methode"] == fr.METHODE == "natural-earth-50m"


@pytest.mark.parametrize(
    "label,lon,lat,attendu",
    [(p["label"], p["lon"], p["lat"], p["iso2"]) for p in POINTS["points"]],
)
def test_point_de_controle(label: str, lon: float, lat: float, attendu: str) -> None:
    r = fr.resoudre_pays(lon, lat)
    assert r["iso2"] == attendu, f"{label} : {r}"
    assert r["method"] == "natural-earth-50m"
    # Aucun point de contrôle ne tombe dans deux polygones : le jeu ne se chevauche pas.
    assert r["ambiguous"] is False
    if attendu == "XX":
        assert r["candidates"] == []
    else:
        assert r["candidates"] == [attendu]


def test_point_hors_couverture_sans_substitution() -> None:
    r = fr.resoudre_pays(-30.0, 20.0)
    assert r == dict(fr.NON_DETERMINE)


def test_nan_rendu_non_determine() -> None:
    assert fr.resoudre_pays(float("nan"), 0.0)["iso2"] == "XX"


def test_le_moteur_consigne_la_methode_et_ne_classe_pas_le_risque() -> None:
    detail = sc.resolve_country_detail(2.3522, 48.8566)
    assert detail["iso2"] == "FR"
    assert detail["method"] == "natural-earth-50m"
    assert detail["risk"] == "UNKNOWN", "aucun benchmark officiel versionné : le risque n'est pas inventé"


def test_referentiel_absent_rend_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def _absent(_lon: float, _lat: float):
        raise fr.FrontieresIndisponibles("test : fichier retiré")

    monkeypatch.setattr(fr, "resoudre_pays", _absent)
    detail = sc.resolve_country_detail(2.3522, 48.8566)
    assert detail["iso2"] == "XX" and detail["method"] == "unavailable"
