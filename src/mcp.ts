import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Action, ApplyOptions } from './apply.js';
import type { Lock, McpFormat, McpServer, Plan } from './types.js';
import { safeJoin, sha256 } from './util.js';

/**
 * Each CLI stores MCP servers differently. Secrets are never written: only references
 * to environment variables, in the syntax each tool expands.
 */
const JSON_ROOT: Record<Exclude<McpFormat, 'codex-toml'>, string> = {
  claude: 'mcpServers',
  cursor: 'mcpServers',
  vscode: 'servers',
  opencode: 'mcp',
};

const ENV_REF: Record<Exclude<McpFormat, 'codex-toml'>, (v: string) => string> = {
  claude: (v) => `\${${v}}`,
  cursor: (v) => `\${env:${v}}`,
  vscode: (v) => `\${env:${v}}`,
  opencode: (v) => `{env:${v}}`,
};

export function renderJsonServer(s: McpServer, format: Exclude<McpFormat, 'codex-toml'>): Record<string, unknown> {
  const ref = ENV_REF[format];
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const sec of s.secrets ?? []) {
    if (sec.header) headers[sec.header] = (sec.prefix ?? '') + ref(sec.env);
    else env[sec.env] = ref(sec.env);
  }
  const opt = (o: Record<string, string>) => (Object.keys(o).length ? o : undefined);

  if (s.url) {
    switch (format) {
      case 'opencode':
        return clean({ type: 'remote', url: s.url, headers: opt(headers), enabled: true });
      case 'cursor':
        return clean({ url: s.url, headers: opt(headers) });
      default:
        return clean({ type: 'http', url: s.url, headers: opt(headers) });
    }
  }
  switch (format) {
    case 'opencode':
      return clean({ type: 'local', command: [s.command, ...(s.args ?? [])], environment: opt(env), enabled: true });
    case 'vscode':
      return clean({ type: 'stdio', command: s.command, args: s.args ?? [], env: opt(env) });
    default:
      return clean({ command: s.command, args: s.args ?? [], env: opt(env) });
  }
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

const tomlStr = (v: string) => JSON.stringify(v);
const tomlArr = (a: string[]) => `[${a.map(tomlStr).join(', ')}]`;
const tomlKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k));

