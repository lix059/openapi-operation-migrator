import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { parse as parseJs } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { parse as parseVue } from '@vue/compiler-sfc';

const traverse = traverseModule.default ?? traverseModule;
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) files.push(...await sourceFiles(path));
    else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

function scriptParts(filename, source) {
  if (extname(filename) !== '.vue') return [{ code: source, offset: 0 }];
  const { descriptor, errors } = parseVue(source, { filename });
  if (errors.length) throw new Error(errors[0].message);
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean)
    .map(block => ({ code: block.content, offset: block.loc.start.offset }));
}

function findUsages(code, offset, options, renames) {
  const ast = parseJs(code, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx', 'decorators-legacy']
  });
  const edits = [];
  const manual = [];
  function inspectMember(path) {
    const member = path.node;
    if (member.object.type !== 'Identifier') return;
    if (member.computed && member.property.type !== 'StringLiteral') return;
    if (!member.computed && member.property.type !== 'Identifier') return;
    const oldId = member.computed ? member.property.value : member.property.name;
    const change = renames.get(oldId);
    if (!change) return;

    const binding = path.scope.getBinding(member.object.name);
    if (!binding || !binding.path.isImportSpecifier()) return;
    const importNode = binding.path.parentPath.node;
    if (importNode.source.value !== options.clientImport) return;
    const imported = binding.path.node.imported;
    if ((imported.name ?? imported.value) !== options.clientExport) return;

    const usage = {
      start: offset + member.property.start + (member.computed ? 1 : 0),
      end: offset + member.property.end - (member.computed ? 1 : 0),
      oldId,
      newId: change.newId,
      endpoint: change.endpoint
    };
    const parent = path.parentPath;
    if ((parent.isCallExpression() || parent.isOptionalCallExpression()) && parent.node.callee === member) {
      edits.push(usage);
    } else {
      manual.push(usage);
    }
  }
  traverse(ast, {
    MemberExpression: inspectMember,
    OptionalMemberExpression: inspectMember
  });
  return { edits, manual };
}

export async function migrateSources(options, changes) {
  const renames = new Map(changes.filter(change => !change.reason).map(change => [change.oldId, change]));
  const files = await sourceFiles(options.src);
  const matches = [];
  const manualMatches = [];
  const errors = [];
  const pendingWrites = [];
  for (const filename of files) {
    const source = await readFile(filename, 'utf8');
    let usages;
    try {
      usages = scriptParts(filename, source).map(part => findUsages(part.code, part.offset, options, renames));
    } catch (error) {
      errors.push({ file: relative(options.src, filename), message: error.message });
      continue;
    }
    const edits = usages.flatMap(usage => usage.edits);
    const manual = usages.flatMap(usage => usage.manual);
    for (const usage of manual) {
      manualMatches.push({
        file: relative(options.src, filename),
        line: source.slice(0, usage.start).split('\n').length,
        oldId: usage.oldId,
        newId: usage.newId,
        endpoint: usage.endpoint,
        reason: 'method reference is not a direct call'
      });
    }
    if (!edits.length) continue;
    for (const edit of edits) {
      const before = source.slice(0, edit.start);
      matches.push({
        file: relative(options.src, filename),
        line: before.split('\n').length,
        oldId: edit.oldId,
        newId: edit.newId,
        endpoint: edit.endpoint
      });
    }
    let updated = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      updated = updated.slice(0, edit.start) + edit.newId + updated.slice(edit.end);
    }
    pendingWrites.push({ filename, updated });
  }
  if (options.write && !errors.length) {
    for (const { filename, updated } of pendingWrites) await writeFile(filename, updated);
  }
  return {
    matches,
    manualMatches,
    errors,
    scannedFiles: files.length,
    appliedFiles: options.write && !errors.length ? pendingWrites.length : 0
  };
}
