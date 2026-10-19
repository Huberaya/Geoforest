"""Lot A — identité de l'opérateur : trois états, jamais confondus.

Ce que ces tests verrouillent, et pourquoi chacun existe :

* la route d'audit ne **fabrique plus** d'identité pour un opérateur absent
  (elle écrivait « Opérateur non renseigné » / ``XX0000000000000`` / ``XX``) ;
* l'export **refuse** un dossier sans identité exploitable, en distinguant
  « absente » de « valeur de remplissage héritée » ;
* un dossier historique n'est **ni réécrit ni supprimé** : il est reconnu ;
* la migration d'une base antérieure conserve toutes les lignes, y compris
  lorsqu'une colonne de l'ancien schéma n'existe plus dans le nouveau ;
* un échec de migration laisse la base **exactement** dans son état d'avant.
"""
from __future__ import annotations

import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

# Le jeton est lu par `settings` au moment de l'appel : il doit être posé avant
# l'import des modules qui figent la configuration.
JETON_DE_TEST = "jeton-de-test-" + "a" * 24
os.environ["GF_BACKEND_API_TOKEN"] = JETON_DE_TEST  # noqa: E402

from app.core import database as module_base  # noqa: E402
from app.core.database import Database, reset_db_for_tests  # noqa: E402
from app.main import app  # noqa: E402
from app.models.sql_models import CREATE_TABLES_SQL  # noqa: E402
from app.services.identite_operateur import (  # noqa: E402
    EORI_PLACEHOLDER_HISTORIQUE,
    classer_identite_operateur,
)

#: Parcelle de café ~1,3 ha (Yirgacheffe, Éthiopie) — même géométrie que la
#: suite principale, pour que seule la question de l'identité varie.
POLY = {
    "type": "Polygon",
    "coordinates": [
        [
            [38.201234, 6.161234],
            [38.202334, 6.161234],
            [38.202334, 6.162334],
            [38.201234, 6.162334],
            [38.201234, 6.161234],
        ]
    ],
}


@pytest.fixture()
def analyse_probante(monkeypatch: pytest.MonkeyPatch):
    """Rend l'analyse satellite probante, sans aucun appel réseau.

    Ce n'est pas une validation externe : c'est un *stub* local, pour que la
    question testée reste l'identité de l'opérateur et non l'accès GFW.
    """
    from app.api.v1 import endpoints as module_endpoints

    monkeypatch.setattr(
        module_endpoints,
        "check_deforestation_risk",
        lambda _geojson, _date: {
            "compliant": True,
            "loss_year": None,
            "confidence_score": 0.9,
            "risk_level": "UNKNOWN",
            "country_code": "ET",
            "country_name": "Éthiopie",
            "country_risk": "UNKNOWN",
            "source": "gfw-live",
            "is_probative": True,
            "evidence": {
                "provider": "stub-local (aucun appel réseau)",
                "dataset": "test",
                "dataset_version": "v0",
                "endpoint": "stub://local",
                "sql": "stub",
                "geometry_type": "Polygon",
                "retrieved_at": "2026-10-19T00:00:00+00:00",
            },
            "disclaimer": None,
            "loss_area_ha": 0.0,
            "tree_cover_2000_pct": None,
            "details": "stub local — aucune validation externe",
        },
    )

