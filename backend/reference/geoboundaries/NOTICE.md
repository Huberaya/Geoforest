# Public reference snapshots — not customer parcel data

Downloaded 2026-09-28, pinned upstream commit:
`9469f09592ced973a3448cf66b6100b741b64c0d` (geoBoundaries).

Unchanged public GeoJSON bytes and the metadata returned by the provider are
retained. The separate provenance JSON files record download URLs and SHA-256.
The metadata endpoint is mutable; the geometry URL is pinned. Runtime loading
checks the hash in the reviewed code catalogue, not a value supplied by a user.

**Attribution:** geoBoundaries — Runfola, D. et al. (2020), *geoBoundaries: A global
database of political administrative boundaries*, PLoS ONE 15(4): e0231866.
https://doi.org/10.1371/journal.pone.0231866
https://www.geoboundaries.org/

Collection licence: **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/
Respect attribution and indicate modifications if making derived products.
No provider endorsement or warranty is implied.

- `CIV.geojson`: primary source Natural Earth, Public Domain as identified by
  geoBoundaries. Made with Natural Earth, https://www.naturalearthdata.com/.
  Terms: https://www.naturalearthdata.com/about/terms-of-use/.
  Represented year 2018, build 2023-12-12; no metric accuracy guaranteed.
  Admitted **only for historical indicative pilot screening**.
- `FRA.geojson`: primary source geoBoundaries/Wikipedia, CC0 1.0 according to
  geoBoundaries. https://creativecommons.org/publicdomain/zero/1.0/.
  Represented year 2016, build 2023-12-12. Primary URL is incomplete in metadata;
  full French territorial coverage is not established. **Rejected for runtime
  screening**; retained solely as a source-qualification example.

The legacy OGC CRS84 collection declaration in the source is explicitly
recognized as longitude/latitude WGS84. Extraction of the geometry does not
change coordinates. No reprojection, simplification, or repair is performed.

These are public administrative reference outlines, not real supplier plots.
They do not establish property, lawful origin, forest conditions or compliance.
No global coverage is claimed. See docs/reglementation/04-sources-geographiques.md.
