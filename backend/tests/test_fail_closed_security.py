"""Régressions P0 : identité explicite et démarrage fermé en cas de panne DB."""
import sqlite3

import pytest
from pydantic import ValidationError

from app.core.database import Database
from app.models.schemas import OperatorInfo, ParcelAuditRequest


def test_eori_fictif_est_rejete():
    with pytest.raises(ValidationError, match="identité opérateur fictive"):
        OperatorInfo(name="Opérateur de test", eori="XX0000000000000", country="XX")


def test_identite_operateur_est_obligatoire_dans_une_demande_audit():
    with pytest.raises(ValidationError, match="operator"):
        ParcelAuditRequest(
            geojson={"type": "Point", "coordinates": [2.0, 48.0]},
            commodity="coffee",
            harvest_date="2024-03-15",
        )


def test_base_refuse_le_marqueur_eori_fictif():
    db = Database(__import__("pathlib").Path(":memory:"))
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        db._conn.execute(
            """
            INSERT INTO parcel_audits (
                id, created_at, operator_name, operator_eori, commodity, hs_code,
                harvest_date, geometry_json, geometry_type, area_ha, vertex_count,
                centroid_lon, centroid_lat, country_code, country_risk, risk_level,
                status, validation_json, satellite_json
            ) VALUES (
                'audit-test', '2026-10-21T00:00:00+00:00', 'Opérateur fictif',
                'XX0000000000000', 'coffee', '0901', '2024-03-15', '{}',
                'Point', 0, 1, 2, 48, 'XX', 'UNKNOWN', 'UNKNOWN',
                'ANALYSIS_UNAVAILABLE', '{}', '{}'
            )
            """
        )


def test_echec_initialisation_db_interrompt_sans_fallback_tmp(monkeypatch, tmp_path):
    def echec_connexion(*args, **kwargs):
        raise sqlite3.OperationalError("disque indisponible")

    monkeypatch.setattr(sqlite3, "connect", echec_connexion)
    chemin = tmp_path / "base" / "geoforest.sqlite"
    with pytest.raises(RuntimeError, match="démarrage refusé"):
        Database(chemin)
    assert not (tmp_path / "geoforest.sqlite").exists()
