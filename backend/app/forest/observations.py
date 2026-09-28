"""Satellite signal summaries, deliberately not EUDR conclusions.

Selection must be supplied by a separately qualified geometry/grid intersection
method. This module alone does not establish an entire parcel's coverage.
"""

import numpy as np

LIMITATIONS = (
    "Perte de couvert arboré cartographiée, pas conversion agricole démontrée.",
    "Le masque terre/eau/sans données est fondé sur 2000–2012, pas sur la visibilité annuelle.",
    "La source arrêtée en 2025 ne couvre pas l'année 2026 ni une période ultérieure.",
    "Un pixel peut dépasser la parcelle ; le signal n'est pas localisé plus finement dans ce pixel.",
    "Aucun seuil de couvert 2000 ne définit à lui seul une forêt au 31 décembre 2020.",
    "Ni probabilité de conformité, ni surface de déforestation juridique calculée.",
)


def summarize_gfc(lossyear, datamask, selection):
    for a, dtype in ((lossyear, np.uint8), (datamask, np.uint8), (selection, np.bool_)):
        if type(a) is not np.ndarray or a.ndim != 2 or a.dtype != dtype:
            raise ValueError("TYPED_2D_ARRAY_REQUIRED")
        if a.size > 256**2:
            raise ValueError("SUMMARY_PIXEL_BUDGET")
    if lossyear.shape != datamask.shape or lossyear.shape != selection.shape:
        raise ValueError("GRID_SHAPE_MISMATCH")
    if np.any(lossyear > 25) or np.any(datamask > 2):
        raise ValueError("UNKNOWN_RASTER_CLASS")
    selected = int(np.count_nonzero(selection))
    land = selection & (datamask == 1)
    post_cutoff = selection & (lossyear >= 21)
    signal_count = int(np.count_nonzero(post_cutoff))
    land_count = int(np.count_nonzero(land))
    # Do not suppress a positive signal because a historical land mask differs.
    conflict_count = int(np.count_nonzero(post_cutoff & (datamask != 1)))
    state = (
        "SIGNAL_OBSERVED"
        if signal_count
        else "NO_SIGNAL_IN_SELECTED_LAND_PIXELS"
        if land_count
        else "NOT_ASSESSABLE"
    )
    years, counts = np.unique(lossyear[selection & (lossyear > 0)], return_counts=True)
    return {
        "method_version": "gfc-selected-pixels-v1-qualification",
        "signal_status": state,
        "selected_pixels": selected,
        "historical_land_mask_pixels": land_count,
        "historical_water_mask_pixels": int(
            np.count_nonzero(selection & (datamask == 2))
        ),
        "historical_no_data_mask_pixels": int(
            np.count_nonzero(selection & (datamask == 0))
        ),
        "post_2020_signal_pixels": signal_count,
        "signal_outside_historical_land_mask_pixels": conflict_count,
        "loss_year_pixel_counts": {
            str(2000 + int(y)): int(n) for y, n in zip(years, counts)
        },
        "data_period_end_year": 2025,
        "cutoff_date": "2020-12-31",
        "coverage_of_entire_parcel": "NOT_ESTABLISHED_BY_THIS_SUMMARY",
        "forest_state_2020_assessed": False,
        "agricultural_conversion_assessed": False,
        "eudr_forest_degradation_assessed": False,
        "regulatory_status": "NOT_ASSESSED",
        "human_review_required": True,
        "confidence_probability": None,
        "deforested_area_ha": None,
        "limitations": list(LIMITATIONS),
    }
