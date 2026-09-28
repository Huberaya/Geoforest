# Natural Earth — global indicative reference

Source: Natural Earth, **1:10 million Admin 0 Map Units**.
Natural Earth's `10m` means **10 million scale, not 10 metre accuracy**.

Public domain; commercial use permitted by the publisher's terms:
https://www.naturalearthdata.com/about/terms-of-use/

Attribution: **Made with Natural Earth — naturalearthdata.com**.
No endorsement, accuracy, legal sovereignty or fitness-for-purpose warranty.

Pinned repository tag `v5.1.2`, commit
`f1890d9f152c896d250a77557a5751a93d494776`, committed 2022-05-13.
This is the repository snapshot identifier, not an assertion that each theme has
version 5.1.2, that the geography represents 2022, or that it is legally current
in 2026. The source does not provide a single represented year for all outlines.

Downloaded 2026-09-28 from:
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_10m_admin_0_map_units.geojson

Raw SHA-256:
`57da82be755f4afccd8f3b14251bb2752f5df1395f47d2d86f817470c4a48862`

## Documented derivation

`map_units.geojson` preserves unchanged upstream bytes. `countries/*.geojson`
are derived by `scripts/prepare-naturalearth.py`:

1. Group by the provider's `ISO_A2_EH`, restricted to recognized ISO alpha-2 codes.
   Never infer a country from a name or sovereign-state field.
2. Check each component's bounded 2D geometry and PostGIS validity.
3. Dissolve valid components of the same ISO group using `ST_UnaryUnion`, then
   export with 15 decimal places and check the result. Internal component edges
   disappear; this is a documented derivation, not an unchanged raw geometry.
4. No ST_MakeValid, reprojection or simplification. Invalid inputs are rejected.
5. Record the original NE IDs and map-unit names, hashes, PostGIS version,
   exceptions and unmapped units in `manifest.json`.

246 ISO codes are admitted. Exceptions: AQ (unsupported polar extent), EG
(upstream invalid topology), UM (no unambiguous ISO map unit). 18 non-ISO or
unmapped units are listed and not forcibly assigned to another country.

Map units distinguish French Guiana (GF), France (FR), and other overseas ISO
territories. These coding conventions do not determine sovereignty or the
correct legal declaration for a product. France's admitted Natural Earth
outline is not the previously rejected geoBoundaries FRA snapshot.

Natural Earth's default worldview is **de facto**. Other legal viewpoints and
territorial claims can differ; this layer alone is not exhaustive dispute
screening. https://www.naturalearthdata.com/about/disputed-boundaries-policy/

The preparation script is an **offline build tool**, not a runtime deployment
or upload endpoint. Build/review in an isolated checkout; deploy the whole
reviewed code + manifest + files atomically, never regenerate a live reference
folder. The manifest hash is pinned in code; per-country hashes are checked
at use. Retain old software and source snapshots with DB backups.
