"""Endpoints REST v1 de GeoForest Trace."""
from __future__ import annotations

import hmac
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status

from app.core.config import settings
from app.core.database import Database, get_db
from app.models.schemas import (
    COMMODITY_HS_CODES,
    AuditSummary,
    HealthResponse,
    OperatorInfo,
    ParcelAuditRequest,
    ParcelAuditResponse,
    TracesExportRequest,
)
from app.models.sql_models import ParcelAuditRecord
from app.services.gis_validator import validate_geometry
from app.services.satellite_checker import check_deforestation_risk
from app.services.traces_exporter import build_reference, export_traces_json, export_traces_xml
from app.services.identite_operateur import classer_identite_operateur

router = APIRouter()

# ⚠️ Lot A — il existait ici une identité de remplissage (`_ANONYMOUS_OPERATOR`)
#   écrite en base pour tout opérateur absent : « Opérateur non renseigné » /
#   XX0000000000000 / XX. Elle a la forme d'une identité réelle, devient
#   indiscernable d'une déclaration véritable, et part en export. Supprimée :
#   l'absence est représentée par `None`. La constante n'est définie qu'à un
#   seul endroit (`app.services.identite_operateur`) : deux copies d'une même
#   sentinelle finissent toujours par diverger.


def _summary_text(status_value: str, validation: Dict[str, Any], satellite: Dict[str, Any] | None) -> str:
    if status_value == "INVALID_GEOMETRY":
        first = validation["errors"][0]["message"] if validation["errors"] else "géométrie invalide"
        return f"Dossier rejeté : {first}"
    assert satellite is not None
    area = validation["area_ha"]
    if status_value == "ANALYSIS_UNAVAILABLE":
        return (
            f"Aucun verdict : l'analyse satellite n'a pas abouti. Ce dossier n'emporte aucune "
            f"présomption de conformité (parcelle de {area:.2f} ha)."
        )
    if status_value == "SIMULATED_NON_PROBATIVE":
        return (
            f"Résultat simulé, non probant : aucune donnée satellite n'a été consultée. "
            f"Ce dossier ne peut pas servir de preuve de conformité (parcelle de {area:.2f} ha)."
        )
    if status_value == "NON_COMPLIANT":
        return (
            f"NON CONFORME EUDR : déforestation détectée en {satellite['loss_year']} "
            f"(après le {settings.eudr_cutoff_date.strftime('%d/%m/%Y')}) sur une parcelle de {area:.2f} ha."
        )
    return (
        f"CONFORME EUDR : aucune déforestation post-{settings.eudr_cutoff_date.year} détectée "
        f"(parcelle de {area:.2f} ha, risque {satellite['risk_level']}"
        + (f", confiance {satellite['confidence_score']:.0%}" if satellite.get("confidence_score") is not None else "")
        + ")."
    )


# ------------------------------------------------------------------ P0 (recette 2026-10-08)
# Les routes d'analyse et d'export n'étaient protégées par rien : quiconque
# joignait ce service pouvait créer une analyse, lire les dossiers et exporter
# un TRACES. Elles exigent désormais un jeton Bearer dédié, comparé en temps
# constant. Sans jeton configuré, elles sont FERMÉES (503), jamais ouvertes.
# Le point de santé reste public.
JETON_VARIABLE = "GF_BACKEND_API_TOKEN"


def exiger_jeton(authorization: str | None = Header(default=None)) -> None:
    attendu = os.environ.get(JETON_VARIABLE, "")
    if not attendu:
        raise HTTPException(
            status_code=503,
            detail=f"Service fermé : la variable {JETON_VARIABLE} n'est pas configurée.",
        )
    presente = authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else ""
    if not presente or not hmac.compare_digest(presente.encode(), attendu.encode()):
        raise HTTPException(status_code=401, detail="Authentification requise.")


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=settings.app_version,
        gfw_mode="live" if settings.gfw_live_available else ("demo-simule" if settings.gfw_demo_mode else "indisponible"),
    )


