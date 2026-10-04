import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { parse } from '@babel/parser';

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

function exportedName(node) {
  return node.name ?? node.value;
}

function resolveRelativeModule(fromFile, source) {
  if (!source.startsWith('.')) return undefined;
  const base = resolve(dirname(fromFile), source);
  const candidates = [base, ...EXTENSIONS.map(extension => `${base}${extension}`), ...EXTENSIONS.map(extension => join(base, `index${extension}`))];
  if (extname(base) === '.js') candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
}

export async function createImportResolver(options) {
  const allowed = new Set(options.clientImports ?? [options.clientImport]);
  const cache = new Map();
  let compilerOptions;
  let ts;
  if (options.tsconfig) {
    ts = (await import('typescript')).default;
    const config = ts.readConfigFile(options.tsconfig, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(options.tsconfig));
    if (parsed.errors.length) throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n'));
    compilerOptions = parsed.options;
  }

  function resolveModule(fromFile, source) {
    if (compilerOptions) {
      const matched = ts.resolveModuleName(source, fromFile, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
      if (matched && existsSync(matched)) return matched;
    }
    return resolveRelativeModule(fromFile, source);
  }

  function moduleAst(file) {
    if (!cache.has(file)) {
      const code = readFileSync(file, 'utf8');
      try {
        cache.set(file, parse(code, {
          sourceType: 'unambiguous',
          plugins: ['typescript', 'jsx', 'decorators-legacy']
        }));
      } catch (error) {
        throw new Error(`Cannot parse re-export module ${file}: ${error.message}`);
      }
    }
    return cache.get(file);
  }

  function resolveImport(fromFile, source, name, visited = new Set()) {
    if (allowed.has(source)) return name === options.clientExport;
    const file = resolveModule(fromFile, source);
    return file ? moduleProvidesClient(file, name, visited) : false;
  }

  function moduleProvidesClient(file, name, visited) {
    const key = `${file}:${name}`;
    if (visited.has(key)) return false;
    const currentVisited = new Set(visited);
    currentVisited.add(key);
    const body = moduleAst(file).program.body;

    function resolveLocal(localName, localVisited = new Set()) {
      if (localVisited.has(localName)) return false;
      localVisited.add(localName);
      for (const statement of body) {
        if (statement.type === 'ImportDeclaration') {
          for (const specifier of statement.specifiers) {
            if (specifier.local.name !== localName) continue;
            if (specifier.type === 'ImportSpecifier') {
              return resolveImport(file, statement.source.value, exportedName(specifier.imported), currentVisited);
            }
          }
        }
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue;
        for (const item of declaration.declarations) {
          if (item.id.type !== 'Identifier' || item.id.name !== localName || !item.init) continue;
          if (item.init.type === 'Identifier') return resolveLocal(item.init.name, localVisited);
          if (item.init.type === 'MemberExpression' && item.init.object.type === 'Identifier') {
            const property = item.init.computed && item.init.property.type === 'StringLiteral'
              ? item.init.property.value
              : !item.init.computed && item.init.property.type === 'Identifier'
                ? item.init.property.name
                : undefined;
            if (!property) return false;
            for (const imported of body) {
              if (imported.type !== 'ImportDeclaration') continue;
              if (imported.specifiers.some(specifier => specifier.type === 'ImportNamespaceSpecifier' && specifier.local.name === item.init.object.name)) {
                return resolveImport(file, imported.source.value, property, currentVisited);
              }
            }
          }
          return false;
        }
      }
      return false;
    }

    for (const statement of body) {
      if (statement.type === 'ExportNamedDeclaration') {
        if (statement.declaration?.type === 'VariableDeclaration') {
          if (statement.declaration.declarations.some(item => item.id.type === 'Identifier' && item.id.name === name) && resolveLocal(name)) return true;
        }
        for (const specifier of statement.specifiers) {
          if (specifier.type !== 'ExportSpecifier' || exportedName(specifier.exported) !== name) continue;
          const sourceName = exportedName(specifier.local);
          if (statement.source ? resolveImport(file, statement.source.value, sourceName, currentVisited) : resolveLocal(sourceName)) return true;
        }
      }
    }
    const stars = body.filter(statement => statement.type === 'ExportAllDeclaration' && !statement.exported);
    if (stars.length === 1 && resolveImport(file, stars[0].source.value, name, currentVisited)) return true;
    return false;
  }

  return { resolveImport };
}
