"""Le backend ne doit jamais masquer une panne DB en basculant vers /tmp."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core import database as module_database
from app.core.database import Database
from app import main as module_main


def test_echec_connexion_db_interrompt_sans_tenter_un_autre_chemin(monkeypatch, tmp_path: Path):
    appels: list[str] = []

    def echec(path, **kwargs):
        appels.append(str(path))
        raise sqlite3.OperationalError("base inaccessible")

    monkeypatch.setattr(module_database.sqlite3, "connect", echec)
    chemin_demande = tmp_path / "donnees" / "geoforest.sqlite"

    with pytest.raises(RuntimeError, match="démarrage refusé"):
        Database(chemin_demande)

    assert appels == [str(chemin_demande)]


def test_echec_creation_repertoire_interrompt_sans_fallback(monkeypatch, tmp_path: Path):
    parent_non_repertoire = tmp_path / "fichier"
    parent_non_repertoire.write_text("pas un dossier", encoding="utf-8")
    appels: list[str] = []

    def connexion_interdite(path, **kwargs):
        appels.append(str(path))
        raise AssertionError("sqlite3.connect ne doit pas être appelé")

    monkeypatch.setattr(module_database.sqlite3, "connect", connexion_interdite)

    with pytest.raises(RuntimeError, match="démarrage refusé"):
        Database(parent_non_repertoire / "geoforest.sqlite")

    assert appels == []


def test_lifespan_fastapi_refuse_de_demarrer_si_db_inaccessible(monkeypatch, tmp_path: Path):
    def echec_connexion(*args, **kwargs):
        raise sqlite3.OperationalError("base inaccessible")

    monkeypatch.setattr(module_database.sqlite3, "connect", echec_connexion)
    chemin = tmp_path / "donnees" / "geoforest.sqlite"
    monkeypatch.setattr(module_main, "get_db", lambda: Database(chemin))

    with pytest.raises(RuntimeError, match="démarrage refusé"):
        with TestClient(module_main.app):
            pytest.fail("le serveur ne doit pas démarrer avec une base indisponible")
