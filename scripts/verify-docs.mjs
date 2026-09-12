import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const retired = ['HANDOFF.md', 'docs/DEVLOG.md', 'docs/00_core/f3_work_packages.md',
  'docs/00_core/architecture/F3_runtime_activation.md',
  '.claude/skills/runtime-data-discipline/references/cleanup-backlog.md',
  'docs/01_world/national_content_catalog.md', 'docs/01_world/national_content_catalog.html',
  'docs/02_systems/equipment_balance.md'];
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
const files = ['README.md', 'AGENTS.md', ...walk('docs'), ...walk('.claude')].filter(f => f.endsWith('.md'));
const errors = retired.filter(existsSync).map(file => `Retired duplicate document returned: ${file}`);
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^[a-z]+:|^\//i.test(link)) continue;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(link)))) errors.push(`${file}: broken link ${link}`);
  }
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`DOCUMENTS PASSED: ${files.length} Markdown files, no broken local links or retired status documents`);
