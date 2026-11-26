import assert from "node:assert/strict";
import { test } from "node:test";

import EudrLegalDates from "../../src/components/dashboard/EudrLegalDates";

function texteDuRendu(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(texteDuRendu).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const props = (value as { props?: { children?: unknown } }).props;
    return texteDuRendu(props?.children);
  }
  return "";
}

test("le cockpit distingue la date de référence de déforestation du calendrier d'application EUDR", () => {
  const markup = texteDuRendu(EudrLegalDates());

  assert.ok(markup.includes("Date de référence « zéro déforestation » : 31/12/2020"));
  assert.ok(markup.includes("30/12/2026"));
  assert.ok(markup.includes("30/06/2027"));
  assert.ok(markup.includes("Vérifiez les dispositions applicables"));
});
