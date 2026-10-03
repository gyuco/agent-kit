import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface FetchedSource {
  dir: string;
  commit: string;
  cleanup: () => void;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function isLocalSource(source: string): boolean {
  return /^(\.{1,2}\/|\/|file:)/.test(source);
}

export function toGitUrl(source: string): string {
  const gh = /^github:([\w.-]+\/[\w.-]+)$/.exec(source);
  if (gh) return `https://github.com/${gh[1]}.git`;
  const gl = /^gitlab:([\w.-]+\/[\w./-]+)$/.exec(source);
  if (gl) return `https://gitlab.com/${gl[1]}.git`;
  return source;
}

/**
 * Fetch a single commit (shallow). Works for branches, tags and full SHAs.
 * Auth is whatever git already has (SSH keys, credential helper).
 */
export function fetchSource(source: string, ref: string | undefined, cwd: string): FetchedSource {
  if (isLocalSource(source)) {
    const dir = resolve(cwd, source.replace(/^file:/, ''));
    let commit = 'local';
    try {
      commit = git(['rev-parse', 'HEAD'], dir);
    } catch {
      // not a git repo: fine for local development
    }
    return { dir, commit, cleanup: () => {} };
  }

  const dir = mkdtempSync(join(tmpdir(), 'agent-kit-'));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    git(['init', '-q'], dir);
    git(['fetch', '-q', '--depth', '1', toGitUrl(source), ref ?? 'HEAD'], dir);
    git(['checkout', '-q', 'FETCH_HEAD'], dir);
    return { dir, commit: git(['rev-parse', 'HEAD'], dir), cleanup };
  } catch (err) {
    cleanup();
    const msg = (err as { stderr?: string }).stderr?.trim() || String(err);
    throw new Error(`Failed to fetch ${source}@${ref ?? 'HEAD'}: ${msg}`);
  }
}
