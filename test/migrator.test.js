import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareOperations, loadOperations } from '../src/spec.js';
import { migrateSources } from '../src/scan.js';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'opid-migrate-'));
  const src = join(dir, 'src');
  await mkdir(src);
  const old = join(dir, 'old.yaml');
  const next = join(dir, 'new.yaml');
  await writeFile(old, `openapi: 3.0.3
info: { title: Demo, version: 1.0.0 }
paths:
  /users:
    get:
      operationId: listUsersOld
      responses: { '200': { description: OK } }
`);
  await writeFile(next, `openapi: 3.0.3
info: { title: Demo, version: 2.0.0 }
paths:
  /users:
    get:
      operationId: listUsers
      responses: { '200': { description: OK } }
`);
  return { dir, src, old, next };
}

test('preview and write update only direct calls on the requested named import', async () => {
  const { src, old, next } = await fixture();
  const ts = join(src, 'users.ts');
  const vue = join(src, 'Users.vue');
  const original = `import { AdminApi as Api } from '@/api';
const rows = Api.listUsersOld();
const unrelated = other.listUsersOld();
function shadow(Api) { return Api.listUsersOld(); }
const mention = 'Api.listUsersOld()';
`;
  await writeFile(ts, original);
  await writeFile(vue, `<template><div>listUsersOld</div></template>
<script setup lang="ts">
import { AdminApi } from '@/api';
await AdminApi.listUsersOld();
</script>
`);
  const changes = compareOperations(await loadOperations(old), await loadOperations(next));
  const options = { src, clientImport: '@/api', clientExport: 'AdminApi', write: false };
  const preview = await migrateSources(options, changes);
  assert.equal(preview.matches.length, 2);
  assert.deepEqual(preview.errors, []);
  assert.equal(await readFile(ts, 'utf8'), original);

  const result = await migrateSources({ ...options, write: true }, changes);
  assert.equal(result.matches.length, 2);
  const updatedTs = await readFile(ts, 'utf8');
  assert.match(updatedTs, /Api\.listUsers\(\)/);
  assert.match(updatedTs, /other\.listUsersOld\(\)/);
  assert.match(updatedTs, /function shadow\(Api\) \{ return Api\.listUsersOld\(\); \}/);
  assert.match(updatedTs, /'Api\.listUsersOld\(\)'/);
  const updatedVue = await readFile(vue, 'utf8');
  assert.match(updatedVue, /await AdminApi\.listUsers\(\)/);
  assert.match(updatedVue, /<div>listUsersOld<\/div>/);
});

test('reused operationId is reported for manual review', () => {
  const oldSpec = {
    operations: new Map([['GET /a', 'alpha'], ['GET /b', 'beta']]),
    ids: new Map([['alpha', 1], ['beta', 1]])
  };
  const newSpec = {
    operations: new Map([['GET /a', 'beta'], ['GET /b', 'gamma']]),
    ids: new Map([['beta', 1], ['gamma', 1]])
  };
  const changes = compareOperations(oldSpec, newSpec);
  assert.equal(changes.length, 2);
  assert.ok(changes.every(change => change.reason));
});

test('CLI returns a JSON report and leaves source untouched by default', async () => {
  const { src, old, next } = await fixture();
  const file = join(src, 'users.ts');
  const source = "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n";
  await writeFile(file, source);
  const { stdout } = await execFileAsync(process.execPath, [
    cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api', '--json'
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.mode, 'preview');
  assert.equal(report.matches[0].line, 2);
  assert.equal(await readFile(file, 'utf8'), source);
});
