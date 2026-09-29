"""Candidate adapters; never wired to production automatically."""

import hashlib
import json
import re
from pathlib import Path

from app.documents.sandbox import DocumentSandbox
from app.documents.scanner import APPROVED_VERSION, Scanner, ScanResult
from app.documents.storage import MAX_BYTES


def sandbox_format(storage, blob, declared_mime, *, sandbox=None):
    try:
        with storage.open_verified(blob) as f:
            data = f.read(MAX_BYTES + 1)
        if len(data) != blob.size or hashlib.sha256(data).hexdigest() != blob.sha256:
            return None
        result = (sandbox or DocumentSandbox()).run("format", data)
        if result.error or result.returncode != 0 or len(result.output) > 4096:
            return None
        parsed = json.loads(result.output)
        return (
            parsed
            if isinstance(parsed, dict) and parsed.get("mime") == declared_mime
            else None
        )
    except Exception:
        return None


class SandboxScanner(Scanner):
    """Preserves existing engine/signature/hash gates; BOTH launches use namespaces."""

    def __init__(self, executable, database, *, library_path=None, sandbox=None):
        super().__init__(executable, database, library_path=library_path)
        self.library_path = Path(library_path) if library_path else None
        self.sandbox = sandbox or DocumentSandbox()

    def scan(self, store, blob, *, timeout=65):
        unavailable = ScanResult("SCAN_UNAVAILABLE", "SANDBOX_OR_SCAN_UNAVAILABLE")
        try:
            versions = self._databases()
            artifacts = {"engine": self.executable, "library_path": self.library_path}
            version = self.sandbox.run("version", timeout=5, **artifacts)
            if (
                version.error
                or version.returncode != 0
                or not re.fullmatch(
                    rb"ClamAV "
                    + re.escape(APPROVED_VERSION.encode())
                    + rb"(?:/[0-9]+/[^\r\n]{1,100})?",
                    version.output.strip(),
                )
            ):
                return unavailable
            with store.open_verified(blob) as f:
                data = f.read(MAX_BYTES + 1)
            if (
                len(data) != blob.size
                or hashlib.sha256(data).hexdigest() != blob.sha256
            ):
                return unavailable
            files = []
            for name in ("daily", "main", "bytecode"):
                candidates = [
                    self.database / (name + suffix)
                    for suffix in (".cvd", ".cld")
                    if (self.database / (name + suffix)).is_file()
                ]
                if len(candidates) != 1:
                    return unavailable
                files.extend(candidates)
            result = self.sandbox.run(
                "scan", data, timeout=timeout, database_files=files, **artifacts
            )
            if result.error or versions != self._databases():
                return unavailable
            status, reason = "SCAN_UNAVAILABLE", "SCAN_FAILED_OR_LIMIT"
            if result.returncode == 0 and result.output.strip() == b"stdin: OK":
                status, reason = "SCAN_PASSED", "NO_DETECTION_IN_THIS_SCAN"
            elif result.returncode == 1:
                status, reason = "SCAN_REJECTED", "DETECTION_OR_POLICY_LIMIT"
            return ScanResult(status, reason, APPROVED_VERSION, versions, blob.sha256)
        except Exception:
            return unavailable
