import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { applyPlan, type Action } from './apply.js';
import { copyInclude, loadBuiltinTargets, loadCatalog, resolveBuiltin, type Catalog, type CatalogItem, type Step } from './catalog.js';
import { LOCK_FILE, loadProjectConfig, ownSources, readSourceTargets, resolveTargets } from './config.js';
import { DEFAULT_LAYOUT, emptyContent, loadContent, mergeContent, walkFiles } from './content.js';
import { buildPlan } from './plan.js';
import { fetchSource } from './source.js';
import type { Include, Layout, Lock, ProjectConfig, TargetSpec } from './types.js';

export interface SyncOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Re-fetch the exact commits recorded in the lockfile instead of resolving refs. */
  frozen?: boolean;
  /** Override the targets listed in the config. */
  targets?: string[];
  /** Use this config instead of reading .agentkit.yaml (e.g. wizard dry-run). */
  config?: ProjectConfig;
}

export interface CommandStep {
  item: CatalogItem;
  step: Extract<Step, { kind: 'command' }>;
}

export interface SyncResult {
  actions: Action[];
  commits: Record<string, string>;
  /** External installers of selected items: never run by sync, surfaced to the caller. */
  commands: CommandStep[];
  /** Environment variables the configured MCP servers expect. */
  secrets: string[];
  warnings: string[];
}

interface SourceReq {
  key: string;
  origin: string;
  source: string;
  ref?: string;
  include: Include;
  layout: Layout;
  only?: string[];
  /** Content shipped inside the package: no fetch, versioned with agent-kit itself. */
  builtin?: { dir: string; commit: string };
}

export function readLock(root: string): Lock | null {
  const path = join(root, LOCK_FILE);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw.version === 2) return raw as Lock;
  // v1: single source, no MCP
  return { version: 2, commits: {}, files: raw.files ?? {}, blocks: raw.blocks ?? {}, mcp: {} };
}

/** Turn the config + catalog selections into fetchable sources and inline content. */
function collect(cfg: ProjectConfig, catalog: Catalog) {
  const sources: SourceReq[] = ownSources(cfg).map((s) => ({
    key: `${s.source}@${s.ref ?? 'HEAD'}`,
    origin: s.source,
    source: s.source,
    ref: s.ref,
    include: s.include ?? {},
    layout: DEFAULT_LAYOUT,
  }));
  const inline = emptyContent();
  const commands: CommandStep[] = [];
  const scaffolds: Array<{ dir: string; to: string }> = [];

  for (const sel of cfg.catalog ?? []) {
    const item = catalog.items.find((i) => i.id === sel.id);
    if (!item) throw new Error(`Unknown catalog item "${sel.id}" in .agentkit.yaml`);
    const only = item.compat?.only;
    for (const step of item.install) {
      switch (step.kind) {
        case 'copy': {
          const { kind: _k, repo, ref, ...layout } = step;
          sources.push({
            key: `${repo}@${ref ?? 'HEAD'}`,
            origin: `catalog:${item.id}`,
            source: repo,
            ref,
            include: copyInclude(item, layout, sel.options),
            layout,
            only,
            builtin: resolveBuiltin(repo) ?? undefined,
          });
          break;
        }
        case 'scaffold': {
          const b = resolveBuiltin(step.from);
          if (!b) throw new Error(`${item.id}: scaffold source must be builtin:, got ${step.from}`);
          scaffolds.push({ dir: b.dir, to: step.to });
          break;
        }
        case 'mcp': {
          const { kind: _k, id, ...server } = step;
          inline.mcp.push({ ...server, id: id ?? item.id, only });
          break;
        }
        case 'instructions':
          inline.instructions.push({ name: item.id, body: step.text.trim(), only });
          break;
        case 'command':
          commands.push({ item, step });
          break;
      }
    }
  }
  return { sources, inline, commands, scaffolds };
}

export function sync(root: string, opts: SyncOptions = {}): SyncResult {
  const cfg = opts.config ?? loadProjectConfig(root);
  const catalog = loadCatalog();
  const prev = readLock(root);
  const { sources, inline, commands, scaffolds } = collect(cfg, catalog);

  const targetIds = opts.targets ?? cfg.targets;
  if (!targetIds.length) throw new Error('No targets selected. Run "npx gyukit" or add "targets" to .agentkit.yaml.');

  const fetched: Array<ReturnType<typeof fetchSource>> = [];
  try {
    const content = emptyContent();
    const origins = new Map<string, string>();
    const commits: Record<string, string> = {};
    let sourceTargets: Record<string, TargetSpec> = {};

    for (const s of sources) {
      let ref = s.ref;
      if (opts.frozen && !s.builtin) {
        const pinned = prev?.commits[s.key];
        if (!pinned) throw new Error(`--frozen: no locked commit for ${s.key}`);
        if (pinned !== 'local') ref = pinned;
      }
      const src = s.builtin ? { ...s.builtin, cleanup: () => {} } : fetchSource(s.source, ref, root);
      fetched.push(src);
      commits[s.key] = src.commit;
      const loaded = loadContent(src.dir, s.include, s.layout);
      if (s.only) for (const x of [...loaded.skills, ...loaded.agents, ...loaded.instructions]) x.only = s.only;
      mergeContent(content, loaded, s.origin, origins);
      if (!s.origin.startsWith('catalog:')) sourceTargets = { ...sourceTargets, ...readSourceTargets(src.dir) };
    }
    mergeContent(content, inline, 'catalog', origins);

    const allTargets = { ...loadBuiltinTargets(), ...sourceTargets, ...(cfg.targetDefinitions ?? {}) };
    const targets = resolveTargets(allTargets, targetIds);
    const plan = buildPlan(content, targets);
    for (const sc of scaffolds) {
      for (const f of walkFiles(sc.dir)) plan.scaffold.set(posix.join(sc.to, f.split('\\').join('/')), readFileSync(join(sc.dir, f)));
    }
    const { actions, files, blocks, mcp } = applyPlan(root, plan, prev, opts);

    if (!opts.dryRun) {
      const lock: Lock = { version: 2, commits, files, blocks, mcp };
      writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
    }

    const usedMcp = new Set([...plan.mcp.values()].flatMap((e) => e.servers));
    const secrets = [...new Set([...usedMcp].flatMap((s) => (s.secrets ?? []).map((x) => x.env)))].sort();
    const ids = targetIds;
    const applicable = commands.filter((c) => !c.item.compat?.only || c.item.compat.only.some((t) => ids.includes(t)));
    return { actions, commits, commands: applicable, secrets, warnings: content.warnings };
  } finally {
    for (const f of fetched) f.cleanup();
  }
}
