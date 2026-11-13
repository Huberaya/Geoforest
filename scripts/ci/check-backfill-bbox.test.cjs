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

test('dry-run calculates every BBOX before its no-write branch, and UPDATE is guarded after it', () => {
  const bboxCalculation = source.indexOf('bboxDeGeometrie(ligne.geometry)');
  const dryRun = source.indexOf('if (essai)', bboxCalculation);
  const update = source.indexOf('UPDATE gf_plots', dryRun);
  assert.ok(bboxCalculation >= 0 && dryRun > bboxCalculation && update > dryRun);
  assert.match(source, /if \(essai\)[\s\S]*?continue;[\s\S]*?UPDATE gf_plots/);
  assert.match(source, /aucune écriture effectuée/i);
});