export function renderTomlServer(s: McpServer): string {
  const lines = [`[mcp_servers.${tomlKey(s.id)}]`];
  const envSecrets = (s.secrets ?? []).filter((x) => !x.header);
  const headerSecrets = (s.secrets ?? []).filter((x) => x.header);
  if (s.url) {
    lines.push(`url = ${tomlStr(s.url)}`);
    const bearer = headerSecrets.find((h) => h.header?.toLowerCase() === 'authorization' && h.prefix?.trim() === 'Bearer');
    if (bearer) lines.push(`bearer_token_env_var = ${tomlStr(bearer.env)}`);
    const others = headerSecrets.filter((h) => h !== bearer);
    if (others.length) {
      lines.push(`env_http_headers = { ${others.map((h) => `${tomlStr(h.header!)} = ${tomlStr(h.env)}`).join(', ')} }`);
    }
  } else {
    lines.push(`command = ${tomlStr(s.command!)}`, `args = ${tomlArr(s.args ?? [])}`);
    if (envSecrets.length) lines.push(`env_vars = ${tomlArr(envSecrets.map((x) => x.env))}`);
  }
  return lines.join('\n');
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TOML_START = '# agent-kit:start (managed, edits will be detected)';
const TOML_END = '# agent-kit:end';
const TOML_BLOCK_RE = /# agent-kit:start[^\n]*\n([\s\S]*?)\n?# agent-kit:end\n?/;
const BLOCK_KEY = '#block';

/** Write owned MCP servers into each config file, preserving everything else in it. */
export function applyMcp(
  root: string,
  plan: Plan['mcp'],
  prev: Lock['mcp'],
  opts: ApplyOptions,
): { actions: Action[]; lock: Lock['mcp'] } {
  const actions: Action[] = [];
  const lock: Lock['mcp'] = {};
  const files = new Set([...plan.keys(), ...Object.keys(prev)]);

  for (const rel of [...files].sort()) {
    const abs = safeJoin(root, rel);
    const entry = plan.get(rel);
    const owned = prev[rel] ?? {};
    const format = entry?.format ?? (rel.endsWith('.toml') ? 'codex-toml' : null);
    const servers = entry?.servers ?? [];
    const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const write = (out: string) => {
      if (opts.dryRun) return;
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, out);
    };

    if (format === 'codex-toml') {
      const r = applyToml(rel, text, servers, owned, opts, write);
      actions.push(...r.actions);
      if (r.hash) lock[rel] = { [BLOCK_KEY]: r.hash };
      continue;
    }

    let doc: Record<string, any>;
    try {
      doc = text.trim() ? JSON.parse(text) : {};
    } catch {
      actions.push({ kind: 'conflict', path: rel, note: 'not plain JSON (comments?), MCP servers not written' });
      if (prev[rel]) lock[rel] = prev[rel];
      continue;
    }
    const rootKey = JSON_ROOT[(format ?? 'claude') as keyof typeof JSON_ROOT] ?? 'mcpServers';
    const section: Record<string, unknown> = doc[rootKey] ?? {};
    const fileLock: Record<string, string> = {};
    let changed = false;

    for (const s of servers) {
      const next = renderJsonServer(s, format as keyof typeof JSON_ROOT);
      const hash = sha256(JSON.stringify(next));
      const cur = section[s.id];
      const label = `${rel} → ${s.id}`;
      if (cur !== undefined && sha256(JSON.stringify(cur)) === hash) {
        actions.push({ kind: 'unchanged', path: label });
        fileLock[s.id] = hash;
        continue;
      }
      if (cur !== undefined && owned[s.id] !== sha256(JSON.stringify(cur)) && !opts.force) {
        actions.push({ kind: 'conflict', path: label, note: 'server already configured differently' });
        if (owned[s.id]) fileLock[s.id] = owned[s.id];
        continue;
      }
      section[s.id] = next;
      fileLock[s.id] = hash;
      changed = true;
      actions.push({ kind: 'write', path: label });
    }

    for (const [id, oldHash] of Object.entries(owned)) {
      if (servers.some((s) => s.id === id) || section[id] === undefined) continue;
      if (sha256(JSON.stringify(section[id])) !== oldHash && !opts.force) {
        actions.push({ kind: 'keep', path: `${rel} → ${id}`, note: 'no longer managed, but edited locally' });
        continue;
      }
      delete section[id];
      changed = true;
      actions.push({ kind: 'remove', path: `${rel} → ${id}` });
    }

    if (changed) {
      if (Object.keys(section).length) doc[rootKey] = section;
      else delete doc[rootKey];
      write(JSON.stringify(doc, null, 2) + '\n');
    }
    if (Object.keys(fileLock).length) lock[rel] = fileLock;
  }

  return { actions, lock };
}

function applyToml(
  rel: string,
  text: string,
  servers: McpServer[],
  owned: Record<string, string>,
  opts: ApplyOptions,
  write: (s: string) => void,
): { actions: Action[]; hash?: string } {
  const m = TOML_BLOCK_RE.exec(text);
  const cur = m ? m[1].trim() : null;
  const outside = m ? text.replace(TOML_BLOCK_RE, '') : text;
  const label = `${rel} (block)`;

  // A server the user defined outside our block would make the TOML invalid (duplicate table).
  const clash = servers.filter((s) => new RegExp(`^\\[mcp_servers\\.${escapeRe(tomlKey(s.id))}\\]`, 'm').test(outside));
  const mine = servers.filter((s) => !clash.includes(s));
  const actions: Action[] = clash.map((s) => ({ kind: 'conflict' as const, path: `${rel} → ${s.id}`, note: 'already defined outside the managed block' }));

  const inner = mine.map(renderTomlServer).join('\n\n');
  const hash = inner ? sha256(inner) : undefined;

  if (cur === inner || (cur === null && !inner)) {
    if (inner) actions.push({ kind: 'unchanged', path: label });
    return { actions, hash };
  }
  if (cur !== null && owned[BLOCK_KEY] !== sha256(cur) && !opts.force) {
    actions.push({ kind: 'conflict', path: label, note: 'managed block edited locally' });
    return { actions, hash: owned[BLOCK_KEY] };
  }
  const base = outside.trimEnd();
  const block = inner ? `${TOML_START}\n${inner}\n${TOML_END}\n` : '';
  const out = base && block ? `${base}\n\n${block}` : base ? `${base}\n` : block;
  write(out);
  actions.push({ kind: inner ? 'write' : 'remove', path: label });
  return { actions, hash };
}
