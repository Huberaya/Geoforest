"""Export des dossiers de diligence raisonnée (DDS) vers TRACES-NT (EUDR).

Le document XML produit suit la structure du service de soumission EUDR de TRACES-NT
(`SubmitStatementRequest`, namespaces `http://ec.europa.eu/tracesnt/certificate/eudr/...`) :
  * opérateur (nom, EORI, adresse),
  * activité (IMPORT / EXPORT / DOMESTIC) et pays,
  * marchandise (code SH, description, poids net),
  * producteur / parcelles : géométrie GeoJSON encodée en base64 (champ `geometryGeojson`),
  * bloc de vérification GeoForest Trace (statut, surface, risque, année de perte).
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from lxml import etree

from app.core.config import settings
from app.models.schemas import COMMODITY_HS_CODES, COMMODITY_LABELS
from app.models.sql_models import ParcelAuditRecord

NS_SUBMISSION = "http://ec.europa.eu/tracesnt/certificate/eudr/submission/v1"
NS_MODEL = "http://ec.europa.eu/tracesnt/certificate/eudr/model/v1"
NS_GFT = "https://geoforest-trace.eu/schema/verification/v1"

NSMAP = {"eudr": NS_SUBMISSION, "model": NS_MODEL, "gft": NS_GFT}


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def _sub(parent: etree._Element, ns: str, tag: str, text: Optional[Any] = None) -> etree._Element:
    el = etree.SubElement(parent, _q(ns, tag))
    if text is not None:
        el.text = str(text)
    return el


def build_reference(audit_id: str) -> str:
    """Référence interne DDS : GFT-<année>-<8 premiers caractères de l'audit>."""
    return f"GFT-{datetime.now(timezone.utc).year}-{audit_id.replace('-', '')[:8].upper()}"