@router.post(
    "/audit/parcel",
    response_model=ParcelAuditResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["audit"],
    summary="Audit EUDR complet d'une parcelle (GIS + satellite)",
    dependencies=[Depends(exiger_jeton)],
)
def audit_parcel(
    payload: ParcelAuditRequest,
    request: Request,
    db: Database = Depends(get_db),
) -> ParcelAuditResponse:
    # Le texte brut est conservé : la précision des coordonnées doit être mesurée
    # sur les littéraux du fichier, pas sur les valeurs parsées (cf. P0-05).
    try:
        raw_text = request.scope["geoforest_raw_body"].decode("utf-8")
    except (KeyError, AttributeError):
        raw_text = None

    validation = validate_geometry(payload.geojson, payload.declared_area_ha, raw_text)
    audit_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    hs_code = COMMODITY_HS_CODES[payload.commodity.value]
    # Aucune fabrication : l'absence d'identité reste une absence.
    operator: OperatorInfo | None = payload.operator

    satellite: Dict[str, Any] | None = None
    if validation["valid"]:
        # Aucun argument ne provient des propriétés du fichier : le verdict ne
        # peut pas être influencé par le déposant (cf. P0-03).
        satellite = check_deforestation_risk(payload.geojson, payload.harvest_date.isoformat())
        # Aucun verdict n'est inventé : si l'analyse n'est pas probante, le
        # statut le dit. `compliant is None` ne devient jamais « NON_COMPLIANT ».
        if satellite["compliant"] is None:
            status_value = (
                "SIMULATED_NON_PROBATIVE"
                if satellite.get("source") == "simulated"
                else "ANALYSIS_UNAVAILABLE"
            )
        else:
            status_value = "COMPLIANT" if satellite["compliant"] else "NON_COMPLIANT"
    else:
        status_value = "INVALID_GEOMETRY"

    centroid = validation.get("centroid") or [0.0, 0.0]
    record = ParcelAuditRecord(
        id=audit_id,
        created_at=created_at,
        operator_name=operator.name if operator else None,
        operator_eori=operator.eori if operator else None,
        operator_country=operator.country if operator else None,
        commodity=payload.commodity.value,
        hs_code=hs_code,
        harvest_date=payload.harvest_date.isoformat(),
        geometry=validation.get("normalized_geometry") or payload.geojson,
        geometry_type=validation.get("geometry_type") or "Unknown",
        area_ha=float(validation.get("area_ha") or 0.0),
        vertex_count=int(validation.get("vertex_count") or 0),
        centroid_lon=float(centroid[0]),
        centroid_lat=float(centroid[1]),
        country_code=(satellite or {}).get("country_code", "XX"),
        country_risk=(satellite or {}).get("country_risk", "UNKNOWN"),
        compliant=(satellite["compliant"] if satellite else None),
        loss_year=(satellite or {}).get("loss_year"),
        # None = aucune confiance calculable ; 0.0 serait lu comme une mesure.
        confidence_score=(satellite or {}).get("confidence_score"),
        risk_level=(satellite or {}).get("risk_level", "UNKNOWN"),
        analysis_source=(satellite or {}).get("source", "unavailable"),
        analysis_probative=bool((satellite or {}).get("is_probative", False)),
        analysis_evidence=(satellite or {}).get("evidence"),
        status=status_value,
        validation=validation,
        satellite=satellite or {},
    )
    db.insert_audit(record)

    return ParcelAuditResponse(
        audit_id=audit_id,
        created_at=created_at,
        status=status_value,  # type: ignore[arg-type]
        commodity=payload.commodity,
        hs_code=hs_code,
        harvest_date=payload.harvest_date,
        validation=validation,  # type: ignore[arg-type]
        satellite=satellite,  # type: ignore[arg-type]
        eudr_cutoff_date=settings.eudr_cutoff_date,
        summary=_summary_text(status_value, validation, satellite),
    )


@router.get("/audits", response_model=List[AuditSummary], tags=["audit"], dependencies=[Depends(exiger_jeton)])
def list_audits(limit: int = Query(default=50, ge=1, le=500), db: Database = Depends(get_db)) -> List[AuditSummary]:
    return [
        AuditSummary(
            audit_id=r.id,
            created_at=r.created_at,
            operator_name=r.operator_name,
            operator_identity=classer_identite_operateur(r.operator_name, r.operator_eori).etat,
            commodity=r.commodity,
            hs_code=r.hs_code,
            harvest_date=r.harvest_date,
            area_ha=r.area_ha,
            geometry_type=r.geometry_type,
            status=r.status,
            compliant=r.compliant,
            loss_year=r.loss_year,
            risk_level=("HIGH" if r.compliant is False else "UNKNOWN"),
            country_code="XX",
        )
        for r in db.list_audits(limit)
    ]


