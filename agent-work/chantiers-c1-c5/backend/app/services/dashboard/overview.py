"""Calcul des indicateurs du dashboard principal.

Au fur et à mesure des chantiers, les compteurs "0 / À venir" sont remplacés par
des valeurs réelles tirées des modèles correspondants.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.notifications import recent_user_alerts, unread_alert_counts_by_level


async def build_overview(db: AsyncSession, organization_id: UUID, user_id: UUID) -> dict[str, Any]:
    """Construit l'ensemble des KPIs et alertes pour le dashboard."""
    from app.models import User
    from app.models.plots import Plot, PlotStatus
    from app.models.products import Product, Shipment
    from app.models.suppliers import Supplier
    from app.models.documents import Document, DocumentChecklistItem, DocumentVersion
    from app.services.documents.metadata import checklist_out

    def _count(model, where=None):
        q = select(func.count()).select_from(model).where(model.organization_id == organization_id)
        if where is not None:
            q = q.where(where)
        return q

    users_count = (await db.execute(_count(User))).scalar_one() or 0
    suppliers_count = (await db.execute(_count(Supplier))).scalar_one() or 0
    products_count = (await db.execute(_count(Product))).scalar_one() or 0
    shipments_count = (await db.execute(_count(Shipment))).scalar_one() or 0
    plots_total = (await db.execute(_count(Plot))).scalar_one() or 0
    plots_action = (await db.execute(_count(Plot, Plot.status.in_([PlotStatus.invalid, PlotStatus.draft, PlotStatus.validating, PlotStatus.rejected])))).scalar_one() or 0
    # `valid` signifie validation géométrique seulement ; seule l'analyse prévue au chantier 5-6
    # peut incrémenter le KPI `plots_analyzed`.
    plots_analyzed = (await db.execute(_count(Plot, Plot.status == PlotStatus.analyzed))).scalar_one() or 0

    today = date.today()
    documents_count = (await db.execute(_count(Document, Document.is_archived.is_(False)))).scalar_one() or 0
    documents_expiring_soon = (await db.execute(
        select(func.count(func.distinct(Document.id)))
        .join(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(
            Document.organization_id == organization_id,
            Document.is_archived.is_(False),
            Document.expires_at >= today,
            Document.expires_at <= today + timedelta(days=30),
            DocumentVersion.version_number == Document.current_version_number,
            DocumentVersion.scan_status == "clean",
        )
    )).scalar_one() or 0
    checklist_items = (await db.execute(select(DocumentChecklistItem).where(
        DocumentChecklistItem.organization_id == organization_id,
        DocumentChecklistItem.is_active.is_(True),
    ).limit(300))).scalars().all()
    documents_missing = 0
    for checklist_item in checklist_items:
        current_state = await checklist_out(db, checklist_item)
        if current_state["state"] in {"missing", "expired"}:
            documents_missing += 1

    # Les compteurs et l'aperçu respectent le destinataire et l'état de lecture individuel.
    alert_counts = await unread_alert_counts_by_level(
        db, organization_id=organization_id, user_id=user_id
    )
    total_unread_alerts = sum(alert_counts.values())
    recent_alerts = await recent_user_alerts(
        db, organization_id=organization_id, user_id=user_id, limit=8
    )

    onboarding_steps = _build_onboarding_steps(
        users_count, suppliers_count, products_count, shipments_count, plots_total, documents_count
    )

    # Conformité globale : null tant qu'aucun DDR (chantier 9).
    compliance_pct: float | None = None

    kpis = {
        "compliance_pct": compliance_pct,
        "suppliers_count": suppliers_count,
        "products_count": products_count,
        "shipments_count": shipments_count,
        "plots_total": plots_total,
        "plots_action_required": plots_action,
        "plots_analyzed": plots_analyzed,
        "dds_ready": 0,
        "dds_incomplete": 0,
        "dds_at_risk": 0,
        "documents_expiring_soon": documents_expiring_soon,
        "documents_missing": documents_missing,
        "users_count": users_count,
        "unread_alerts": total_unread_alerts,
        "critical_alerts": alert_counts["critical"],
        "warning_alerts": alert_counts["warning"],
        "alerts_by_level": alert_counts,
    }

    note = "Le coffre documentaire est disponible. Les indicateurs de conformité EUDR et la déclaration restent à traiter par des étapes dédiées."
    if suppliers_count == 0 and products_count == 0 and shipments_count == 0:
        note = (
            "Commencez par créer un fournisseur, un produit EUDR, puis un premier lot. "
            "Les imports de parcelles seront débloqués ensuite."
        )
    elif plots_total == 0:
        note = (
            "Vos fournisseurs, produits et lots sont en place. Importez ou dessinez "
            "maintenant vos premières parcelles pour lancer l'analyse géospatiale."
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "kpis": kpis,
        "recent_alerts": recent_alerts,
        "upcoming_deadlines": [],
        "onboarding": onboarding_steps,
        "labels": {"note": note},
    }


def _build_onboarding_steps(
    users_count: int, suppliers_count: int, products_count: int, shipments_count: int, plots_count: int = 0,
    documents_count: int = 0,
) -> dict[str, Any]:
    steps: list[dict[str, Any]] = [
        {
            "key": "team",
            "title": "Inviter les membres de votre équipe",
            "description": "Ajoutez vos collègues responsables conformité, achats ou analystes.",
            "href": "/settings",
            "done": users_count > 1,
            "available": True,
        },
        {
            "key": "supplier",
            "title": "Créer votre premier fournisseur",
            "description": "Ajoutez un producteur, coopérative ou négociant dans votre base.",
            "href": "/suppliers",
            "done": suppliers_count > 0,
            "available": True,  # Chantier 3
        },
        {
            "key": "product",
            "title": "Ajouter un produit",
            "description": "Sélectionnez une commodité EUDR et son code SH associé.",
            "href": "/products",
            "done": products_count > 0,
            "available": suppliers_count > 0,  # besoin d'au moins un fournisseur
            "available_chantier": 3,
        },
        {
            "key": "plot",
            "title": "Importer ou dessiner vos premières parcelles",
            "description": "Ajoutez les coordonnées des parcelles (point ou polygone selon la surface et le contexte).",
            "href": "/plots",
            "done": plots_count > 0,
            "available": shipments_count > 0,
            "available_chantier": 4,
        },
        {
            "key": "document",
            "title": "Déposer les documents de légalité",
            "description": "Déposez des pièces et suivez une checklist configurée par votre organisation; elle n'est pas une liste légale exhaustive.",
            "href": "/documents",
            "done": documents_count > 0,
            "available": True,
            "available_chantier": 7,
        },
        {
            "key": "dds",
            "title": "Générer votre premier dossier de diligence raisonnée",
            "description": "Une étape ultérieure préparera un dossier de diligence à vérifier; aucune déclaration TRACES n'est effectuée ici.",
            "href": "/dds",
            "done": False,
            "available": False,
            "available_chantier": 9,
        },
    ]
    completed = sum(1 for s in steps if s["done"])
    return {"steps": steps, "total": len(steps), "completed": completed}
