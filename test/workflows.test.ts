import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import YAML from 'yaml';
import { CATALOG_DIR, loadCatalog } from '../src/catalog.js';
import { loadContent, walkFiles } from '../src/content.js';
import { sync } from '../src/sync.js';
import { parseFrontmatter } from '../src/util.js';

let root: string;
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const configure = (catalog: object[], targets = ['claude-code', 'codex']) =>
  writeFileSync(join(root, '.agentkit.yaml'), YAML.stringify({ targets, catalog }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-kit-wf-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const methodologies = loadCatalog().items.filter((i) => i.category === 'methodology');

test('methodologies are all built-in: no external installers or remote repos', () => {
  for (const m of methodologies) {
    for (const st of m.install) {
      assert.notEqual(st.kind, 'command', `${m.id} runs an external command`);
      if (st.kind === 'copy') assert.match(st.repo, /^builtin:/, `${m.id} fetches ${st.repo}`);
    }
  }
});

test('every built-in workflow file is well-formed', () => {
  const base = join(CATALOG_DIR, 'workflows');
  for (const wf of readdirSync(base)) {
    const c = loadContent(join(base, wf), {}, { skillsDir: 'skills', agentsDir: 'agents', instructionsDir: 'instructions' });
    assert.ok(c.skills.length + c.agents.length > 0, `${wf} is empty`);
    assert.ok(c.instructions.length > 0, `${wf} has no instructions`);
    for (const a of c.agents) {
      assert.ok(a.meta.description, `${wf}/${a.name}: description`);
      assert.ok(Array.isArray(a.meta.capabilities), `${wf}/${a.name}: capabilities`);
    }
    for (const s of c.skills) {
      const { meta } = parseFrontmatter(readFileSync(join(s.dir, 'SKILL.md'), 'utf8'));
      assert.equal(meta.name, s.name, `${wf}: skill dir and name differ`);
      assert.ok(meta.description, `${wf}/${s.name}: description`);
    }
    if (existsSync(join(base, wf, 'docs'))) {
      for (const f of walkFiles(join(base, wf, 'docs'))) {
        const text = readFileSync(join(base, wf, 'docs', f), 'utf8');
        if (text.startsWith('---')) parseFrontmatter(text); // throws on broken YAML
      }
    }
  }
});

test('each methodology installs offline for every CLI', () => {
  for (const m of methodologies) {
    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), 'agent-kit-wf-'));
    configure([{ id: m.id }], ['claude-code', 'codex', 'opencode', 'pi']);
    const r = sync(root);
    assert.ok(r.actions.some((a) => a.kind === 'write'), m.id);
    assert.equal(r.commands.length, 0, `${m.id} needs no external command`);
  }
});

test('gyukit workflow: agents per CLI, skills, instructions and starter docs', () => {
  configure([{ id: 'gyukit-flow' }], ['claude-code', 'codex', 'opencode']);
  sync(root);

  for (const a of ['analyst', 'architect', 'planner', 'coder', 'reviewer']) {
    assert.ok(existsSync(join(root, `.claude/agents/${a}.md`)), `claude ${a}`);
    assert.ok(existsSync(join(root, `.opencode/agent/${a}.md`)), `opencode ${a}`);
    assert.ok(existsSync(join(root, `.agents/skills/${a}/SKILL.md`)), `codex ${a} as skill`);
  }
  assert.match(read('.claude/agents/coder.md'), /tools: Read, Glob, Grep, Edit, Write, Bash|tools: Read, Edit, Write, Glob, Grep, Bash/);
  assert.match(read('.claude/agents/analyst.md'), /model: opus/);
  assert.ok(existsSync(join(root, '.claude/skills/autopilot/SKILL.md')));
  assert.ok(existsSync(join(root, '.agents/skills/quick-change/SKILL.md')));
  assert.match(read('AGENTS.md'), /Development workflow \(gyukit\)/);
  assert.match(read('CLAUDE.md'), /autopilot/);
  for (const d of ['docs/PRD.md', 'docs/architecture.md', 'docs/workflow.md', 'docs/stories/_template.md', 'docs/epics/_template.md', 'docs/adr/0000-template.md']) {
    assert.ok(existsSync(join(root, d)), d);
  }
});

test('starter docs are never overwritten, tracked or pruned', () => {
  configure([{ id: 'gyukit-flow' }]);
  sync(root);
  writeFileSync(join(root, 'docs/PRD.md'), 'my PRD');

  const again = sync(root, { force: true });
  assert.equal(read('docs/PRD.md'), 'my PRD', 'even --force keeps user docs');
  assert.ok(again.actions.some((a) => a.path === 'docs/PRD.md' && a.kind === 'unchanged'));
  const lock = JSON.parse(read('.agentkit.lock.json'));
  assert.ok(!Object.keys(lock.files).some((f) => f.startsWith('docs/')), 'docs are not in the lockfile');

  // switching methodology removes gyukit agents but keeps the docs
  configure([{ id: 'superpowers-lite' }]);
  sync(root);
  assert.ok(!existsSync(join(root, '.claude/agents/coder.md')));
  assert.ok(existsSync(join(root, '.claude/skills/sp-test-driven-development/SKILL.md')));
  assert.equal(read('docs/PRD.md'), 'my PRD');
  assert.doesNotMatch(read('AGENTS.md'), /gyukit/);
});

test('builtin sources work with --frozen', () => {
  configure([{ id: 'gyukit-flow' }]);
  sync(root);
  const r = sync(root, { frozen: true });
  assert.ok(r.actions.every((a) => a.kind === 'unchanged'));
});
