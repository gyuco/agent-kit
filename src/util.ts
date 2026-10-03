import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import YAML from 'yaml';

export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Minimal glob: only `*` is special. */
export function matchesAny(name: string, patterns: string[] | undefined): boolean {
  if (!patterns) return true;
  return patterns.some((p) => {
    const re = new RegExp('^' + p.split('*').map(escapeRe).join('.*') + '$');
    return re.test(name);
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a project-relative path, refusing anything that escapes the root.
 * Target paths come from a remote repo, so they are untrusted.
 */
export function safeJoin(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const base = resolve(root);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`Path escapes project root: ${rel}`);
  }
  return abs;
}

export function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = YAML.parse(m[1]) ?? {};
  if (typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Frontmatter must be a mapping');
  return { meta, body: m[2] };
}

export function renderFrontmatter(meta: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(meta, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${body.startsWith('\n') ? body : '\n' + body}`;
}
