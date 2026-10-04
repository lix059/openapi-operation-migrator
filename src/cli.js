#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadOperations, compareOperations } from './spec.js';
import { migrateSources } from './scan.js';

const HELP = `Usage: opid-migrate --old old.yaml --new new.yaml --src ./src --client-import @/api [options]

Options:
  --client-export NAME  Named export containing the API methods (default: AdminApi)
  --write               Apply safe call-site renames (default: preview only)
  --json                Print machine-readable JSON
  --help                Show this help

Only direct calls on a named import are changed, for example AdminApi.oldMethod().
Operations are matched by HTTP method and path. Review generated API code before --write.
`;

function parseArgs(argv) {
  const options = { clientExport: 'AdminApi', write: false, json: false };
  const valued = new Map([
    ['--old', 'old'], ['--new', 'new'], ['--src', 'src'],
    ['--client-import', 'clientImport'], ['--client-export', 'clientExport']
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--write' || arg === '--json') {
      options[arg.slice(2)] = true;
    } else if (valued.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      options[valued.get(arg)] = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  for (const key of ['old', 'new', 'src', 'clientImport']) {
    if (!options[key]) throw new Error(`Missing --${key === 'clientImport' ? 'client-import' : key}`);
  }
  options.old = resolve(options.old);
  options.new = resolve(options.new);
  options.src = resolve(options.src);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const oldSpec = await loadOperations(options.old);
  const newSpec = await loadOperations(options.new);
  const changes = compareOperations(oldSpec, newSpec);
  const scan = await migrateSources(options, changes);
  const report = { mode: options.write ? 'write' : 'preview', changes, ...scan };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${changes.length} operationId change(s), ${scan.matches.length} call site(s), ${scan.scannedFiles} file(s) scanned.\n`);
    for (const change of changes) {
      process.stdout.write(`${change.endpoint}: ${change.oldId} -> ${change.newId}${change.reason ? ` [manual: ${change.reason}]` : ''}\n`);
    }
    for (const match of scan.matches) {
      process.stdout.write(`  ${match.file}:${match.line} ${match.oldId} -> ${match.newId}\n`);
    }
    for (const error of scan.errors) process.stderr.write(`Skipped ${error.file}: ${error.message}\n`);
    if (!options.write && scan.matches.length) process.stdout.write('Preview only. Pass --write to apply.\n');
  }
  if (scan.errors.length) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
