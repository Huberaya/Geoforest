const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const source = readFileSync('scripts/backfill-bbox.ts', 'utf8');

test('bbox backfill refuses DATABASE_URL fallback and requires explicit admin URL', () => {
  assert.match(source, /const url = process\.env\.DATABASE_URL_ADMIN;/);
  assert.doesNotMatch(source, /DATABASE_URL_ADMIN\s*\?\?\s*process\.env\.DATABASE_URL/);
  assert.match(source, /DATABASE_URL_ADMIN est obligatoire/);
});

test('bbox backfill verifies the connected PostgreSQL role before reading or writing plots', () => {
  const identity = source.indexOf('SELECT r.rolname AS role_name');
  const plotRead = source.indexOf('FROM gf_plots');
  assert.ok(identity >= 0 && plotRead > identity, 'role check must precede plot queries');
  assert.match(source, /!role\.is_superuser && !role\.bypass_rls/);
  assert.match(source, /SUPERUSER ou BYPASSRLS requis/);
});

test('partial bbox rows are eligible, not only rows with bbox_min_lon NULL', () => {
  for (const column of ['bbox_min_lon', 'bbox_min_lat', 'bbox_max_lon', 'bbox_max_lat']) {
    assert.match(source, new RegExp(column + ' IS NULL'));
  }
});

test('every successful bbox update is counted with RETURNING and verified at the end', () => {
  assert.match(source, /RETURNING id/);
  assert.match(source, /update\.rowCount/);
  assert.match(source, /bornes encore incomplètes/);
  assert.match(source, /nonTraitees > 0/);
  assert.match(source, /lues !== attendu/);
});

test('dry-run exits before any UPDATE statement', () => {
  const dryRun = source.indexOf('if (essai)');
  const update = source.indexOf('UPDATE gf_plots');
  assert.ok(dryRun >= 0 && update > dryRun);
  const bboxCalculation = source.indexOf('bboxDeGeometrie(ligne.geometry)', dryRun);
  assert.ok(bboxCalculation > dryRun && bboxCalculation < update,
    'dry-run must calculate each BBOX before reaching the UPDATE statement');
  assert.match(source, /Aucune écriture effectuée/);
});
