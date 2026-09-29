import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CountryChecks } from "../../src/components/plots/CountryChecks";
import type { Api } from "../../src/components/supply/types";

afterEach(cleanup);
const catalogue = {
  coverage: "GLOBAL_INDICATIVE_WITH_EXCEPTIONS",
  covered_count: 246,
  excluded: [
    { country: "AQ", reason: "polar" },
    { country: "EG", reason: "invalid" },
    { country: "UM", reason: "ambiguous" },
  ],
};
const record = (id: string, status = "INSIDE_REFERENCE_INDICATIVE") => ({
  id,
  revision: 1,
  created_at: "2026-09-29T12:00:00Z",
  result: {
    status,
    declared_country: "FR",
    review_distance_m: 0,
    distance_to_reference_boundary_m: null,
    source: null,
    method_version: "synthetic-test",
    postgis_version: null,
    geometry_sha256: "synthetic",
    limitations: ["Source indicative uniquement"],
  },
});
function mount(api: Api, writable = true) {
  return render(
    <CountryChecks
      api={api}
      plot="synthetic-plot"
      revision={1}
      writable={writable}
    />,
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("distinguishes empty history from unavailable coverage and permits retry", async () => {
  let broken = true;
  const api = vi.fn<Api>(async (path: string) => {
    if (path === "/geospatial/sources") {
      if (broken) throw new Error("PRIVATE_BACKEND_DETAILS");
      return catalogue;
    }
    return { items: [], total: 0 };
  });
  mount(api);
  await screen.findByText(/Catalogue indisponible/);
  expect(screen.queryByText("Chargement de la couverture…")).toBeNull();
  expect(screen.queryByText(/PRIVATE_BACKEND_DETAILS/)).toBeNull();
  expect(screen.getByText(/Aucune comparaison enregistrée/)).toBeTruthy();
  broken = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Réessayer le catalogue" }),
  );
  await screen.findByText(/246 codes ISO/);
  expect(screen.queryByText(/Catalogue indisponible/)).toBeNull();
});

it("offers retry when server explicitly reports catalogue unavailable", async () => {
  const api = vi.fn<Api>(async (path: string) =>
    path === "/geospatial/sources"
      ? { ...catalogue, coverage: "UNAVAILABLE" }
      : { items: [], total: 0 },
  );
  mount(api);
  await screen.findByRole("button", { name: "Réessayer le catalogue" });
  expect(screen.queryByText(/246 codes ISO/)).toBeNull();
});

it("history failure is not displayed as no comparisons", async () => {
  let broken = true;
  const api = vi.fn<Api>(async (path: string) => {
    if (path === "/geospatial/sources") return catalogue;
    if (broken) throw new Error("PRIVATE_DETAILS");
    return { items: [], total: 0 };
  });
  mount(api);
  await screen.findByText(/Historique indisponible/);
  expect(screen.queryByText(/Aucune comparaison enregistrée/)).toBeNull();
  expect(screen.queryByText("Chargement de l’historique…")).toBeNull();
  expect(screen.queryByText(/PRIVATE_DETAILS/)).toBeNull();
  broken = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Réessayer l’historique" }),
  );
  await screen.findByText(/Aucune comparaison enregistrée/);
});

