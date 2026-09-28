import numpy as np
import pytest
from app.forest.observations import summarize_gfc


def run(loss, mask, selection=None):
    a = np.array([loss], dtype=np.uint8)
    b = np.array([mask], dtype=np.uint8)
    selected = (
        np.array([selection], dtype=bool)
        if selection is not None
        else np.ones_like(a, dtype=bool)
    )
    return summarize_gfc(a, b, selected)


def test_cutoff_and_no_fabricated_verdict():
    r = run([0, 20, 21, 25], [1, 1, 1, 1])
    assert r["post_2020_signal_pixels"] == 2
    assert r["loss_year_pixel_counts"] == {"2020": 1, "2021": 1, "2025": 1}
    assert r["signal_status"] == "SIGNAL_OBSERVED"
    assert r["confidence_probability"] is None
    assert r["deforested_area_ha"] is None
    assert r["regulatory_status"] == "NOT_ASSESSED"
    assert r["human_review_required"]
    assert not r["forest_state_2020_assessed"]


def test_no_data_never_means_no_signal():
    r = run([0, 0], [0, 2])
    assert r["signal_status"] == "NOT_ASSESSABLE"
    assert r["historical_no_data_mask_pixels"] == 1
    assert r["historical_water_mask_pixels"] == 1


def test_positive_signal_not_hidden_by_old_mask():
    r = run([25, 21], [0, 2])
    assert r["signal_status"] == "SIGNAL_OBSERVED"
    assert r["signal_outside_historical_land_mask_pixels"] == 2


def test_zero_loss_on_mapped_land_is_not_entire_parcel_clear():
    r = run([0, 20], [1, 1])
    assert r["signal_status"] == "NO_SIGNAL_IN_SELECTED_LAND_PIXELS"
    assert r["coverage_of_entire_parcel"] == "NOT_ESTABLISHED_BY_THIS_SUMMARY"
    assert r["regulatory_status"] == "NOT_ASSESSED"


def test_no_selected_pixels():
    r = run([25], [1], [False])
    assert r["signal_status"] == "NOT_ASSESSABLE"
    assert r["selected_pixels"] == 0


def test_selection_not_all_pixels():
    r = run([25, 0], [1, 1], [False, True])
    assert r["post_2020_signal_pixels"] == 0
    assert r["selected_pixels"] == 1


@pytest.mark.parametrize("loss,mask", [([26], [1]), ([0], [3]), ([255], [1])])
def test_unknown_classes(loss, mask):
    with pytest.raises(ValueError, match="UNKNOWN_RASTER_CLASS"):
        run(loss, mask)


def test_shapes_and_types():
    a = np.zeros((1, 1), dtype=np.uint8)
    with pytest.raises(ValueError, match="TYPED_2D_ARRAY_REQUIRED"):
        summarize_gfc(a.astype(float), a, a.astype(bool))
    with pytest.raises(ValueError, match="GRID_SHAPE_MISMATCH"):
        summarize_gfc(a, np.zeros((2, 2), dtype=np.uint8), a.astype(bool))
    big = np.zeros((257, 256), dtype=np.uint8)
    with pytest.raises(ValueError, match="SUMMARY_PIXEL_BUDGET"):
        summarize_gfc(big, big, big.astype(bool))


def test_masked_arrays_cannot_silently_hide_observations():
    a = np.ma.array([[25]], dtype=np.uint8, mask=[[True]])
    with pytest.raises(ValueError, match="TYPED_2D_ARRAY_REQUIRED"):
        summarize_gfc(a, np.ones((1, 1), dtype=np.uint8), np.ones((1, 1), dtype=bool))
