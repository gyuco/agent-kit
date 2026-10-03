import * as p from '@clack/prompts';
import { spawnSync } from 'node:child_process';
import { loadBuiltinTargets, loadCatalog, optionChoices } from './catalog.js';
import { hasProjectConfig, loadProjectConfig, ownSources, saveProjectConfig } from './config.js';
import { detect, findBins } from './detect.js';
import { detectTargets, propose, proposalToSelection, requiredBins, type Proposal } from './suggest.js';
import { sync, type CommandStep } from './sync.js';
import type { CatalogSelection, ProjectConfig } from './types.js';

export interface WizardOptions {
  /** Accept the deterministic proposal without prompting. External installers are only printed. */
  yes?: boolean;
  dryRun?: boolean;
}

const NONE = '__none__';

function bail<T>(v: T): Exclude<T, symbol> {
  if (p.isCancel(v)) {
    p.cancel('Annullato, nessun file modificato.');
    process.exit(130);
  }
  return v as Exclude<T, symbol>;
}

function hint(pr: Proposal): string | undefined {
  const parts: string[] = [];
  if (pr.preselected) parts.push('consigliato');
  if (pr.reasons.length) parts.push(pr.reasons.join(', '));
  if (pr.missing.length) parts.push(`manca ${pr.missing.join(', ')}`);
  if (pr.item.compat?.only) parts.push(`solo ${pr.item.compat.only.join(', ')}`);
  if (pr.item.license && /AGPL|GPL|noncommercial/i.test(pr.item.license)) parts.push(`licenza ${pr.item.license}`);
  return parts.length ? parts.join(' · ') : undefined;
}

const cmdLine = (run: string[]) => run.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');

