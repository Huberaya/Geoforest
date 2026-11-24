import assert from "node:assert/strict";
import test from "node:test";

import { analyserContenuPourSecrets } from "../../scripts/check-secrets";

test("détecte un jeton GitHub PAT, une clé Neon, un bloc de clé privée et une URL Neon avec mot de passe", () => {
  const patSynthetique = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2";
  const neonSynthetique = "napi_" + "1234567890abcdefghijklmno";
  const pemSynthetique = "-----BEGIN " + "PRIVATE KEY-----";
  const pgNeon =
    "postgresql://geoforest_app:" + "SuperSecret99" + "@ep-cool-host.eu-central-1.aws.neon.tech/neondb";

  assert.equal(analyserContenuPourSecrets("src/app.ts", `const t = "${patSynthetique}";`).length, 1);
  assert.equal(analyserContenuPourSecrets("src/app.ts", `const k = "${neonSynthetique}";`).length, 1);
  assert.equal(analyserContenuPourSecrets("src/key.pem", pemSynthetique).length, 1);
  assert.equal(analyserContenuPourSecrets("src/db.ts", `url="${pgNeon}"`).length, 1);
});

test("détecte un mot de passe littéral dans CREATE/ALTER ROLE hors documentation", () => {
  const sql = [
    "CREATE ROLE geoforest_app LOGIN",
    "PASSWORD 'motdepasseenclair';",
  ].join(" ");
  const alertes = analyserContenuPourSecrets("scripts/sql/post-migrate/010_row_level_security.sql", sql);
  assert.equal(alertes.length, 1);
  assert.equal(alertes[0].regle, "sql-role-password-literal");
});

test("autorise les URLs locales jetables et les placeholders documentaires explicites", () => {
  assert.equal(
    analyserContenuPourSecrets(
      "src/db/index.ts",
      'const u = "postgresql://ci:ci@127.0.0.1:5432/ci";',
    ).length,
    0,
  );
  assert.equal(
    analyserContenuPourSecrets(
      ".env.example",
      "DATABASE_URL=postgresql://geoforest_app:<MOT_DE_PASSE>@ep-exemple.neon.tech/neondb",
    ).length,
    0,
  );
  assert.equal(
    analyserContenuPourSecrets(
      "scripts/sql/post-migrate/010_row_level_security.sql",
      " * create role geoforest_app login password '…en clair…';",
    ).length,
    0,
  );
});
