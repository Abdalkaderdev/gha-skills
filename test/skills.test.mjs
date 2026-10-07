import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const ALLOWED = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function unquote(v) {
  if (/^".*"$/.test(v)) return JSON.parse(v);
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replaceAll("''", "'");
  if (/: | #/.test(v)) throw new Error(`plain scalar needs quoting: ${v}`);
  return v;
}

export function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error('missing --- frontmatter block');
  const data = {};
  let map = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const nested = line.match(/^ {2}([\w.-]+):\s*(.*)$/);
    if (nested && map) {
      map[nested[1]] = unquote(nested[2]);
      continue;
    }
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (!top) throw new Error(`unparseable frontmatter line: ${line}`);
    if (top[2] === '') {
      map = data[top[1]] = {};
    } else {
      map = null;
      data[top[1]] = unquote(top[2]);
    }
  }
  return { data, body: m[2] };
}

const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test('skills directory is not empty', () => {
  assert.ok(skills.length > 0);
});

for (const dir of skills) {
  test(`skills/${dir}`, () => {
    const file = join(skillsDir, dir, 'SKILL.md');
    assert.ok(existsSync(file), 'SKILL.md missing');
    const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'));

    for (const key of Object.keys(data)) assert.ok(ALLOWED.has(key), `unknown frontmatter key: ${key}`);

    assert.equal(typeof data.name, 'string', 'name required');
    assert.ok(data.name.length <= 64, 'name > 64 chars');
    assert.match(data.name, NAME_RE, 'name must be lowercase a-z, 0-9, single hyphens');
    assert.equal(data.name, dir, 'name must match folder name');

    assert.equal(typeof data.description, 'string', 'description required');
    assert.ok(data.description.length >= 1 && data.description.length <= 1024, 'description must be 1-1024 chars');
    assert.match(data.description, /\bUse (when|for|this)\b/i, 'description must say when to use it');

    if ('compatibility' in data) {
      assert.equal(typeof data.compatibility, 'string');
      assert.ok(data.compatibility.length >= 1 && data.compatibility.length <= 500, 'compatibility must be 1-500 chars');
    }
    if ('metadata' in data) {
      assert.equal(typeof data.metadata, 'object', 'metadata must be a map');
      for (const v of Object.values(data.metadata)) assert.equal(typeof v, 'string', 'metadata values must be strings');
    }
    if ('allowed-tools' in data) assert.equal(typeof data['allowed-tools'], 'string');

    assert.ok(body.split('\n').length < 500, 'SKILL.md body must stay under 500 lines');

    for (const [, target] of body.matchAll(/\]\(((?:references|scripts|assets)\/[^)#\s]+)\)/g)) {
      assert.ok(existsSync(join(skillsDir, dir, target)), `broken link: ${target}`);
    }
  });
}

test('plugin and marketplace manifests', () => {
  const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.match(plugin.name, NAME_RE);
  assert.ok(market.name && market.owner?.name && Array.isArray(market.plugins));
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'marketplace must list the plugin');
  assert.ok(entry.source === './' || entry.source === '.', 'plugin source must be the repo root');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(plugin.version, pkg.version, 'plugin.json and package.json versions differ');
});

test('parseFrontmatter rejects bad input', () => {
  assert.throws(() => parseFrontmatter('no frontmatter'));
  assert.throws(() => parseFrontmatter('---\nname: a\ndescription: bad: colon\n---\n'));
  assert.deepEqual(parseFrontmatter('---\nname: a\nmetadata:\n  v: "1"\n---\nx').data, { name: 'a', metadata: { v: '1' } });
});
