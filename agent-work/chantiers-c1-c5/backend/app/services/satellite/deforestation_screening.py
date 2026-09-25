"""Dépistage prudent de perte de couvert arboré pour une parcelle.

Ce service ne conclut jamais à la conformité EUDR. Il interroge la version configurée
et figée du jeu GFW `umd_tree_cover_loss`; il ne contient aucun jeu de données simulé
ni aucun repli déterministe. Toute perte signalée nécessite une revue humaine.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any

import httpx
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry

from app.core.config import settings

logger = logging.getLogger(__name__)

CUTOFF_DATE = date(2020, 12, 31)
ALGORITHM_VERSION = "c5-screening-v1"
DATASET_FIRST_YEAR = 2001
DATASET_LAST_YEAR = 2025  # UMD/GFW `umd_tree_cover_loss` v1.13, vérifié le 25/09/2026.
SPATIAL_RESOLUTION_M = 30
# La table `umd_tree_cover_density_2000__threshold` stocke des codes, pas les pourcentages.
# Correspondance confirmée pour les champs de la version v1.13 (1→10 %, 5→30 %).
GFW_THRESHOLD_CODES = {("umd_tree_cover_loss", "v1.13"): {10: 1, 30: 5}}


class ScreeningStatus(str, Enum):
    signal_post_2020 = "signal_post_2020"
    no_signal_observed = "no_signal_observed"
    non_evaluable = "non_evaluable"
    source_unavailable = "source_unavailable"


@dataclass(frozen=True)
class ScreeningOutcome:
    status: ScreeningStatus
    review_required: bool
    source: str
    dataset: str
    dataset_version: str
    api_spec_version: str
    algorithm_version: str
    cutoff_date: str
    data_first_year: int
    data_last_year: int
    spatial_resolution_m: int
    canopy_thresholds_pct: tuple[int, int]
    plot_area_ha: float | None
    geometry_sha256: str | None
    loss_by_year: tuple[dict[str, int | float | None], ...]
    pre_cutoff_loss_ha_10pct: float | None
    post_cutoff_loss_ha_10pct: float | None
    pre_cutoff_loss_ha_30pct: float | None
    post_cutoff_loss_ha_30pct: float | None
    post_cutoff_share_pct_10pct: float | None
    first_post_cutoff_year_10pct: int | None
    boundary_year_uncertainty: bool
    caveats: tuple[str, ...]
    message: str
    error_code: str | None
    analyzed_at: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "review_required": self.review_required,
            "source": self.source,
            "dataset": self.dataset,
            "dataset_version": self.dataset_version,
            "api_spec_version": self.api_spec_version,
            "algorithm_version": self.algorithm_version,
            "cutoff_date": self.cutoff_date,
            "data_first_year": self.data_first_year,
            "data_last_year": self.data_last_year,
            "spatial_resolution_m": self.spatial_resolution_m,
            "canopy_thresholds_pct": list(self.canopy_thresholds_pct),
            "plot_area_ha": self.plot_area_ha,
            "geometry_sha256": self.geometry_sha256,
            "loss_by_year": [dict(row) for row in self.loss_by_year],
            "pre_cutoff_loss_ha_10pct": self.pre_cutoff_loss_ha_10pct,
            "post_cutoff_loss_ha_10pct": self.post_cutoff_loss_ha_10pct,
            "pre_cutoff_loss_ha_30pct": self.pre_cutoff_loss_ha_30pct,
            "post_cutoff_loss_ha_30pct": self.post_cutoff_loss_ha_30pct,
            "post_cutoff_share_pct_10pct": self.post_cutoff_share_pct_10pct,
            "first_post_cutoff_year_10pct": self.first_post_cutoff_year_10pct,
            "boundary_year_uncertainty": self.boundary_year_uncertainty,
            "caveats": list(self.caveats),
            "message": self.message,
            "error_code": self.error_code,
            "analyzed_at": self.analyzed_at,
        }


class GFWProviderError(Exception):
    """Erreur de source destinée à être convertie en état explicite, jamais en « aucun signal »."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _provider_gate_error_code() -> str | None:
    """N'autorise le live qu'avec clé, opt-in explicite, contrat validé et mapping versionné."""
    if not settings.gfw_api_key:
        return "GFW_NOT_CONFIGURED"
    if not settings.gfw_live_enabled:
        return "GFW_DISABLED"
    if not settings.gfw_contract_verified:
        return "GFW_CONTRACT_NOT_VERIFIED"
    if (settings.gfw_dataset, settings.gfw_dataset_version) not in GFW_THRESHOLD_CODES:
        return "GFW_THRESHOLD_MAPPING_UNVERIFIED"
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_outcome(
    *,
    status: ScreeningStatus,
    message: str,
    geometry_sha256: str | None,
    plot_area_ha: float | None,
    error_code: str | None = None,
) -> ScreeningOutcome:
    return ScreeningOutcome(
        status=status,
        review_required=True,
        source="GFW Data API",
        dataset=settings.gfw_dataset,
        dataset_version=settings.gfw_dataset_version,
        api_spec_version="0.3.0",
        algorithm_version=ALGORITHM_VERSION,
        cutoff_date=CUTOFF_DATE.isoformat(),
        data_first_year=DATASET_FIRST_YEAR,
        data_last_year=DATASET_LAST_YEAR,
        spatial_resolution_m=SPATIAL_RESOLUTION_M,
        canopy_thresholds_pct=(settings.gfw_canopy_threshold_pct, settings.gfw_sensitivity_canopy_threshold_pct),
        plot_area_ha=plot_area_ha,
        geometry_sha256=geometry_sha256,
        loss_by_year=(),
        pre_cutoff_loss_ha_10pct=None,
        post_cutoff_loss_ha_10pct=None,
        pre_cutoff_loss_ha_30pct=None,
        post_cutoff_loss_ha_30pct=None,
        post_cutoff_share_pct_10pct=None,
        first_post_cutoff_year_10pct=None,
        boundary_year_uncertainty=False,
        caveats=_caveats(),
        message=message,
        error_code=error_code,
        analyzed_at=_now_iso(),
    )


