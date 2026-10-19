import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

/**
 * Le pool d'administration ne doit plus exiger sa configuration au **chargement**
 * du module (le build évalue les routes), mais à la **première requête**.
 *
 * ⚠️ Le défaut corrigé : `createAdminPool()` levait dès l'import. Le build
 *   échouait donc sur une machine sans base, ce qui poussait à fournir une URL
 *   factice en intégration continue — un contrôle de configuration transformé en
 *   réussite trompeuse.
 */
test("sans URL, le pool se charge mais refuse la première requête", async () => {
  const urlAdmin = process.env.DATABASE_URL_ADMIN;
  const url = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ADMIN;
  delete process.env.DATABASE_URL;

  try {
    const { dbAdmin } = await import("../../src/db/admin");
    // Drizzle enveloppe l'erreur du pilote : on remonte la chaîne de `cause`
    // pour vérifier le message applicatif lui-même, pas l'emballage.
    await assert.rejects(dbAdmin.execute(sql`select 1`), (erreur: unknown) => {
      const messages: string[] = [];
      let courant: unknown = erreur;
      while (courant instanceof Error) {
        messages.push(courant.message);
        courant = courant.cause;
      }
      assert.match(
        messages.join(" | "),
        /DATABASE_URL_ADMIN est requis pour les opérations système/,
      );
      return true;
    });
  } finally {
    if (urlAdmin === undefined) delete process.env.DATABASE_URL_ADMIN;
    else process.env.DATABASE_URL_ADMIN = urlAdmin;
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
  }
});
