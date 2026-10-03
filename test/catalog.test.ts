import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import YAML from 'yaml';
import { loadBuiltinTargets, loadCatalog } from '../src/catalog.js';
import { detect } from '../src/detect.js';
import { applyMcp, renderJsonServer, renderTomlServer } from '../src/mcp.js';
import { detectTargets, propose, proposalToSelection } from '../src/suggest.js';
import { sync } from '../src/sync.js';
import { normalizeAgent, renderAgent } from '../src/transform.js';
import type { McpServer } from '../src/types.js';

let root: string;
const put = (rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-kit-cat-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// ───────────── catalog data

test('catalog and targets load and are internally consistent', () => {
  const c = loadCatalog();
  const targets = loadBuiltinTargets();
  for (const i of c.items) {
    for (const t of i.compat?.only ?? []) assert.ok(targets[t], `${i.id}: unknown target ${t}`);
    assert.ok(i.install.length, `${i.id}: no install steps`);
  }
});

// ───────────── detection + suggestions

function reactProject() {
  put('package.json', JSON.stringify({ dependencies: { react: '19', next: '15' }, devDependencies: { typescript: '5' } }));
  put('.git/config', '[remote "origin"]\n\turl = git@github.com:acme/web.git\n');
  put('playwright.config.ts', '');
  put('.claude/settings.json', '{}');
  for (let i = 0; i < 12; i++) put(`src/c${i}.tsx`, '');
  put('scripts/one.py', '');
}

test('detect reads deps, languages, git host and globs', () => {
  reactProject();
  const s = detect(root, []);
  assert.ok(s.deps.has('next'));
  assert.equal(s.gitHost, 'github.com');
  assert.equal(s.sourceFiles, 14, '12 tsx + playwright.config.ts + one.py');
  assert.ok(s.languages.has('typescript'));
  assert.ok(s.languages.has('python'), '1/14 is above the 5% share');
  assert.ok(s.exists('playwright.config.*'));
  assert.ok(!s.exists('vitest.config.*'));
});

test('proposal is deterministic and rule-driven', () => {
  reactProject();
  const catalog = loadCatalog();
  const s = detect(root, []);
  // pretend npx exists so `requires` doesn't block preselection
  s.bins.add('npx');
  const targets = detectTargets(loadBuiltinTargets(), s);
  assert.deepEqual(targets, ['claude-code']);

  const a = proposalToSelection(propose(catalog, s, targets));
  const b = proposalToSelection(propose(catalog, s, targets));
  assert.deepEqual(a, b);

  const ids = a.map((x) => x.id);
  for (const id of ['gyukit-flow', 'vercel-agent-skills', 'playwright', 'github', 'context7', 'memory-files', 'lean-config']) {
    assert.ok(ids.includes(id), `expected ${id} in ${ids}`);
  }
  assert.ok(!ids.includes('supabase-skills'));
  assert.ok(!ids.includes('serena'), 'small repo: no indexer');
  const flow = a.find((x) => x.id === 'gyukit-flow')!;
  assert.deepEqual(flow.options, ['analyst', 'architect', 'planner', 'coder', 'reviewer']);
});

test('exclusive groups keep at most one preselected item', () => {
  const catalog = loadCatalog();
  const s = detect(root, []);
  s.bins.add('uv');
  s.sourceFiles = 900; // force indexing rule
  const proposal = propose(catalog, s, ['codex']);
  for (const cat of catalog.categories.filter((c) => c.group)) {
    assert.ok(proposal.get(cat.id)!.filter((p) => p.preselected).length <= 1, cat.id);
  }
  assert.ok(proposal.get('indexing')!.find((p) => p.item.id === 'serena')!.preselected);
});

test('items limited to some CLIs are not preselected for others', () => {
  const catalog = loadCatalog();
  const s = detect(root, []);
  const mem = propose(catalog, s, ['codex']).get('memory')!;
  assert.equal(mem.find((p) => p.item.id === 'claude-mem')!.compatible, false);
});

test('missing required binary blocks preselection', () => {
  put('package.json', '{}');
  const s = detect(root, []);
  s.bins.clear();
  const c7 = propose(loadCatalog(), s, ['claude-code']).get('mcp')!.find((p) => p.item.id === 'context7')!;
  assert.ok(c7.score >= 50);
  assert.deepEqual(c7.missing, ['npx']);
  assert.equal(c7.preselected, false);
});

// ───────────── agents normalization

test('claude-format agents are normalized and re-rendered per target', () => {
  const meta = normalizeAgent({ name: 'x', description: 'd', tools: 'Read, Write, Edit, Bash, Glob, Grep', model: 'sonnet' }, 'claude');
  assert.deepEqual(meta, { name: 'x', description: 'd', capabilities: ['read', 'edit', 'shell', 'search'], model: 'balanced' });
  const targets = loadBuiltinTargets();
  const oc = renderAgent({ name: 'x', meta, body: 'b' }, targets.opencode.agents!);
  assert.match(oc, /mode: subagent/);
  assert.match(oc, /bash: true/);
  const cc = renderAgent({ name: 'x', meta, body: 'b' }, targets['claude-code'].agents!);
  assert.match(cc, /tools: Read, Edit, Write, Bash, Glob, Grep/);
  assert.match(cc, /model: sonnet/);
});

// ───────────── MCP rendering

const stdio: McpServer = { id: 'fs', command: 'npx', args: ['-y', 'x'], secrets: [{ env: 'KEY' }] };
const http: McpServer = { id: 'gh', url: 'https://h/mcp', secrets: [{ env: 'PAT', header: 'Authorization', prefix: 'Bearer ' }] };

test('MCP servers render in each format with env references, never values', () => {
  assert.deepEqual(renderJsonServer(stdio, 'claude'), { command: 'npx', args: ['-y', 'x'], env: { KEY: '${KEY}' } });
  assert.deepEqual(renderJsonServer(stdio, 'vscode'), { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { KEY: '${env:KEY}' } });
  assert.deepEqual(renderJsonServer(stdio, 'opencode'), { type: 'local', command: ['npx', '-y', 'x'], environment: { KEY: '{env:KEY}' }, enabled: true });
  assert.deepEqual(renderJsonServer(http, 'claude'), { type: 'http', url: 'https://h/mcp', headers: { Authorization: 'Bearer ${PAT}' } });
  assert.deepEqual(renderJsonServer(http, 'cursor'), { url: 'https://h/mcp', headers: { Authorization: 'Bearer ${env:PAT}' } });
  assert.equal(renderTomlServer(stdio), '[mcp_servers.fs]\ncommand = "npx"\nargs = ["-y", "x"]\nenv_vars = ["KEY"]');
  assert.equal(renderTomlServer(http), '[mcp_servers.gh]\nurl = "https://h/mcp"\nbearer_token_env_var = "PAT"');
});

test('JSON MCP config keeps user servers, detects edits, prunes owned ones', () => {
  put('.mcp.json', JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: 1 }));
  const plan = new Map([['.mcp.json', { format: 'claude' as const, servers: [stdio] }]]);

  const first = applyMcp(root, plan, {}, {});
  assert.deepEqual(first.actions.map((a) => a.kind), ['write']);
  const doc = JSON.parse(read('.mcp.json'));
  assert.deepEqual(Object.keys(doc.mcpServers), ['mine', 'fs']);
  assert.equal(doc.other, 1);

  // user edits our entry → conflict, untouched
  doc.mcpServers.fs.args = ['changed'];
  put('.mcp.json', JSON.stringify(doc));
  const second = applyMcp(root, plan, first.lock, {});
  assert.equal(second.actions[0].kind, 'conflict');
  assert.deepEqual(JSON.parse(read('.mcp.json')).mcpServers.fs.args, ['changed']);

  // forced removal when no longer selected
  const third = applyMcp(root, new Map(), first.lock, { force: true });
  assert.equal(third.actions[0].kind, 'remove');
  assert.deepEqual(Object.keys(JSON.parse(read('.mcp.json')).mcpServers), ['mine']);
});

