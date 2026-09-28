<!-- Written in ASD-STE100. Technical Names: JRC, TMF, COG, STAC, icechunk, xarray, EPSG:4326, AnnualChange, DeforestationYear, DegradationYear, TransitionMap_MainClasses, TransitionMap_Subtypes, UndisturbedDegradedForest, source.coop. -->

# JRC Tropical Moist Forests (TMF) v1.2025

This publication is a cloud-native mirror of the JRC Tropical Moist Forests (TMF) products. The pixel values of this mirror are identical to the JRC source. We re-packaged the files as Cloud-Optimized GeoTIFFs (COGs) and added a STAC index and a virtual icechunk cube.

## Producer and source

- Producer: European Commission, Joint Research Centre (JRC). This publication is a derivative of the work authored by the JRC.
- Source: JRC TMF v1.2025, <https://forobs.jrc.ec.europa.eu/TMF/data>. We downloaded each tile from the JRC download CGI.
- Reference: Vancutsem, C., Achard, F., Pekel, J.-F., et al. (2021). Long-term (1990-2019) monitoring of forest cover changes in the humid tropics. *Science Advances*. <https://doi.org/10.1126/sciadv.abe1603>

## Licence

Copernicus / JRC open data. Attribution is required. Name the JRC as the source. State that we re-packaged the files. The mirror does not imply endorsement by the European Commission.

## Changes to Original Publication

- We re-encoded each tile as a valid COG: internal overviews (nearest neighbour), corrected IFD order, ZSTD compression.
- We flipped south-up tiles to north-up. We re-adjusted the georeferencing. We did not change the values.
- There was no resampling, no reprojection, and no changes to the data.

## Coverage

| Property | Value |
| --- | --- |
| Extent | Pan-tropical land, 86 tiles of 10° × 10° |
| Resolution | Harmonized to ~30 m at the equator (0.000269°) |
| CRS | EPSG:4326 |
| Years | 1990 to 2025 |
| Products | 6 families, 41 layers, 3,526 COGs |
| Size | 117 GiB |

## Data Products

| Product | Pixel meaning | Type |
| --- | --- | --- |
| `AnnualChange_<YYYY>` | TMF status for one year, 6 classes | uint8 |
| `DeforestationYear` | Year of first deforestation, 0 = never | uint16 |
| `DegradationYear` | Year of first degradation, 0 = never | uint16 |
| `TransitionMap_MainClasses` | 9 transition classes at end of 2025 | uint8 |
| `TransitionMap_Subtypes` | 39 transition sub-types at end of 2025 | uint8 |
| `UndisturbedDegradedForest` | 1 undisturbed, 2 degraded, 3 other | uint8 |

