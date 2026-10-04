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
| `--allow-remote-refs` | Allow HTTP(S) Path Item references from OpenAPI documents |
| `--write` | Apply safe renames; omitted by default |
| `--check` | Check for pending calls and set a CI-friendly exit code |
| `--json` | Emit machine-readable report |
| `--markdown` | Emit a Markdown report; cannot be combined with `--json` |
| `--sarif` | Emit SARIF 2.1.0 diagnostics for code scanning |
| `--github` | Emit GitHub Actions workflow annotations |
| `--repo-root DIR` | Repository root for SARIF/annotations; defaults to current directory |

An import alias is supported: `import { AdminApi as Api } from '@/api'` followed by `Api.oldMethod()`. Namespace imports are supported too: `import * as Service from '@/api'` followed by `Service.AdminApi.oldMethod()`. Optional calls and string-literal member calls such as `Api['oldMethod']()` are supported. The scanner uses import bindings, so calls on unrelated objects and locally shadowed names are left alone. A method reference such as `const load = Api.oldMethod` is reported under `manualMatches` for context-specific review. If any source file cannot be parsed, `--write` leaves all files untouched and exits 2.

For an explicit barrel import, repeat the import option: `--client-import '@/api' --client-import '@/api/barrel'`. This declares both paths as trusted sources of the same `--client-export`; the tool does not inspect the barrel's re-export chain.

If your generator changes operation IDs into different method names, pass a map covering the old and new IDs:

```json
{
  "list_users_old": "listUsersOld",
  "list_users": "listUsers"
}
```

Use `--method-map method-map.json`. IDs absent from the map keep their original names. The tool reports method-name collisions for manual review.

## Safety boundaries

- Operations are paired by the same HTTP method and path. Path or method migrations require manual review.
- Without `--method-map`, the tool assumes each generated method has the exact `operationId` name.
- Local and external file Path Item references are resolved relative to the document containing each reference. HTTP(S) references require `--allow-remote-refs` and are limited to 5 MiB and 10 seconds per document. Circular and unresolved references fail explicitly.
- Duplicated or reused `operationId` values are reported as manual changes.
- Only method calls on the configured named or namespace import are edited. Dynamic computed properties and indirect aliases are outside this release. Re-export paths must be declared explicitly with repeated `--client-import` options.
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
