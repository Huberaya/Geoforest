# GFC v1.13 — real public qualification extracts

**Source: Hansen/UMD/Google/USGS/NASA**

Hansen, M. C., et al. (2013). High-Resolution Global Maps of 21st-Century Forest Cover Change. Science 342, 850–853.

Data visualization/link recommended by the publisher:
https://glad.earthengine.app/view/global-forest-change

Version documentation and attribution:
https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html

**Creative Commons Attribution 4.0 International**:
https://creativecommons.org/licenses/by/4.0/

Commercial reuse permitted under those conditions; give attribution, link the
license and indicate changes. No endorsement by the source institutions.

## Modifications

These files are **64×64 pixel crops** from the public 2025-v1.13 GeoTIFFs,
re-encoded with lossless DEFLATE compression. No reprojection, resampling,
class modification, canopy threshold or silent nodata substitution.

The arbitrary study window is not an identified customer's plot. Its source
pixels are real, not simulated; synthetic fixtures exist separately in tests.
It does not establish legal forest state, agricultural conversion or EUDR
compliance. The 2025 endpoint is not monitoring for 2026.

`qualification.json` records the source URLs, GCS generation and ETag for each
layer, SHA-256 of downloaded byte ranges, extract files and uncompressed pixel
bytes, native grid and software versions. **No complete upstream SHA-256 is
claimed**, since the full source files were not downloaded.

Reproduction tool: `scripts/qualify-forest.py`, using the isolated qualification
adapter. Re-running it HEADs the currently served objects; compare recorded
generations/hashes and review any change, rather than silently promoting it.
The recorded generation can identify the exact original object, subject to its
continued availability from the upstream host. Preserve these extracts and
metadata independently of upstream availability.

These small extracts are regression/qualification assets, **not a deployed
worldwide dataset or a fallback for a missing live parcel observation**.
