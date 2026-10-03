/** How a canonical frontmatter field is rendered for a target. */
export interface FieldMapping {
  /** Key name in the target's frontmatter. */
  key: string;
  /** Value translation table; a value may expand to several. When present, unmapped values are dropped. */
  map?: Record<string, string | string[]>;
  /** Rendering for array values (default: list). */
  format?: 'list' | 'csv' | 'object';
}

export interface AgentsSpec {
  /** Directory (relative to project root) where agent files are written. */
  dir: string;
  /** File extension, default ".md". */
  ext?: string;
  /** canonical key -> target key (string) or full mapping. name/description are mapped by default. */
  fields?: Record<string, string | FieldMapping>;
  /** Static fields added to every agent's frontmatter (e.g. mode: subagent). */
  extra?: Record<string, unknown>;
  /** Copy canonical fields not listed in `fields` as-is (default false). */
  passthrough?: boolean;
}

export type McpFormat = 'claude' | 'cursor' | 'vscode' | 'opencode' | 'codex-toml';

/** A coding-agent CLI described purely as data. */
export interface TargetSpec {
  label?: string;
  /** Signals that the CLI is used in this project or installed on this machine. */
  detect?: { bins?: string[]; paths?: string[] };
  /** Directory where skill folders go. Targets sharing a dir are written once. */
  skills?: string;
  /** Native subagent support. Omit if the tool has none. */
  agents?: AgentsSpec;
  /** What to do with agents when `agents` is not set (default: skill). */
  agentsFallback?: 'skill' | 'instructions' | 'none';
  /** Instructions file to inject a managed block into (e.g. AGENTS.md). */
  instructions?: string;
  /** Project MCP config file. Omit if the tool has no MCP support. */
  mcp?: { file: string; format: McpFormat };
}

/** Where a set of skills/agents/instructions lives inside a repo. */
export interface Layout {
  skillsDir?: string;
  agentsDir?: string;
  agentsRecursive?: boolean;
  instructionsDir?: string;
  /** Frontmatter dialect of the source agents; non-canonical ones are normalized first. */
  agentFormat?: 'canonical' | 'claude';
}

export interface Include {
  skills?: string[];
  agents?: string[];
  instructions?: string[];
}

export interface SourceConfig {
  /** github:org/repo, gitlab:org/repo, a git URL, or a local path (./, ../, /). */
  source: string;
  /** Tag, branch or commit. Default: remote HEAD. */
  ref?: string;
  include?: Include;
}

export interface CatalogSelection {
  id: string;
  /** Chosen sub-options (e.g. which skills of a collection). */
  options?: string[];
}

export interface ProjectConfig {
  /** Target ids to install for. */
  targets: string[];
  /** Your own source repos. */
  sources?: SourceConfig[];
  /** Legacy single-source form, equivalent to sources: [{ source, ref, include }]. */
  source?: string;
  ref?: string;
  include?: Include;
  /** Items picked from the bundled catalog. */
  catalog?: CatalogSelection[];
  /** Project-local target definitions; override or extend built-in and source targets. */
  targetDefinitions?: Record<string, TargetSpec>;
}

/** Restricts an installable piece to some targets (catalog `compat.only`). */
interface Scoped {
  only?: string[];
}

export interface Skill extends Scoped {
  name: string;
  dir: string;
  /** Paths relative to `dir`. */
  files: string[];
}

export interface Agent extends Scoped {
  name: string;
  meta: Record<string, unknown>;
  body: string;
}

export interface Instruction extends Scoped {
  name: string;
  body: string;
}

export interface Secret {
  env: string;
  /** For remote servers: send the value in this HTTP header. */
  header?: string;
  prefix?: string;
}

export interface McpServer extends Scoped {
  id: string;
  command?: string;
  args?: string[];
  url?: string;
  secrets?: Secret[];
}

export interface Content {
  skills: Skill[];
  agents: Agent[];
  instructions: Instruction[];
  mcp: McpServer[];
  /** Non-fatal problems in third-party sources (e.g. malformed files skipped). */
  warnings: string[];
}

export interface Plan {
  /** Project-relative path -> file content. */
  files: Map<string, Buffer>;
  /** Project-relative instructions file -> managed block content. */
  blocks: Map<string, string>;
  /** Project-relative MCP config file -> servers to own in it. */
  mcp: Map<string, { format: McpFormat; servers: McpServer[] }>;
}

export interface Lock {
  version: 2;
  /** "<source>@<ref>" -> resolved commit. */
  commits: Record<string, string>;
  /** Project-relative path -> sha256 of the content we wrote. */
  files: Record<string, string>;
  /** Instructions file -> sha256 of the managed block we wrote. */
  blocks: Record<string, string>;
  /** MCP config file -> server id -> sha256 of the entry we wrote. */
  mcp: Record<string, Record<string, string>>;
}
