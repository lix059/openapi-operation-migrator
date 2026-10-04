import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function cell(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function sourcePath(file, context, uri = true) {
  const absolute = resolve(context.src, file);
  const fromRoot = relative(context.repoRoot, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return uri ? pathToFileURL(absolute).href : absolute;
  }
  return uri ? fromRoot.split(sep).map(encodeURIComponent).join('/') : fromRoot.split(sep).join('/');
}

function specPath(context, uri = true) {
  const fromRoot = relative(context.repoRoot, context.newSpec);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return uri ? pathToFileURL(context.newSpec).href : context.newSpec;
  }
  return uri ? fromRoot.split(sep).map(encodeURIComponent).join('/') : fromRoot.split(sep).join('/');
}

function sarifResult(ruleId, message, uri, line) {
  return {
    ruleId,
    level: ruleId === 'opid/parse-error' ? 'error' : 'warning',
    message: { text: message },
    locations: [{ physicalLocation: {
      artifactLocation: { uri },
      region: { startLine: line }
    } }]
  };
}

export function formatSarif(report, context) {
  const results = [];
  if (!report.appliedFiles) {
    for (const match of report.matches) {
      results.push(sarifResult('opid/rename-call', `Rename ${match.oldMethod} to ${match.newMethod} for ${match.endpoint}.`, sourcePath(match.file, context), match.line));
    }
  }
  for (const match of report.manualMatches) {
    results.push(sarifResult('opid/manual-reference', `Review ${match.oldMethod} to ${match.newMethod}: ${match.reason}.`, sourcePath(match.file, context), match.line));
  }
  for (const change of report.changes) {
    if (change.reason && change.reason !== 'generated method name is unchanged') {
      results.push(sarifResult('opid/ambiguous-change', `Review ${change.endpoint}: ${change.reason}.`, specPath(context), 1));
    }
  }
  for (const error of report.errors) {
    results.push(sarifResult('opid/parse-error', error.message, sourcePath(error.file, context), 1));
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'openapi-operation-migrator',
        semanticVersion: version,
        rules: [
          { id: 'opid/rename-call', shortDescription: { text: 'Generated API method call needs renaming' } },
          { id: 'opid/manual-reference', shortDescription: { text: 'Generated API method reference needs review' } },
          { id: 'opid/ambiguous-change', shortDescription: { text: 'OpenAPI operation rename is ambiguous' } },
          { id: 'opid/parse-error', shortDescription: { text: 'Source file could not be parsed' } }
        ]
      } },
      results
    }]
  };
}

function annotationValue(value, property = false) {
  const escaped = String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return property ? escaped.replaceAll(':', '%3A').replaceAll(',', '%2C') : escaped;
}

export function formatGitHubAnnotations(report, context) {
  const lines = [];
  function add(level, file, line, message) {
    lines.push(`::${level} file=${annotationValue(file, true)},line=${line},title=OpenAPI operation migration::${annotationValue(message)}`);
  }
  if (!report.appliedFiles) {
    for (const match of report.matches) {
      add('warning', sourcePath(match.file, context, false), match.line, `Rename ${match.oldMethod} to ${match.newMethod} for ${match.endpoint}.`);
    }
  }
  for (const match of report.manualMatches) {
    add('warning', sourcePath(match.file, context, false), match.line, `Review ${match.oldMethod} to ${match.newMethod}: ${match.reason}.`);
  }
  for (const change of report.changes) {
    if (change.reason && change.reason !== 'generated method name is unchanged') {
      add('warning', specPath(context, false), 1, `Review ${change.endpoint}: ${change.reason}.`);
    }
  }
  for (const error of report.errors) add('error', sourcePath(error.file, context, false), 1, error.message);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function formatMarkdown(report) {
  const lines = [
    '# OpenAPI operation migration',
    '',
    `Mode: ${report.mode}. ${report.changes.length} operation ID change(s), ${report.matches.length} direct call(s), ${report.manualMatches.length} manual reference(s), ${report.errors.length} parse error(s).`,
    '',
    '## Operation changes',
    '',
    '| Endpoint | Operation ID | Generated method | Status |',
    '| --- | --- | --- | --- |'
  ];
  for (const change of report.changes) {
    lines.push(`| ${cell(change.endpoint)} | ${cell(change.oldId)} → ${cell(change.newId)} | ${cell(change.oldMethod)} → ${cell(change.newMethod)} | ${cell(change.reason ?? 'Ready')} |`);
  }
  if (!report.changes.length) lines.push('| None | — | — | — |');
  lines.push('', '## Source usages', '', '| File | Line | Generated method | Action |', '| --- | ---: | --- | --- |');
  for (const match of report.matches) {
    const action = report.appliedFiles ? 'Written' : 'Direct call';
    lines.push(`| ${cell(match.file)} | ${match.line} | ${cell(match.oldMethod)} → ${cell(match.newMethod)} | ${action} |`);
  }
  for (const match of report.manualMatches) {
    lines.push(`| ${cell(match.file)} | ${match.line} | ${cell(match.oldMethod)} → ${cell(match.newMethod)} | Manual: ${cell(match.reason)} |`);
  }
  if (!report.matches.length && !report.manualMatches.length) lines.push('| None | — | — | — |');
  if (report.errors.length) {
    lines.push('', '## Parse errors', '');
    for (const error of report.errors) lines.push(`- ${cell(error.file)}: ${cell(error.message)}`);
  }
  return `${lines.join('\n')}\n`;
}