def _caveats() -> tuple[str, ...]:
    return (
        "Une perte de couvert arboré n'est pas, à elle seule, une preuve de déforestation au sens EUDR.",
        "La couche annuelle de 30 m peut inclure récolte forestière, plantations, incendies, maladies ou tempêtes; elle comporte des faux positifs et faux négatifs.",
        "L'année cartographiée ne donne pas le jour exact; l'année 2021 est signalée comme proche de la date butoir du 31/12/2020.",
        "L'absence de signal dans cette source ne prouve pas la conformité, l'absence de déforestation ou l'absence de dégradation forestière.",
        "Le seuil de couvert 10 % est un filtre de dépistage, non la détermination juridique d'une forêt; 30 % est présenté uniquement comme sensibilité.",
        "Le jeu v1.13 est annuel, actuellement disponible jusqu'en 2025; sa méthode historique n'est pas homogène sur toute la série.",
    )


def _validated_polygon(geojson: dict[str, Any]) -> tuple[BaseGeometry, dict[str, Any]]:
    try:
        geom = shape(geojson)
    except Exception as exc:
        raise ValueError("Géométrie GeoJSON illisible.") from exc
    if not isinstance(geom, (Polygon, MultiPolygon)):
        raise TypeError("Le dépistage satellitaire C5 exige un Polygon ou MultiPolygon.")
    if geom.is_empty or not geom.is_valid or geom.area <= 0:
        raise ValueError("Géométrie polygonale vide ou invalide.")
    normalized = mapping(geom)
    return geom, normalized


