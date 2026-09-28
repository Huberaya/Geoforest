"""Real local antivirus qualification using ONLY fictional bytes and EICAR.

Example (first provision the approved engine and updated vendor signatures):
PYTHONPATH=backend .venv/bin/python scripts/qualify-document-scanner.py \
  --engine /private/clamav/usr/local/bin/clamscan \
  --library-path /private/clamav/usr/local/lib --database /var/lib/clamav
No uploads to an external scanner; no business files or credentials consumed.
"""

import argparse
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.documents.scanner import Scanner
from app.documents.storage import CHUNK, LocalStore


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--library-path", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/rapports/preuves-chantier-6/antivirus-reel.json"),
    )
    args = parser.parse_args()
    scanner = Scanner(args.engine, args.database, library_path=args.library_path)
    # Harmless standard antivirus test string; NOT an executable or real malware.
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "cases": {}}
    with tempfile.TemporaryDirectory() as root:
        store = LocalStore(Path(root))
        organization = uuid4()
        for name, data, expected in (
            (
                "clean-fictional-text",
                b"Document de recette fictif. Aucun justificatif reel.\n",
                "SCAN_PASSED",
            ),
            ("eicar-standard-test", eicar, "SCAN_REJECTED"),
            ("clean-280000-bytes", b"FICTIF\n" * 40000, "SCAN_PASSED"),
        ):
            blob = store.put_quarantined(
                organization,
                (data[i : i + CHUNK] for i in range(0, len(data), CHUNK)),
                declared_size=len(data),
            )
            result = scanner.scan(store, blob)
            report["cases"][name] = result.json() | {
                "input_bytes": len(data),
                "expected_status": expected,
            }
        result = scanner.scan(store, blob, timeout=0.001)
        report["cases"]["forced-timeout"] = result.json() | {
            "expected_status": "SCAN_UNAVAILABLE"
        }
        invalid_db = Path(root) / "invalid-signatures"
        invalid_db.mkdir()
        for name in ("daily", "main", "bytecode"):
            (invalid_db / f"{name}.cvd").write_text(
                f"ClamAV-VDB:date:1:1:90:invalid:invalid:builder:{int(time.time())}".ljust(
                    512
                )
            )
        invalid_scanner = Scanner(
            args.engine, invalid_db, library_path=args.library_path
        )
        report["cases"]["synthetic-invalid-signatures"] = invalid_scanner.scan(
            store, blob
        ).json() | {"expected_status": "SCAN_UNAVAILABLE"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    for name, result in report["cases"].items():
        print(name, result["status"], result["reason"])
    if any(r["status"] != r["expected_status"] for r in report["cases"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