OPERATEUR = {
    "name": "Café Import SAS",
    "eori": "FR12345678901234",
    "country": "FR",
    "address": "1 rue du Port, 76600 Le Havre",
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {JETON_DE_TEST}"})


@pytest.fixture()
def base_isolee():
    """Base temporaire propre au test, sans toucher à la base partagée."""
    dossier = tempfile.TemporaryDirectory()
    base = reset_db_for_tests(str(Path(dossier.name) / "lot-a.db"))
    yield base
    dossier.cleanup()


def _payload(**extra: Any) -> Dict[str, Any]:
    corps: Dict[str, Any] = {"geojson": POLY, "commodity": "coffee", "harvest_date": "2024-03-15"}
    corps.update(extra)
    return corps


# --------------------------------------------------------------------------- 0. Classement
class TestClassementIdentite:
    """Le classement est la règle unique : interface, API et export s'y réfèrent."""

    @pytest.mark.parametrize(
        "nom,eori,attendu",
        [
            ("Café Import SAS", "FR12345678901234", "declared"),
            (None, None, "missing"),
            (None, "", "missing"),
            ("Café Import SAS", None, "missing"),
            ("Opérateur non renseigné", EORI_PLACEHOLDER_HISTORIQUE, "legacy_placeholder"),
            ("Autre nom", EORI_PLACEHOLDER_HISTORIQUE, "legacy_placeholder"),
            # Sentinelle, pas identifiant : la casse ne doit pas suffire à la
            # faire passer pour une identité déclarée.
            ("Autre nom", "xx0000000000000", "legacy_placeholder"),
            ("Autre nom", "  XX0000000000000  ", "legacy_placeholder"),
            # EORI présent mais nom inexploitable : pas une identité déclarable.
            ("", "FR12345678901234", "missing"),
            ("A", "FR12345678901234", "missing"),
        ],
    )
    def test_trois_etats(self, nom, eori, attendu) -> None:
        assert classer_identite_operateur(nom, eori).etat == attendu

    def test_seul_declared_est_exportable(self) -> None:
        for nom, eori in [(None, None), ("X", EORI_PLACEHOLDER_HISTORIQUE), ("A", "FR12345678901234")]:
            assert classer_identite_operateur(nom, eori).exportable is False
        assert classer_identite_operateur("Café Import SAS", "FR12345678901234").exportable is True

    def test_la_valeur_heritee_est_reconnue_sans_etre_modifiee(self) -> None:
        """Reconnaître n'est pas réécrire : la valeur ressort inchangée."""
        resultat = classer_identite_operateur("Opérateur non renseigné", EORI_PLACEHOLDER_HISTORIQUE)
        assert resultat.etat == "legacy_placeholder"
        assert EORI_PLACEHOLDER_HISTORIQUE == "XX0000000000000"


# --------------------------------------------------------------------------- 1. Création
class TestCreationSansIdentite:
    def test_identite_absente_n_est_pas_fabriquee(self, client: TestClient, base_isolee) -> None:
        reponse = client.post("/api/v1/audit/parcel", json=_payload())
        assert reponse.status_code == 201, reponse.text
        audit_id = reponse.json()["audit_id"]

        enregistre = base_isolee.get_audit(audit_id)
        assert enregistre is not None
        assert enregistre.operator_name is None
        assert enregistre.operator_eori is None
        assert enregistre.operator_country is None

    def test_identite_absente_n_apparait_pas_dans_le_corps(self, client: TestClient, base_isolee) -> None:
        """Aucune trace du triplet de remplissage nulle part dans la réponse."""
        reponse = client.post("/api/v1/audit/parcel", json=_payload())
        corps = reponse.text
        assert EORI_PLACEHOLDER_HISTORIQUE not in corps
        assert "Opérateur non renseigné" not in corps

    def test_identite_reelle_est_conservee(self, client: TestClient, base_isolee) -> None:
        reponse = client.post("/api/v1/audit/parcel", json=_payload(operator=OPERATEUR))
        assert reponse.status_code == 201, reponse.text
        enregistre = base_isolee.get_audit(reponse.json()["audit_id"])
        assert enregistre.operator_name == "Café Import SAS"
        assert enregistre.operator_eori == "FR12345678901234"
        assert enregistre.operator_country == "FR"

    def test_identite_invalide_est_refusee(self, client: TestClient, base_isolee) -> None:
        reponse = client.post("/api/v1/audit/parcel", json=_payload(operator={"name": "X", "eori": "123"}))
        assert reponse.status_code == 422

    def test_pays_d_operateur_non_declare_reste_nul(self, client: TestClient, base_isolee) -> None:
        """`FR` n'est plus écrit par défaut quand l'opérateur ne déclare pas de pays."""
        reponse = client.post(
            "/api/v1/audit/parcel",
            json=_payload(operator={"name": "Sans Pays", "eori": "SE12345678901234"}),
        )
        assert reponse.status_code == 201, reponse.text
        enregistre = base_isolee.get_audit(reponse.json()["audit_id"])
        assert enregistre.operator_country is None


# --------------------------------------------------------------------------- 2. Export
class TestExportIdentite:
    def _creer(self, client: TestClient, **extra: Any) -> str:
        reponse = client.post("/api/v1/audit/parcel", json=_payload(**extra))
        assert reponse.status_code == 201, reponse.text
        return reponse.json()["audit_id"]

    def test_export_refuse_sans_identite(self, client: TestClient, base_isolee, analyse_probante) -> None:
        audit_id = self._creer(client)
        reponse = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"})
        assert reponse.status_code == 422, reponse.text
        corps = reponse.json()["detail"]
        assert corps["code"] == "OPERATOR_IDENTITY_MISSING"
        assert corps["operator_identity"] == "missing"

    def test_export_accepte_une_identite_fournie_a_l_export(self, client: TestClient, base_isolee, analyse_probante) -> None:
        """Le dossier peut être complété au moment de l'export, sans réécrire l'audit."""
        audit_id = self._creer(client)
        reponse = client.post(
            "/api/v1/export/traces",
            json={"audit_id": audit_id, "format": "json", "operator": OPERATEUR},
        )
        assert reponse.status_code == 200, reponse.text
        # L'audit lui-même reste sans identité : l'export ne le modifie pas.
        assert base_isolee.get_audit(audit_id).operator_eori is None

    def test_export_accepte_un_dossier_renseigne(self, client: TestClient, base_isolee, analyse_probante) -> None:
        audit_id = self._creer(client, operator=OPERATEUR)
        reponse = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"})
        assert reponse.status_code == 200, reponse.text
        assert EORI_PLACEHOLDER_HISTORIQUE not in reponse.text

    def test_dossier_historique_refuse_et_signale(self, client: TestClient, base_isolee, analyse_probante) -> None:
        """Un dossier hérité est refusé avec son état exact, et reste intact."""
        from app.models.sql_models import ParcelAuditRecord

        historique = ParcelAuditRecord(
            id="historique-1",
            created_at="2026-01-01T00:00:00+00:00",
            operator_name="Opérateur non renseigné",
            operator_eori=EORI_PLACEHOLDER_HISTORIQUE,
            operator_country="XX",
            commodity="coffee",
            hs_code="0901",
            harvest_date="2024-03-15",
            geometry=POLY,
            geometry_type="Polygon",
            area_ha=1.48,
            vertex_count=5,
            centroid_lon=-5.0,
            centroid_lat=5.0002,
            country_code="XX",
            country_risk="UNKNOWN",
            compliant=None,
            loss_year=None,
            confidence_score=0.9,
            risk_level="UNKNOWN",
            status="COMPLIANT",
            analysis_source="gfw",
            analysis_probative=True,
        )
        base_isolee.insert_audit(historique)

        reponse = client.post("/api/v1/export/traces", json={"audit_id": "historique-1", "format": "json"})
        assert reponse.status_code == 422, reponse.text
        corps = reponse.json()["detail"]
        assert corps["code"] == "OPERATOR_IDENTITY_MISSING"
        assert corps["operator_identity"] == "legacy_placeholder"
        # Le refus ne modifie pas la donnée héritée.
        assert base_isolee.get_audit("historique-1").operator_eori == EORI_PLACEHOLDER_HISTORIQUE

    def test_analyse_non_probante_reste_refusee_en_409(self, client: TestClient, base_isolee) -> None:
        """Le 422 ne doit pas se substituer aux 409 existants.

        Un dossier sans identité **et** sans analyse probante reste refusé pour
        la raison historique : le contrôle d'identité s'ajoute après, il ne
        remplace rien.
        """
        audit_id = self._creer(client)  # sans analyse probante (fixture non utilisée ici)
        reponse = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"})
        assert reponse.status_code == 409, reponse.text
        assert "analyse satellite" in reponse.text

    def test_export_xml_refuse_aussi_sans_identite(self, client: TestClient, base_isolee, analyse_probante) -> None:
        """Le second format ne contourne pas la règle."""
        audit_id = self._creer(client)
        reponse = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "xml"})
        assert reponse.status_code == 422, reponse.text


