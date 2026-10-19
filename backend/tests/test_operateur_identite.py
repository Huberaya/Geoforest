"""P2-15 — identité de l'opérateur : jamais fabriquée.

Avant correctif, la route d'audit remplaçait une identité absente par
`{ nom: "Opérateur non renseigné", eori: "XX0000000000000", pays: "XX" }`.
Ce triplet était persisté, repris dans l'historique et dans l'export : une fois
en base, rien ne le distinguait d'une identité réelle.

Ces tests vérifient les quatre états que la mission demande de séparer :
  * identité réelle vérifiée ;
  * identité inconnue ou non renseignée ;
  * donnée invalide (refusée au contrat) ;
  * dossier historique portant la valeur de remplissage (ni effacé ni réécrit).
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import Database  # noqa: E402
from app.main import app  # noqa: E402
from app.models.sql_models import ParcelAuditRecord  # noqa: E402

OPERATOR = {"name": "Coopérative Test", "eori": "FR12345678901234", "country": "FR"}
PLACEHOLDER = "XX0000000000000"

POLY = {
    "type": "Polygon",
    "coordinates": [[
        [38.201234, 6.161234], [38.202334, 6.161234],
        [38.202334, 6.162334], [38.201234, 6.162334], [38.201234, 6.161234],
    ]],
}


def _client(monkeypatch: pytest.MonkeyPatch, chemin: Path) -> TestClient:
    """Client dont la base est isolée dans un fichier temporaire."""
    import app.api.v1.endpoints as endpoints

    base = Database(chemin)
    app.dependency_overrides[endpoints.get_db] = lambda: base
    # Aucune source satellite : le statut reste ANALYSIS_UNAVAILABLE partout,
    # ce qui n'a pas d'incidence sur l'identité, objet de ce fichier.
    object.__setattr__(endpoints.settings, "gfw_live_enabled", False)
    object.__setattr__(endpoints.settings, "gfw_demo_mode", False)
    return TestClient(app)


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    with tempfile.TemporaryDirectory() as dossier:
        yield _client(monkeypatch, Path(dossier) / "audits.db")
    app.dependency_overrides.clear()


def _auditer(client: TestClient, operator=None):
    corps = {
        "geojson": POLY,
        "commodity": "coffee",
        "harvest_date": "2024-03-15",
    }
    if operator is not None:
        corps["operator"] = operator
    return client.post("/api/v1/audit/parcel", json=corps)


class TestCreation:
    def test_identite_absente_n_est_pas_fabriquee(self, client: TestClient) -> None:
        """Aucun EORI de remplissage ne doit apparaître dans la réponse."""
        response = _auditer(client)
        assert response.status_code == 201, response.text
        corps = response.json()

        assert corps["operator"] is None
        assert corps["operator_identity"] == "missing"
        # Le contrôle décisif : la valeur fabriquée ne doit exister nulle part
        # dans la réponse sérialisée.
        assert PLACEHOLDER not in response.text
        assert "Opérateur non renseigné" not in response.text

    def test_identite_absente_est_persistee_comme_nulle(self, client: TestClient) -> None:
        audit_id = _auditer(client).json()["audit_id"]
        lu = client.get(f"/api/v1/audits/{audit_id}").json()

        assert lu["operator_name"] is None
        assert lu["operator_eori"] is None
        assert lu["operator_country"] is None

    def test_identite_reelle_est_conservee(self, client: TestClient) -> None:
        corps = _auditer(client, OPERATOR).json()
        assert corps["operator_identity"] == "declared"
        assert corps["operator"]["eori"] == "FR12345678901234"

        lu = client.get(f"/api/v1/audits/{corps['audit_id']}").json()
        assert lu["operator_eori"] == "FR12345678901234"
        assert lu["operator_country"] == "FR"

    def test_identite_invalide_est_refusee(self, client: TestClient) -> None:
        """Une donnée invalide n'est ni corrigée ni remplacée : elle est refusée."""
        assert _auditer(client, {"name": "X", "eori": "FR123"}).status_code == 422
        assert _auditer(client, {"name": "Valide SA", "eori": "123"}).status_code == 422
        assert _auditer(client, {"name": "", "eori": "FR1234"}).status_code == 422
        # Les espaces sont une tolérance de saisie documentée, pas une invention :
        # l'EORI est normalisé, et c'est bien la valeur normalisée qui est
        # persistée — jamais une valeur fabriquée.
        normalise = _auditer(client, {"name": "Valide SA", "eori": "FR 12 34"})
        assert normalise.status_code == 201
        assert normalise.json()["operator"]["eori"] == "FR1234"


