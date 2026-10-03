import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Content, McpFormat, McpServer, Plan, TargetSpec } from './types.js';
import { agentAsInstructions, agentAsSkill, renderAgent } from './transform.js';

class PlanBuilder {
  files = new Map<string, Buffer>();
  blockParts = new Map<string, string[]>();
  mcp = new Map<string, { format: McpFormat; servers: McpServer[] }>();
  private owners = new Map<string, string>();

  /** Identical content at the same path is fine (shared dirs); different content is a config error. */
  addFile(path: string, content: Buffer, owner: string): void {
    const norm = posix.normalize(path.split('\\').join('/'));
    const existing = this.files.get(norm);
    if (existing && !existing.equals(content)) {
      throw new Error(`Conflict: ${norm} produced differently by targets "${this.owners.get(norm)}" and "${owner}"`);
    }
    this.files.set(norm, content);
    this.owners.set(norm, owner);
  }

  addBlockPart(file: string, part: string): void {
    const norm = posix.normalize(file);
    const parts = this.blockParts.get(norm) ?? [];
    if (!parts.includes(part)) parts.push(part);
    this.blockParts.set(norm, parts);
  }

  addMcp(file: string, format: McpFormat, server: McpServer, owner: string): void {
    const norm = posix.normalize(file);
    const entry = this.mcp.get(norm) ?? { format, servers: [] };
    if (entry.format !== format) throw new Error(`Conflict: ${norm} used with formats ${entry.format} and ${format} (${owner})`);
    if (!entry.servers.some((s) => s.id === server.id)) entry.servers.push(server);
    this.mcp.set(norm, entry);
  }

  build(): Plan {
    const blocks = new Map<string, string>();
    for (const [file, parts] of this.blockParts) blocks.set(file, parts.join('\n\n'));
    return { files: this.files, blocks, mcp: this.mcp };
  }
}

const forTarget = (id: string) => (x: { only?: string[] }) => !x.only || x.only.includes(id);

export function buildPlan(content: Content, targets: Array<[string, TargetSpec]>): Plan {
  const p = new PlanBuilder();

  for (const [id, t] of targets) {
    const ok = forTarget(id);

    if (t.skills) {
      for (const s of content.skills.filter(ok)) {
        for (const f of s.files) p.addFile(join(t.skills, s.name, f), readFileSync(join(s.dir, f)), id);
      }
    }

    if (t.instructions) {
      for (const i of content.instructions.filter(ok)) p.addBlockPart(t.instructions, i.body);
    }

    for (const a of content.agents.filter(ok)) {
      if (t.agents) {
        const ext = t.agents.ext ?? '.md';
        p.addFile(join(t.agents.dir, a.name + ext), Buffer.from(renderAgent(a, t.agents)), id);
        continue;
      }
      const fallback = t.agentsFallback ?? 'skill';
      if (fallback === 'skill' && t.skills) {
        p.addFile(join(t.skills, a.name, 'SKILL.md'), Buffer.from(agentAsSkill(a)), id);
      } else if ((fallback === 'instructions' || fallback === 'skill') && t.instructions) {
        p.addBlockPart(t.instructions, agentAsInstructions(a));
      }
    }

    if (t.mcp) {
      for (const m of content.mcp.filter(ok)) p.addMcp(t.mcp.file, t.mcp.format, m, id);
    }
  }

  return p.build();
}
