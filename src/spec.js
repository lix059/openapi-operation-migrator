import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export async function loadOperations(file) {
  const contents = await readFile(file, 'utf8');
  let spec;
  try {
    spec = YAML.parse(contents, { uniqueKeys: true });
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}`);
  }
  if (!spec || typeof spec !== 'object' || !String(spec.openapi ?? '').startsWith('3.')) {
    throw new Error(`${file} must be an OpenAPI 3 document`);
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    throw new Error(`${file} has no paths object`);
  }

  const operations = new Map();
  const ids = new Map();
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      if (!operation || typeof operation !== 'object') continue;
      const id = operation.operationId;
      if (typeof id !== 'string' || !id.trim()) continue;
      const key = `${method.toUpperCase()} ${path}`;
      operations.set(key, id);
      ids.set(id, (ids.get(id) ?? 0) + 1);
    }
  }
  return { operations, ids };
}

export function compareOperations(oldSpec, newSpec) {
  const changes = [];
  for (const [endpoint, oldId] of oldSpec.operations) {
    const newId = newSpec.operations.get(endpoint);
    if (!newId || newId === oldId) continue;

    let reason;
    if (oldSpec.ids.get(oldId) !== 1 || newSpec.ids.get(newId) !== 1) {
      reason = 'operationId is duplicated in a specification';
    } else if (newSpec.ids.has(oldId) || oldSpec.ids.has(newId)) {
      reason = 'operationId is reused by another operation';
    } else if (!/^[A-Za-z_$][\w$]*$/.test(oldId) || !/^[A-Za-z_$][\w$]*$/.test(newId)) {
      reason = 'operationId is not a JavaScript property identifier';
    }
    changes.push({ endpoint, oldId, newId, ...(reason ? { reason } : {}) });
  }
  return changes;
}
