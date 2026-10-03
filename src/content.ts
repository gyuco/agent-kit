import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { normalizeAgent } from './transform.js';
import type { Content, Include, Layout } from './types.js';
import { NAME_RE, matchesAny, parseFrontmatter, safeJoin } from './util.js';

export const DEFAULT_LAYOUT: Layout = { skillsDir: 'skills', agentsDir: 'agents', instructionsDir: 'instructions' };

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** Regular files only; symlinks are skipped so a source repo can't point at files outside itself. */
export function walkFiles(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const entry of listDir(dir)) {
    const abs = join(dir, entry);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walkFiles(abs, root));
    else if (st.isFile()) out.push(relative(root, abs));
  }
  return out;
}

function assertName(kind: string, name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`Invalid ${kind} name: "${name}"`);
}

export function emptyContent(): Content {
  return { skills: [], agents: [], instructions: [], mcp: [], warnings: [] };
}

export function loadContent(sourceDir: string, include: Include = {}, layout: Layout = DEFAULT_LAYOUT): Content {
  const content = emptyContent();

  if (layout.skillsDir) {
    const skillsRoot = safeJoin(sourceDir, layout.skillsDir);
    for (const name of listDir(skillsRoot)) {
      const dir = join(skillsRoot, name);
      if (!lstatSync(dir).isDirectory() || !existsSync(join(dir, 'SKILL.md'))) continue;
      if (!matchesAny(name, include.skills)) continue;
      assertName('skill', name);
      content.skills.push({ name, dir, files: walkFiles(dir) });
    }
  }

  if (layout.agentsDir) {
    const agentsRoot = safeJoin(sourceDir, layout.agentsDir);
    const files = layout.agentsRecursive ? walkFiles(agentsRoot) : listDir(agentsRoot);
    for (const file of files) {
      if (!file.endsWith('.md') || /^readme\.md$/i.test(basename(file))) continue;
      // Cheap prefilter on the file name, so unselected files in big collections are never parsed.
      if (layout.agentsRecursive && !matchesAny(basename(file, '.md'), include.agents)) continue;
      let parsed;
      try {
        parsed = parseFrontmatter(readFileSync(join(agentsRoot, file), 'utf8'));
      } catch (err) {
        // Third-party collections occasionally ship broken YAML: skip that file, don't fail the install.
        if (!layout.agentsRecursive) throw new Error(`${file}: ${(err as Error).message.split('\n')[0]}`);
        content.warnings.push(`skipped ${layout.agentsDir}/${file}: invalid frontmatter`);
        continue;
      }
      // Collections mix agents with docs; an agent must at least describe itself.
      if (layout.agentsRecursive && !parsed.meta.description) continue;
      const name = String(parsed.meta.name ?? basename(file, '.md'));
      if (!matchesAny(name, include.agents)) continue;
      assertName('agent', name);
      const meta = normalizeAgent({ ...parsed.meta, name }, layout.agentFormat ?? 'canonical');
      content.agents.push({ name, meta, body: parsed.body });
    }
  }

  if (layout.instructionsDir) {
    const dir = safeJoin(sourceDir, layout.instructionsDir);
    for (const file of listDir(dir)) {
      if (!file.endsWith('.md')) continue;
      const name = basename(file, '.md');
      if (!matchesAny(name, include.instructions)) continue;
      content.instructions.push({ name, body: readFileSync(join(dir, file), 'utf8').trim() });
    }
  }

  return content;
}

/** Merge contents from several sources; the same name from two sources is an error, not a silent override. */
export function mergeContent(into: Content, from: Content, origin: string, origins: Map<string, string>): void {
  const claim = (kind: string, name: string) => {
    const key = `${kind}:${name}`;
    const prev = origins.get(key);
    if (prev && prev !== origin) throw new Error(`${kind} "${name}" is provided by both ${prev} and ${origin}`);
    origins.set(key, origin);
  };
  for (const s of from.skills) {
    claim('skill', s.name);
    into.skills.push(s);
  }
  for (const a of from.agents) {
    claim('agent', a.name);
    into.agents.push(a);
  }
  for (const m of from.mcp) {
    claim('mcp', m.id);
    into.mcp.push(m);
  }
  into.instructions.push(...from.instructions);
  into.warnings.push(...from.warnings);
}