# --------------------------------------------------------------------------- 3. Migration
class TestMigrationIdentite:
    """Reconstruction d'une base antérieure : NOT NULL, pas de colonne pays."""

    def _base_ancienne(self, chemin: Path, extra_col: str = "") -> None:
        from app.models.sql_models import CREATE_TABLES_SQL

        ancien = CREATE_TABLES_SQL.replace(
            "operator_name    TEXT,", "operator_name    TEXT NOT NULL,"
        ).replace(
            "operator_eori    TEXT,", "operator_eori    TEXT NOT NULL,"
        ).replace(
            "    operator_country TEXT,\n", ""
        )
        if extra_col:
            ancien = ancien.replace(
                "    commodity        TEXT NOT NULL,",
                f"    {extra_col} TEXT,\n    commodity        TEXT NOT NULL,",
            )
        conn = sqlite3.connect(chemin)
        conn.executescript(ancien)
        conn.execute(
            """
            INSERT INTO parcel_audits (
                id, created_at, operator_name, operator_eori, commodity, hs_code,
                harvest_date, geometry_json, geometry_type, area_ha, vertex_count,
                centroid_lon, centroid_lat, country_code, country_risk, compliant,
                analysis_source, analysis_probative, risk_level, status,
                validation_json, satellite_json
            ) VALUES (
                'ancien-1', '2026-01-01T00:00:00+00:00', 'Opérateur non renseigné',
                'XX0000000000000', 'coffee', '0901', '2024-03-15', '{}', 'Polygon',
                1.0, 5, 38.0, 6.0, 'XX', 'UNKNOWN', NULL,
                'unavailable', 0, 'UNKNOWN', 'ANALYSIS_UNAVAILABLE', '{}', '{}'
            )
            """
        )
        conn.commit()
        conn.close()

    def test_migration_conserve_les_lignes_et_autorise_l_absence(self, tmp_path: Path) -> None:
        from app.models.sql_models import ParcelAuditRecord

        chemin = tmp_path / "ancienne.db"
        self._base_ancienne(chemin)

        base = Database(chemin)

        enregistre = base.get_audit("ancien-1")
        assert enregistre is not None
        # Valeur héritée conservée telle quelle : aucune réécriture d'office.
        assert enregistre.operator_eori == EORI_PLACEHOLDER_HISTORIQUE

        # La contrainte est levée : un dossier sans identité s'insère.
        base.insert_audit(
            ParcelAuditRecord(
                id="nouveau-1",
                created_at="2026-10-19T00:00:00+00:00",
                operator_name=None,
                operator_eori=None,
                commodity="coffee",
                hs_code="0901",
                harvest_date="2024-03-15",
                geometry=POLY,
                geometry_type="Polygon",
                area_ha=1.48,
                vertex_count=5,
                centroid_lon=-5.0,
                centroid_lat=5.0002,
                country_code="XX",
                country_risk="UNKNOWN",
                compliant=None,
                loss_year=None,
                confidence_score=None,
                risk_level="UNKNOWN",
                status="ANALYSIS_UNAVAILABLE",
            )
        )
        assert base.get_audit("nouveau-1").operator_eori is None
        assert base.get_audit("ancien-1") is not None

    def test_migration_tolere_une_colonne_absente_du_schema_cible(self, tmp_path: Path) -> None:
        chemin = tmp_path / "avec_colonne.db"
        self._base_ancienne(chemin, extra_col="operator_address")
        conn = sqlite3.connect(chemin)
        conn.execute("UPDATE parcel_audits SET operator_address = '12 rue des Fleurs'")
        conn.commit()
        conn.close()

        base = Database(chemin)

        assert base.get_audit("ancien-1") is not None
        conn = sqlite3.connect(chemin)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        conn.close()
        assert "parcel_audits_avant_lot_a" not in tables

    def test_migration_idempotente(self, tmp_path: Path) -> None:
        chemin = tmp_path / "idem.db"
        self._base_ancienne(chemin)
        Database(chemin)
        Database(chemin)

        conn = sqlite3.connect(chemin)
        n = conn.execute("SELECT COUNT(*) FROM parcel_audits").fetchone()[0]
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        colonnes = {r[1]: r[3] for r in conn.execute("PRAGMA table_info(parcel_audits)")}
        conn.close()
        assert n == 1
        assert "parcel_audits_avant_lot_a" not in tables
        # `notnull` vaut 0 : la contrainte est bien levée.
        assert colonnes["operator_eori"] == 0
        assert "operator_country" in colonnes

    def test_migration_annulee_laisse_la_base_intacte(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Un échec en cours de route doit tout annuler — jamais vider la table.

        L'échec est forcé par un déclencheur qui refuse toute insertion dans la
        nouvelle table. Ce que l'on vérifie n'est pas l'échec, mais son effet :
        la base reste exactement dans l'état d'avant, données comprises.
        """
        chemin = tmp_path / "echec.db"
        self._base_ancienne(chemin)

        monkeypatch.setattr(
            module_base,
            "CREATE_TABLES_SQL",
            CREATE_TABLES_SQL
            + """
            CREATE TRIGGER refus_test BEFORE INSERT ON parcel_audits
            BEGIN SELECT RAISE(ABORT, 'échec forcé par le test'); END;
            """,
        )
        with pytest.raises(Exception):
            module_base.Database(chemin)

        conn = sqlite3.connect(chemin)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        colonnes = [r[1] for r in conn.execute("PRAGMA table_info(parcel_audits)")]
        n = conn.execute("SELECT COUNT(*) FROM parcel_audits").fetchone()[0]
        conn.close()

        assert "parcel_audits_avant_lot_a" not in tables
        assert "operator_eori" in colonnes
        assert n == 1, f"données perdues : {n} ligne(s), tables={tables}"
