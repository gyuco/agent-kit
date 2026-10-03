import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { readBlock, upsertBlock } from '../src/apply.js';
import { sync } from '../src/sync.js';
import { renderAgent } from '../src/transform.js';
import { parseFrontmatter } from '../src/util.js';

const TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../template');

// Fictional targets: the tests exercise the mechanics, not any real tool's layout.
const TARGETS = {
  native: {
    skills: '.native/skills',
    instructions: 'NATIVE.md',
    agents: {
      dir: '.native/agents',
      fields: {
        model: { key: 'model', map: { smart: 'big-model' } },
        capabilities: { key: 'tools', format: 'csv', map: { read: 'Read', search: 'Grep' } },
      },
    },
  },
  shared: { skills: '.shared/skills', instructions: 'AGENTS.md' },
  shared2: { skills: '.shared/skills', instructions: 'AGENTS.md' },
  plain: { instructions: 'PLAIN.md', agentsFallback: 'instructions' },
};

let root: string;
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const writeConfig = (extra: object = {}) =>
  writeFileSync(
    join(root, '.agentkit.yaml'),
    YAML.stringify({ source: TEMPLATE, targets: Object.keys(TARGETS), targetDefinitions: TARGETS, ...extra }),
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-kit-test-'));
  writeConfig();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('installs skills, translated agents and instruction blocks', () => {
  sync(root);

  const agent = parseFrontmatter(read('.native/agents/example-agent.md'));
  assert.deepEqual(agent.meta, {
    name: 'example-agent',
    description: 'Example agent. Describe when it should be delegated to.',
    model: 'big-model',
    tools: 'Read, Grep',
  });

  assert.ok(existsSync(join(root, '.native/skills/example-skill/SKILL.md')));
  // agent becomes a skill where subagents aren't supported
  assert.match(read('.shared/skills/example-agent/SKILL.md'), /name: example-agent/);
  // agent becomes an instructions section when there's no skills dir
  assert.match(read('PLAIN.md'), /## Agent: example-agent/);
  assert.match(readBlock(read('AGENTS.md'))!, /Project conventions/);
  assert.ok(existsSync(join(root, '.agentkit.lock.json')));
});

test('dry-run writes nothing', () => {
  const { actions } = sync(root, { dryRun: true });
  assert.ok(actions.some((a) => a.kind === 'write'));
  assert.ok(!existsSync(join(root, '.native')));
  assert.ok(!existsSync(join(root, '.agentkit.lock.json')));
});

test('second sync is a no-op', () => {
  sync(root);
  const { actions } = sync(root);
  assert.ok(actions.every((a) => a.kind === 'unchanged'), JSON.stringify(actions));
});

test('local edits are preserved unless --force', () => {
  sync(root);
  const p = '.native/skills/example-skill/SKILL.md';
  writeFileSync(join(root, p), 'my edit');

  const { actions } = sync(root);
  assert.ok(actions.some((a) => a.kind === 'conflict' && a.path === p));
  assert.equal(read(p), 'my edit');

  sync(root, { force: true });
  assert.notEqual(read(p), 'my edit');
});

test('pre-existing untracked files are not overwritten', () => {
  const p = 'AGENTS.md';
  writeFileSync(join(root, p), '# My notes\n');
  sync(root);
  assert.ok(read(p).startsWith('# My notes\n'), 'user content kept above the block');
  assert.ok(readBlock(read(p)));
});

test('removed content is pruned, including the managed block', () => {
  sync(root);
  writeFileSync(join(root, 'AGENTS.md'), read('AGENTS.md') + '\nuser footer\n');
  writeConfig({ targets: ['native'] });
  sync(root);

  assert.ok(!existsSync(join(root, '.shared')));
  assert.ok(!existsSync(join(root, 'PLAIN.md')), 'file holding only the block is deleted');
  assert.equal(readBlock(read('AGENTS.md')), null);
  assert.match(read('AGENTS.md'), /user footer/);
});

test('rejects target paths escaping the project root', () => {
  writeConfig({ targets: ['evil'], targetDefinitions: { evil: { skills: '../../outside' } } });
  assert.throws(() => sync(root), /escapes project root/);
});

test('unknown target lists known ones', () => {
  assert.throws(() => sync(root, { targets: ['nope'] }), /Unknown target\(s\): nope. Known: .*native/);
});

test('skips symlinks inside source skills', () => {
  const src = mkdtempSync(join(tmpdir(), 'agent-kit-src-'));
  try {
    const skill = join(src, 'skills', 's1');
    writeConfig({ source: src, targets: ['shared'] });
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: s1\ndescription: d\n---\nbody');
    symlinkSync('/etc/hosts', join(skill, 'leak'));
    sync(root);
    assert.ok(existsSync(join(root, '.shared/skills/s1/SKILL.md')));
    assert.ok(!existsSync(join(root, '.shared/skills/s1/leak')));
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
});

test('field mapping formats', () => {
  const agent = { name: 'a', meta: { name: 'a', capabilities: ['read', 'shell', 'unknown'] }, body: 'x' };
  const out = parseFrontmatter(
    renderAgent(agent, {
      dir: 'x',
      fields: { capabilities: { key: 'tools', format: 'object', map: { read: 'read', shell: 'bash' } } },
      extra: { mode: 'subagent' },
    }),
  );
  assert.deepEqual(out.meta, { name: 'a', tools: { read: true, bash: true }, mode: 'subagent' });
});

test('upsertBlock replaces in place', () => {
  const t = upsertBlock('a\n', 'one');
  assert.equal(upsertBlock(t, 'two'), 'a\n\n<!-- agent-kit:start -->\ntwo\n<!-- agent-kit:end -->\n');
});
