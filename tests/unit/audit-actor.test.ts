import { describe, expect, it } from "vitest";
import { auditActorLabel } from "../../src/audit-actor";

describe("audit actor attribution", () => {
  it("never attributes system processing to a person", () => {
    expect(
      auditActorLabel({
        actor_kind: "system",
        actor_id: null,
        supplier_actor_id: null,
      }),
    ).toBe("Système · contrôle documentaire");
  });
  it("keeps supplier attribution", () => {
    expect(
      auditActorLabel({
        actor_kind: "supplier",
        actor_id: null,
        supplier_actor_id: "synthetic-supplier",
      }),
    ).toBe("Portail fournisseur · synthetic-supplier");
  });
  it("keeps human attribution", () => {
    expect(
      auditActorLabel({
        actor_kind: "user",
        actor_id: "synthetic-user",
        supplier_actor_id: null,
      }),
    ).toBe("synthetic-user");
  });
});