def geometry_sha256(geojson: dict[str, Any]) -> str:
    """Empreinte stable de la géométrie normalisée; les coordonnées ne sont pas dupliquées."""
    _geom, normalized = _validated_polygon(geojson)
    encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _sql_for_threshold(threshold_pct: int) -> str:
    # `threshold_pct` provient de Settings, jamais de la requête HTTP du client.
    version_codes = GFW_THRESHOLD_CODES.get((settings.gfw_dataset, settings.gfw_dataset_version))
    if version_codes is None:
        raise GFWProviderError("GFW_THRESHOLD_MAPPING_UNVERIFIED")
    threshold_code = version_codes.get(threshold_pct)
    if threshold_code is None:
        raise ValueError("Seuls les seuils de dépistage 10 % et 30 % sont autorisés.")
    return (
        "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha "
        "FROM results "
        f"WHERE umd_tree_cover_density_2000__threshold = {threshold_code} "
        "AND umd_tree_cover_loss__year IS NOT NULL "
        "GROUP BY umd_tree_cover_loss__year "
        "ORDER BY umd_tree_cover_loss__year"
    )


def _decode_year(raw: Any) -> int:
    try:
        numeric = float(raw)
        if not numeric.is_integer():
            raise ValueError("year is not an integer")
        year = int(numeric)
    except (TypeError, ValueError, OverflowError) as exc:
        raise GFWProviderError("GFW_INVALID_YEAR") from exc
    # Raster metadata can expose its legend code (1=2001 ... 25=2025) or the mapped year.
    if 1 <= year <= DATASET_LAST_YEAR - DATASET_FIRST_YEAR + 1:
        year += 2000
    if not DATASET_FIRST_YEAR <= year <= DATASET_LAST_YEAR:
        raise GFWProviderError("GFW_YEAR_OUT_OF_RANGE")
    return year


def _extract_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise GFWProviderError("GFW_INVALID_JSON") from exc
    if isinstance(payload, dict):
        if payload.get("status") not in {None, "success"}:
            raise GFWProviderError("GFW_QUERY_FAILED")
        if "data" not in payload:
            raise GFWProviderError("GFW_INVALID_RESPONSE")
        data = payload["data"]
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError as exc:
                raise GFWProviderError("GFW_INVALID_JSON") from exc
        if isinstance(data, dict) and isinstance(data.get("data"), list):
            data = data["data"]
        if isinstance(data, list):
            rows = data
        else:
            raise GFWProviderError("GFW_INVALID_RESPONSE")
    elif isinstance(payload, list):
        rows = payload
    else:
        raise GFWProviderError("GFW_INVALID_RESPONSE")
    if not all(isinstance(row, dict) for row in rows):
        raise GFWProviderError("GFW_INVALID_RESPONSE")
    return rows


def _normalize_rows(rows: list[dict[str, Any]]) -> dict[int, float]:
    by_year: dict[int, float] = {}
    for row in rows:
        if "umd_tree_cover_loss__year" not in row and "loss_year" not in row:
            raise GFWProviderError("GFW_INVALID_RESPONSE")
        raw_year = row.get("umd_tree_cover_loss__year", row.get("loss_year"))
        if raw_year is None:
            continue
        year = _decode_year(raw_year)
        if "area__ha" not in row and "loss_area_ha" not in row:
            raise GFWProviderError("GFW_INVALID_RESPONSE")
        raw_area = row.get("area__ha", row.get("loss_area_ha"))
        if raw_area is None:
            raise GFWProviderError("GFW_INVALID_AREA")
        try:
            area = float(raw_area)
        except (TypeError, ValueError, OverflowError) as exc:
            raise GFWProviderError("GFW_INVALID_AREA") from exc
        if not math.isfinite(area) or area < 0:
            raise GFWProviderError("GFW_INVALID_AREA")
        by_year[year] = by_year.get(year, 0.0) + area
    return by_year


