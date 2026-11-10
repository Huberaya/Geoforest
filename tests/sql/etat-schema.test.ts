/**
 * R-05 — garde-fou d'état de sécurité du schéma.
 *
 * ⚠️ Ce que ces tests vérifient.
 *
 *   L'interprétation pure est éprouvée sur l'état **mesuré** d'une migration
 *   interrompue entre `010` et `020` : 13 politiques au lieu de 34, les deux
 *   fonctions d'authentification encore exécutables par le rôle applicatif,
 *   aucun déclencheur de journal. Cet état ne doit jamais être déclaré sain.
 *
 *   La lecture réelle est éprouvée sur une base PGlite migrée : l'état complet
 *   est accepté ; le retrait d'une seule politique, de l'index de cadence ou
 *   de la contrainte d'identité est refusé, avec le code attendu. Rien n'est
 *   réparé par le module — les tests restaurent eux-mêmes ce qu'ils ont retiré.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  DECLENCHEURS_JOURNAL,
  exigerSchemaPret,
  interpreterSchemaSecurite,
  reinitialiserEtatSchema,
  SchemaSecuriteIncompletError,
  TABLES_POLITIQUES_QUADRUPLE,
  TABLES_PROTEGEES,
  verifierSchemaSecuriteAvec,
  type ConstatsSchema,
} from "../../src/db/etat-schema";
import { appliquerMigrations } from "../helpers/migrations";

type BaseLike = Parameters<typeof verifierSchemaSecuriteAvec>[0];

function etatComplet(): ConstatsSchema {
  const politiques = TABLES_PROTEGEES.flatMap((table) =>
    (TABLES_POLITIQUES_QUADRUPLE as readonly string[]).includes(table)
      ? [
          { tablename: table, policyname: "tenant_isolation_lecture" },
          { tablename: table, policyname: "tenant_isolation_ecriture" },
          { tablename: table, policyname: "tenant_isolation_maj" },
          { tablename: table, policyname: "tenant_isolation_retrait" },
        ]
      : [{ tablename: table, policyname: "tenant_isolation" }],
  );

  return {
    role: "geoforest_app",
    superutilisateur: false,
    tables: TABLES_PROTEGEES.map((tablename) => ({
      tablename,
      rowsecurity: true,
      forcerowsecurity: true,
    })),
    politiques,
    fonctions: [
      { signature: "auth_user_by_email(text)", executable: false, security_definer: true },
      { signature: "auth_user_by_id(uuid)", executable: false, security_definer: true },
    ],
    declencheurs: [...DECLENCHEURS_JOURNAL],
    indexCadence: true,
    identite: {
      contrainte: true,
      name_nullable: true,
      eori_nullable: true,
      country_nullable: true,
      country_default: false,
    },
    privileges: {
      table_select: false,
      password_hash: false,
      mfa_secret: false,
      mfa_recovery_codes: false,
      email: true,
    },
  };
}

describe("interprétation d'un état de schéma", () => {
  it("accepte l'état complet (34 politiques, 13 tables, 2 déclencheurs)", () => {
    const etat = interpreterSchemaSecurite(etatComplet());
    assert.deepEqual(etat.problemes, []);
    assert.equal(etat.ok, true);
    assert.equal(etat.mesures.tablesProtegees, 13);
    assert.equal(etat.mesures.politiques, 34);
    assert.equal(etat.mesures.declencheursJournal, 2);
    assert.equal(etat.mesures.fonctionsAuthExecutables, 0);
  });

  it("refuse l'état mesuré après interruption entre 010 et 020", () => {
    // Relevé du 19/10/2026 sur PostgreSQL 16.2, après `010` et avant `020` :
    // 13 politiques (une par table), 0 déclencheur, index et contrainte
    // absents, fonctions d'auth encore exécutables, colonnes d'identité
    // NOT NULL avec pays par défaut.
    const interrompu: ConstatsSchema = {
      role: "geoforest_app",
      superutilisateur: false,
      tables: TABLES_PROTEGEES.map((tablename) => ({
        tablename,
        rowsecurity: true,
        forcerowsecurity: true,
      })),
      politiques: TABLES_PROTEGEES.map((tablename) => ({
        tablename,
        policyname: "tenant_isolation",
      })),
      fonctions: [
        { signature: "auth_user_by_email(text)", executable: true, security_definer: true },
        { signature: "auth_user_by_id(uuid)", executable: true, security_definer: true },
      ],
      declencheurs: [],
      indexCadence: false,
      identite: {
        contrainte: false,
        name_nullable: false,
        eori_nullable: false,
        country_nullable: false,
        country_default: true,
      },
      privileges: {
        table_select: false,
        password_hash: false,
        mfa_secret: false,
        mfa_recovery_codes: false,
        email: true,
      },
    };

    const etat = interpreterSchemaSecurite(interrompu);
    assert.equal(etat.ok, false);
    const codes = etat.problemes.map((p) => p.code);
    for (const attendu of [
      "politiques_rls_incompletes",
      "fonctions_auth_executables",
      "declencheurs_journal_incomplets",
      "index_cadence_absent",
      "contrainte_identite_absente",
      "identite_operateur_non_nulle",
      "pays_operateur_par_defaut",
    ]) {
      assert.ok(codes.includes(attendu), `code manquant : ${attendu} (reçus : ${codes.join(", ")})`);
    }
    assert.equal(etat.mesures.politiques, 13);
  });

  it("refuse une politique supplémentaire, qui peut élargir l'accès", () => {
    const constats = etatComplet();
    constats.politiques.push({ tablename: "gf_products", policyname: "lecture_publique" });
    const etat = interpreterSchemaSecurite(constats);
    assert.equal(etat.ok, false);
    assert.ok(etat.problemes.some((p) => p.code === "politiques_rls_inattendues"));
  });

  it("refuse une table métier sans RLS forcée", () => {
    const constats = etatComplet();
    constats.tables = constats.tables.map((t) =>
      t.tablename === "gf_shipments" ? { ...t, forcerowsecurity: false } : t,
    );
    const etat = interpreterSchemaSecurite(constats);
    assert.equal(etat.ok, false);
    assert.ok(etat.problemes.some((p) => p.code === "rls_non_forcee"));
  });

  it("refuse un rôle applicatif qui lit les colonnes sensibles de gf_users", () => {
    const constats = etatComplet();
    constats.privileges = {
      table_select: true,
      password_hash: true,
      mfa_secret: true,
      mfa_recovery_codes: true,
      email: true,
    };
    const etat = interpreterSchemaSecurite(constats);
    assert.equal(etat.ok, false);
    const codes = etat.problemes.map((p) => p.code);
    assert.ok(codes.includes("privilege_table_gf_users"));
    assert.ok(codes.includes("colonnes_sensibles_exposees"));
  });
});

describe("lecture du catalogue sur une base migrée", () => {
  let client: PGlite;
  let base: BaseLike;

  before(async () => {
    reinitialiserEtatSchema();
    client = await PGlite.create();
    await appliquerMigrations(client);
    base = {
      query: (text: string, valeurs?: unknown[]) => client.query(text, valeurs),
    } as unknown as BaseLike;
  });

  after(async () => {
    await client?.close();
  });

  it("accepte la base migrée et compte les objets réels", async () => {
    const etat = await verifierSchemaSecuriteAvec(base);
    assert.deepEqual(
      etat.problemes,
      [],
      `problèmes inattendus : ${etat.problemes.map((p) => p.message).join(" | ")}`,
    );
    assert.equal(etat.mesures.tablesProtegees, 13);
    assert.equal(etat.mesures.politiques, 34);
    assert.equal(etat.mesures.declencheursJournal, 2);
    assert.equal(etat.mesures.indexCadence, true);
    assert.equal(etat.mesures.contrainteIdentite, true);
  });

  it("refuse et nomme la politique retirée, puis reprend après restauration", async () => {
    await client.exec("drop policy tenant_isolation_lecture on gf_suppliers;");
    reinitialiserEtatSchema();

    await assert.rejects(
      () => exigerSchemaPret({ pool: base, force: true }),
      (erreur: unknown) => {
        assert.ok(erreur instanceof SchemaSecuriteIncompletError);
        const codes = erreur.etat.problemes.map((p) => p.code);
        assert.ok(
          codes.includes("politiques_rls_incompletes"),
          `codes reçus : ${codes.join(", ")}`,
        );
        return true;
      },
    );

    await client.exec(`
      create policy tenant_isolation_lecture on gf_suppliers
        for select
        using (organization_id = current_org()
               and current_org() is not null
               and deleted_at is null);
    `);
    reinitialiserEtatSchema();

    const etat = await exigerSchemaPret({ pool: base, force: true });
    assert.equal(etat.ok, true);
  });

  it("refuse la disparition de l'index de cadence et de la contrainte d'identité", async () => {
    await client.exec("drop index uq_gf_login_attempts_cle;");
    await client.exec(
      "alter table parcel_audits drop constraint parcel_audits_identite_operateur_valide;",
    );
    reinitialiserEtatSchema();

    await assert.rejects(
      () => exigerSchemaPret({ pool: base, force: true }),
      (erreur: unknown) => {
        assert.ok(erreur instanceof SchemaSecuriteIncompletError);
        const codes = erreur.etat.problemes.map((p) => p.code);
        assert.ok(codes.includes("index_cadence_absent"), codes.join(", "));
        assert.ok(codes.includes("contrainte_identite_absente"), codes.join(", "));
        return true;
      },
    );
  });
});

describe("lecture sous le rôle applicatif réel", () => {
  let client: PGlite;
  let base: BaseLike;

  before(async () => {
    reinitialiserEtatSchema();
    client = await PGlite.create();
    await appliquerMigrations(client);
    base = {
      query: (text: string, valeurs?: unknown[]) => client.query(text, valeurs),
    } as unknown as BaseLike;
  });

  after(async () => {
    await client?.close();
  });

  it("mesure l'absence d'exécution des fonctions d'authentification", async () => {
    await client.exec("set role geoforest_app");
    try {
      const etat = await verifierSchemaSecuriteAvec(base);
      assert.equal(etat.role, "geoforest_app");
      assert.equal(etat.superutilisateur, false);
      assert.equal(etat.mesures.fonctionsAuthExecutables, 0);
      assert.deepEqual(
        etat.problemes,
        [],
        etat.problemes.map((p) => p.message).join(" | "),
      );
    } finally {
      await client.exec("reset role");
    }
  });

  it("refuse une fonction d'authentification rendue exécutable au rôle applicatif", async () => {
    await client.exec("grant execute on function auth_user_by_email(text) to geoforest_app");
    await client.exec("set role geoforest_app");
    try {
      reinitialiserEtatSchema();
      await assert.rejects(
        () => exigerSchemaPret({ pool: base, force: true }),
        (erreur: unknown) => {
          assert.ok(erreur instanceof SchemaSecuriteIncompletError);
          assert.ok(
            erreur.etat.problemes.some((p) => p.code === "fonctions_auth_executables"),
            erreur.etat.problemes.map((p) => p.code).join(", "),
          );
          return true;
        },
      );
    } finally {
      await client.exec("reset role");
      await client.exec("revoke execute on function auth_user_by_email(text) from geoforest_app");
    }
  });
});
