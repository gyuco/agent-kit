import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';

/** Everything the suggestion rules may look at. Read-only, no network. */
export interface Signals {
  root: string;
  bins: Set<string>;
  deps: Set<string>;
  languages: Set<string>;
  /** Source files per language. */
  languageCounts: Record<string, number>;
  sourceFiles: number;
  gitHost?: string;
  /** Glob (`*` per path segment) existence check, relative to root. */
  exists: (pattern: string) => boolean;
}

const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.vue': 'vue', '.svelte': 'svelte', '.dart': 'dart',
  '.ex': 'elixir', '.exs': 'elixir', '.scala': 'scala',
};
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__',
  'venv', 'env', 'bower_components', 'Pods',
]);
const MAX_FILES = 50_000;
/** A language counts if it is at least this share of source files (avoids stray scripts). */
const LANGUAGE_SHARE = 0.05;

function globRe(segment: string): RegExp {
  return new RegExp('^' + segment.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

export function existsGlob(root: string, pattern: string): boolean {
  const segments = pattern.replace(/\/$/, '').split('/');
  const walk = (dir: string, i: number): boolean => {
    const seg = segments[i];
    const last = i === segments.length - 1;
    if (!seg.includes('*')) {
      const p = join(dir, seg);
      return last ? existsSync(p) : existsSync(p) && walk(p, i + 1);
    }
    if (!existsSync(dir)) return false;
    const re = globRe(seg);
    return readdirSync(dir).some((e) => re.test(e) && (last || walk(join(dir, e), i + 1)));
  };
  return walk(root, 0);
}

function countSources(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let seen = 0;
  const stack = [root];
  while (stack.length && seen < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries.sort()) {
      if (e.startsWith('.') || SKIP_DIRS.has(e)) continue;
      const p = join(dir, e);
      const st = lstatSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (st.isFile()) {
        seen++;
        const lang = EXT_LANG[extname(e).toLowerCase()];
        if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function readDeps(root: string): Set<string> {
  const deps = new Set<string>();
  const read = (f: string) => {
    try {
      return readFileSync(join(root, f), 'utf8');
    } catch {
      return null;
    }
  };

  const pkg = read('package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(j[k] ?? {})) deps.add(name);
      }
    } catch {
      // malformed package.json: ignore, detection is best-effort
    }
  }

  // Python: names only, versions don't matter for suggestions.
  const req = read('requirements.txt');
  for (const line of req?.split('\n') ?? []) {
    const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line);
    if (m && !line.trim().startsWith('#') && !line.trim().startsWith('-')) deps.add(m[1].toLowerCase());
  }
  const py = read('pyproject.toml');
  for (const m of py?.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:[<>=~!;]|["'])/g) ?? []) {
    deps.add(m[1].toLowerCase());
  }
  return deps;
}

function gitHost(root: string): string | undefined {
  try {
    const cfg = readFileSync(join(root, '.git', 'config'), 'utf8');
    const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(cfg)?.[1];
    if (!url) return undefined;
    return (/^[\w.-]+@([^:]+):/.exec(url) ?? /^\w+:\/\/(?:[^@/]+@)?([^/:]+)/.exec(url))?.[1];
  } catch {
    return undefined;
  }
}

export function findBins(names: Iterable<string>, pathEnv = process.env.PATH ?? ''): Set<string> {
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const found = new Set<string>();
  for (const name of names) {
    const hit = dirs.some((d) =>
      exts.some((x) => {
        try {
          accessSync(join(d, name + x), constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    );
    if (hit) found.add(name);
  }
  return found;
}

export function detect(root: string, binNames: Iterable<string>): Signals {
  const languageCounts = countSources(root);
  const sourceFiles = Object.values(languageCounts).reduce((a, b) => a + b, 0);
  const languages = new Set(
    Object.entries(languageCounts)
      .filter(([, n]) => n / sourceFiles >= LANGUAGE_SHARE)
      .map(([l]) => l),
  );
  return {
    root,
    bins: findBins(binNames),
    deps: readDeps(root),
    languages,
    languageCounts,
    sourceFiles,
    gitHost: gitHost(root),
    exists: (p) => existsGlob(root, p),
  };
}
