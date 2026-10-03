import type { Agent, AgentsSpec, FieldMapping } from './types.js';
import { renderFrontmatter } from './util.js';

const DEFAULT_FIELDS: Record<string, string> = { name: 'name', description: 'description' };

/** Claude Code dialect -> canonical fields. */
const CLAUDE_TOOLS: Record<string, string> = {
  Read: 'read',
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Glob: 'search',
  Grep: 'search',
  Bash: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
};
const CLAUDE_MODELS: Record<string, string> = { opus: 'smart', sonnet: 'balanced', haiku: 'fast' };

/** Bring agents written for a specific CLI into the canonical shape every target maps from. */
export function normalizeAgent(meta: Record<string, unknown>, format: 'canonical' | 'claude'): Record<string, unknown> {
  if (format === 'canonical') return meta;
  const { tools, model, ...rest } = meta;
  const out: Record<string, unknown> = { ...rest };
  if (tools !== undefined) {
    const list = Array.isArray(tools) ? tools.map(String) : String(tools).split(',');
    const caps = [...new Set(list.map((t) => CLAUDE_TOOLS[t.trim()]).filter(Boolean))];
    if (caps.length) out.capabilities = caps;
  }
  if (typeof model === 'string' && CLAUDE_MODELS[model]) out.model = CLAUDE_MODELS[model];
  return out;
}

function mapValue(value: unknown, m: FieldMapping): unknown {
  if (Array.isArray(value)) {
    const items = [
      ...new Set(
        value.map(String).flatMap((v) => {
          if (!m.map) return [v];
          const mapped = m.map[v];
          return mapped === undefined ? [] : Array.isArray(mapped) ? mapped : [mapped];
        }),
      ),
    ];
    if (!items.length) return undefined;
    switch (m.format ?? 'list') {
      case 'csv':
        return items.join(', ');
      case 'object':
        return Object.fromEntries(items.map((v) => [v, true]));
      default:
        return items;
    }
  }
  if (m.map) {
    const mapped = m.map[String(value)];
    return Array.isArray(mapped) ? mapped[0] : mapped;
  }
  return value;
}

/** Render a canonical agent in a target's native format. */
export function renderAgent(agent: Agent, spec: AgentsSpec): string {
  const fields = { ...DEFAULT_FIELDS, ...(spec.fields ?? {}) };
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(agent.meta)) {
    const f = fields[key];
    if (f === undefined) {
      if (spec.passthrough) out[key] = value;
      continue;
    }
    const m: FieldMapping = typeof f === 'string' ? { key: f } : f;
    const mapped = mapValue(value, m);
    if (mapped !== undefined) out[m.key] = mapped;
  }
  Object.assign(out, spec.extra ?? {});
  return renderFrontmatter(out, agent.body);
}

/** For tools without subagents: expose the agent as a skill the model can load on demand. */
export function agentAsSkill(agent: Agent): string {
  const description = String(agent.meta.description ?? `Act as the ${agent.name} agent`);
  return renderFrontmatter({ name: agent.name, description }, agent.body);
}

/** For tools without subagents or skills: a section in the instructions file. */
export function agentAsInstructions(agent: Agent): string {
  const desc = agent.meta.description ? `\n\n_${String(agent.meta.description)}_` : '';
  return `## Agent: ${agent.name}${desc}\n\n${agent.body.trim()}`;
}
