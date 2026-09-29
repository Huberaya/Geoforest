"""Actual subprocess/resource tests. No service or official submission involved."""

import io
import os
import signal
import subprocess
import sys
import time
from copy import deepcopy

import pytest
from app.diligence import artifacts, pdf_worker
from app.diligence.core import PreparationError
from pypdf import PdfReader


def envelope():
    return {
        "snapshot": {
            "dossier_id": "00000000-0000-0000-0000-000000000001",
            "revision": 1,
            "title": "Recette entièrement fictive",
            "prepared_at": "2026-09-29T00:00:00Z",
            "prepared_by": "acteur fictif",
            "declaration": {"preparation": {"operator_name": "FICTIF"}},
            "facts": [],
            "sources": [],
            "limitations": ["Aucune certification."],
        },
        "internal_state": "DRAFT",
        "is_current_revision": True,
        "source_matches_now": True,
        "validation_applicability": "NOT_A_CURRENT_VALIDATION",
        "exported_at": "2026-09-29T00:00:00Z",
        "snapshot_sha256": "0" * 64,
        "checks_at_export": {"status": "BLOCKED", "issues": []},
        "decisions": [],
    }


@pytest.mark.parametrize("pages", [60, 61])
def test_actual_footer_page_boundary(monkeypatch, pages):
    from reportlab.platypus import PageBreak, SimpleDocTemplate, Spacer

    original = SimpleDocTemplate.build

    def build(doc, story, **kw):
        # Exercise actual pagination and worker footer, not a fake page counter.
        flow = []
        for i in range(pages):
            flow.append(Spacer(1, 20))
            if i + 1 < pages:
                flow.append(PageBreak())
        original(doc, flow, **kw)

    monkeypatch.setattr(SimpleDocTemplate, "build", build)
    if pages == 61:
        with pytest.raises(PreparationError, match="PDF_PAGE_BUDGET"):
            pdf_worker.render(envelope())
    else:
        assert len(PdfReader(io.BytesIO(pdf_worker.render(envelope()))).pages) == 60


def test_long_real_input_hits_page_limit():
    doc = envelope()
    doc["checks_at_export"]["issues"] = [{"code": "X", "message": "Recette"}] * 2600
    with pytest.raises(PreparationError, match="PDF_PAGE_BUDGET"):
        artifacts.artifact(doc, "pdf")


@pytest.mark.parametrize("mode", ["timeout", "memory", "cpu", "file"])
def test_real_resource_boundaries(monkeypatch, mode):
    original = subprocess.Popen
    children = []
    payloads = {
        "timeout": "import time; time.sleep(40)",
        "memory": "data = bytearray(1024**3)",
        "cpu": "while True: pass",
        "file": "import os; os.write(1, b'x'*(9*1024**2))",
    }
    # Replace only renderer in a real child; main() still applies production rlimits.
    code = (
        "from app.diligence import pdf_worker as w\n"
        "def probe(data):\n"
        + "\n".join("    " + x for x in payloads[mode].splitlines())
        + "\n    return b'%PDF-probe'\nw.render=probe\nw.main()\n"
    )

    def launch(argv, **kw):
        child = original([sys.executable, "-c", code], **kw)
        children.append(child)
        return child

    monkeypatch.setattr(artifacts.subprocess, "Popen", launch)
    start = time.monotonic()
    with pytest.raises(
        PreparationError,
        match="PDF_TIMEOUT" if mode == "timeout" else "PDF_GENERATION_FAILED",
    ):
        artifacts.artifact(envelope(), "pdf")
    elapsed = time.monotonic() - start
    assert children[0].poll() is not None
    assert elapsed < 35
    if mode == "timeout":
        assert elapsed >= 24
        assert children[0].returncode == -signal.SIGKILL
    if mode == "cpu":
        assert children[0].returncode in {-signal.SIGKILL, -signal.SIGXCPU}
    # No orphan child survives failed generation.
    with pytest.raises(ProcessLookupError):
        os.kill(children[0].pid, 0)


def test_long_layout_and_all_page_footers():
    doc = deepcopy(envelope())
    doc["checks_at_export"]["issues"] = [
        {"code": f"TEST_{i:04d}", "message": "Justification synthétique longue " * 5}
        for i in range(180)
    ]
    raw, _, _ = artifacts.artifact(doc, "pdf")
    pdf = PdfReader(io.BytesIO(raw))
    assert 10 <= len(pdf.pages) <= 60
    texts = [p.extract_text() for p in pdf.pages]
    assert all(f"page {i}" in t for i, t in enumerate(texts, 1))
    assert "TEST_0000" in "".join(texts)
    assert "TEST_0179" in "".join(texts)
