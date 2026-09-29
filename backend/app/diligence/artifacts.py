"""Bounded private dossier artifacts; authorization/audit belong to routes."""

import csv
import hashlib
import io
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from app.diligence.core import PreparationError, canonical_bytes
from app.diligence.exports import csv_text

MAX_PDF_BYTES = 8 * 1024 * 1024


def artifact(envelope, kind):
    encoded = canonical_bytes(envelope)
    if kind == "json":
        content, mime = encoded, "application/json"
    elif kind == "csv":
        output = io.StringIO(newline="")
        writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        fields = [
            "notice",
            "dossier_id",
            "revision",
            "snapshot_sha256",
            "internal_state",
            "is_current_revision",
            "source_matches_now",
            "validation_applicability",
            "readiness",
            "operator",
            "lot_id",
            "lot_reference",
            "supplier",
            "product",
            "hs_code",
            "quantity",
            "unit",
            "declared_net_mass_kg",
            "country",
            "production_start",
            "production_end",
            "risk_id",
            "risk_residual",
        ]
        writer.writerow(fields)
        s = envelope["snapshot"]
        operator = s["declaration"]["preparation"]["operator_name"]
        for lot in s["facts"]:
            risk = lot.get("risk") or {}
            writer.writerow(
                [
                    csv_text(v)
                    for v in [
                        "INDEX INTERNE — NON SOUMIS PAR GEOFOREST — détails et décisions dans le JSON",
                        s["dossier_id"],
                        s["revision"],
                        envelope["snapshot_sha256"],
                        envelope["internal_state"],
                        envelope["is_current_revision"],
                        envelope["source_matches_now"],
                        envelope["validation_applicability"],
                        envelope["checks_at_export"]["status"],
                        operator,
                        lot["id"],
                        lot["reference"],
                        lot["supplier_name"],
                        lot["product_name"],
                        lot["hs_code"],
                        lot["quantity"],
                        lot["unit"],
                        lot.get("declared_net_mass_kg"),
                        lot["origin_country"],
                        lot.get("production_start"),
                        lot.get("production_end"),
                        risk.get("id"),
                        risk.get("proposed_residual"),
                    ]
                ]
            )
        content, mime = output.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8"
    elif kind == "pdf":
        env = {
            "PATH": "/usr/bin:/bin",
            "LANG": "C.UTF-8",
            "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
        }
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            proc = subprocess.Popen(
                [sys.executable, "-m", "app.diligence.pdf_worker"],
                stdin=subprocess.PIPE,
                stdout=out,
                stderr=err,
                env=env,
                start_new_session=True,
            )
            try:
                proc.communicate(encoded, timeout=25)
                out.seek(0)
                content = out.read(MAX_PDF_BYTES + 1)
                if (
                    proc.returncode
                    or len(content) > MAX_PDF_BYTES
                    or not content.startswith(b"%PDF-")
                ):
                    err.seek(0)
                    reason = err.read(80).decode("ascii", errors="replace").strip()
                    allowed = {
                        "PDF_TEXT_BUDGET",
                        "PDF_PAGE_BUDGET",
                        "PDF_UNSUPPORTED_CHARACTER",
                    }
                    raise PreparationError(
                        reason if reason in allowed else "PDF_GENERATION_FAILED"
                    )
            except subprocess.TimeoutExpired:
                raise PreparationError("PDF_TIMEOUT") from None
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.communicate()
        mime = "application/pdf"
    else:
        raise PreparationError("EXPORT_FORMAT_NOT_IMPLEMENTED")
    if len(content) > (MAX_PDF_BYTES if kind == "pdf" else 2 * 1024 * 1024):
        raise PreparationError("EXPORT_BUDGET")
    return content, mime, hashlib.sha256(content).hexdigest()