async def _query_gfw_yearly_loss_unchecked(
    geometry: dict[str, Any],
    canopy_threshold_pct: int,
) -> dict[int, float]:
    """Transport bas niveau; à n'appeler qu'après une garde métier ou depuis le probe C5 contrôlé."""
    url = (
        f"{settings.gfw_api_url.rstrip('/')}/dataset/{settings.gfw_dataset}/"
        f"{settings.gfw_dataset_version}/query/json"
    )
    headers = {
        "x-api-key": settings.gfw_api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if settings.gfw_api_origin:
        headers["Origin"] = settings.gfw_api_origin
    try:
        async with httpx.AsyncClient(
            timeout=settings.gfw_timeout_seconds,
            follow_redirects=False,
        ) as client:
            response = await client.post(
                url,
                headers=headers,
                json={"sql": _sql_for_threshold(canopy_threshold_pct), "geometry": geometry},
            )
    except httpx.TimeoutException as exc:
        raise GFWProviderError("GFW_TIMEOUT") from exc
    except httpx.RequestError as exc:
        raise GFWProviderError("GFW_NETWORK_ERROR") from exc

    if response.status_code != 200:
        # Le corps externe peut contenir des détails opérationnels; ne pas le journaliser/retourner.
        code = "GFW_LEGACY_REDIRECT" if response.status_code in {301, 302, 307, 308} else f"GFW_HTTP_{response.status_code}"
        raise GFWProviderError(code)
    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError) as exc:
        raise GFWProviderError("GFW_INVALID_JSON") from exc
    return _normalize_rows(_extract_rows(payload))


async def query_gfw_yearly_loss(
    geometry: dict[str, Any],
    canopy_threshold_pct: int,
) -> dict[int, float]:
    """Appelle `query/json` après toutes les gardes; aucune redirection ni valeur de repli."""
    gate_error = _provider_gate_error_code()
    if gate_error is not None:
        raise GFWProviderError(gate_error)
    return await _query_gfw_yearly_loss_unchecked(geometry, canopy_threshold_pct)


def _build_outcome(
    *,
    rows_10pct: dict[int, float],
    rows_30pct: dict[int, float],
    geometry_hash: str,
    plot_area_ha: float | None,
) -> ScreeningOutcome:
    years = sorted(set(rows_10pct) | set(rows_30pct))
    loss_by_year = tuple(
        {
            "year": year,
            "area_ha_10pct": round(rows_10pct.get(year, 0.0), 6),
            "area_ha_30pct": round(rows_30pct.get(year, 0.0), 6),
        }
        for year in years
    )
    pre_10 = sum(area for year, area in rows_10pct.items() if year <= 2020)
    post_10 = sum(area for year, area in rows_10pct.items() if year > 2020)
    pre_30 = sum(area for year, area in rows_30pct.items() if year <= 2020)
    post_30 = sum(area for year, area in rows_30pct.items() if year > 2020)
    first_post = min((year for year, area in rows_10pct.items() if year > 2020 and area > 0), default=None)
    has_signal = post_10 > 0
    share = (post_10 / plot_area_ha * 100.0) if plot_area_ha and plot_area_ha > 0 else None
    boundary_uncertainty = any(
        year in {2020, 2021} and (rows_10pct.get(year, 0.0) > 0 or rows_30pct.get(year, 0.0) > 0)
        for year in set(rows_10pct) | set(rows_30pct)
    )
    return ScreeningOutcome(
        status=ScreeningStatus.signal_post_2020 if has_signal else ScreeningStatus.no_signal_observed,
        review_required=True,
        source="GFW Data API",
        dataset=settings.gfw_dataset,
        dataset_version=settings.gfw_dataset_version,
        api_spec_version="0.3.0",
        algorithm_version=ALGORITHM_VERSION,
        cutoff_date=CUTOFF_DATE.isoformat(),
        data_first_year=DATASET_FIRST_YEAR,
        data_last_year=DATASET_LAST_YEAR,
        spatial_resolution_m=SPATIAL_RESOLUTION_M,
        canopy_thresholds_pct=(settings.gfw_canopy_threshold_pct, settings.gfw_sensitivity_canopy_threshold_pct),
        plot_area_ha=plot_area_ha,
        geometry_sha256=geometry_hash,
        loss_by_year=loss_by_year,
        pre_cutoff_loss_ha_10pct=round(pre_10, 6),
        post_cutoff_loss_ha_10pct=round(post_10, 6),
        pre_cutoff_loss_ha_30pct=round(pre_30, 6),
        post_cutoff_loss_ha_30pct=round(post_30, 6),
        post_cutoff_share_pct_10pct=round(share, 6) if share is not None else None,
        first_post_cutoff_year_10pct=first_post,
        boundary_year_uncertainty=boundary_uncertainty,
        caveats=_caveats(),
        message=(
            "Signal annuel de perte de couvert arboré à partir de 2021; revue humaine requise. "
            "Ce résultat ne conclut pas à une déforestation ni à une non-conformité EUDR."
            if has_signal
            else "Aucun signal de perte de couvert arboré post-2020 n'a été retourné par cette source. "
            "Cela ne prouve pas la conformité ni l'absence de déforestation."
        ),
        error_code=None,
        analyzed_at=_now_iso(),
    )


