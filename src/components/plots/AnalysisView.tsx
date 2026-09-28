import { type Analysis } from "./types";
export function AnalysisView({ analysis }: { analysis: Analysis }) {
  return (
    <section className="geo-analysis">
      <div className="section-heading">
        <h3>Contrôles techniques</h3>
        <span className="status neutral">Risque non évalué</span>
      </div>
      <p>
        {analysis.position_count} positions ·{" "}
        {analysis.calculated_area_ha === null
          ? "Aucune surface calculable à partir d’un point"
          : `${analysis.calculated_area_ha.toLocaleString("fr-FR", { maximumFractionDigits: 6 })} ha calculés (WGS84)`}
      </p>
      <p className="caption">
        Pays déclaré, non vérifié spatialement. Précision terrain non démontrée
        par le nombre de décimales. Acceptation par le système officiel non
        testée.
      </p>
      {analysis.warnings.map((w, i) => (
        <div className="callout warning" key={w.code + i}>
          {w.message}
          {w.source && (
            <a
              href={w.source}
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              {" "}
              Texte de référence ↗
            </a>
          )}
        </div>
      ))}
      {analysis.spatial_relations.length > 0 && (
        <div className="callout warning">
          <strong>Relations avec les parcelles actives autorisées</strong>
          <ul>
            {analysis.spatial_relations.map((r) => (
              <li key={r.id}>
                {r.reference} —{" "}
                {(
                  {
                    DUPLICATE: "géométrie identique",
                    OVERLAP: "recouvrement de surface",
                    INTERSECTION: "intersection / contact",
                  } as Record<string, string>
                )[r.kind] || r.kind}
              </li>
            ))}
          </ul>
          {analysis.relations_truncated && (
            <p>50 relations affichées, liste tronquée.</p>
          )}
          Un contact ou recouvrement ne prouve ni fraude ni déforestation.
        </div>
      )}
      <details>
        <summary>Méthode et limites</summary>
        <p className="caption">
          {analysis.method}. Détection limitée au périmètre autorisé ; absence
          de relation affichée ≠ unicité mondiale.
        </p>
      </details>
    </section>
  );
}
