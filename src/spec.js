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

export async function loadMethodMap(file) {
  const contents = await readFile(file, 'utf8');
  let values;
  try {
    values = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}`);
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  for (const [id, method] of Object.entries(values)) {
    if (typeof method !== 'string' || !method) {
      throw new Error(`${file}: method for ${id} must be a non-empty string`);
    }
  }
  return new Map(Object.entries(values));
}

export function compareOperations(oldSpec, newSpec, methodMap = new Map()) {
  const changes = [];
  for (const [endpoint, oldId] of oldSpec.operations) {
    const newId = newSpec.operations.get(endpoint);
    if (!newId || newId === oldId) continue;
    const oldMethod = methodMap.get(oldId) ?? oldId;
    const newMethod = methodMap.get(newId) ?? newId;

    let reason;
    if (oldSpec.ids.get(oldId) !== 1 || newSpec.ids.get(newId) !== 1) {
      reason = 'operationId is duplicated in a specification';
    } else if (newSpec.ids.has(oldId) || oldSpec.ids.has(newId)) {
      reason = 'operationId is reused by another operation';
    } else if (!/^[A-Za-z_$][\w$]*$/.test(oldMethod) || !/^[A-Za-z_$][\w$]*$/.test(newMethod)) {
      reason = 'generated method name is not a JavaScript property identifier';
    } else if (oldMethod === newMethod) {
      reason = 'generated method name is unchanged';
    }
    changes.push({ endpoint, oldId, newId, oldMethod, newMethod, ...(reason ? { reason } : {}) });
  }
  const oldMethodCounts = new Map();
  const newMethodCounts = new Map();
  for (const id of oldSpec.operations.values()) {
    const method = methodMap.get(id) ?? id;
    oldMethodCounts.set(method, (oldMethodCounts.get(method) ?? 0) + 1);
  }
  for (const id of newSpec.operations.values()) {
    const method = methodMap.get(id) ?? id;
    newMethodCounts.set(method, (newMethodCounts.get(method) ?? 0) + 1);
  }
  for (const change of changes) {
    if (!change.reason && (oldMethodCounts.get(change.oldMethod) > 1 || newMethodCounts.get(change.newMethod) > 1)) {
      change.reason = 'generated method name is shared by multiple changes';
    }
  }
  return changes;
}
