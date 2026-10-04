import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { compareOperations, loadMethodMap, loadOperations } from '../src/spec.js';
import { migrateSources } from '../src/scan.js';
import { formatMarkdown } from '../src/report.js';
import { generatorMethodMap } from '../src/generators.js';

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
const optional = Api?.listUsersOld?.();
const bracket = Api['listUsersOld']();
const callback = Api.listUsersOld;
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
  assert.equal(preview.matches.length, 4);
  assert.equal(preview.manualMatches.length, 1);
  assert.deepEqual(preview.errors, []);
  assert.equal(await readFile(ts, 'utf8'), original);

  const result = await migrateSources({ ...options, write: true }, changes);
  assert.equal(result.matches.length, 4);
  assert.equal(result.appliedFiles, 2);
  const updatedTs = await readFile(ts, 'utf8');
  assert.match(updatedTs, /Api\.listUsers\(\)/);
  assert.match(updatedTs, /Api\?\.listUsers\?\.\(\)/);
  assert.match(updatedTs, /Api\['listUsers'\]\(\)/);
  assert.match(updatedTs, /const callback = Api\.listUsersOld;/);
  assert.match(updatedTs, /other\.listUsersOld\(\)/);
  assert.match(updatedTs, /function shadow\(Api\) \{ return Api\.listUsersOld\(\); \}/);
  assert.match(updatedTs, /'Api\.listUsersOld\(\)'/);
  const updatedVue = await readFile(vue, 'utf8');
  assert.match(updatedVue, /await AdminApi\.listUsers\(\)/);
  assert.match(updatedVue, /<div>listUsersOld<\/div>/);
});

test('namespace imports migrate only the configured export and preserve shadowed names', async () => {
  const { src, old, next } = await fixture();
  const file = join(src, 'namespace.ts');
  await writeFile(file, `import * as Service from '@/api';
Service.AdminApi.listUsersOld();
Service['AdminApi']['listUsersOld']();
Service.OtherApi.listUsersOld();
function shadow(Service) { Service.AdminApi.listUsersOld(); }
`);
  const changes = compareOperations(await loadOperations(old), await loadOperations(next));
  const result = await migrateSources({
    src, clientImport: '@/api', clientExport: 'AdminApi', write: true
  }, changes);
  assert.equal(result.matches.length, 2);
  const updated = await readFile(file, 'utf8');
  assert.match(updated, /Service\.AdminApi\.listUsers\(\)/);
  assert.match(updated, /Service\['AdminApi'\]\['listUsers'\]\(\)/);
  assert.match(updated, /Service\.OtherApi\.listUsersOld\(\)/);
  assert.match(updated, /function shadow\(Service\) \{ Service\.AdminApi\.listUsersOld\(\); \}/);
});

test('repeated client import paths include explicit barrels without matching other modules', async () => {
  const { src, old, next } = await fixture();
  const file = join(src, 'users.ts');
  await writeFile(file, `import { AdminApi as Direct } from '@/api';
import { AdminApi as Barrel } from '@/api/barrel';
import { AdminApi as Other } from '@/other';
Direct.listUsersOld();
Barrel.listUsersOld();
Other.listUsersOld();
`);
  const { stdout } = await execFileAsync(process.execPath, [
    cli, '--old', old, '--new', next, '--src', src,
    '--client-import', '@/api', '--client-import', '@/api/barrel', '--write', '--json'
  ]);
  assert.equal(JSON.parse(stdout).matches.length, 2);
  const updated = await readFile(file, 'utf8');
  assert.match(updated, /Direct\.listUsers\(\)/);
  assert.match(updated, /Barrel\.listUsers\(\)/);
  assert.match(updated, /Other\.listUsersOld\(\)/);
});

