"""Local synthetic real-engine check, no application activation or cloud access."""

# ruff: noqa: E402
import argparse
import hashlib
import io
import json
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.documents.sandbox_processing import SandboxScanner, sandbox_format
from app.documents.storage import LocalStore
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-synthetic", action="store_true", required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--library-path", type=Path, required=True)
    args = parser.parse_args()
    report = {
        "scope": "LOCAL_SYNTHETIC_REAL_ENGINE_IN_NAMESPACES",
        "production_authorized": False,
        "cases": {},
    }
    try:
        scanner = SandboxScanner(
            args.engine, args.database, library_path=args.library_path
        )
        with args.engine.open("rb") as f:
            report["engine_sha256"] = hashlib.file_digest(f, "sha256").hexdigest()
        report["vendor_databases"] = scanner._databases()
        report["database_sha256"] = {}
        for name in ("daily", "main", "bytecode"):
            paths = [
                args.database / (name + suffix)
                for suffix in (".cvd", ".cld")
                if (args.database / (name + suffix)).is_file()
            ]
            if len(paths) != 1:
                raise ValueError("Ambiguous signatures")
            with paths[0].open("rb") as f:
                report["database_sha256"][name] = hashlib.file_digest(
                    f, "sha256"
                ).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            store = LocalStore(Path(directory))
            clean = b"FICTITIOUS DOCUMENT ONLY. No business data."
            eicar = (
                b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
            )
            for name, data, expected in [
                ("clean", clean, "SCAN_PASSED"),
                ("eicar", eicar, "SCAN_REJECTED"),
            ]:
                blob = store.put_quarantined(uuid4(), [data], declared_size=len(data))
                result = scanner.scan(store, blob)
                report["cases"][name] = {
                    "expected": expected,
                    "observed": result.json(),
                    "passed": result.status == expected,
                }
            result = scanner.scan(store, blob, timeout=0.001)
            report["cases"]["timeout"] = {
                "expected": "SCAN_UNAVAILABLE",
                "observed": result.json(),
                "passed": result.status == "SCAN_UNAVAILABLE",
            }
            buffer = io.BytesIO()
            Image.new("RGB", (4, 5), "green").save(buffer, format="PNG")
            data = buffer.getvalue()
            blob = store.put_quarantined(uuid4(), [data], declared_size=len(data))
            parsed = sandbox_format(store, blob, "image/png")
            report["cases"]["format"] = {
                "passed": parsed == {"mime": "image/png", "dimensions": [4, 5]}
            }
        report["passed"] = all(x["passed"] for x in report["cases"].values())
    except Exception:
        report.update(passed=False, error="SANDBOX_QUALIFICATION_INCOMPLETE")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
