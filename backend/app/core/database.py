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


def _instructions_sql(script: str) -> list[str]:
    """Découpe un script SQL en instructions complètes.

    ``sqlite3.complete_statement`` gère les points-virgules internes (chaînes,
    déclencheurs), contrairement à un ``split(";")`` naïf.
    """
    instructions: list[str] = []
    tampon = ""
    for ligne in script.splitlines(keepends=True):
        tampon += ligne
        if sqlite3.complete_statement(tampon):
            instruction = tampon.strip()
            if instruction:
                instructions.append(instruction)
            tampon = ""
    reste = tampon.strip()
    if reste:
        instructions.append(reste)
    return instructions


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
            self._conn.commit()
            self._migrer_identite_operateur()

    def _migrer_identite_operateur(self) -> None:
        """Lot A — rend l'identité de l'opérateur facultative (SQLite).

        ⚠️ ``CREATE TABLE IF NOT EXISTS`` ne touche pas une table déjà créée :
        une base antérieure conserve donc ``operator_eori NOT NULL`` (et, selon
        son millésime, pas de colonne ``operator_country``). Insérer un dossier
        sans identité échouerait. SQLite ne sait pas retirer une contrainte
        ``NOT NULL`` : il faut reconstruire la table.

        La reconstruction suit la procédure officielle et **ne perd aucune
        ligne**. Trois précautions, chacune apprise d'un échec mesuré :

          1. la copie porte sur l'**intersection** des colonnes anciennes et
             cibles — une colonne ancienne absente du nouveau schéma ferait
             échouer l'INSERT après le renommage ;
          2. tout s'exécute dans une transaction explicite : en cas d'échec,
             ``ROLLBACK`` rend la base exactement dans son état d'avant, au lieu
             de laisser une table vivante vide et des données orphelines ;
          3. le nombre de lignes est **comparé** avant de supprimer l'ancienne
             table — une copie partielle est un échec, pas un succès.

        Les identités existantes sont copiées **telles quelles**, y compris la
        valeur de remplissage héritée : sa reprise est une décision explicite
        (cf. ``classer_identite_operateur``), jamais un effet de bord.
        """
        colonnes = {
            ligne["name"]: ligne
            for ligne in self._conn.execute("PRAGMA table_info(parcel_audits)")
        }
        if not colonnes or "operator_eori" not in colonnes:
            return
        # Déjà migrée : plus de NOT NULL et la colonne pays existe.
        if not colonnes["operator_eori"]["notnull"] and "operator_country" in colonnes:
            return

        logger = logging.getLogger(__name__)
        logger.info("Lot A : migration de parcel_audits (identité opérateur facultative)")

        anciennes = [ligne["name"] for ligne in self._conn.execute("PRAGMA table_info(parcel_audits)")]

        # Procédure officielle SQLite : on pilote la transaction à la main, car
        # le mode « legacy » de sqlite3 ouvre et ferme des transactions
        # implicites autour des DDL, ce qui rendrait le ROLLBACK inopérant.
        mode_initial = self._conn.isolation_level
        self._conn.isolation_level = None
        try:
            self._conn.execute("BEGIN IMMEDIATE")
            self._conn.execute("ALTER TABLE parcel_audits RENAME TO parcel_audits_avant_lot_a")

            # ⚠️ `executescript()` émet un COMMIT implicite : l'utiliser ici
            #   fermerait la transaction et le ROLLBACK serait impossible
            #   (« cannot rollback - no transaction is active », mesuré).
            for instruction in _instructions_sql(CREATE_TABLES_SQL):
                self._conn.execute(instruction)

            cibles = [
                ligne["name"]
                for ligne in self._conn.execute("PRAGMA table_info(parcel_audits)")
            ]
            communes = [nom for nom in anciennes if nom in cibles]
            if not communes:  # pragma: no cover — schémas disjoints
                raise RuntimeError(
                    "aucune colonne commune entre l'ancien et le nouveau schéma "
                    "de parcel_audits : migration impossible sans perte"
                )
            liste = ", ".join(f'"{nom}"' for nom in communes)
            ecartees = sorted(set(anciennes) - set(communes))
            if ecartees:
                logger.warning(
                    "Lot A : colonne(s) absente(s) du schéma cible, non copiée(s) : %s",
                    ", ".join(ecartees),
                )

            self._conn.execute(
                f"INSERT INTO parcel_audits ({liste}) "
                f"SELECT {liste} FROM parcel_audits_avant_lot_a"
            )

            avant = self._conn.execute(
                "SELECT COUNT(*) AS n FROM parcel_audits_avant_lot_a"
            ).fetchone()["n"]
            apres = self._conn.execute("SELECT COUNT(*) AS n FROM parcel_audits").fetchone()["n"]
            if avant != apres:
                raise RuntimeError(
                    f"copie incomplète : {avant} ligne(s) avant, {apres} après — "
                    "migration annulée, l'ancienne table est conservée"
                )

            self._conn.execute("DROP TABLE parcel_audits_avant_lot_a")
            self._conn.execute("COMMIT")
            logger.info("Lot A : %s ligne(s) conservée(s)", apres)
        except BaseException:
            try:
                self._conn.execute("ROLLBACK")
            except sqlite3.Error:  # pragma: no cover — transaction déjà close
                logger.exception("Lot A : échec du ROLLBACK après une migration ratée")
            logger.exception("Lot A : migration annulée, base laissée intacte")
            raise
        finally:
            self._conn.isolation_level = mode_initial

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
