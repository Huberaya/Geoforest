import hashlib
import io
import time
from types import SimpleNamespace

import pytest
from app.documents.sandbox import DocumentSandbox, SandboxResult
from app.documents.sandbox_processing import SandboxScanner, sandbox_format


class Store:
    def __init__(self, data=b"fiction"):
        self.data = data

    def open_verified(self, blob):
        return io.BytesIO(self.data)


@pytest.fixture
def blob():
    return SimpleNamespace(size=7, sha256=hashlib.sha256(b"fiction").hexdigest())


class FakeSandbox:
    def __init__(self, result):
        self.result, self.calls = result, []

    def run(self, operation, data=b"", **kwargs):
        self.calls.append(operation)
        if operation == "version":
            return SandboxResult(0, b"ClamAV 1.4.6\n")
        return self.result


@pytest.mark.parametrize(
    "result",
    [
        SandboxResult(0, b'{"mime":"image/png"}'),
        SandboxResult(0, b"[]"),
        SandboxResult(0, b"null"),
        SandboxResult(0, b'{"mime":"application/pdf"}'),
        SandboxResult(0, b"invalid"),
        SandboxResult(0, b"x" * 4097),
        SandboxResult(1, b'{"mime":"image/png"}'),
        SandboxResult(None, b'{"mime":"image/png"}', "SANDBOX_UNAVAILABLE"),
        SandboxResult(None, b"", "SANDBOX_TIMEOUT"),
    ],
)
def test_format_fail_closed(blob, result):
    sandbox = FakeSandbox(result)
    actual = sandbox_format(Store(), blob, "image/png", sandbox=sandbox)
    assert bool(actual) == (result == SandboxResult(0, b'{"mime":"image/png"}'))
    assert sandbox.calls == ["format"]


def test_integrity_failure_never_launches(blob):
    sandbox = FakeSandbox(SandboxResult(0, b'{"mime":"image/png"}'))
    assert sandbox_format(Store(b"changed"), blob, "image/png", sandbox=sandbox) is None
    assert sandbox.calls == []


@pytest.fixture
def scanner(tmp_path):
    for name in ["daily", "main", "bytecode"]:
        (tmp_path / (name + ".cvd")).write_text(
            f"ClamAV-VDB:date:1:1:90:invalid:invalid:builder:{int(time.time())}".ljust(
                512
            )
        )
    return SandboxScanner(tmp_path / "fake-engine", tmp_path)


@pytest.mark.parametrize(
    "result,status",
    [
        (SandboxResult(0, b"stdin: OK\n"), "SCAN_PASSED"),
        (SandboxResult(1, b"stdin: Eicar FOUND\n"), "SCAN_REJECTED"),
        (SandboxResult(2, b"stdin: OK\n"), "SCAN_UNAVAILABLE"),
        (SandboxResult(0, b"not the strict output"), "SCAN_UNAVAILABLE"),
        (SandboxResult(None, b"stdin: OK\n", "SANDBOX_TIMEOUT"), "SCAN_UNAVAILABLE"),
        (SandboxResult(None, b"", "SANDBOX_UNAVAILABLE"), "SCAN_UNAVAILABLE"),
    ],
)
def test_scan_both_processes_use_sandbox(scanner, blob, result, status):
    scanner.sandbox = FakeSandbox(result)
    assert scanner.scan(Store(), blob).status == status
    assert scanner.sandbox.calls == ["version", "scan"]


def test_wrong_engine_refused(scanner, blob):
    scanner.sandbox = SimpleNamespace(
        run=lambda *a, **k: SandboxResult(0, b"ClamAV 1.4.3")
    )
    assert scanner.scan(Store(), blob).status == "SCAN_UNAVAILABLE"


def test_changed_signatures_refused(scanner, blob, monkeypatch):
    first = scanner._databases()
    responses = iter([first, dict(first, daily={"version": 2})])
    monkeypatch.setattr(scanner, "_databases", lambda: next(responses))
    scanner.sandbox = FakeSandbox(SandboxResult(0, b"stdin: OK"))
    assert scanner.scan(Store(), blob).status == "SCAN_UNAVAILABLE"


@pytest.mark.parametrize(
    "data,timeout", [("text", 1), (b"", 0), (b"", 91), (b"", True), (b"", float("nan"))]
)
def test_invalid_input_never_starts(data, timeout, monkeypatch):
    import subprocess

    def forbidden(*a, **k):
        raise AssertionError("MUST_NOT_LAUNCH")

    monkeypatch.setattr(subprocess, "Popen", forbidden)
    assert (
        DocumentSandbox().run("format", data, timeout=timeout).error
        == "SANDBOX_INPUT_REFUSED"
    )


def test_missing_launcher_has_no_fallback(tmp_path):
    result = DocumentSandbox(launcher=tmp_path / "missing").run("format", b"fiction")
    assert result.error == "SANDBOX_UNAVAILABLE"
    assert result.output == b""


def test_output_limit_and_clean_launch_contract(monkeypatch):
    import subprocess

    class Process:
        returncode = 0

        def __init__(self, command, **kwargs):
            assert kwargs["close_fds"] is True and kwargs["umask"] == 0o077
            assert kwargs["env"] == {"PATH": "/usr/bin:/bin", "LANG": "C"}
            kwargs["stdout"].write(b"x" * 65537)

        def communicate(self, *a, **k):
            return None, None

        def poll(self):
            return 0

    monkeypatch.setattr(DocumentSandbox, "command", lambda *a, **k: ["synthetic"])
    monkeypatch.setattr(subprocess, "Popen", Process)
    result = DocumentSandbox().run("format", b"fiction")
    assert result.error == "SANDBOX_OUTPUT_LIMIT" and result.output == b""


def test_launcher_error_redacted(monkeypatch):
    import subprocess

    def unavailable(*a, **k):
        raise PermissionError("SECRET_TOKEN_MUST_NOT_LEAK")

    monkeypatch.setattr(DocumentSandbox, "command", lambda *a, **k: ["synthetic"])
    monkeypatch.setattr(subprocess, "Popen", unavailable)
    result = DocumentSandbox().run("format", b"fiction")
    assert result.error == "SANDBOX_UNAVAILABLE"
    assert "SECRET_TOKEN" not in repr(result)
