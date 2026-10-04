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

Install from this repository with `npm install -g .` to use `opid-migrate` as a command. For automation, add `--json` to get the report as JSON, or `--markdown` to produce a report for a pull request or build artifact.

To fail a CI step when matching method usages still use old names or the specification has ambiguous renames, use `--check`. It exits 3 when migration or manual review is pending, 2 when a source file cannot be parsed, and 1 for invalid input or another fatal error. A clean check exits 0. An operation ID change that leaves the generated method name unchanged does not fail the check. `--check` never edits files and cannot be combined with `--write`.

For example, after your own API generation step in CI:

```sh
opid-migrate \
  --old api/previous.yaml \
  --new api/current.yaml \
  --src src \
  --client-import '@/api' \
  --check
```

Add `--markdown > migration-report.md` to save a reviewable report. The command keeps the same exit codes when Markdown output is selected.

## Options

| Option | Purpose |
| --- | --- |
| `--old FILE` | Previous OpenAPI 3 JSON or YAML document |
| `--new FILE` | New OpenAPI 3 JSON or YAML document |
| `--src DIR` | Source tree to inspect |
| `--client-import NAME` | Exact module specifier used in source imports; repeat for multiple paths |
| `--client-export NAME` | Named export with methods; defaults to `AdminApi` |
| `--method-map FILE` | Optional JSON map from operation IDs to generated method names |
| `--generator NAME` | Derive names using a supported generator naming rule |
| `--allow-remote-refs` | Allow HTTP(S) Path Item references from OpenAPI documents |
| `--write` | Apply safe renames; omitted by default |
| `--check` | Check for pending calls and set a CI-friendly exit code |
| `--json` | Emit machine-readable report |
| `--markdown` | Emit a Markdown report; cannot be combined with `--json` |
| `--sarif` | Emit SARIF 2.1.0 diagnostics for code scanning |
| `--github` | Emit GitHub Actions workflow annotations |
| `--repo-root DIR` | Repository root for SARIF/annotations; defaults to current directory |
| `--tsconfig FILE` | Resolve barrel imports using TypeScript `baseUrl`/`paths` |

An import alias is supported: `import { AdminApi as Api } from '@/api'` followed by `Api.oldMethod()`. Namespace imports are supported too: `import * as Service from '@/api'` followed by `Service.AdminApi.oldMethod()`. Optional calls and string-literal member calls such as `Api['oldMethod']()` are supported. The scanner uses import bindings, so calls on unrelated objects and locally shadowed names are left alone. A method reference such as `const load = Api.oldMethod` is reported under `manualMatches` for context-specific review. If any source file cannot be parsed, `--write` leaves all files untouched and exits 2.

Relative barrel re-export chains are traced automatically, including renamed exports and a single `export *` source. Pass `--tsconfig tsconfig.json` to resolve path aliases using the project's TypeScript configuration. Constant aliases such as `const Api = AdminApi` are traced in their declaration scope. Mutable aliases are left alone. If a non-relative barrel path is not resolvable through `tsconfig`, repeat the import option: `--client-import '@/api' --client-import '@/api/barrel'`. This declares both paths as trusted sources of the same `--client-export`.

If your generator changes operation IDs into different method names, pass a map covering the old and new IDs:

```json
{
  "list_users_old": "listUsersOld",
  "list_users": "listUsers"
}
```

Use `--method-map method-map.json`. IDs absent from the map keep their original names. The tool reports method-name collisions for manual review.

For [`openapi-typescript-codegen` 0.31](https://github.com/ferdikoomen/openapi-typescript-codegen/blob/main/src/openApi/v3/parser/getOperationName.ts), use `--generator openapi-typescript-codegen@0.31` instead of maintaining a map. The adapter applies that version's explicit `operationId` naming rule. If your project customizes generated names, add `--method-map`; its entries override the adapter. Other generator versions are not assumed compatible.

## Safety boundaries

- Operations are paired by the same HTTP method and path. Path or method migrations require manual review.
- Without `--method-map`, the tool assumes each generated method has the exact `operationId` name.
- Local and external file Path Item references are resolved relative to the document containing each reference. HTTP(S) references require `--allow-remote-refs` and are limited to 5 MiB and 10 seconds per document. Circular and unresolved references fail explicitly.
- Duplicated or reused `operationId` values are reported as manual changes.
- Only method calls on a verified named, namespace, or constant alias binding are edited. Dynamic computed properties, mutable aliases, and non-relative re-export paths that were not explicitly declared are outside this release.
- The tool does not regenerate your API client. Confirm the new method exists before applying edits.
- Preview first, run on a clean Git working tree, and review the diff after `--write`.

For CI diagnostics, run from the repository root (or pass `--repo-root`) and select one output format. `--sarif > migration.sarif` creates a file compatible with GitHub's SARIF upload action; `--github` prints workflow warnings and errors directly. Both keep the normal `--check` exit status. SARIF upload requires a separate workflow step and the repository's code scanning permissions.

## Development

```sh
npm ci
npm run check
npm test
```

See [ROADMAP.md](ROADMAP.md) for planned compatibility work and [CONTRIBUTING.md](CONTRIBUTING.md) for reporting or contributing. Use synthetic API schemas and source files when reporting bugs; avoid posting private application code or credentials.

## Release verification

`npm ci && npm run check && npm test && npm run test:package` checks syntax,
binding-aware migrations, CLI exit codes and installation of the actual npm tarball.
Supported runtimes are Node.js 20 and later; CI targets 20, 22 and 24.
The CLI is distributed from this repository; it has not been published to npm.

Migration is static analysis, not a full TypeScript semantic proof. Dynamic property
names, runtime client mutation, Vue template calls and multiple star re-exports
are outside the supported scope. Back up or commit source before using `--write`:
parse failures stop all writes, but filesystem failures during writing may leave
partially updated files. Review the diff and run your application's checks.
