/** Regression tests for the reconciled workflow; no secrets or network required. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));

test('candidate, security and forest PR targets remain enabled', () => {
  assert.deepEqual(workflow.on.push.branches, ['main', 'arena/**', 'forest/**']);
  assert.deepEqual(workflow.on.pull_request.branches,
    ['main', 'arena/**', 'security/**', 'forest/**']);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
});

test('workflow has read-only permissions and no privileged PR event', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(!Object.hasOwn(workflow.on, 'pull_request_target'));
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(!job.permissions);
    assert.ok(!job['continue-on-error']);
    for (const step of job.steps) assert.ok(!step['continue-on-error']);
  }
});

test('database mutation follows ephemeral creation and cleanup is unconditional', () => {
  const steps = workflow.jobs.database.steps;
  const create = steps.findIndex(s => s.run === 'npx tsx scripts/ci/neon-branche.ts creer');
  const migrate = steps.findIndex(s => s.run === 'npm run db:migrate');
  const reset = steps.findIndex(s => s.run === 'npm run seed:auth -- --reset');
  const cleanup = steps.find(s => s.run === 'npx tsx scripts/ci/neon-branche.ts supprimer');
  assert.ok(create >= 0 && migrate > create && reset > migrate);
  assert.equal(cleanup.if, 'always()');
  assert.ok(!Object.hasOwn(workflow.jobs.qualite, 'env'));
});

test('quality and backend jobs keep install, regression tests, lint, types, build and pytest gates', () => {
  const commands = workflow.jobs.qualite.steps.map(s => s.run || '').join('\n');
  for (const command of ['npm ci', 'npm run test:ci', 'npm run typecheck', 'npm run db:check',
    'npm run lint', 'npm run test:unit', 'npm run test:controles', 'npm run test:eudr',
    'npm run check:version', 'npm run check:seed', 'npm run check:docs', 'npm run build',
    'npm run audit:sec']) {
    assert.ok(commands.includes(command), command);
  }
  const backend = workflow.jobs.backend.steps.map(s => s.run || '').join('\n');
  assert.ok(backend.includes('pytest -q --strict-markers'));
});

// Les contextes exigés par la protection de `main` (ruleset 26568220) : un job
// renommé ne remonte plus et la fusion reste bloquée sans message explicite.
test('the four status checks required by the main branch ruleset exist by exact name', () => {
  const noms = Object.values(workflow.jobs).map(j => j.name);
  for (const requis of ['Qualité (types, lint, règles EUDR, dépendances)', 'Backend (pytest)',
    'Contrôles SQL (PostgreSQL)', 'Bout en bout (application démarrée, PostgreSQL)']) {
    assert.ok(noms.includes(requis), requis);
  }
});

test('Neon job runs every HTTP suite on the test branch, then the RLS proof last', () => {
  const runs = workflow.jobs.database.steps.map(s => s.run || '');
  const index = (suite) => runs.findIndex(r => r.endsWith(`npm run ${suite}`));
  const ordre = ['test:e2e', 'test:cross-tenant', 'test:export-identite:http', 'test:fournisseur:http',
    'test:dds-etats:http', 'test:evidence:http', 'test:cross-tenant:rls'];
  const positions = ordre.map(index);
  for (const [i, suite] of ordre.entries()) {
    assert.ok(positions[i] >= 0, suite);
    // Chaque suite HTTP est précédée d'une remise à zéro des comptes de démonstration,
    // postérieure à la suite précédente (le parcours e2e suit le démarrage du serveur).
    if (suite !== 'test:cross-tenant:rls') {
      const depuis = i === 0 ? runs.indexOf('npm run db:migrate') : positions[i - 1];
      const resets = runs.slice(depuis + 1, positions[i]).filter(r => r === 'npm run seed:auth -- --reset');
      assert.equal(resets.length, 1, `reset avant ${suite}`);
    }
    // Les échecs (« 🔴 ») sont relayés en annotations lisibles sans le journal brut.
    assert.ok(runs[positions[i]].startsWith('bash scripts/ci/annoter.sh "'), `annoter ${suite}`);
  }
  // La preuve RLS, non vacueuse par construction, vient après toutes les suites HTTP
  // et avant l'arrêt du serveur / la suppression de la branche.
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  const stop = workflow.jobs.database.steps.findIndex(s => s.name === 'Stop production server');
  assert.ok(stop > 0 && positions.at(-1) < stop);
});