it("hides previous page results while loading and after failed pagination", async () => {
  const next = deferred();
  const api = vi.fn<Api>(async (path: string) => {
    if (path === "/geospatial/sources") return catalogue;
    if (path.includes("page=2")) return next.promise;
    return { items: [record("a")], total: 21 };
  });
  mount(api);
  await screen.findByText("Dans le référentiel — indicatif");
  fireEvent.click(screen.getByRole("button", { name: "Contrôles suivants" }));
  expect(screen.queryByText("Dans le référentiel — indicatif")).toBeNull();
  expect(screen.getByText("Page 2 · historique non chargé")).toBeTruthy();
  await act(async () => next.reject(new Error("network")));
  expect(screen.queryByText("Dans le référentiel — indicatif")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Contrôles précédents" }));
  await screen.findByText("Dans le référentiel — indicatif");
});

it.each(["history", "catalogue"])(
  "ignores late %s responses after API scope changes even if transport ignores abort",
  async (kind) => {
    const old = deferred();
    const first: Api = async (path) =>
      path === "/geospatial/sources"
        ? kind === "catalogue"
          ? old.promise
          : catalogue
        : kind === "history"
          ? old.promise
          : { items: [], total: 0 };
    const second: Api = async (path) =>
      path === "/geospatial/sources" ? catalogue : { items: [], total: 0 };
    const view = mount(first);
    view.rerender(
      <CountryChecks
        api={second}
        plot="synthetic-plot"
        revision={2}
        writable={false}
      />,
    );
    await screen.findByText(/Aucune comparaison enregistrée/);
    await act(async () =>
      old.resolve(
        kind === "history"
          ? { items: [record("old")], total: 1 }
          : { ...catalogue, covered_count: 999 },
      ),
    );
    expect(screen.queryByText("Dans le référentiel — indicatif")).toBeNull();
    expect(screen.queryByText(/999 codes/)).toBeNull();
    expect(screen.getByText(/Historique de la révision 2/)).toBeTruthy();
  },
);

it("read-only users have no write control; limitations remain visible", async () => {
  const api = vi.fn<Api>(async (path: string) =>
    path === "/geospatial/sources"
      ? catalogue
      : { items: [record("a", "NOT_COVERED")], total: 1 },
  );
  mount(api, false);
  await screen.findByText("Pays non couvert");
  expect(
    screen.queryByRole("button", {
      name: "Comparer le pays de cette révision",
    }),
  ).toBeNull();
  expect(
    screen.getByText(/Revue humaine nécessaire · pays non vérifié/),
  ).toBeTruthy();
  expect(
    api.mock.calls.every((call) => call.length === 1 || call[1] !== "POST"),
  ).toBe(true);
});

it("retries identical write with the same request ID but new margin uses a new ID", async () => {
  const api = vi.fn(async (path: string, method?: string) => {
    if (method === "POST") throw new Error("Réponse perdue");
    return path === "/geospatial/sources" ? catalogue : { items: [], total: 0 };
  });
  mount(api);
  await screen.findByText(/Aucune comparaison enregistrée/);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
  const run = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: "Comparer le pays de cette révision",
      }),
    );
  run();
  await screen.findByText("Réponse perdue");
  run();
  await screen.findByText("Réponse perdue");
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "10" } });
  run();
  await screen.findByText("Réponse perdue");
  const writes = vi
    .mocked(api)
    .mock.calls.filter((c) => c[1] === "POST") as unknown as [
    string,
    string,
    { request_id: string; revision: number; review_distance_m: number },
  ][];
  expect(writes).toHaveLength(3);
  expect(writes[0][2].request_id).toBe(writes[1][2].request_id);
  expect(writes[2][2].request_id).not.toBe(writes[0][2].request_id);
  expect(writes[2][2]).toMatchObject({ revision: 1, review_distance_m: 10 });
});

it.each(["-1", "50001", "0.5"])(
  "rejects invalid margin %s without write",
  async (value) => {
    const api = vi.fn<Api>(async (path: string) =>
      path === "/geospatial/sources" ? catalogue : { items: [], total: 0 },
    );
    mount(api);
    await screen.findByText(/Aucune comparaison enregistrée/);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Comparer le pays de cette révision",
      }),
    );
    await screen.findByText(/Saisissez une marge entière/);
    expect(api.mock.calls).toHaveLength(2);
  },
);

it("successful write refreshes history and never claims verified country", async () => {
  let saved = false;
  const api = vi.fn(async (path: string, method?: string) => {
    if (method === "POST") {
      saved = true;
      return {};
    }
    return path === "/geospatial/sources"
      ? catalogue
      : { items: saved ? [record("new")] : [], total: saved ? 1 : 0 };
  });
  mount(api);
  await screen.findByText(/Aucune comparaison enregistrée/);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Comparer le pays de cette révision" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Dans le référentiel — indicatif")).toBeTruthy(),
  );
  expect(screen.getByText(/pays déclaré reste inchangé/)).toBeTruthy();
  expect(
    screen.getByText(/Revue humaine nécessaire · pays non vérifié/),
  ).toBeTruthy();
});
