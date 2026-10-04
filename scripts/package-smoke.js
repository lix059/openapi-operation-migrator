import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'opid-package-'));
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { encoding: 'utf8' }));
  execFileSync('npm', ['install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', join(dir, packed[0].filename)], { stdio: 'pipe' });
  const output = execFileSync(process.execPath, [join(dir, 'node_modules/openapi-operation-migrator/src/cli.js'), '--help'], { encoding: 'utf8' });
  assert.match(output, /Usage: opid-migrate/);
  console.log('Packed artifact installs and CLI starts successfully.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
