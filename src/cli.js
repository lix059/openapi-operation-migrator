#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadOperations, loadMethodMap, compareOperations } from './spec.js';
import { migrateSources } from './scan.js';

const HELP = `Usage: opid-migrate --old old.yaml --new new.yaml --src ./src --client-import @/api [options]

Options:
  --client-export NAME  Named export containing the API methods (default: AdminApi)
  --method-map FILE     JSON map from operationId to generated method name
  --write               Apply safe call-site renames (default: preview only)
  --check               Exit 3 if method usages still need migration; for CI
  --json                Print machine-readable JSON
  --help                Show this help

Only calls on a named import are changed, for example AdminApi.oldMethod().
Operations are matched by HTTP method and path. Review generated API code before --write.
`;

function parseArgs(argv) {
  const options = { clientExport: 'AdminApi', write: false, check: false, json: false };
  const valued = new Map([
    ['--old', 'old'], ['--new', 'new'], ['--src', 'src'],
    ['--client-import', 'clientImport'], ['--client-export', 'clientExport'],
    ['--method-map', 'methodMap']
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--write' || arg === '--check' || arg === '--json') {
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
  if (options.write && options.check) throw new Error('--write and --check cannot be combined');
  options.old = resolve(options.old);
  options.new = resolve(options.new);
  options.src = resolve(options.src);
  if (options.methodMap) options.methodMap = resolve(options.methodMap);
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
  const methodMap = options.methodMap ? await loadMethodMap(options.methodMap) : new Map();
  const changes = compareOperations(oldSpec, newSpec, methodMap);
  const scan = await migrateSources(options, changes);
  const report = { mode: options.write ? 'write' : options.check ? 'check' : 'preview', changes, ...scan };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${changes.length} operationId change(s), ${scan.matches.length} call site(s), ${scan.manualMatches.length} manual reference(s), ${scan.scannedFiles} file(s) scanned, ${scan.appliedFiles} file(s) written.\n`);
    for (const change of changes) {
      const methodLabel = change.oldId !== change.oldMethod || change.newId !== change.newMethod
        ? ` (client: ${change.oldMethod} -> ${change.newMethod})`
        : '';
      process.stdout.write(`${change.endpoint}: ${change.oldId} -> ${change.newId}${methodLabel}${change.reason ? ` [manual: ${change.reason}]` : ''}\n`);
    }
    for (const match of scan.matches) {
      process.stdout.write(`  ${match.file}:${match.line} ${match.oldMethod} -> ${match.newMethod}\n`);
    }
    for (const match of scan.manualMatches) {
      process.stdout.write(`  ${match.file}:${match.line} ${match.oldMethod} -> ${match.newMethod} [manual: ${match.reason}]\n`);
    }
    for (const error of scan.errors) process.stderr.write(`Skipped ${error.file}: ${error.message}\n`);
    if (options.write && scan.errors.length) process.stderr.write('No files written because some files could not be parsed.\n');
    if (!options.write && scan.matches.length) process.stdout.write('Preview only. Pass --write to apply.\n');
  }
  if (scan.errors.length) process.exitCode = 2;
  else if (options.check && (scan.matches.length || scan.manualMatches.length)) process.exitCode = 3;
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
