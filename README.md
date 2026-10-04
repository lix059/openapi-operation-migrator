# OpenAPI Operation Migrator

Find renamed OpenAPI `operationId` values and update direct calls to a named API client export in TypeScript, JavaScript, and Vue single-file components.

This tool targets a narrow migration: a generated API method is renamed while its HTTP method and path stay the same. It previews every change and edits source files only with `--write`.

## Quick start

Requires Node.js 20 or later.

```sh
npm install
node src/cli.js \
  --old examples/basic/old.yaml \
  --new examples/basic/new.yaml \
  --src examples/basic/src \
  --client-import '@/api'
```

For a project that imports `AdminApi` from `@/api`, the preview includes:

```text
GET /users: getUserListOld -> getUserList
  Users.vue:9 getUserListOld -> getUserList
```

Review the report and the newly generated client method, then add `--write`. Run the project's typecheck and tests after applying changes.

Install from this repository with `npm install -g .` to use `opid-migrate` as a command. For automation, add `--json` to get the report as JSON.

## Options

| Option | Purpose |
| --- | --- |
| `--old FILE` | Previous OpenAPI 3 JSON or YAML document |
| `--new FILE` | New OpenAPI 3 JSON or YAML document |
| `--src DIR` | Source tree to inspect |
| `--client-import NAME` | Exact module specifier used in source imports |
| `--client-export NAME` | Named export with methods; defaults to `AdminApi` |
| `--write` | Apply safe renames; omitted by default |
| `--json` | Emit machine-readable report |

An import alias is supported: `import { AdminApi as Api } from '@/api'` followed by `Api.oldMethod()`. The scanner uses the import binding, so calls on unrelated objects and locally shadowed names are left alone. Parse errors are reported as skipped files and give the process exit code 2.

## Safety boundaries

- Operations are paired by the same HTTP method and path. Path or method migrations require manual review.
- Duplicated or reused `operationId` values are reported as manual changes.
- Only direct method calls on the configured named import are edited. Computed properties, optional calls, re-exports, and indirect aliases are outside this first release.
- The tool does not regenerate your API client. Confirm the new method exists before applying edits.
- Preview first, run on a clean Git working tree, and review the diff after `--write`.

## Development

```sh
npm ci
npm run check
npm test
```

Issues and small reproducible examples are welcome. Use synthetic API schemas and source files when reporting bugs; avoid posting private application code or credentials.
