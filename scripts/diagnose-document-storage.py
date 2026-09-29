"""Offline plan or read-only loopback diagnostic. No cloud execution enabled."""

# ruff: noqa: E402
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.documents.s3_config import ObjectStorageSettings
from app.documents.s3_store import S3Store
from app.documents.storage_diagnostic import inspect_security, plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "local-check"])
    args = parser.parse_args()
    if args.action == "plan":
        print(json.dumps(plan()))
        return 0
    try:
        if os.environ.get("APP_ENV") != "test":
            raise ValueError("test only")
        cfg = ObjectStorageSettings()
        if cfg.document_storage_backend != "s3" or not cfg.document_s3_local_test:
            raise ValueError("explicit loopback emulator required")
        # ObjectStorageSettings enforces http://127.0.0.1 with no URL credentials.
        store = S3Store.from_settings(cfg)
        result = inspect_security(store.client, store.bucket)
        print(json.dumps(result))
        return 0 if result["runtime_configuration"] == "OBSERVED_PASS" else 1
    except Exception:
        print(
            json.dumps(
                {
                    "error": "STORAGE_DIAGNOSTIC_REFUSED",
                    "provider_qualified": False,
                    "production_authorized": False,
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
