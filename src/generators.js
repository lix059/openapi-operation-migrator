import camelCase from 'camelcase';

const GENERATORS = new Set(['openapi-typescript-codegen@0.31']);

export function generatorMethodMap(name, oldSpec, newSpec) {
  if (!GENERATORS.has(name)) {
    throw new Error(`Unsupported generator: ${name}. Supported: ${[...GENERATORS].join(', ')}`);
  }
  const methods = new Map();
  for (const id of [...oldSpec.operations.values(), ...newSpec.operations.values()]) {
    // Mirrors openapi-typescript-codegen 0.31 getOperationName for an explicit operationId.
    const normalized = id.replace(/^[^a-zA-Z]+/g, '').replace(/[^\w-]+/g, '-').trim();
    methods.set(id, camelCase(normalized));
  }
  return methods;
}
