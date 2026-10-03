import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Lock, Plan } from './types.js';
import { applyMcp } from './mcp.js';
import { safeJoin, sha256 } from './util.js';

export const START = '<!-- agent-kit:start -->';
export const END = '<!-- agent-kit:end -->';
const BLOCK_RE = /<!-- agent-kit:start -->\n?([\s\S]*?)\n?<!-- agent-kit:end -->/;

export type ActionKind = 'write' | 'unchanged' | 'conflict' | 'remove' | 'keep';
export interface Action {
  kind: ActionKind;
  path: string;
  note?: string;
}

export interface ApplyOptions {
  dryRun?: boolean;
  force?: boolean;
}

export function readBlock(text: string): string | null {
  const m = BLOCK_RE.exec(text);
  return m ? m[1] : null;
}

/** Insert, replace (inner = string) or remove (inner = null) the managed block, leaving the rest untouched. */
export function upsertBlock(text: string, inner: string | null): string {
  if (inner === null) return text.replace(BLOCK_RE, '').replace(/\n{3,}/g, '\n\n');
  const block = `${START}\n${inner}\n${END}`;
  if (BLOCK_RE.test(text)) return text.replace(BLOCK_RE, () => block);
  return text.trim() ? `${text.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

function removeEmptyParents(root: string, file: string): void {
  const base = resolve(root);
  let dir = dirname(file);
  while (dir.startsWith(base) && dir !== base && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

/**
 * Write the plan to disk. Never clobbers files the user changed since the last sync
 * (detected via the lockfile hashes) unless `force` is set.
 */
export function applyPlan(
  root: string,
  plan: Plan,
  prev: Lock | null,
  opts: ApplyOptions = {},
): { actions: Action[]; files: Lock['files']; blocks: Lock['blocks']; mcp: Lock['mcp'] } {
  const actions: Action[] = [];
  const files: Lock['files'] = {};
  const blocks: Lock['blocks'] = {};
  const write = (abs: string, data: string | Buffer) => {
    if (opts.dryRun) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  };

  // Starter docs: written once if missing, then they belong to the user (not in the lockfile).
  for (const [rel, content] of plan.scaffold) {
    if (plan.files.has(rel)) throw new Error(`Template ${rel} collides with a managed file`);
    const abs = safeJoin(root, rel);
    if (existsSync(abs)) {
      actions.push({ kind: 'unchanged', path: rel, note: 'template, already present' });
      continue;
    }
    write(abs, content);
    actions.push({ kind: 'write', path: rel, note: 'template, yours from now on' });
  }

  for (const [rel, content] of plan.files) {
    const abs = safeJoin(root, rel);
    const hash = sha256(content);
    if (existsSync(abs)) {
      const curHash = sha256(readFileSync(abs));
      if (curHash === hash) {
        actions.push({ kind: 'unchanged', path: rel });
        files[rel] = hash;
        continue;
      }
      if (prev?.files[rel] !== curHash && !opts.force) {
        actions.push({ kind: 'conflict', path: rel, note: 'modified locally, use --force to overwrite' });
        if (prev?.files[rel]) files[rel] = prev.files[rel];
        continue;
      }
    }
    write(abs, content);
    files[rel] = hash;
    actions.push({ kind: 'write', path: rel });
  }

  for (const [rel, inner] of plan.blocks) {
    const abs = safeJoin(root, rel);
    const hash = sha256(inner);
    const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const cur = readBlock(text);
    if (cur === inner) {
      actions.push({ kind: 'unchanged', path: `${rel} (block)` });
      blocks[rel] = hash;
      continue;
    }
    if (cur !== null && prev?.blocks[rel] !== sha256(cur) && !opts.force) {
      actions.push({ kind: 'conflict', path: `${rel} (block)`, note: 'managed block edited locally' });
      if (prev?.blocks[rel]) blocks[rel] = prev.blocks[rel];
      continue;
    }
    write(abs, upsertBlock(text, inner));
    blocks[rel] = hash;
    actions.push({ kind: 'write', path: `${rel} (block)` });
  }

  // Prune what a previous sync installed but the current plan no longer contains.
  for (const [rel, oldHash] of Object.entries(prev?.files ?? {})) {
    if (plan.files.has(rel)) continue;
    const abs = safeJoin(root, rel);
    if (!existsSync(abs)) continue;
    if (sha256(readFileSync(abs)) !== oldHash && !opts.force) {
      actions.push({ kind: 'keep', path: rel, note: 'no longer managed, but modified locally' });
      continue;
    }
    if (!opts.dryRun) {
      unlinkSync(abs);
      removeEmptyParents(root, abs);
    }
    actions.push({ kind: 'remove', path: rel });
  }

  for (const [rel, oldHash] of Object.entries(prev?.blocks ?? {})) {
    if (plan.blocks.has(rel)) continue;
    const abs = safeJoin(root, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const cur = readBlock(text);
    if (cur === null) continue;
    if (sha256(cur) !== oldHash && !opts.force) {
      actions.push({ kind: 'keep', path: `${rel} (block)`, note: 'edited locally' });
      continue;
    }
    if (!opts.dryRun) {
      const rest = upsertBlock(text, null);
      if (rest.trim()) writeFileSync(abs, rest);
      else unlinkSync(abs);
    }
    actions.push({ kind: 'remove', path: `${rel} (block)` });
  }

  const mcp = applyMcp(root, plan.mcp, prev?.mcp ?? {}, opts);
  actions.push(...mcp.actions);

  return { actions, files, blocks, mcp: mcp.lock };
}
