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

function findCalls(code, offset, options, renames) {
  const ast = parseJs(code, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx', 'decorators-legacy']
  });
  const edits = [];
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier') return;
      const oldId = callee.property.name;
      const change = renames.get(oldId);
      if (!change) return;

      const binding = path.scope.getBinding(callee.object.name);
      if (!binding || !binding.path.isImportSpecifier()) return;
      const importNode = binding.path.parentPath.node;
      if (importNode.source.value !== options.clientImport) return;
      const imported = binding.path.node.imported;
      if ((imported.name ?? imported.value) !== options.clientExport) return;

      edits.push({
        start: offset + callee.property.start,
        end: offset + callee.property.end,
        oldId,
        newId: change.newId,
        endpoint: change.endpoint
      });
    }
  });
  return edits;
}

export async function migrateSources(options, changes) {
  const renames = new Map(changes.filter(change => !change.reason).map(change => [change.oldId, change]));
  const files = await sourceFiles(options.src);
  const matches = [];
  const errors = [];
  for (const filename of files) {
    const source = await readFile(filename, 'utf8');
    let edits;
    try {
      edits = scriptParts(filename, source).flatMap(part => findCalls(part.code, part.offset, options, renames));
    } catch (error) {
      errors.push({ file: relative(options.src, filename), message: error.message });
      continue;
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
    if (options.write) {
      let updated = source;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        updated = updated.slice(0, edit.start) + edit.newId + updated.slice(edit.end);
      }
      await writeFile(filename, updated);
    }
  }
  return { matches, errors, scannedFiles: files.length };
}
