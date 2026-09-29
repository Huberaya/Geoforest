"""Internal PDF worker: trusted layout, escaped text, embedded local font, no URLs fetched.
Resource limits are NOT a qualified OS/network sandbox.
"""

import io
import json
import resource
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from app.diligence.core import PreparationError


def render(data):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer

    font = TTFont("GFT", str(Path(__file__).with_name("fonts") / "DejaVuSans.ttf"))
    pdfmetrics.registerFont(font)
    glyphs = font.face.charToGlyph
    styles = {
        "title": ParagraphStyle(
            "title",
            fontName="GFT",
            fontSize=22,
            leading=29,
            textColor=colors.HexColor("#164c39"),
            spaceAfter=14,
        ),
        "h": ParagraphStyle(
            "h",
            fontName="GFT",
            fontSize=13,
            leading=19,
            textColor=colors.HexColor("#164c39"),
            spaceBefore=14,
            spaceAfter=7,
        ),
        "p": ParagraphStyle(
            "p",
            fontName="GFT",
            fontSize=9,
            leading=14,
            spaceAfter=6,
            alignment=TA_LEFT,
            splitLongWords=True,
        ),
        "muted": ParagraphStyle(
            "muted",
            fontName="GFT",
            fontSize=8,
            leading=12,
            textColor=colors.HexColor("#566960"),
            spaceAfter=7,
        ),
    }
    story = []
    used = 0

    def para(value, style="p"):
        nonlocal used
        text = str(value)
        used += len(text)
        if used > 80000:
            raise PreparationError("PDF_TEXT_BUDGET")
        if any(ord(c) not in glyphs for c in text if c not in "\r\n\t"):
            raise PreparationError("PDF_UNSUPPORTED_CHARACTER")
        safe = (
            escape(text)
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .replace("\t", "    ")
            .replace("\n", "<br/>")
        )
        return Paragraph(safe, styles[style])

    def line(label, value):
        story.append(
            para(f"{label} : {value if value not in (None, '') else 'Non renseigné'}")
        )

    s = data["snapshot"]
    p = s["declaration"]["preparation"]
    story += [
        para("GeoForest Trace", "muted"),
        para("Dossier de diligence\nSynthèse interne", "title"),
        para("NON SOUMIS PAR GEOFOREST — AUCUNE CERTIFICATION", "h"),
        para(s["title"], "h"),
    ]
    for label, value in [
        ("Dossier", s["dossier_id"]),
        ("Révision", s["revision"]),
        ("Préparé le", s["prepared_at"]),
        ("Préparateur (identifiant interne)", s["prepared_by"]),
        ("État interne", data["internal_state"]),
        ("Révision courante", data["is_current_revision"]),
        ("Sources toujours concordantes", data["source_matches_now"]),
        ("Applicabilité de la validation", data["validation_applicability"]),
        ("Export généré le", data["exported_at"]),
        ("Empreinte SHA-256 du snapshot", data["snapshot_sha256"]),
    ]:
        line(label, value)
    story.append(
        para(
            "Ce PDF est une synthèse lisible. Le JSON associé conserve les géométries complètes et le détail structuré des sources. Les pièces binaires et blocs raster ne sont pas embarqués. Ce fichier ne constitue ni une déclaration officielle, ni une signature électronique qualifiée.",
            "muted",
        )
    )
    story.append(para("1. Opérateur et qualification humaine", "h"))
    for label, key in [
        ("Nom", "operator_name"),
        ("Adresse", "operator_address"),
        ("EORI déclaré, non vérifié", "eori"),
        ("Régime", "regime"),
        ("Référence de qualification du régime", "regime_reference"),
        ("Opération commerciale", "trade_flow"),
        ("Champ produit confirmé", "product_scope_confirmed"),
        ("Référence du champ produit", "product_scope_reference"),
        ("Chaîne complète confirmée", "supply_chain_complete_confirmed"),
        ("Note de chaîne", "supply_chain_note"),
    ]:
        line(label, p.get(key))
    story.append(para("2. Contrôles au moment de l’export", "h"))
    line("Résultat", data["checks_at_export"]["status"])
    for issue in data["checks_at_export"].get("issues", []):
        line(
            issue["code"],
            issue.get("message", "Source à réexaminer")
            + (" — lot " + issue["lot_id"] if issue.get("lot_id") else ""),
        )
    if not data["checks_at_export"].get("issues"):
        story.append(
            para(
                "Aucun blocage identifié par ces contrôles internes. Cela ne prouve pas la conformité réglementaire."
            )
        )
    story.append(para("3. Lots, preuves et évaluations", "h"))
    for index, lot in enumerate(s["facts"], 1):
        story.append(
            KeepTogether(
                [
                    Spacer(1, 5 * mm),
                    para(f"Lot {index} — {lot['reference']}", "h"),
                    para(lot["product_name"]),
                ]
            )
        )
        for label, key in [
            ("Identifiant", "id"),
            ("Fournisseur", "supplier_name"),
            ("Adresse fournisseur", "supplier_address"),
            ("Contact fournisseur", "supplier_contact"),
            ("Description", "product_description"),
            ("Code SH déclaré", "hs_code"),
            ("Quantité", "quantity"),
            ("Unité", "unit"),
            ("Masse nette déclarée en kg", "declared_net_mass_kg"),
            ("Pays de production", "origin_country"),
            ("Début de production", "production_start"),
            ("Fin de production", "production_end"),
        ]:
            line(label, lot.get(key))
        line("Matières", ", ".join(lot["commodities"]))
        line("Noms scientifiques", ", ".join(lot["scientific_names"]))
        line("Justification des unités", lot["additional_unit_note"])
        line(
            "Géolocalisation complète confirmée", lot["geolocation_complete_confirmed"]
        )
        source = next(
            src
            for src in s["sources"]
            if str(src["context"]["lot"]["id"]) == str(lot["id"])
        )
        for g in source["geolocations"]:
            line(
                "Géolocalisation",
                f"{g['plot_id']} · révision {g['revision']} · {g['payload']['geometry']['type']} · pays {g['payload']['country']}",
            )
        legal = source["context"].get("legality")
        if legal:
            line("Revue de légalité", f"{legal['id']} · {legal['created_at']}")
            line("Note de légalité", legal["payload"]["note"])
            for c in legal["payload"]["criteria"]:
                line(
                    f"Légalité / {c['code']} / {c['state']}",
                    c["explanation"] + " — source : " + c["source_reference"],
                )
        else:
            line("Revue de légalité", "Absente")
        risk = source.get("risk")
        if risk:
            line("Évaluation du risque", f"{risk['id']} · {risk['created_at']}")
            line(
                "Risque résiduel proposé", risk["result"]["review"]["proposed_residual"]
            )
            line("Motivation", risk["result"]["review"]["note"])
            for c in risk["result"]["review"]["criteria"]:
                line(
                    f"Risque / {c['code']} / {c['state']}",
                    c["explanation"] + " — source : " + c["source_reference"],
                )
            for factor in risk["result"]["factors"]:
                line(
                    "Facteur " + factor["code"],
                    str(factor["message"]) + " — bloquant : " + str(factor["blocking"]),
                )
        else:
            line("Évaluation du risque", "Absente")
        for proof in source["accepted_proofs"]:
            line(
                "Preuve acceptée", str(proof["id"]) + " — " + proof["metadata"]["title"]
            )
            line("SHA-256 de la preuve", proof["sha256"])
        for task in source["context"]["tasks"]:
            line(
                "Action corrective",
                task["title"]
                + " — "
                + task["state"]
                + " — échéance "
                + str(task["due_date"]),
            )
            line("Résolution", task.get("resolution_note"))
    story.append(para("4. Décisions internes conservées", "h"))
    for d in data["decisions"]:
        line(
            "Décision",
            str(d["created_at"]) + " — " + d["action"] + " — " + d["new_state"],
        )
        line("Auteur (identifiant interne)", d["actor_id"])
        line("Note", d["note"])
    if not data["decisions"]:
        story.append(para("Aucune décision enregistrée pour cette révision."))
    story.append(para("5. Limites", "h"))
    for note in s["limitations"]:
        story.append(para(note))

    def footer(canvas, doc):
        if doc.page > 60:
            raise PreparationError("PDF_PAGE_BUDGET")
        canvas.saveState()
        canvas.setFont("GFT", 7)
        canvas.setFillColor(colors.HexColor("#566960"))
        canvas.drawString(
            18 * mm, 12 * mm, "GeoForest Trace — synthèse interne, non soumise"
        )
        canvas.drawRightString(
            192 * mm, 12 * mm, f"Révision {s['revision']} · page {doc.page}"
        )
        canvas.restoreState()

    output = io.BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=(210 * mm, 297 * mm),
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=23 * mm,
        title="GeoForest — synthèse interne non soumise",
        author="GeoForest Trace",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def main():
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024**2,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    raw = sys.stdin.buffer.read(2 * 1024**2 + 1)
    if len(raw) > 2 * 1024**2:
        raise PreparationError("EXPORT_BUDGET")
    sys.stdout.buffer.write(render(json.loads(raw)))


if __name__ == "__main__":
    try:
        main()
    except PreparationError as exc:
        sys.stderr.write(str(exc))
        sys.exit(2)
    except Exception:
        sys.stderr.write("PDF_GENERATION_FAILED")
        sys.exit(2)
