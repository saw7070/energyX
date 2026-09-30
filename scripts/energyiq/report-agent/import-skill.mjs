// Usage: node scripts/energyiq/report-agent/import-skill.mjs <Skill directory> [version]
// Prints one self-contained skillRef JSON. Does not alter the source Skill or save settings.
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2]);
const source = readFileSync(join(root, 'SKILL.md'), 'utf8');
const references = [];
const walk = (directory, prefix = '') => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry), stat = lstatSync(path), relative = prefix + entry;
    if (stat.isSymbolicLink()) throw Error('SKILL_LINK_UNSUPPORTED');
    if (stat.isDirectory()) walk(path, relative + '/');
    else if (relative.startsWith('references/') && relative.endsWith('.md')) references.push({ path: relative, content: readFileSync(path, 'utf8') });
  }
};
walk(root);
const labels = new Map(references.map((ref, index) => [ref.path, `Embedded reference ${index + 1}: ${basename(ref.path)}`]));
const inline = text => {
  for (const [path, label] of labels) {
    text = text.split(`(${path})`).join('');
    text = text.split(path).join(label);
  }
  if (/\b(?:references|scripts)\/[\w./-]+/i.test(text)) throw Error('SKILL_RESOURCE_NOT_EMBEDDED');
  return text;
};
const content = inline(source) + '\n\nThe references below are embedded in this saved version; use their text directly. No source Session or external files are required.\n' + references.map(ref => `\n## ${labels.get(ref.path)}\n\n${inline(ref.content)}`).join('\n');
const hash = createHash('sha256').update(content).digest('hex');
process.stdout.write(JSON.stringify({ name: basename(root), version: process.argv[3] ?? hash.slice(0, 16), content }, null, 2) + '\n');
