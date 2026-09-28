import { useCallback } from "react";
import { type Api, errorText } from "../supply/types";
export type Geometry = {
  type: "Point" | "Polygon" | "MultiPolygon" | "LineString";
  coordinates: unknown;
};
export type PlotData = {
  reference: string;
  name: string;
  country: string;
  commodity: string | null;
  declared_area_ha: string | null;
  geometry: Geometry;
  capture_method: string;
  source_note: string;
  gps_accuracy_m: number | null;
  captured_at: string | null;
};
export type Analysis = {
  calculated_area_ha: number | null;
  declared_area_ha: string | null;
  warnings: { code: string; message: string; source?: string }[];
  spatial_relations: { id: string; reference: string; kind: string }[];
  relations_truncated: boolean;
  position_count: number;
  official_system_status: string;
  method: string;
};
export type Plot = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  reference: string;
  version: number;
  current_revision: number;
  payload: PlotData;
  analysis: Analysis;
  archived_at: string | null;
  source_kind: string;
  source_id: string | null;
  revisions?: { revision: number; source_kind: string; created_at: string }[];
};
export type Proposal = {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  payload: PlotData;
  analysis: Analysis;
  status: string;
  version: number;
  review_note: string;
  adopted_plot_id: string | null;
};
export const proposalLabels: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "À revoir",
  CHANGES_REQUESTED: "Corrections demandées",
  ACCEPTED: "Adoptée dans le référentiel",
};
export function usePlotApi(prefix: string, csrf: string): Api {
  return useCallback(
    async (path, method = "GET", body, signal) => {
      const r = await fetch(prefix + path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        cache: "no-store",
      });
      if (!r.ok) {
        let data;
        try {
          data = await r.json();
        } catch {}
        const detail = data?.detail;
        const items = detail?.items
          ?.map(
            (i: { index: number; message: unknown; fields?: string[] }) =>
              `Élément ${i.index} : ${errorText(i.message)} ${i.fields?.join(", ") || ""}`,
          )
          .join(" · ");
        throw new Error(
          r.status === 401
            ? "Accès expiré : reconnectez-vous ou demandez un nouveau lien."
            : errorText(detail) + (items ? " — " + items : ""),
        );
      }
      return r.status === 204 ? undefined : r.json();
    },
    [prefix, csrf],
  );
}
