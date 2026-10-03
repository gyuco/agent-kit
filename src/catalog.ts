import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Include, Layout, McpServer, Secret, TargetSpec } from './types.js';

/** Bundled with the package, so a given agent-kit version always ships the same catalog. */
export const CATALOG_DIR = fileURLToPath(new URL('../../catalog/', import.meta.url));

export interface Condition {
  always?: boolean;
  dependency?: string[];
  file?: string[];
  language?: string[];
  gitHost?: string;
  target?: string[];
  bin?: string[];
  sourceFilesMin?: number;
  sourceFilesMax?: number;
}

export interface Rule {
  when: Condition;
  score: number;
  reason?: string;
}

export type Step =
  | ({ kind: 'copy'; repo: string; ref?: string } & Layout)
  | ({ kind: 'mcp' } & Omit<McpServer, 'id' | 'only'> & { id?: string; secrets?: Secret[] })
  | { kind: 'command'; run: string[]; requires?: string[]; note?: string }
  | { kind: 'instructions'; text: string };

export interface CatalogItem {
  id: string;
  category: string;
  name: string;
  description: string;
  homepage?: string;
  license?: string;
  requires?: string[];
  compat?: { only?: string[] };
  suggest?: Rule[];
  options?: {
    default?: string[];
    choices?: string[];
    suggest?: Array<{ when: Condition; pick: string[] }>;
  };
  install: Step[];
}

export interface Category {
  id: string;
  label: string;
  /** Mutually exclusive: at most one item. */
  group?: boolean;
}

export interface Catalog {
  version: number;
  categories: Category[];
  items: CatalogItem[];
}

function readYaml<T>(file: string): T {
  return YAML.parse(readFileSync(CATALOG_DIR + file, 'utf8')) as T;
}

export function loadCatalog(): Catalog {
  const c = readYaml<Catalog>('catalog.yaml');
  const ids = new Set<string>();
  const cats = new Set(c.categories.map((x) => x.id));
  for (const item of c.items) {
    if (ids.has(item.id)) throw new Error(`catalog: duplicate id ${item.id}`);
    if (!cats.has(item.category)) throw new Error(`catalog: ${item.id} has unknown category ${item.category}`);
    ids.add(item.id);
  }
  return c;
}

export function loadBuiltinTargets(): Record<string, TargetSpec> {
  return readYaml<{ targets: Record<string, TargetSpec> }>('targets.yaml').targets;
}

/** All option names an item can offer: explicit choices, else defaults plus every rule's picks. */
export function optionChoices(item: CatalogItem): string[] {
  const o = item.options;
  if (!o) return [];
  if (o.choices) return o.choices;
  const all = new Set([...(o.default ?? []), ...(o.suggest ?? []).flatMap((s) => s.pick)]);
  return [...all].sort();
}

/** What a copy step installs, given the chosen options. */
export function copyInclude(item: CatalogItem, step: Layout, options: string[] | undefined): Include {
  const picked = item.options ? options ?? item.options.default ?? [] : undefined;
  return {
    skills: step.skillsDir ? picked : [],
    agents: step.agentsDir ? picked : [],
    instructions: [],
  };
}
