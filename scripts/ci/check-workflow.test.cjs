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


test('Neon-secret CI job is restricted to main and protected by the neon-ci environment', () => {
  const job = workflow.jobs.database;
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.equal(job.environment, 'neon-ci');
  const checkout = job.steps.find(s => s.name === 'Check out source');
  assert.equal(checkout.with['persist-credentials'], false);
});

test('backup/restore workflow cannot receive Neon credentials from feature branches or PRs', () => {
  const backup = yaml.load(readFileSync('.github/workflows/backup-restore-proof.yml', 'utf8'));
  assert.deepEqual(backup.on.push.branches, ['main']);
  assert.ok(Object.hasOwn(backup.on, 'workflow_dispatch'));
  const job = backup.jobs['restore-proof'];
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.equal(job.environment, 'neon-ci');
  const checkout = job.steps.find(s => s.name === 'Récupérer le dépôt');
  assert.equal(checkout.with['persist-credentials'], false);
});


const neonSecretNames = ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_PARENT_BRANCH_ID'];
const privilegedWorkflows = [
  { path: '.github/workflows/ci.yml', document: workflow, jobName: 'database' },
  {
    path: '.github/workflows/backup-restore-proof.yml',
    document: yaml.load(readFileSync('.github/workflows/backup-restore-proof.yml', 'utf8')),
    jobName: 'restore-proof',
  },
];

function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, output));
  return output;
}

test('no privileged Neon workflow uses pull_request_target or checks out PR-controlled refs', () => {
  for (const { document, jobName } of privilegedWorkflows) {
    assert.ok(!Object.hasOwn(document.on, 'pull_request_target'), 'pull_request_target is forbidden');
    const job = document.jobs[jobName];
    for (const step of job.steps) {
      if (String(step.uses || '').startsWith('actions/checkout@')) {
        const ref = step.with?.ref;
        assert.ok(!ref, 'privileged checkout must use the workflow commit, never an explicit PR ref');
        assert.equal(step.with?.['persist-credentials'], false);
      }
    }
  }
});

test('every Neon secret reference is confined to the main-only neon-ci job', () => {
  for (const { document, jobName } of privilegedWorkflows) {
    const privilegedJob = document.jobs[jobName];
    assert.equal(privilegedJob.if, "github.ref == 'refs/heads/main'");
    assert.equal(privilegedJob.environment, 'neon-ci');
    const allJobs = Object.entries(document.jobs);
    for (const [name, job] of allJobs) {
      const references = collectStrings(job).filter(value =>
        neonSecretNames.some(secret => value.includes(`secrets.${secret}`)));
      if (references.length) {
        assert.equal(name, jobName, `Neon secret reference found in unprotected job ${name}`);
        for (const secret of neonSecretNames) {
          assert.ok(references.some(value => value.includes(`secrets.${secret}`)),
            `missing expected secret reference ${secret}`);
        }
      }
    }
  }
});

test('privileged workflows cannot grant write permissions or run from PR events', () => {
  for (const { document, jobName } of privilegedWorkflows) {
    assert.deepEqual(document.permissions, { contents: 'read' });
    assert.ok(!Object.hasOwn(document.on, 'pull_request'));
    assert.ok(!Object.hasOwn(document.on, 'pull_request_target'));
    const job = document.jobs[jobName];
    assert.ok(!job.permissions || Object.values(job.permissions).every(value => value === 'read' || value === 'none'));
  }
});
