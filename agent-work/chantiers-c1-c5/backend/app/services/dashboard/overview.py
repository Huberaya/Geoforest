"""Calcul des indicateurs du dashboard principal.

Au fur et à mesure des chantiers, les compteurs "0 / À venir" sont remplacés par
des valeurs réelles tirées des modèles correspondants.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alerts import Alert, AlertCategory, AlertLevel


async def build_overview(db: AsyncSession, organization_id: UUID) -> dict[str, Any]:
    """Construit l'ensemble des KPIs et alertes pour le dashboard."""
    from app.models import User
    from app.models.plots import Plot, PlotStatus
    from app.models.products import Product, Shipment
    from app.models.suppliers import Supplier

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

    # --- Alertes par niveau
    levels = ["critical", "warning", "info", "success"]
    alert_counts: dict[str, int] = {lvl: 0 for lvl in levels}
    for lvl in levels:
        r = await db.execute(
            select(func.count())
            .select_from(Alert)
            .where(
                Alert.organization_id == organization_id,
                Alert.level == AlertLevel(lvl),
                Alert.is_read.is_(False),
            )
        )
        alert_counts[lvl] = r.scalar_one() or 0
    total_unread_alerts = sum(alert_counts.values())

    res_alerts = await db.execute(
        select(Alert)
        .where(Alert.organization_id == organization_id)
        .order_by(Alert.is_read.asc(), Alert.created_at.desc())
        .limit(8)
    )
    recent_alerts = [_serialize_alert(a) for a in res_alerts.scalars().all()]

    onboarding_steps = _build_onboarding_steps(
        users_count, suppliers_count, products_count, shipments_count, plots_total
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
        "documents_expiring_soon": 0,
        "documents_missing": 0,
        "users_count": users_count,
        "unread_alerts": total_unread_alerts,
        "critical_alerts": alert_counts["critical"],
        "warning_alerts": alert_counts["warning"],
        "alerts_by_level": alert_counts,
    }

    note = (
        "Les modules Documents et Diligence raisonnée seront activés par les chantiers 7 et 9."
    )
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
    users_count: int, suppliers_count: int, products_count: int, shipments_count: int, plots_count: int = 0
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
            "description": "Titres fonciers, certificats, autorisations d'exploitation.",
            "href": "/documents",
            "done": False,
            "available": False,
            "available_chantier": 7,
        },
        {
            "key": "dds",
            "title": "Générer votre premier dossier de diligence raisonnée",
            "description": "Une fois les données collectées, le système assemble le DDR prêt pour TRACES.",
            "href": "/dds",
            "done": False,
            "available": False,
            "available_chantier": 9,
        },
    ]
    completed = sum(1 for s in steps if s["done"])
    return {"steps": steps, "total": len(steps), "completed": completed}


def _serialize_alert(a: Alert) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "level": a.level.value,
        "category": a.category.value,
        "title": a.title,
        "message": a.message,
        "link": a.link,
        "context": a.context or {},
        "is_read": a.is_read,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


async def mark_alert_read(db: AsyncSession, organization_id: UUID, alert_id: UUID) -> Alert | None:
    """Marque une alerte comme lue si elle appartient à l'organisation."""
    res = await db.execute(select(Alert).where(Alert.id == alert_id))
    a = res.scalar_one_or_none()
    if a is None or a.organization_id != organization_id:
        return None
    a.is_read = True
    a.read_at = datetime.now(timezone.utc)
    db.add(a)
    return a


async def seed_onboarding_alerts(db: AsyncSession, organization_id: UUID) -> None:
    """Crée l'alerte de bienvenue si l'organisation n'a encore aucune alerte (idempotent)."""
    existing = await db.execute(
        select(func.count()).select_from(Alert).where(Alert.organization_id == organization_id)
    )
    if (existing.scalar_one() or 0) > 0:
        return
    welcome = Alert(
        organization_id=organization_id,
        level=AlertLevel.info,
        category=AlertCategory.onboarding,
        title="Bienvenue sur GeoForest Trace 🌲",
        message=(
            "Votre espace de conformité EUDR est prêt. "
            "Commencez par inviter les membres de votre équipe, puis créez vos premiers fournisseurs."
        ),
        link="/settings",
    )
    db.add(welcome)
