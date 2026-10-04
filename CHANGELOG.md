# Changelog

## 0.2.1

- Respect explicit exports overriding star exports; ignore type-only client imports.
- Scan `.mts`, `.cts`, `.mjs` and `.cjs` in addition to existing source formats.
- Resolve only own JSON pointer properties and reject array-shaped paths.
- Add packed-install smoke verification, test cleanup and constrained CI permissions.

## 0.2.0

- Complete generator adapter, external path references, re-export and tsconfig resolution.
- Add JSON, Markdown, SARIF and GitHub annotations.