Note that the JRC publishes this product alongside the [GFC2020](https://source.coop/epoch/jrc-global-forest-cover-2020) and [GFT2020](https://source.coop/epoch/jrc-global-forest-types-2020) products.

The tables below relate the stored raster value, the class description, and the colour in the colormap files. The STAC `classification` extension gives more details for `TransitionMap_MainClasses`, `TransitionMap_Subtypes` and `UndisturbedDegradedForest`. For the other three products, use the colormap and metadata files.

**`TransitionMap_MainClasses`** — `uint8`

| Value | Label | RGB |
| --- | --- | --- |
| 10 | Undisturbed tropical moist forest | 0,80,0 |
| 20 | Degraded tropical moist forest | 100,135,35 |
| 30 | Tropical moist forest regrowth | 210,250,60 |
| 41 | Deforested land — converted to tree plantations | 255,200,148 |
| 42 | Deforested land — converted to water | 0,200,150 |
| 43 | Deforested land — converted to other land cover | 255,230,100 |
| 50 | Ongoing deforestation/degradation (2023–2025) | 250,140,10 |
| 60 | Permanent and seasonal water | 0,70,160 |
| 70 | Other land cover (incl. afforestation) | 255,255,255 |

**`AnnualChange_<YYYY>`** — `uint8`, identical legend for every year 1990–2025

| Value | Label | RGB |
| --- | --- | --- |
| 1 | Undisturbed tropical moist forest | 0,90,0 |
| 2 | Degraded tropical moist forest | 100,155,35 |
| 3 | Deforested land | 255,135,15 |
| 4 | Tropical moist forest regrowth | 210,250,60 |
| 5 | Permanent and seasonal water | 0,140,190 |
| 6 | Other land cover | 255,255,255 |

**`UndisturbedDegradedForest`** — `uint8`

| Value | Label | RGB |
| --- | --- | --- |
| 1 | Undisturbed tropical moist forest | 0,90,0 |
| 2 | Degraded tropical moist forest | 100,155,35 |
| 3 | Other land cover | 255,255,255 |

**`DeforestationYear` / `DegradationYear`** — `uint16`, discrete years 1984–2025
rendered as a colour ramp (40,146,199)→(80,8,0); `0`/NoData = never
deforested/degraded.

<details>
<summary><b><code>TransitionMap_Subtypes</code></b> — <code>uint8</code>, 39 discrete classes (click to expand)</summary>

| Value | Label | RGB |
| --- | --- | --- |
| 10 | Undisturbed tropical moist forest | 0,80,0 |
| 11 | Bamboo-dominated forest | 10,100,10 |
| 12 | Undisturbed mangrove | 10,90,60 |
| 21 | Degraded forest, short-duration (started before 2016) | 30,120,0 |
| 22 | Degraded forest, short-duration (started 2016–2024) | 80,150,0 |
| 23 | Degraded forest, long-duration (started before 2016) | 100,160,40 |
| 24 | Degraded forest, long-duration (started 2016–2024) | 120,170,40 |
| 25 | Degraded forest, 2/3 periods (last started before 2016) | 100,160,40 |
| 26 | Degraded forest, 2/3 periods (last started 2016–2024) | 120,170,40 |
| 31 | Old forest regrowth (disturbed before 2006) | 185,200,60 |
| 32 | Young forest regrowth (disturbed 2006–2015) | 200,230,60 |
| 33 | Very young forest regrowth (disturbed 2016–2022) | 210,250,60 |
| 41 | Deforestation started before 2015 | 255,240,160 |
| 42 | Deforestation started 2015–2022 | 255,150,8 |
| 51 | Deforestation started 2023 | 250,60,10 |
| 52 | Deforestation started 2024 | 170,80,10 |
| 53 | Deforestation started 2025 | 140,100,30 |
| 54 | Degradation started 2025 | 140,120,60 |
| 61 | Degraded mangrove (started before 2016) | 40,100,50 |
| 62 | Mangrove recently degraded (2016–2024) | 80,150,0 |
| 63 | Mangrove regrowing (≥10 yr, 2016–2025) | 200,230,60 |
| 64 | Mangrove regrowing (≥3 yr, 2023–2025) | 210,250,60 |
| 65 | Mangrove deforested (started before 2015) | 255,230,110 |
| 66 | Mangrove deforested (started 2016–2022) | 255,60,10 |
| 67 | Mangrove recently disturbed (2023–2025) | 155,105,70 |
| 71 | Permanent water | 0,50,150 |
| 72 | Seasonal water | 0,150,200 |
| 73 | Deforestation to permanent water | 0,160,150 |
| 74 | Deforestation to seasonal water | 0,210,210 |
| 81 | Old plantation | 51,99,51 |
| 82 | Plantation regrowing (disturbed before 2016) | 98,161,80 |
| 83 | Plantation regrowing (disturbed 2016–2022) | 188,209,105 |
| 84 | Conversion to plantation (deforestation before 2015) | 255,228,148 |
| 85 | Conversion to plantation (deforestation 2016–2022) | 250,180,150 |
| 86 | Recent conversion to plantation (2023–2025) | 204,163,163 |
| 91 | Other land cover without afforestation | 255,255,255 |
| 92 | Young afforestation (3–9 yr regrowth) | 237,255,215 |
| 93 | Old afforestation (10–20 yr regrowth) | 224,250,157 |
| 94 | Water converted recently into forest regrowth (≥3 yr) | 214,250,188 |

</details>

## Files

```
v1_2025/<TILE_ID>/<Product>.tif          e.g. v1_2025/N0_E20/AnnualChange_2020.tif
stac/<Product>_stac.parquet              one STAC-geoparquet index per product
icechunk/v1_2025/                        virtual icechunk cube, one group per tile
```

`TILE_ID` is the approximate north-west coordinate of the tile, from the JRC. Examples are `N0_E20` and `S10_W60`. These coordinates are not exact. Use the STAC index for exact footprints.

## How to read

Example of an anonymous read through the source.coop proxy. Find tiles with the STAC index, then read the COGs:

```python
# Requires: aiohttp, fsspec, geopandas, rasterio, pyarrow
import fsspec, geopandas as gpd, rasterio

base = "https://data.source.coop/epoch/jrc-tmf"
idx = gpd.read_parquet(
    f"{base}/stac/DeforestationYear_stac.parquet",
    filesystem=fsspec.filesystem("https"),
)
aoi = idx.iloc[0]["geometry"].centroid
hits = idx[idx.intersects(aoi)]
with rasterio.open(hits.iloc[0]["assets"]["DeforestationYear"]["href"]) as ds:
    arr = ds.read(1)
print(arr.shape, arr.dtype)
```

Example of a GDAL-free read with icechunk and xarray. The store references byte ranges in the COGs and copies no pixel data:

```python
# Example requires: icechunk, xarray, zarr
import icechunk as ic, xarray as xr
bucket = "us-west-2.opendata.source.coop"
repo = ic.Repository.open(
    storage=ic.s3_storage(bucket=bucket, prefix="epoch/jrc-tmf/icechunk/v1_2025", region="us-west-2", anonymous=True),
    authorize_virtual_chunk_access={f"s3://{bucket}/": ic.Credentials.S3(ic.S3Credentials.Anonymous())},
)
dt = xr.open_datatree(repo.readonly_session("main").store, engine="zarr", consolidated=False)
tile = dt["N0_E20"].ds
print(tile["AnnualChange"].sel(time="2020"))
```

## Known limitations

- The icechunk cube has one group per tile. It is not one global array. Tile pixel counts are not multiples of 512. Tile pixel counts do differ from tile to tile.
- The tile ID names a nominal 10° by 10° grid cell, for example `N30_W110`. The ID is not the exact raster extent. A real tile can extend past its nominal cell edge. Do not compute pixel offsets from the ID alone. Read the exact bounds from the raster file or from the STAC footprint.
- This publication mirrors six download products only. The JRC publishes other TMF layers through Earth Engine only, for example Intensity and Duration. We do not mirror these layers.
- This publication does not mirror the 10 m Hybrid Transition Map. That product is a beta release. It covers 1990 to 2022. The JRC plans a revised release of this product. The revised release will include an accuracy assessment.