@router.get("/audits/{audit_id}", tags=["audit"], dependencies=[Depends(exiger_jeton)])
def get_audit(audit_id: str, db: Database = Depends(get_db)) -> Dict[str, Any]:
    record = db.get_audit(audit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Audit introuvable")
    data = record.__dict__.copy()
    # Neutraliser les valeurs historiques issues des boîtes englobantes.
    data["country_code"] = "XX"
    data["country_risk"] = "UNKNOWN"
    data["risk_level"] = "HIGH" if record.compliant is False else "UNKNOWN"
    satellite = data.get("satellite")
    if isinstance(satellite, dict):
        satellite = dict(satellite)
        satellite["country_code"] = "XX"
        satellite["country_name"] = "Non déterminé"
        satellite["country_risk"] = "UNKNOWN"
        satellite["risk_level"] = "HIGH" if satellite.get("compliant") is False else "UNKNOWN"
        details = satellite.get("details")
        if isinstance(details, str) and ("benchmark UE" in details or "Pays déduit des coordonnées" in details):
            satellite["details"] = "Classification du pays et benchmark officiel indisponibles."
        data["satellite"] = satellite
    return data


@router.post(
    "/export/traces",
    tags=["export"],
    summary="Export du dossier DDS vers TRACES-NT (XML ou JSON)",
    responses={200: {"content": {"application/xml": {}, "application/json": {}}}},
    dependencies=[Depends(exiger_jeton)],
)
def export_traces(payload: TracesExportRequest, db: Database = Depends(get_db)) -> Response:
    if not payload.audit_id:
        raise HTTPException(status_code=422, detail="audit_id requis")
    record = db.get_audit(payload.audit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Audit introuvable")
    if record.status == "INVALID_GEOMETRY":
        raise HTTPException(
            status_code=409,
            detail="Impossible d'exporter un dossier dont la géométrie est invalide : corrigez la parcelle puis relancez l'audit.",
        )
    # P0 (recette 2026-10-08) : une parcelle déforestée après 2020 n'est pas
    # exportable comme déclaration de conformité — blocage, pas simple signalement.
    if record.status == "NON_COMPLIANT" or record.compliant is False:
        raise HTTPException(
            status_code=409,
            detail="Export bloqué : la parcelle présente une déforestation post-2020. Mitigation et revue humaine requises.",
        )
    # P0-04 : une analyse simulée ou indisponible ne peut pas alimenter une
    # déclaration de diligence raisonnée. Le contrôle est serveur : l'interface
    # n'est pas une barrière.
    if not record.analysis_probative:
        raise HTTPException(
            status_code=409,
            detail=(
                "Export refusé : l'analyse de cette parcelle est une simulation de démonstration, sans valeur probante."
                if record.analysis_source == "simulated"
                else "Export refusé : aucune analyse satellite n'a pu être obtenue pour cette parcelle. "
                "Aucune déclaration ne peut être établie sans données réelles."
            ),
        )

    # ------------------------------------------------------------------ Lot A
    # L'identité vient du dossier **ou** de la requête, jamais d'un remplissage.
    #
    # ⚠️ Cette branche reprenait `record.operator_eori` sans contrôle, et
    #   faisait `record.operator_eori[:2]` : un dossier sans identité (colonne
    #   désormais NULL) aurait levé une TypeError, et un dossier hérité
    #   `XX0000000000000` serait parti avec un EORI de synthèse — un dossier
    #   faussement complet.
    identite = classer_identite_operateur(record.operator_name, record.operator_eori)
    operator: Dict[str, Any]
    if payload.operator is not None:
        operator = payload.operator.model_dump()
    elif identite.exportable:
        eori_stocke = (record.operator_eori or "").strip()
        operator = {
            "name": record.operator_name or "",
            "eori": eori_stocke,
            "country": record.operator_country or eori_stocke[:2],
            "address": "",
            "email": "",
        }
    else:
        # Aucune identité exploitable : refus explicite, distinct d'un refus
        # pour analyse non probante (409) déjà traité plus haut.
        raise HTTPException(
            status_code=422,
            detail={
                "code": "OPERATOR_IDENTITY_MISSING",
                "operator_identity": identite.etat,
                "message": (
                    f"Export refusé : {identite.raison} "
                    "Renseignez l'identité dans la requête (champ `operator`), "
                    "puis relancez l'export. Aucune identité de remplacement "
                    "n'est fabriquée."
                ),
            },
        )

    options = {
        "activity_type": payload.activity_type,
        "net_weight_kg": payload.net_weight_kg,
        "internal_reference": payload.internal_reference,
        "country_of_activity": payload.country_of_activity.upper(),
    }
    reference = payload.internal_reference or build_reference(record.id)
    db.mark_draft_generated(record.id, reference)

    filename = f"DDS_{reference}"
    if payload.format == "json":
        body = export_traces_json(record, operator, options)
        return Response(
            content=__import__("json").dumps(body, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}.json"'},
        )

    xml_bytes = export_traces_xml(record, operator, options)
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}.xml"'},
    )