export async function wizard(root: string, opts: WizardOptions = {}): Promise<number> {
  const catalog = loadCatalog();
  const builtinTargets = loadBuiltinTargets();
  const existing: ProjectConfig | null = hasProjectConfig(root) ? loadProjectConfig(root) : null;

  p.intro('agent-kit');
  const spin = p.spinner();
  spin.start(`Analizzo ${root}`);
  const signals = detect(root, requiredBins(catalog, builtinTargets));
  const allTargets = { ...builtinTargets, ...(existing?.targetDefinitions ?? {}) };
  const detectedTargets = detectTargets(allTargets, signals);
  spin.stop('Analisi completata');

  const langs = Object.entries(signals.languageCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([l, n]) => `${l} (${n})`);
  p.note(
    [
      `CLI rilevate:   ${detectedTargets.join(', ') || 'nessuna'}`,
      `Linguaggi:      ${langs.join(', ') || 'nessuno (progetto vuoto?)'}`,
      `File sorgente:  ${signals.sourceFiles}`,
      `Dipendenze:     ${signals.deps.size}`,
      `Git remote:     ${signals.gitHost ?? '—'}`,
      existing ? 'Config esistente trovata: parto dalle scelte già salvate.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    'Progetto',
  );

  // ── targets
  const initialTargets = existing?.targets.length ? existing.targets : detectedTargets;
  const targets: string[] = opts.yes
    ? initialTargets
    : bail(
        await p.multiselect({
          message: 'Per quali CLI installare?',
          options: Object.entries(allTargets).map(([id, t]) => ({
            value: id,
            label: t.label ?? id,
            hint: detectedTargets.includes(id) ? 'rilevata' : undefined,
          })),
          initialValues: initialTargets,
          required: true,
        }),
      );
  if (!targets.length) {
    p.cancel('Nessuna CLI selezionata (usa senza --yes per sceglierle).');
    return 1;
  }

  // ── own source repo
  const currentOwn = existing ? ownSources(existing)[0] : undefined;
  let own = currentOwn;
  if (!opts.yes) {
    const answer = bail(
      await p.text({
        message: 'Repo con i tuoi agenti/skill (opzionale, invio per saltare)',
        placeholder: 'github:org/repo oppure ./percorso/locale',
        initialValue: currentOwn?.source ?? '',
      }),
    ).trim();
    own = answer ? { ...(currentOwn?.source === answer ? currentOwn : {}), source: answer } : undefined;
  }

  // ── catalog
  const proposal = propose(catalog, signals, targets);
  if (existing?.catalog) {
    // Re-run: saved choices win over suggestions, so nothing flips unexpectedly.
    const saved = new Map(existing.catalog.map((c) => [c.id, c]));
    for (const pr of [...proposal.values()].flat()) {
      pr.preselected = saved.has(pr.item.id);
      const o = saved.get(pr.item.id)?.options;
      if (o) pr.options = o;
    }
  }

  let selection: CatalogSelection[];
  if (opts.yes) {
    selection = proposalToSelection(proposal);
  } else {
    selection = [];
    for (const cat of catalog.categories) {
      const list = (proposal.get(cat.id) ?? []).filter((pr) => pr.compatible);
      const hidden = (proposal.get(cat.id) ?? []).filter((pr) => !pr.compatible);
      if (!list.length) continue;
      const options = list.map((pr) => ({ value: pr.item.id, label: `${pr.item.name} — ${pr.item.description}`, hint: hint(pr) }));
      const message = cat.label + (hidden.length ? ` (non compatibili con le CLI scelte: ${hidden.map((h) => h.item.name).join(', ')})` : '');

      let chosen: string[];
      if (cat.group) {
        const initial = list.find((pr) => pr.preselected)?.item.id ?? NONE;
        const v = bail(
          await p.select({
            message: `${message} — una sola scelta`,
            options: [...options, { value: NONE, label: 'Nessuno', hint: undefined }],
            initialValue: initial,
          }),
        );
        chosen = v === NONE ? [] : [v];
      } else {
        chosen = bail(
          await p.multiselect({
            message,
            options,
            initialValues: list.filter((pr) => pr.preselected).map((pr) => pr.item.id),
            required: false,
          }),
        );
      }

      for (const id of chosen) {
        const pr = list.find((x) => x.item.id === id)!;
        if (!pr.item.options) {
          selection.push({ id });
          continue;
        }
        const picked = bail(
          await p.multiselect({
            message: `${pr.item.name}: quali elementi?`,
            options: optionChoices(pr.item).map((c) => ({ value: c, label: c })),
            initialValues: pr.options,
            required: false,
          }),
        );
        if (picked.length) selection.push({ id, options: picked });
      }
    }
  }

  const cfg: ProjectConfig = {
    targets,
    ...(own ? { sources: [own] } : {}),
    catalog: selection,
    ...(existing?.targetDefinitions ? { targetDefinitions: existing.targetDefinitions } : {}),
  };

  p.note(
    [
      `CLI: ${targets.join(', ')}`,
      own ? `Repo personale: ${own.source}` : '',
      ...selection.map((s) => `• ${s.id}${s.options ? `: ${s.options.join(', ')}` : ''}`),
    ]
      .filter(Boolean)
      .join('\n'),
    'Riepilogo',
  );
  if (!opts.yes && !bail(await p.confirm({ message: opts.dryRun ? 'Simulare l’installazione?' : 'Procedo?' }))) {
    p.cancel('Nessun file modificato.');
    return 0;
  }

  // ── sync, then persist the config only if it worked
  spin.start('Scarico e installo');
  let result;
  try {
    result = sync(root, { dryRun: opts.dryRun, config: cfg });
  } catch (err) {
    spin.stop('Errore');
    p.log.error((err as Error).message);
    return 1;
  }
  if (!opts.dryRun) saveProjectConfig(root, cfg);
  const count = (k: string) => result.actions.filter((a) => a.kind === k).length;
  spin.stop(`${count('write')} scritti, ${count('remove')} rimossi, ${count('unchanged')} invariati`);
  for (const w of result.warnings) p.log.warn(w);
  for (const a of result.actions.filter((x) => x.kind === 'conflict' || x.kind === 'keep')) {
    p.log.warn(`${a.path}: ${a.note}`);
  }

  // ── external installers
  const shown = await runCommands(root, result.commands, opts);

  if (result.secrets.length) {
    p.log.info(`Variabili d'ambiente richieste dagli MCP (mai scritte nei file): ${result.secrets.join(', ')}`);
  }
  if (shown.length) p.note(shown.join('\n'), 'Comandi da eseguire a mano');
  p.outro(opts.dryRun ? 'Simulazione completata, nessun file scritto.' : 'Fatto. Per riallineare in futuro: npx agent-kit sync');
  return count('conflict') ? 2 : 0;
}

async function runCommands(root: string, commands: CommandStep[], opts: WizardOptions): Promise<string[]> {
  const shown: string[] = [];
  const bins = findBins(new Set(commands.flatMap((c) => c.step.requires ?? [c.step.run[0]])));
  for (const { item, step } of commands) {
    const line = cmdLine(step.run);
    const missing = (step.requires ?? [step.run[0]]).filter((b) => !bins.has(b));
    if (opts.yes || opts.dryRun || missing.length) {
      shown.push(`${line}${missing.length ? `   # manca ${missing.join(', ')}` : ''}${step.note ? `   # ${step.note}` : ''}`);
      continue;
    }
    const choice = bail(
      await p.select({
        message: `${item.name}: ${line}${step.note ? `\n  ${step.note}` : ''}`,
        options: [
          { value: 'show', label: 'Mostrami solo il comando' },
          { value: 'run', label: 'Eseguilo ora' },
          { value: 'skip', label: 'Salta' },
        ],
        initialValue: 'show',
      }),
    );
    if (choice === 'show') shown.push(line);
    if (choice !== 'run') continue;
    p.log.step(`$ ${line}`);
    const r = spawnSync(step.run[0], step.run.slice(1), { cwd: root, stdio: 'inherit' });
    if (r.status === 0) p.log.success(`${item.name}: completato`);
    else {
      p.log.error(`${item.name}: terminato con codice ${r.status ?? r.signal}`);
      shown.push(line);
    }
  }
  return shown;
}
