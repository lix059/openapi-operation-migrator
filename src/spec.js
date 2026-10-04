import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const MAX_REMOTE_BYTES = 5 * 1024 * 1024;

function displayLocation(location) {
  return location.protocol === 'file:' ? fileURLToPath(location) : `${location.origin}${location.pathname}`;
}

async function readRemote(location) {
  const response = await fetch(location, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${displayLocation(location)}: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REMOTE_BYTES) {
      await reader.cancel();
      throw new Error(`${displayLocation(location)}: remote document exceeds 5 MiB`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function loadDocument(location, context) {
  const documentUrl = new URL(location);
  documentUrl.hash = '';
  const key = documentUrl.href;
  if (!context.cache.has(key)) {
    context.cache.set(key, (async () => {
      let contents;
      if (documentUrl.protocol === 'file:') {
        contents = await readFile(fileURLToPath(documentUrl), 'utf8');
      } else if (['http:', 'https:'].includes(documentUrl.protocol) && context.allowRemoteRefs) {
        contents = await readRemote(documentUrl);
      } else {
        throw new Error(`${displayLocation(documentUrl)}: remote references require --allow-remote-refs`);
      }
      try {
        return YAML.parse(contents, { uniqueKeys: true });
      } catch (error) {
        throw new Error(`Cannot parse ${displayLocation(documentUrl)}: ${error.message}`);
      }
    })());
  }
  return context.cache.get(key);
}

function resolvePointer(document, fragment, location) {
  if (!fragment || fragment === '#') return document;
  const pointer = decodeURIComponent(fragment.slice(1));
  if (!pointer.startsWith('/')) throw new Error(`${displayLocation(location)}: unsupported reference fragment`);
  const segments = pointer.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let target = document;
  for (const segment of segments) target = target?.[segment];
  if (!target || typeof target !== 'object') {
    throw new Error(`${displayLocation(location)}: unresolved path-item reference`);
  }
  return target;
}

async function resolvePathItem(pathItem, location, context, visited = new Set()) {
  if (!pathItem || typeof pathItem !== 'object') return pathItem;
  const ref = pathItem.$ref;
  if (typeof ref !== 'string') return pathItem;
  if (Object.keys(pathItem).some(key => METHODS.has(key.toLowerCase()))) {
    throw new Error(`${displayLocation(location)}: path-item reference has sibling operations: ${ref}`);
  }
  const targetLocation = new URL(ref, location);
  if (visited.has(targetLocation.href)) {
    throw new Error(`${displayLocation(targetLocation)}: circular path-item reference`);
  }
  visited.add(targetLocation.href);
  const document = await loadDocument(targetLocation, context);
  const target = resolvePointer(document, targetLocation.hash, targetLocation);
  return resolvePathItem(target, targetLocation, context, visited);
}

export async function loadOperations(file, options = {}) {
  const location = pathToFileURL(resolve(file));
  const context = { cache: new Map(), allowRemoteRefs: options.allowRemoteRefs ?? false };
  const spec = await loadDocument(location, context);
  if (!spec || typeof spec !== 'object' || !String(spec.openapi ?? '').startsWith('3.')) {
    throw new Error(`${file} must be an OpenAPI 3 document`);
  }
  if (!spec.paths || typeof spec.paths !== 'object') {
    throw new Error(`${file} has no paths object`);
  }

  const operations = new Map();
  const ids = new Map();
  for (const [path, rawPathItem] of Object.entries(spec.paths)) {
    const pathItem = await resolvePathItem(rawPathItem, location, context);
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
