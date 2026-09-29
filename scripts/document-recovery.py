"""Local synthetic backup/restore only. Configuration and key paths are external."""

# ruff: noqa: E402
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.documents.recovery.archive import load_key
from app.documents.recovery.service import backup, restore, verify
from app.documents.s3_config import ObjectStorageSettings
from app.documents.s3_store import S3Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "verify", "restore"])
    parser.add_argument("--directory", required=True)
    parser.add_argument("--writers-stopped", action="store_true")
    parser.add_argument("--receipt")
    args = parser.parse_args()
    try:
        if os.environ.get("APP_ENV") != "test":
            raise ValueError("test only")
        key = load_key(os.environ["DOCUMENT_RECOVERY_KEY_FILE"], args.directory)
        if args.action == "verify":
            m = verify(args.directory, key)
            result = {"verified": True, "objects": len(m.entries)}
        else:
            cfg = ObjectStorageSettings()
            if cfg.document_storage_backend != "s3" or not cfg.document_s3_local_test:
                raise ValueError(
                    "Recovery CLI requires an explicit loopback S3 emulator"
                )
            storage = S3Store.from_settings(cfg)
            url = os.environ["DOCUMENT_RECOVERY_DATABASE_URL"]
            if args.action == "backup":
                result = backup(
                    url,
                    storage,
                    args.directory,
                    key,
                    app_env="test",
                    writers_stopped=args.writers_stopped,
                )
            else:
                if not args.receipt:
                    raise ValueError("receipt required")
                result = restore(
                    args.directory,
                    key,
                    url,
                    storage,
                    args.receipt,
                    app_env="test",
                    writers_stopped=args.writers_stopped,
                )
        print(json.dumps(result))
        return 0
    except Exception:
        # No connection strings, keys, source names or SQL errors printed.
        print(json.dumps({"error": "DOCUMENT_RECOVERY_FAILED"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