test('write aborts all files when a source file cannot be parsed', async () => {
  const { src, old, next } = await fixture();
  const valid = join(src, 'valid.ts');
  await writeFile(valid, "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n");
  await writeFile(join(src, 'invalid.ts'), "import { AdminApi } from '@/api';\nconst broken = ;\n");
  const changes = compareOperations(await loadOperations(old), await loadOperations(next));
  const result = await migrateSources({
    src, clientImport: '@/api', clientExport: 'AdminApi', write: true
  }, changes);
  assert.equal(result.errors.length, 1);
  assert.equal(result.appliedFiles, 0);
  assert.match(await readFile(valid, 'utf8'), /AdminApi\.listUsersOld\(\)/);
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

test('method map connects generator-specific names to operation IDs', async () => {
  const { dir, src, old, next } = await fixture();
  const oldText = await readFile(old, 'utf8');
  const nextText = await readFile(next, 'utf8');
  await writeFile(old, oldText.replace('listUsersOld', 'list_users_old'));
  await writeFile(next, nextText.replace('listUsers', 'list_users'));
  const mapFile = join(dir, 'method-map.json');
  await writeFile(mapFile, JSON.stringify({ list_users_old: 'listUsersOld', list_users: 'listUsers' }));
  const file = join(src, 'users.ts');
  await writeFile(file, "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n");
  const methodMap = await loadMethodMap(mapFile);
  const changes = compareOperations(await loadOperations(old), await loadOperations(next), methodMap);
  assert.equal(changes[0].oldMethod, 'listUsersOld');
  assert.equal(changes[0].newMethod, 'listUsers');
  const { stdout } = await execFileAsync(process.execPath, [
    cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api',
    '--method-map', mapFile, '--write', '--json'
  ]);
  assert.equal(JSON.parse(stdout).appliedFiles, 1);
  assert.match(await readFile(file, 'utf8'), /AdminApi\.listUsers\(\)/);
});

test('openapi-typescript-codegen 0.31 adapter derives names without a JSON map', async () => {
  const { src, old, next } = await fixture();
  await writeFile(old, (await readFile(old, 'utf8')).replace('listUsersOld', 'list_users_old'));
  await writeFile(next, (await readFile(next, 'utf8')).replace('listUsers', 'list_users'));
  const file = join(src, 'users.ts');
  await writeFile(file, "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n");
  const oldSpec = await loadOperations(old);
  const newSpec = await loadOperations(next);
  const map = generatorMethodMap('openapi-typescript-codegen@0.31', oldSpec, newSpec);
  assert.equal(map.get('list_users_old'), 'listUsersOld');
  assert.equal(map.get('list_users'), 'listUsers');
  const { stdout } = await execFileAsync(process.execPath, [
    cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api',
    '--generator', 'openapi-typescript-codegen@0.31', '--write', '--json'
  ]);
  assert.equal(JSON.parse(stdout).appliedFiles, 1);
  assert.match(await readFile(file, 'utf8'), /AdminApi\.listUsers\(\)/);
  assert.throws(() => generatorMethodMap('unknown', oldSpec, newSpec), /Unsupported generator/);
});

test('colliding mapped method names require manual review', () => {
  const oldSpec = {
    operations: new Map([['GET /a', 'alpha'], ['GET /b', 'beta']]),
    ids: new Map([['alpha', 1], ['beta', 1]])
  };
  const newSpec = {
    operations: new Map([['GET /a', 'gamma'], ['GET /b', 'beta']]),
    ids: new Map([['gamma', 1], ['beta', 1]])
  };
  const map = new Map([['alpha', 'same'], ['beta', 'same'], ['gamma', 'newName']]);
  const changes = compareOperations(oldSpec, newSpec, map);
  assert.match(changes[0].reason, /shared/);
});

test('local path-item references and external files resolve relative to their own document', async () => {
  const { dir } = await fixture();
  const local = join(dir, 'local.yaml');
  await writeFile(local, `openapi: 3.1.0
info: { title: Demo, version: 1.0.0 }
paths:
  /users:
    $ref: '#/components/pathItems/Users'
components:
  pathItems:
    Users:
      get:
        operationId: listUsers
        responses: { '200': { description: OK } }
`);
  const operations = await loadOperations(local);
  assert.equal(operations.operations.get('GET /users'), 'listUsers');

  const external = join(dir, 'external.yaml');
  await writeFile(external, `openapi: 3.1.0
info: { title: Demo, version: 1.0.0 }
paths:
  /users:
    $ref: './paths.yaml#/Users'
`);
  await writeFile(join(dir, 'paths.yaml'), `Users:
  $ref: './nested.yaml#/Items/Users'
`);
  await writeFile(join(dir, 'nested.yaml'), `Items:
  Users:
    get:
      operationId: externalUsers
      responses: { '200': { description: OK } }
`);
  const externalOperations = await loadOperations(external);
  assert.equal(externalOperations.operations.get('GET /users'), 'externalUsers');

  const circular = join(dir, 'circular.yaml');
  await writeFile(circular, `openapi: 3.1.0
info: { title: Demo, version: 1.0.0 }
paths:
  /users:
    $ref: '#/components/pathItems/Users'
components:
  pathItems:
    Users:
      $ref: '#/paths/~1users'
`);
  await assert.rejects(loadOperations(circular), /circular path-item reference/);
});

test('HTTP path-item references require opt-in and use a bounded fetch', async () => {
  const { dir } = await fixture();
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/yaml');
    response.end("Users:\n  get:\n    operationId: remoteUsers\n    responses: { '200': { description: OK } }\n");
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const spec = join(dir, 'remote.yaml');
    const port = server.address().port;
    await writeFile(spec, `openapi: 3.1.0
info: { title: Demo, version: 1.0.0 }
paths:
  /users:
    $ref: 'http://127.0.0.1:${port}/path.yaml#/Users'
`);
    await assert.rejects(loadOperations(spec), /--allow-remote-refs/);
    const operations = await loadOperations(spec, { allowRemoteRefs: true });
    assert.equal(operations.operations.get('GET /users'), 'remoteUsers');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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

test('check mode reports pending calls with exit code 3 and never writes', async () => {
  const { src, old, next } = await fixture();
  const file = join(src, 'users.ts');
  const source = "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n";
  await writeFile(file, source);
  await assert.rejects(
    execFileAsync(process.execPath, [
      cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api', '--check', '--json'
    ]),
    error => {
      assert.equal(error.code, 3);
      assert.equal(JSON.parse(error.stdout).matches.length, 1);
      return true;
    }
  );
  assert.equal(await readFile(file, 'utf8'), source);
});

test('check mode also reports a method reference that needs manual review', async () => {
  const { src, old, next } = await fixture();
  await writeFile(join(src, 'users.ts'), "import { AdminApi } from '@/api';\nconst load = AdminApi.listUsersOld;\n");
  await assert.rejects(
    execFileAsync(process.execPath, [
      cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api', '--check', '--json'
    ]),
    error => {
      assert.equal(error.code, 3);
      const report = JSON.parse(error.stdout);
      assert.equal(report.matches.length, 0);
      assert.equal(report.manualMatches.length, 1);
      return true;
    }
  );
});

test('CLI write followed by check passes once direct calls are migrated', async () => {
  const { src, old, next } = await fixture();
  const file = join(src, 'users.ts');
  await writeFile(file, "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n");
  const args = [cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api'];
  const write = await execFileAsync(process.execPath, [...args, '--write', '--json']);
  assert.equal(JSON.parse(write.stdout).appliedFiles, 1);
  assert.match(await readFile(file, 'utf8'), /AdminApi\.listUsers\(\)/);
  const check = await execFileAsync(process.execPath, [...args, '--check', '--json']);
  assert.equal(JSON.parse(check.stdout).matches.length, 0);
});

test('Markdown report includes source locations and escapes table content', async () => {
  const { src, old, next } = await fixture();
  await writeFile(join(src, 'users.ts'), "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n");
  const { stdout } = await execFileAsync(process.execPath, [
    cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api', '--markdown'
  ]);
  assert.match(stdout, /\| users\.ts \| 2 \| listUsersOld → listUsers \| Direct call \|/);
  const escaped = formatMarkdown({
    mode: 'preview',
    changes: [{ endpoint: 'GET /a|b', oldId: 'old', newId: 'new', oldMethod: 'old', newMethod: 'new' }],
    matches: [], manualMatches: [], errors: [], appliedFiles: 0
  });
  assert.match(escaped, /GET \/a\\\|b/);
});

test('SARIF and GitHub formats locate pending calls at repository-relative paths', async () => {
  const { dir, src, old, next } = await fixture();
  await writeFile(join(src, 'users.ts'), "import { AdminApi } from '@/api';\nAdminApi.listUsersOld();\n");
  const args = [cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api', '--repo-root', dir];
  const sarif = JSON.parse((await execFileAsync(process.execPath, [...args, '--sarif'])).stdout);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'openapi-operation-migrator');
  assert.equal(sarif.runs[0].results[0].ruleId, 'opid/rename-call');
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'src/users.ts');
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 2);
  const annotations = (await execFileAsync(process.execPath, [...args, '--github'])).stdout;
  assert.match(annotations, /^::warning file=src\/users\.ts,line=2,title=OpenAPI operation migration::Rename listUsersOld to listUsers/m);
});

test('check mode fails on ambiguous IDs but accepts an unchanged generated method name', async () => {
  const { dir, src, old, next } = await fixture();
  const oldText = await readFile(old, 'utf8');
  await writeFile(old, `${oldText}  /other:\n    get:\n      operationId: listUsers\n`);
  const nextText = await readFile(next, 'utf8');
  await writeFile(next, `${nextText}  /other:\n    get:\n      operationId: listUsers\n`);
  const args = [cli, '--old', old, '--new', next, '--src', src, '--client-import', '@/api', '--check', '--json'];
  await assert.rejects(execFileAsync(process.execPath, args), error => {
    assert.equal(error.code, 3);
    assert.match(JSON.parse(error.stdout).changes[0].reason, /duplicated/);
    return true;
  });

  await writeFile(old, oldText);
  await writeFile(next, nextText);
  const methodMap = join(dir, 'same-method.json');
  await writeFile(methodMap, JSON.stringify({ listUsersOld: 'listUsers', listUsers: 'listUsers' }));
  const { stdout } = await execFileAsync(process.execPath, [...args, '--method-map', methodMap]);
  assert.equal(JSON.parse(stdout).changes[0].reason, 'generated method name is unchanged');
});
