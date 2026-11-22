const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const dockerfile = readFileSync('Dockerfile', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8');
const compose = yaml.load(readFileSync('docker-compose.yml', 'utf8'));
const backendDockerfile = readFileSync('backend/Dockerfile', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));

test('Dockerfile uses Node 22, non-root USER, HEALTHCHECK, valid COPY paths and never runs drizzle-kit push', () => {
  const instructions = dockerfile
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('#'))
    .join('\n');

  assert.match(instructions, /^FROM node:22-alpine AS builder/m);
  assert.match(instructions, /^FROM node:22-alpine AS runner/m);
  assert.doesNotMatch(instructions, /drizzle-kit\s+push/i);
  assert.doesNotMatch(instructions, /drizzle\.config\.json/);
  assert.doesNotMatch(instructions, /\/app\/public\b/);
  assert.match(instructions, /^USER node$/m);
  assert.match(instructions, /^HEALTHCHECK\b.*\/api\/health/ms);
  assert.match(instructions, /^CMD \["npm", "run", "start"\]$/m);

  // Every static source path copied from /app in runner (excluding build outputs)
  // must actually exist in the repository.
  const copyMatches = [...instructions.matchAll(/^COPY --from=builder(?: --chown=\S+)? (.+) \S+$/gm)];
  assert.ok(copyMatches.length >= 5, 'expected runner COPY instructions');
  for (const [, rawSources] of copyMatches) {
    for (const token of rawSources.trim().split(/\s+/)) {
      if (token.includes('*') || token === '/app/.next' || token === '/app/node_modules') continue;
      const rel = token.replace(/^\/app\//, '');
      assert.ok(
        existsSync(path.join(process.cwd(), rel)),
        `Dockerfile copies missing path: ${rel}`,
      );
    }
  }
});

test('.dockerignore excludes local secret files, virtualenvs and runtime artifacts', () => {
  const lines = dockerignore.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const required of ['.env', '.env.*', '.venv', '.git', 'var', 'backend']) {
    assert.ok(lines.includes(required), `.dockerignore must exclude ${required}`);
  }
});

test('docker-compose.yml enforces least privilege (no DATABASE_URL_ADMIN in frontend), loopback Postgres and no backend service', () => {
  const services = compose.services || {};
  assert.ok(!Object.hasOwn(services, 'backend'), 'FastAPI backend must not be published by docker-compose');

  // Postgres bound to loopback only, mandatory password.
  assert.deepEqual(services.db.ports, ['127.0.0.1:5432:5432']);
  assert.match(String(services.db.environment.POSTGRES_PASSWORD), /\:\?/);

  // Frontend runtime container must use geoforest_app only — never DATABASE_URL_ADMIN.
  const frontendEnv = services.frontend.environment || {};
  assert.ok(!Object.hasOwn(frontendEnv, 'DATABASE_URL_ADMIN'),
    'frontend runtime container must never receive DATABASE_URL_ADMIN');
  assert.match(String(frontendEnv.DATABASE_URL), /postgresql:\/\/geoforest_app:/);
  assert.match(String(frontendEnv.AUTH_SECRET), /\:\?/);
  assert.match(String(frontendEnv.GF_STORAGE_SIGNING_SECRET), /\:\?/);

  // Explicit opt-in one-shot migrate service using versioned migrations + post-migrate RLS.
  assert.ok(services.migrate, 'dedicated migrate service should exist');
  assert.deepEqual(services.migrate.profiles, ['migrate']);
  assert.deepEqual(services.migrate.command, ['npm', 'run', 'db:migrate']);
  assert.equal(services.migrate.restart, 'no');
  assert.ok(Object.hasOwn(services.migrate.environment, 'DATABASE_URL_ADMIN'));
});

test('backend/Dockerfile binds strictly to loopback 127.0.0.1 and runs as non-root', () => {
  assert.match(backendDockerfile, /--host",\s*"127\.0\.0\.1"/);
  assert.match(backendDockerfile, /^USER appuser$/m);
});

test('vercel.json serves only Next.js frontend and never routes to FastAPI/backend', () => {
  assert.deepEqual(Object.keys(vercel.services || {}), ['frontend']);
  assert.equal(vercel.services.frontend.framework, 'nextjs');
  const raw = JSON.stringify(vercel);
  assert.doesNotMatch(raw, /fastapi|\/backend/i);
});
