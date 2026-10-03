import type { Catalog, CatalogItem, Condition } from './catalog.js';
import { optionChoices } from './catalog.js';
import type { Signals } from './detect.js';
import type { CatalogSelection, TargetSpec } from './types.js';

/** Items scoring at least this are preselected. */
export const THRESHOLD = 50;

export interface Proposal {
  item: CatalogItem;
  score: number;
  reasons: string[];
  compatible: boolean;
  /** Required binaries not found on PATH. */
  missing: string[];
  preselected: boolean;
  options: string[];
}

export function matches(when: Condition, s: Signals, targets: string[]): boolean {
  const checks: boolean[] = [];
  if (when.always) checks.push(true);
  if (when.dependency) checks.push(when.dependency.some((d) => s.deps.has(d)));
  if (when.file) checks.push(when.file.some((f) => s.exists(f)));
  if (when.language) checks.push(when.language.some((l) => s.languages.has(l)));
  if (when.gitHost) checks.push(s.gitHost === when.gitHost);
  if (when.target) checks.push(when.target.some((t) => targets.includes(t)));
  if (when.bin) checks.push(when.bin.some((b) => s.bins.has(b)));
  if (when.sourceFilesMin !== undefined) checks.push(s.sourceFiles >= when.sourceFilesMin);
  if (when.sourceFilesMax !== undefined) checks.push(s.sourceFiles <= when.sourceFilesMax);
  return checks.length > 0 && checks.every(Boolean);
}

export function detectTargets(all: Record<string, TargetSpec>, s: Signals): string[] {
  return Object.keys(all)
    .filter((id) => {
      const d = all[id].detect;
      return !!d && ((d.bins ?? []).some((b) => s.bins.has(b)) || (d.paths ?? []).some((p) => s.exists(p)));
    })
    .sort();
}

export function requiredBins(catalog: Catalog, targets: Record<string, TargetSpec>): string[] {
  const names = new Set<string>();
  for (const t of Object.values(targets)) for (const b of t.detect?.bins ?? []) names.add(b);
  for (const i of catalog.items) {
    for (const b of i.requires ?? []) names.add(b);
    for (const r of i.suggest ?? []) for (const b of r.when.bin ?? []) names.add(b);
    for (const st of i.install) if (st.kind === 'command') for (const b of st.requires ?? [st.run[0]]) names.add(b);
  }
  return [...names].sort();
}

function suggestOptions(item: CatalogItem, s: Signals, targets: string[]): string[] {
  const o = item.options;
  if (!o) return [];
  const picked = new Set(o.default ?? []);
  for (const r of o.suggest ?? []) if (matches(r.when, s, targets)) r.pick.forEach((p) => picked.add(p));
  const order = optionChoices(item);
  return order.filter((c) => picked.has(c));
}

/**
 * Deterministic proposal: same signals + same catalog => same output.
 * Order inside a category: score desc, then id asc.
 */
export function propose(catalog: Catalog, s: Signals, targets: string[]): Map<string, Proposal[]> {
  const out = new Map<string, Proposal[]>();
  for (const cat of catalog.categories) {
    const list: Proposal[] = catalog.items
      .filter((i) => i.category === cat.id)
      .map((item) => {
        let score = 0;
        const reasons: string[] = [];
        for (const r of item.suggest ?? []) {
          if (!matches(r.when, s, targets)) continue;
          if (r.score > score) score = r.score;
          if (r.reason && !reasons.includes(r.reason)) reasons.push(r.reason);
        }
        const compatible = !item.compat?.only || item.compat.only.some((t) => targets.includes(t));
        const missing = (item.requires ?? []).filter((b) => !s.bins.has(b));
        return {
          item,
          score,
          reasons,
          compatible,
          missing,
          preselected: compatible && missing.length === 0 && score >= THRESHOLD,
          options: suggestOptions(item, s, targets),
        };
      })
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

    if (cat.group) {
      // Exclusive: keep only the best preselected one.
      let taken = false;
      for (const p of list) {
        if (p.preselected && !taken) taken = true;
        else p.preselected = false;
      }
    }
    out.set(cat.id, list);
  }
  return out;
}

export function proposalToSelection(proposal: Map<string, Proposal[]>): CatalogSelection[] {
  return [...proposal.values()]
    .flat()
    .filter((p) => p.preselected)
    .map((p) => (p.item.options ? { id: p.item.id, options: p.options } : { id: p.item.id }));
}
