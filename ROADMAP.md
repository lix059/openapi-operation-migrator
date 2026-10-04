# Roadmap

This project focuses on a specific problem: a generated API method changes name after an OpenAPI `operationId` change. General contract diffing is already handled by tools such as oasdiff.

## Current release

- Match operations by HTTP method and path in OpenAPI 3 JSON/YAML documents.
- Preview and rewrite direct calls on a configured named import in TypeScript, JavaScript, and Vue source.
- Report ambiguous IDs and indirect method references for manual review.
- Stop all writes if a source file fails to parse; provide `--check` for CI.
- Accept an explicit operation ID to generated method map for generators that rename methods.
- Resolve local path-item references and fail explicitly on external or circular references.
- Support namespace imports with binding-aware analysis.
- Produce a Markdown report with source locations for pull requests and build artifacts.
- Accept multiple explicit client import paths for projects using barrel re-exports.

## Next priorities

1. **Generator adapters:** derive the method map from supported generator configurations instead of maintaining JSON by hand.
2. **More import shapes:** resolve barrel re-export chains and indirect aliases with binding-aware analysis, while keeping unrelated or shadowed names untouched.
3. **External OpenAPI references:** load referenced documents with a clear base path and cycle policy.
4. **CI output:** produce SARIF diagnostics and optional pull-request annotations.

Each compatibility addition should include a small synthetic fixture that fails before the change and passes afterward. Feature requests are most useful when they include the generator, the import statement, an old call, and the expected new call.
