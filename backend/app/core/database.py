"""Couche de persistance légère (SQLite, bibliothèque standard).

Le backend stocke chaque audit de parcelle afin de pouvoir :
  * rejouer un export TRACES-NT à partir d'un identifiant d'audit,
  * fournir un historique au dashboard.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from app.core.config import settings
from app.models.sql_models import CREATE_TABLES_SQL, ParcelAuditRecord


class Database:
    """Wrapper thread-safe autour de sqlite3."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        if str(path) != ":memory:":
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
            except OSError:
                self._path = Path(f"/tmp/{path.name}")
        try:
            self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        except OSError:
            self._path = Path(f"/tmp/{path.name}")
            self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(CREATE_TABLES_SQL)
            self._migrer_identite_operateur()
            self._conn.commit()

    def _migrer_identite_operateur(self) -> None:
        """P2-15 — rend l'identité de l'opérateur facultative (SQLite).

        ⚠️ `CREATE TABLE IF NOT EXISTS` ne touche pas une table déjà créée : une
        base antérieure conserve donc `operator_eori NOT NULL`, et l'insertion
        d'un dossier sans identité échouerait. SQLite ne sait pas retirer une
        contrainte NOT NULL ; il faut reconstruire la table.

        La reconstruction suit la procédure officielle et **ne perd aucune
        ligne** : renommage, création au nouveau schéma, copie intégrale,
        suppression de l'ancienne. Les identités existantes sont copiées
        telles quelles — y compris la valeur de remplissage héritée, qui n'est
        ni effacée ni réécrite : sa reprise est une décision explicite (cf.
        `docs/VALIDATION_GEOFOREST_2026-10-19.md`).
        """
        colonnes = {
            ligne["name"]: ligne
            for ligne in self._conn.execute("PRAGMA table_info(parcel_audits)")
        }
        if not colonnes or "operator_eori" not in colonnes:
            return
        if not colonnes["operator_eori"]["notnull"]:
            return  # déjà migrée

        logger = logging.getLogger(__name__)
        logger.info("P2-15 : migration de parcel_audits (identité opérateur facultative)")

        noms = [ligne["name"] for ligne in self._conn.execute("PRAGMA table_info(parcel_audits)")]
        liste = ", ".join(f'"{nom}"' for nom in noms)

        self._conn.execute("ALTER TABLE parcel_audits RENAME TO parcel_audits_avant_p2_15")
        self._conn.executescript(CREATE_TABLES_SQL)
        self._conn.execute(
            f"INSERT INTO parcel_audits ({liste}) SELECT {liste} FROM parcel_audits_avant_p2_15"
        )
        self._conn.execute("DROP TABLE parcel_audits_avant_p2_15")
        logger.info("P2-15 : %s ligne(s) conservée(s)", self._conn.execute(
            "SELECT COUNT(*) AS n FROM parcel_audits"
        ).fetchone()["n"])

    @contextmanager
    def cursor(self) -> Iterator[sqlite3.Cursor]:
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.close()

    # ------------------------------------------------------------------ CRUD
    def insert_audit(self, record: ParcelAuditRecord) -> None:
        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO parcel_audits (
                    id, created_at, operator_name, operator_eori, operator_country, commodity, hs_code,
                    harvest_date, geometry_json, geometry_type, area_ha, vertex_count,
                    centroid_lon, centroid_lat, country_code, country_risk,
                    compliant, loss_year, confidence_score, analysis_source,
                    analysis_probative, analysis_evidence, risk_level, status,
                    validation_json, satellite_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.created_at,
                    record.operator_name,
                    record.operator_eori,
                    record.operator_country,
                    record.commodity,
                    record.hs_code,
                    record.harvest_date,
                    json.dumps(record.geometry),
                    record.geometry_type,
                    record.area_ha,
                    record.vertex_count,
                    record.centroid_lon,
                    record.centroid_lat,
                    record.country_code,
                    record.country_risk,
                    None if record.compliant is None else (1 if record.compliant else 0),
                    record.loss_year,
                    record.confidence_score,
                    record.analysis_source,
                    1 if record.analysis_probative else 0,
                    json.dumps(record.analysis_evidence) if record.analysis_evidence else None,
                    record.risk_level,
                    record.status,
                    json.dumps(record.validation),
                    json.dumps(record.satellite),
                ),
            )

    def get_audit(self, audit_id: str) -> Optional[ParcelAuditRecord]:
        with self.cursor() as cur:
            cur.execute("SELECT * FROM parcel_audits WHERE id = ?", (audit_id,))
            row = cur.fetchone()
        return self._row_to_record(row) if row else None

    def list_audits(self, limit: int = 50) -> List[ParcelAuditRecord]:
        with self.cursor() as cur:
            cur.execute(
                "SELECT * FROM parcel_audits ORDER BY created_at DESC LIMIT ?", (limit,)
            )
            rows = cur.fetchall()
        return [self._row_to_record(row) for row in rows]

    def mark_draft_generated(self, audit_id: str, reference: str) -> None:
        with self.cursor() as cur:
            cur.execute(
                # P0-06 : générer un fichier n'est pas transmettre une déclaration.
                # Le statut d'analyse (COMPLIANT / NON_COMPLIANT / …) est conservé :
                # l'écraser par « EXPORTED » effaçait l'information utile.
                "UPDATE parcel_audits SET draft_reference = ?, draft_generated_at = ? WHERE id = ?",
                (reference, datetime.now(timezone.utc).isoformat(timespec="seconds"), audit_id),
            )

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> ParcelAuditRecord:
        data: Dict[str, Any] = dict(row)
        return ParcelAuditRecord(
            id=data["id"],
            created_at=data["created_at"],
            operator_name=data["operator_name"],
            operator_eori=data["operator_eori"],
            operator_country=data.get("operator_country"),
            commodity=data["commodity"],
            hs_code=data["hs_code"],
            harvest_date=data["harvest_date"],
            geometry=json.loads(data["geometry_json"]),
            geometry_type=data["geometry_type"],
            area_ha=data["area_ha"],
            vertex_count=data["vertex_count"],
            centroid_lon=data["centroid_lon"],
            centroid_lat=data["centroid_lat"],
            country_code=data["country_code"],
            country_risk=data["country_risk"],
            # compliant peut être NULL : « pas de verdict » ≠ « non conforme ».
            compliant=(None if data["compliant"] is None else bool(data["compliant"])),
            loss_year=data["loss_year"],
            confidence_score=data["confidence_score"],
            analysis_source=data.get("analysis_source", "unavailable"),
            analysis_probative=bool(data.get("analysis_probative", 0)),
            analysis_evidence=(json.loads(data["analysis_evidence"]) if data.get("analysis_evidence") else None),
            draft_reference=data.get("draft_reference"),
            draft_generated_at=data.get("draft_generated_at"),
            risk_level=data["risk_level"],
            status=data["status"],
            validation=json.loads(data["validation_json"]),
            satellite=json.loads(data["satellite_json"]),
        )


_db_instance: Optional[Database] = None


def get_db() -> Database:
    """Dépendance FastAPI : instance unique de la base."""
    global _db_instance
    if _db_instance is None:
        _db_instance = Database(settings.database_path)
    return _db_instance


def reset_db_for_tests(path: str = ":memory:") -> Database:
    """Réinitialise la base (utilisé par la suite de tests)."""
    global _db_instance
    _db_instance = Database(Path(path))
    return _db_instance
