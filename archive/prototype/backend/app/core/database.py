"""Couche de persistance légère (SQLite, bibliothèque standard).

Le backend stocke chaque audit de parcelle afin de pouvoir :
  * rejouer un export TRACES-NT à partir d'un identifiant d'audit,
  * fournir un historique au dashboard.
"""
from __future__ import annotations

import json
import sqlite3
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
            path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(CREATE_TABLES_SQL)
            self._conn.commit()

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
                    id, created_at, operator_name, operator_eori, commodity, hs_code,
                    harvest_date, geometry_json, geometry_type, area_ha, vertex_count,
                    centroid_lon, centroid_lat, country_code, country_risk,
                    compliant, loss_year, confidence_score, risk_level, status,
                    validation_json, satellite_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.created_at,
                    record.operator_name,
                    record.operator_eori,
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
                    1 if record.compliant else 0,
                    record.loss_year,
                    record.confidence_score,
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

    def mark_exported(self, audit_id: str, reference: str) -> None:
        with self.cursor() as cur:
            cur.execute(
                "UPDATE parcel_audits SET status = 'EXPORTED', traces_reference = ? WHERE id = ?",
                (reference, audit_id),
            )

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> ParcelAuditRecord:
        data: Dict[str, Any] = dict(row)
        return ParcelAuditRecord(
            id=data["id"],
            created_at=data["created_at"],
            operator_name=data["operator_name"],
            operator_eori=data["operator_eori"],
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
            compliant=bool(data["compliant"]),
            loss_year=data["loss_year"],
            confidence_score=data["confidence_score"],
            risk_level=data["risk_level"],
            status=data["status"],
            validation=json.loads(data["validation_json"]),
            satellite=json.loads(data["satellite_json"]),
            traces_reference=data.get("traces_reference"),
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
