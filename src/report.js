function cell(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
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