async def screen_plot(
    geojson: dict[str, Any] | None,
    plot_area_ha: float | None,
) -> ScreeningOutcome:
    """Exécute un dépistage; les erreurs de source restent distinctes d'une absence de signal."""
    if not isinstance(geojson, dict):
        return _empty_outcome(
            status=ScreeningStatus.non_evaluable,
            message="Aucune géométrie exploitable n'est disponible pour le dépistage.",
            geometry_sha256=None,
            plot_area_ha=plot_area_ha,
            error_code="GEOMETRY_MISSING",
        )
    try:
        _geom, normalized_geometry = _validated_polygon(geojson)
        geometry_hash = geometry_sha256(normalized_geometry)
    except TypeError:
        return _empty_outcome(
            status=ScreeningStatus.non_evaluable,
            message="Le dépistage satellitaire C5 accepte uniquement les polygones; aucun tampon n'est créé pour un point.",
            geometry_sha256=None,
            plot_area_ha=plot_area_ha,
            error_code="POLYGON_REQUIRED_FOR_SCREENING",
        )
    except ValueError:
        return _empty_outcome(
            status=ScreeningStatus.non_evaluable,
            message="La géométrie n'est pas exploitable pour le dépistage. Corrigez-la puis relancez la validation technique.",
            geometry_sha256=None,
            plot_area_ha=plot_area_ha,
            error_code="INVALID_SCREENING_GEOMETRY",
        )

    gate_error = _provider_gate_error_code()
    if gate_error is not None:
        return _empty_outcome(
            status=ScreeningStatus.source_unavailable,
            message=(
                "Le fournisseur GFW est absent, désactivé, non validé en live ou configuré "
                "avec un mapping de seuil non vérifié. Aucun résultat simulé n'a été utilisé."
            ),
            geometry_sha256=geometry_hash,
            plot_area_ha=plot_area_ha,
            error_code=gate_error,
        )

    try:
        rows_10pct = await query_gfw_yearly_loss(normalized_geometry, settings.gfw_canopy_threshold_pct)
        rows_30pct = await query_gfw_yearly_loss(
            normalized_geometry, settings.gfw_sensitivity_canopy_threshold_pct
        )
    except GFWProviderError as exc:
        logger.warning("Dépistage GFW indisponible (code=%s)", exc.code)
        return _empty_outcome(
            status=ScreeningStatus.source_unavailable,
            message="La source satellitaire n'a pas fourni de réponse exploitable. Aucun résultat simulé n'a été utilisé.",
            geometry_sha256=geometry_hash,
            plot_area_ha=plot_area_ha,
            error_code=exc.code,
        )

    return _build_outcome(
        rows_10pct=rows_10pct,
        rows_30pct=rows_30pct,
        geometry_hash=geometry_hash,
        plot_area_ha=plot_area_ha,
    )


def screening_caveats() -> list[str]:
    """Expose les limites communes, y compris quand le fournisseur n'est pas disponible."""
    return list(_caveats())
