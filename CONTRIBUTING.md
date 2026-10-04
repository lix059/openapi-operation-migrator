# Contributing

Bug reports and focused pull requests are welcome. Please include a minimal OpenAPI pair and a small source example that reproduces the behavior. Use synthetic names and data; do not submit private code, tokens, credentials, or internal API documents.

Before opening a pull request:

```sh
npm ci
npm run check
npm test
```

For migration changes, add a test that checks both preview and `--write`. A safe migration must identify the configured import binding, leave shadowed and unrelated objects alone, and make no writes when source parsing fails.

Please keep pull requests focused on one import shape, generator mapping, or report improvement so behavior is easy to review.