class TestLecture:
    def test_historique_accepte_un_nom_absent(self, client: TestClient) -> None:
        """La liste ne doit pas échouer sur un dossier sans identité."""
        _auditer(client)
        response = client.get("/api/v1/audits")
        assert response.status_code == 200
        assert response.json()[0]["operator_name"] is None


class TestExport:
    def _rendre_probant(self, audit_id: str, base: Database) -> None:
        """Force le caractère probant pour isoler le contrôle d'identité.

        Le refus d'export pour analyse non probante (P0-04) est vérifié
        ailleurs ; ici, on veut savoir ce que fait l'export *d'identité*.
        """
        with base.cursor() as cur:
            cur.execute(
                "UPDATE parcel_audits SET analysis_probative = 1, analysis_source = 'gfw-live' WHERE id = ?",
                (audit_id,),
            )

    def test_export_refuse_sans_identite(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Une déclaration sans opérateur identifiable ne doit pas être émise."""
        import app.api.v1.endpoints as endpoints

        with tempfile.TemporaryDirectory() as dossier:
            base = Database(Path(dossier) / "audits.db")
            app.dependency_overrides[endpoints.get_db] = lambda: base
            object.__setattr__(endpoints.settings, "gfw_live_enabled", False)
            object.__setattr__(endpoints.settings, "gfw_demo_mode", False)
            client = TestClient(app)

            audit_id = _auditer(client).json()["audit_id"]
            self._rendre_probant(audit_id, base)

            response = client.post(
                "/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"}
            )
            assert response.status_code == 422, response.text
            assert "identité de l'opérateur" in response.json()["detail"]
            assert PLACEHOLDER not in response.text

            # Fournir l'identité au moment de l'export reste possible : c'est une
            # donnée déclarative, pas une donnée d'analyse.
            fourni = client.post(
                "/api/v1/export/traces",
                json={"audit_id": audit_id, "format": "json", "operator": OPERATOR},
            )
            assert fourni.status_code == 200, fourni.text
            assert "FR12345678901234" in fourni.text
        app.dependency_overrides.clear()

    def test_export_ne_devine_pas_le_pays_d_activite(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Sans pays d'activité ni pays d'opérateur, aucune nationalité inventée."""
        import app.api.v1.endpoints as endpoints

        with tempfile.TemporaryDirectory() as dossier:
            base = Database(Path(dossier) / "audits.db")
            app.dependency_overrides[endpoints.get_db] = lambda: base
            object.__setattr__(endpoints.settings, "gfw_live_enabled", False)
            object.__setattr__(endpoints.settings, "gfw_demo_mode", False)
            client = TestClient(app)

            audit_id = _auditer(client).json()["audit_id"]
            self._rendre_probant(audit_id, base)

            # L'EORI porte le pays : FR. Le pays d'activité doit venir de là,
            # jamais d'un « FR » codé en dur indépendant de l'opérateur.
            response = client.post(
                "/api/v1/export/traces",
                json={"audit_id": audit_id, "format": "json", "operator": {
                    "name": "Operateur Belge", "eori": "BE12345678901234", "country": "BE"}},
            )
            assert response.status_code == 200, response.text
            assert "country_of_activity" in response.text
            assert '"country_of_activity": "BE"' in response.text
        app.dependency_overrides.clear()


class TestDossierHistorique:
    """Un dossier antérieur au correctif n'est ni effacé ni réécrit."""

    def _base_ancienne(self, chemin: Path) -> None:
        """Recrée le schéma d'avant P2-15 (colonnes NOT NULL)."""
        import sqlite3

        from app.models.sql_models import CREATE_TABLES_SQL

        ancien = CREATE_TABLES_SQL.replace("operator_name    TEXT,", "operator_name    TEXT NOT NULL,")
        ancien = ancien.replace("operator_eori    TEXT,", "operator_eori    TEXT NOT NULL,")
        ancien = ancien.replace("operator_country TEXT,\n", "")
        conn = sqlite3.connect(chemin)
        conn.executescript(ancien)
        conn.execute(
            """
            INSERT INTO parcel_audits (
                id, created_at, operator_name, operator_eori, commodity, hs_code,
                harvest_date, geometry_json, geometry_type, area_ha, vertex_count,
                centroid_lon, centroid_lat, country_code, country_risk, compliant,
                loss_year, confidence_score, analysis_source, analysis_probative,
                analysis_evidence, risk_level, status, validation_json, satellite_json
            ) VALUES (
                'ancien-1', '2026-01-01T00:00:00+00:00', 'Opérateur non renseigné',
                'XX0000000000000', 'coffee', '0901', '2024-03-15', '{}', 'Polygon',
                1.0, 5, 38.0, 6.0, 'XX', 'STANDARD', NULL, NULL, NULL, 'unavailable',
                0, NULL, 'STANDARD', 'ANALYSIS_UNAVAILABLE', '{}', '{}'
            )
            """
        )
        conn.commit()
        conn.close()

    def test_migration_conserve_les_lignes_et_autorise_l_absence(self, tmp_path: Path) -> None:
        chemin = tmp_path / "ancienne.db"
        self._base_ancienne(chemin)

        base = Database(chemin)  # applique la reconstruction

        with base.cursor() as cur:
            cur.execute("SELECT operator_eori FROM parcel_audits WHERE id = 'ancien-1'")
            # Valeur héritée conservée telle quelle : pas de réécriture d'office.
            assert cur.fetchone()["operator_eori"] == PLACEHOLDER

        # La contrainte est bien levée : un dossier sans identité s'insère.
        base.insert_audit(
            ParcelAuditRecord(
                id="nouveau-1",
                created_at="2026-10-19T00:00:00+00:00",
                operator_name=None,
                operator_eori=None,
                commodity="coffee",
                hs_code="0901",
                harvest_date="2024-03-15",
                geometry={"type": "Polygon", "coordinates": [[]]},
                geometry_type="Polygon",
                area_ha=1.0,
                vertex_count=0,
                centroid_lon=0.0,
                centroid_lat=0.0,
                country_code="XX",
                country_risk="STANDARD",
                compliant=None,
                loss_year=None,
                confidence_score=None,
                risk_level="STANDARD",
                status="ANALYSIS_UNAVAILABLE",
                validation={},
                satellite={},
            )
        )
        assert base.get_audit("nouveau-1").operator_eori is None
        assert base.get_audit("ancien-1") is not None

    def test_migration_idempotente(self, tmp_path: Path) -> None:
        chemin = tmp_path / "ancienne.db"
        self._base_ancienne(chemin)
        Database(chemin)
        Database(chemin)  # ne doit ni lever ni dupliquer

        import sqlite3

        conn = sqlite3.connect(chemin)
        n = conn.execute("SELECT COUNT(*) FROM parcel_audits").fetchone()[0]
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        conn.close()
        assert n == 1
        assert "parcel_audits_avant_p2_15" not in tables

    # ------------------------------------------------------------------ P3-03
    # La reconstruction n'était ni atomique ni tolérante. Mesuré : sur une base
    # dont la table portait une colonne absente du schéma cible, la copie
    # échouait APRÈS le renommage, laissant `parcel_audits` vide et les données
    # orphelines. Ces trois tests verrouillent les trois propriétés.

    def test_migration_tolere_une_colonne_absente_du_schema_cible(self, tmp_path: Path) -> None:
        """Une colonne en trop côté ancien ne doit pas faire échouer la migration."""
        import sqlite3

        chemin = tmp_path / "avec_colonne.db"
        self._base_ancienne(chemin)
        conn = sqlite3.connect(chemin)
        conn.execute("ALTER TABLE parcel_audits ADD COLUMN operator_address TEXT")
        conn.execute("UPDATE parcel_audits SET operator_address = '12 rue des Fleurs'")
        conn.commit()
        conn.close()

        base = Database(chemin)

        with base.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n, MAX(operator_eori) AS e FROM parcel_audits")
            ligne = cur.fetchone()
        assert ligne["n"] == 1
        assert ligne["e"] == PLACEHOLDER

        conn = sqlite3.connect(chemin)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        conn.close()
        assert "parcel_audits_avant_p2_15" not in tables

    def test_migration_annulee_laisse_la_base_intacte(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Un échec en cours de route doit tout annuler, jamais vider la table.

        On force l'échec par un déclencheur qui refuse toute insertion dans la
        nouvelle table. Ce que l'on vérifie n'est pas l'échec, mais son
        **effet** : la base reste exactement dans l'état d'avant, données
        comprises.
        """
        import sqlite3

        import app.core.database as module_base
        from app.models.sql_models import CREATE_TABLES_SQL

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
            Database(chemin)

        conn = sqlite3.connect(chemin)
        conn.row_factory = sqlite3.Row
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        colonnes = [r[1] for r in conn.execute("PRAGMA table_info(parcel_audits)")]
        n = conn.execute("SELECT COUNT(*) FROM parcel_audits").fetchone()[0]
        conn.close()

        # Aucun renommage résiduel, aucune table vide à la place des données.
        assert "parcel_audits_avant_p2_15" not in tables
        assert "operator_eori" in colonnes
        assert n == 1, f"les données ont été perdues : {n} ligne(s), tables={tables}"

    def test_migration_verifie_le_nombre_de_lignes(self, tmp_path: Path) -> None:
        """La suppression de l'ancienne table n'a lieu qu'après comparaison."""
        import sqlite3

        chemin = tmp_path / "compte.db"
        self._base_ancienne(chemin)
        conn = sqlite3.connect(chemin)
        conn.execute(
            """INSERT INTO parcel_audits (
                id, created_at, operator_name, operator_eori, commodity, hs_code,
                harvest_date, geometry_json, geometry_type, area_ha, vertex_count,
                centroid_lon, centroid_lat, country_code, country_risk, compliant,
                analysis_source, analysis_probative, risk_level, status,
                validation_json, satellite_json
            ) VALUES (
                'ancien-2', '2026-01-02T00:00:00+00:00', 'Coop', 'CI1234567890123',
                'coffee', '0901', '2024-03-15', '{}', 'Polygon', 1.0, 5, 38.0, 6.0,
                'CI', 'LOW', 1, 'gfw', 1, 'LOW', 'COMPLIANT', '{}', '{}'
            )"""
        )
        conn.commit()
        conn.close()

        base = Database(chemin)

        with base.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM parcel_audits")
            assert cur.fetchone()["n"] == 2

    def test_dossier_historique_refuse_a_l_export(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Le sentinelle hérité est traité comme une identité inconnue."""
        import app.api.v1.endpoints as endpoints

        with tempfile.TemporaryDirectory() as dossier:
            chemin = Path(dossier) / "ancienne.db"
            self._base_ancienne(chemin)
            base = Database(chemin)
            with base.cursor() as cur:
                cur.execute(
                    "UPDATE parcel_audits SET analysis_probative = 1, analysis_source = 'gfw-live'"
                )
            app.dependency_overrides[endpoints.get_db] = lambda: base
            object.__setattr__(endpoints.settings, "gfw_live_enabled", False)
            object.__setattr__(endpoints.settings, "gfw_demo_mode", False)
            client = TestClient(app)

            response = client.post(
                "/api/v1/export/traces", json={"audit_id": "ancien-1", "format": "json"}
            )
            assert response.status_code == 422, response.text
            assert PLACEHOLDER not in response.text
        app.dependency_overrides.clear()


class TestFrontieresIndisponibles:
    """P2-16 — sans frontières, aucune attribution ; l'analyse est refusée."""

    def test_absence_de_frontieres_refuse_l_analyse(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from unittest.mock import patch

        from app.services import satellite_checker as sc
        from app.services.frontieres import FrontieresIndisponibles

        with patch.object(sc, "resoudre_pays", side_effect=FrontieresIndisponibles("fichier absent")):
            resultat = sc.check_deforestation_risk(POLY, "2024-06-01")

        assert resultat["source"] == "unavailable"
        assert resultat["compliant"] is None
        assert resultat["is_probative"] is False
        assert resultat["country_code"] == "XX"
        assert resultat["risk_level"] == "STANDARD"
        assert "frontières indisponible" in resultat["provenance"]["limits"][0]