test('Codex TOML uses a managed block and refuses duplicate tables', () => {
  put('.codex/config.toml', 'model = "x"\n\n[mcp_servers.gh]\nurl = "mine"\n');
  const plan = new Map([['.codex/config.toml', { format: 'codex-toml' as const, servers: [stdio, http] }]]);
  const r = applyMcp(root, plan, {}, {});
  assert.deepEqual(r.actions.map((a) => a.kind).sort(), ['conflict', 'write']);
  const text = read('.codex/config.toml');
  assert.match(text, /^model = "x"/);
  assert.match(text, /# agent-kit:start[^\n]*\n\[mcp_servers\.fs\]/);
  assert.equal(text.match(/\[mcp_servers\.gh\]/g)!.length, 1);

  const again = applyMcp(root, plan, r.lock, {});
  assert.ok(again.actions.some((a) => a.kind === 'unchanged'));
});

// ───────────── end to end with catalog (offline: only mcp + instructions items)

test('sync installs catalog MCP + instructions into each selected CLI', () => {
  put(
    '.agentkit.yaml',
    YAML.stringify({ targets: ['claude-code', 'codex', 'opencode', 'pi'], catalog: [{ id: 'context7' }, { id: 'github' }, { id: 'lean-config' }] }),
  );
  const r = sync(root);
  assert.deepEqual(r.secrets, ['GITHUB_PAT']);

  assert.deepEqual(Object.keys(JSON.parse(read('.mcp.json')).mcpServers), ['context7', 'github']);
  assert.deepEqual(Object.keys(JSON.parse(read('opencode.json')).mcp), ['context7', 'github']);
  assert.match(read('.codex/config.toml'), /\[mcp_servers\.context7\][\s\S]*bearer_token_env_var = "GITHUB_PAT"/);
  assert.match(read('CLAUDE.md'), /Context hygiene/);
  assert.match(read('AGENTS.md'), /Context hygiene/);

  // deselect github → removed everywhere
  put('.agentkit.yaml', YAML.stringify({ targets: ['claude-code', 'codex', 'opencode', 'pi'], catalog: [{ id: 'context7' }] }));
  sync(root);
  assert.deepEqual(Object.keys(JSON.parse(read('.mcp.json')).mcpServers), ['context7']);
  assert.doesNotMatch(read('.codex/config.toml'), /github/);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false, 'file held only our block');
});

test('compat.only items are skipped for other CLIs and commands surfaced, not run', () => {
  put('.agentkit.yaml', YAML.stringify({ targets: ['codex'], catalog: [{ id: 'caveman' }, { id: 'agentmemory' }] }));
  const r = sync(root);
  assert.deepEqual(r.commands.map((c) => c.item.id), ['agentmemory']);
});
