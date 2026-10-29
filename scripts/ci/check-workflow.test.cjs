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
  assert.ok(!Object.hasOwn(workflow.jobs.verify, 'env'));
});

test('verification keeps install, regression tests, lint, types and build gates', () => {
  const commands = workflow.jobs.verify.steps.map(s => s.run || '').join('\n');
  for (const command of ['npm ci', 'pytest -q', 'npm run test:ci', 'npm run typecheck',
    'npm run db:check', 'npm run lint', 'npm run test:unit', 'npm run test:eudr', 'npm run build']) {
    assert.ok(commands.includes(command), command);
  }
});
