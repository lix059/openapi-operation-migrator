# Roadmap

This project focuses on a specific problem: a generated API method changes name after an OpenAPI `operationId` change. General contract diffing is already handled by tools such as oasdiff.

## Current release

- Match operations by HTTP method and path in OpenAPI 3 JSON/YAML documents.
- Preview and rewrite direct calls through verified API client bindings in TypeScript, JavaScript, and Vue source.
- Report ambiguous IDs and indirect method references for manual review.
- Stop all writes if a source file fails to parse; provide `--check` for CI.
- Accept an explicit operation ID to generated method map for generators that rename methods.
- Resolve local and external Path Item references with document-relative paths and cycle detection; require opt-in for HTTP(S).
- Support namespace imports with binding-aware analysis.
- Produce a Markdown report with source locations for pull requests and build artifacts.
- Accept multiple explicit client import paths for projects using barrel re-exports.
- Produce SARIF 2.1.0 and GitHub Actions annotations for pending migrations.
- Derive generated method names for openapi-typescript-codegen 0.31 from its naming rule.
- Trace relative barrel re-export chains and constant aliases in their lexical scope.
- Resolve non-relative barrel aliases with the project's TypeScript path configuration.

## Completed roadmap

1. **Generator adapter:** a pinned `openapi-typescript-codegen@0.31` naming rule derives method names; explicit map entries can override it.
2. **Import shapes:** relative re-export chains, TypeScript path aliases, namespace imports, and constant aliases are resolved using lexical bindings.
3. **External OpenAPI references:** file and opt-in HTTP(S) Path Item references use the containing document as their base and reject cycles.
4. **CI output:** JSON, Markdown, SARIF 2.1.0, and GitHub Actions annotations include source locations.

## Possible extensions

- Add other pinned generator versions after verifying their naming rules.
- Trace multiple `export *` sources when module exports can be resolved without ambiguity.
- Package a reusable GitHub Action if consumers need one.

Each compatibility addition should include a small synthetic fixture that fails before the change and passes afterward. Feature requests are most useful when they include the generator, the import statement, an old call, and the expected new call.

## Engineering acceptance (0.2.1)

- [x] Regression coverage for explicit export precedence and ESM/CJS extensions.
- [x] Clean up generated test fixtures.
- [x] Install and execute the packed distribution in an isolated directory.
- [x] Lock dependencies, publish repository metadata, restrict CI token permissions.
- [x] Bound CI runtime and cancel superseded runs.
- [x] Document static-analysis boundaries and partial-write recovery.

Remote CI execution is currently blocked by the repository owner's GitHub billing
lock. Local checks are reproducible; remote passing status is not asserted.
Possible extensions above are outside this completed release scope.