def _geometry_feature_collection(record: ParcelAuditRecord) -> Dict[str, Any]:
    """TRACES attend un FeatureCollection ; on y injecte les attributs de la parcelle."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "ProducerName": record.operator_name,
                    "ProducerCountry": record.country_code,
                    "ProductionPlace": record.id,
                    "Area": round(record.area_ha, 4),
                    "HarvestDate": record.harvest_date,
                },
                "geometry": record.geometry,
            }
        ],
    }


def _dds_payload(record: ParcelAuditRecord, operator: Dict[str, Any], options: Dict[str, Any]) -> Dict[str, Any]:
    """Représentation canonique (dict) du DDS, base commune du XML et du JSON."""
    reference = options.get("internal_reference") or build_reference(record.id)
    geojson_fc = _geometry_feature_collection(record)
    geojson_b64 = base64.b64encode(json.dumps(geojson_fc, separators=(",", ":")).encode("utf-8")).decode("ascii")
    hs_code = record.hs_code or COMMODITY_HS_CODES.get(record.commodity, "")
    verification_status = "VERIFIED_COMPLIANT" if record.compliant and record.status != "INVALID_GEOMETRY" else "VERIFIED_NON_COMPLIANT"

    return {
        "schema": {"submission": NS_SUBMISSION, "model": NS_MODEL, "verification": NS_GFT},
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "operator_type": "OPERATOR",
        "operator": {
            "reference_number": {"type": "EORI", "identifier": operator["eori"]},
            "name": operator["name"],
            "country": operator.get("country", "FR"),
            "address": operator.get("address") or "",
            "email": operator.get("email") or "",
        },
        "statement": {
            "internal_reference_number": reference,
            "activity_type": options.get("activity_type", "IMPORT"),
            "country_of_activity": options.get("country_of_activity", "FR"),
            "border_cross_country": options.get("country_of_activity", "FR"),
            "comment": f"Généré par GeoForest Trace — audit {record.id}",
            "commodities": [
                {
                    "hs_heading": hs_code,
                    "description_of_goods": COMMODITY_LABELS.get(record.commodity, record.commodity),
                    "goods_measure": {
                        "net_weight_kg": options.get("net_weight_kg"),
                        "supplementary_unit": None,
                    },
                    "producers": [
                        {
                            "country": record.country_code,
                            "name": record.operator_name,
                            "geometry_geojson_base64": geojson_b64,
                            "geometry_geojson": geojson_fc,
                        }
                    ],
                }
            ],
            "geolocation_confidential": False,
        },
        "verification": {
            "provider": "GeoForest Trace",
            "audit_id": record.id,
            "audited_at": record.created_at,
            "status": verification_status,
            "eudr_cutoff_date": settings.eudr_cutoff_date.isoformat(),
            "harvest_date": record.harvest_date,
            "geometry_type": record.geometry_type,
            "area_ha": round(record.area_ha, 4),
            "geometry_rule": "POLYGON_REQUIRED" if record.area_ha >= settings.eudr_polygon_threshold_ha else "POINT_ALLOWED",
            "deforestation_detected_post_cutoff": not record.compliant,
            "loss_year": record.loss_year,
            "confidence_score": record.confidence_score,
            "risk_level": record.risk_level,
            "country_benchmark_risk": record.country_risk,
            "satellite_source": record.satellite.get("source", ""),
            "centroid": {"lon": record.centroid_lon, "lat": record.centroid_lat},
        },
    }


def export_traces_json(record: ParcelAuditRecord, operator: Dict[str, Any], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return _dds_payload(record, operator, options or {})


def export_traces_xml(record: ParcelAuditRecord, operator: Dict[str, Any], options: Optional[Dict[str, Any]] = None) -> bytes:
    """Génère le XML `SubmitStatementRequest` prêt pour TRACES-NT (UTF-8, indenté)."""
    data = _dds_payload(record, operator, options or {})

    root = etree.Element(_q(NS_SUBMISSION, "SubmitStatementRequest"), nsmap=NSMAP)
    root.set("generatedAt", data["generated_at"])
    root.set("messageId", str(uuid.uuid4()))

    _sub(root, NS_SUBMISSION, "operatorType", data["operator_type"])

    statement = _sub(root, NS_SUBMISSION, "statement")
    _sub(statement, NS_MODEL, "internalReferenceNumber", data["statement"]["internal_reference_number"])
    _sub(statement, NS_MODEL, "activityType", data["statement"]["activity_type"])

    operator_el = _sub(statement, NS_MODEL, "operator")
    ref = _sub(operator_el, NS_MODEL, "referenceNumber")
    _sub(ref, NS_MODEL, "identifierType", "EORI")
    _sub(ref, NS_MODEL, "identifierValue", data["operator"]["reference_number"]["identifier"])
    name_and_address = _sub(operator_el, NS_MODEL, "nameAndAddress")
    _sub(name_and_address, NS_MODEL, "name", data["operator"]["name"])
    _sub(name_and_address, NS_MODEL, "country", data["operator"]["country"])
    _sub(name_and_address, NS_MODEL, "address", data["operator"]["address"])
    if data["operator"]["email"]:
        _sub(operator_el, NS_MODEL, "email", data["operator"]["email"])

    _sub(statement, NS_MODEL, "countryOfActivity", data["statement"]["country_of_activity"])
    _sub(statement, NS_MODEL, "borderCrossCountry", data["statement"]["border_cross_country"])
    _sub(statement, NS_MODEL, "comment", data["statement"]["comment"])

    for commodity in data["statement"]["commodities"]:
        commodity_el = _sub(statement, NS_MODEL, "commodities")
        descriptors = _sub(commodity_el, NS_MODEL, "descriptors")
        _sub(descriptors, NS_MODEL, "descriptionOfGoods", commodity["description_of_goods"])
        measure = _sub(descriptors, NS_MODEL, "goodsMeasure")
        if commodity["goods_measure"]["net_weight_kg"] is not None:
            _sub(measure, NS_MODEL, "netWeight", f"{commodity['goods_measure']['net_weight_kg']:.3f}")
        _sub(commodity_el, NS_MODEL, "hsHeading", commodity["hs_heading"])
        for producer in commodity["producers"]:
            producer_el = _sub(commodity_el, NS_MODEL, "producers")
            _sub(producer_el, NS_MODEL, "country", producer["country"])
            _sub(producer_el, NS_MODEL, "name", producer["name"])
            _sub(producer_el, NS_MODEL, "geometryGeojson", producer["geometry_geojson_base64"])

    _sub(statement, NS_MODEL, "geoLocationConfidential", "false")

    verification = data["verification"]
    ver_el = _sub(root, NS_GFT, "verification")
    ver_el.set("provider", verification["provider"])
    for key in (
        "audit_id",
        "audited_at",
        "status",
        "eudr_cutoff_date",
        "harvest_date",
        "geometry_type",
        "area_ha",
        "geometry_rule",
        "deforestation_detected_post_cutoff",
        "loss_year",
        "confidence_score",
        "risk_level",
        "country_benchmark_risk",
        "satellite_source",
    ):
        value = verification[key]
        tag = "".join(part.capitalize() if i else part for i, part in enumerate(key.split("_")))
        if isinstance(value, bool):
            value = "true" if value else "false"
        _sub(ver_el, NS_GFT, tag, "" if value is None else value)
    centroid_el = _sub(ver_el, NS_GFT, "centroid")
    centroid_el.set("lon", f"{verification['centroid']['lon']:.6f}")
    centroid_el.set("lat", f"{verification['centroid']['lat']:.6f}")

    # Coordonnées lisibles (en plus du GeoJSON base64) pour contrôle douanier humain
    plots_el = _sub(ver_el, NS_GFT, "plotCoordinates")
    plots_el.set("crs", "EPSG:4326")
    plots_el.set("order", "lon,lat")
    _sub(plots_el, NS_GFT, "geoJson", json.dumps(record.geometry, separators=(",", ":")))

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", pretty_print=True)


def validate_xml_well_formed(xml_bytes: bytes) -> bool:
    """Contrôle de bonne formation (utilisé par les tests et avant téléchargement)."""
    try:
        etree.fromstring(xml_bytes)
        return True
    except etree.XMLSyntaxError:
        return False
