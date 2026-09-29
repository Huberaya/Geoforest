// Browser fixture only; never part of Next routes. No auth, DB or real API.
import { createRoot } from "react-dom/client";
import { CountryChecks } from "../../src/components/plots/CountryChecks";
import type { Api } from "../../src/components/supply/types";
import "../../src/app/globals.css";

let retry = false;
const api: Api = async (path) => {
  if (path === "/geospatial/sources") {
    if (!retry) {
      retry = true;
      throw new Error("synthetic outage");
    }
    return {
      coverage: "GLOBAL_INDICATIVE_WITH_EXCEPTIONS",
      covered_count: 246,
      excluded: [{ country: "AQ" }, { country: "EG" }, { country: "UM" }],
    };
  }
  return {
    total: 1,
    items: [
      {
        id: "synthetic",
        revision: 1,
        created_at: "2026-09-29T12:00:00Z",
        result: {
          status: "NOT_COVERED",
          declared_country: "AQ",
          review_distance_m: 0,
          distance_to_reference_boundary_m: null,
          source: null,
          method_version: "fixture-only",
          postgis_version: null,
          geometry_sha256: "f".repeat(64),
          limitations: [
            "Document et résultat fictifs : aucune qualification de production.",
          ],
        },
      },
    ],
  };
};
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 16, maxWidth: 1000, margin: "auto" }}>
    <p>Recette locale fictive — pas une page de production</p>
    <CountryChecks api={api} plot="synthetic" revision={1} writable />
  </main>,
);
