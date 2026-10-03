#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadBuiltinTargets, loadCatalog } from './catalog.js';
import { sync } from './sync.js';
import { wizard } from './wizard.js';

const HELP = `agent-kit — skills, agenti, MCP e workflow per qualsiasi coding-agent CLI

Uso:
  npx agent-kit                 Wizard interattivo nella cartella corrente
  npx agent-kit sync            Riapplica .agentkit.yaml senza domande (CI)
  npx agent-kit list            Mostra catalogo e CLI supportate

Opzioni:
  -y, --yes          Wizard: accetta i suggerimenti senza chiedere (gli installer esterni vengono solo mostrati)
  --dry-run          Mostra cosa cambierebbe, non scrive nulla
  --force            Sovrascrive/rimuove anche file modificati a mano
  --frozen           sync: usa i commit registrati nel lockfile
  --targets a,b      sync: sovrascrive le CLI della config
  --cwd <dir>        Cartella del progetto (default: corrente)
  -h, --help         Questo aiuto
`;

const SYMBOLS = { write: '+', unchanged: '=', conflict: '!', remove: '-', keep: '~' } as const;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', short: 'y' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      frozen: { type: 'boolean' },
      targets: { type: 'string' },
      cwd: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const root = resolve(values.cwd ?? process.cwd());
  const cmd = positionals[0] ?? 'wizard';

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  switch (cmd) {
    case 'wizard':
    case 'init': {
      if (!values.yes && !process.stdin.isTTY) {
        console.error('Terminale non interattivo: usa --yes oppure "agent-kit sync".');
        return 1;
      }
      return wizard(root, { yes: values.yes, dryRun: values['dry-run'] });
    }
    case 'sync': {
      const r = sync(root, {
        dryRun: values['dry-run'],
        force: values.force,
        frozen: values.frozen,
        targets: values.targets?.split(',').map((s) => s.trim()).filter(Boolean),
      });
      for (const a of r.actions) {
        if (a.kind === 'unchanged') continue;
        console.log(`${SYMBOLS[a.kind]} ${a.path}${a.note ? `  (${a.note})` : ''}`);
      }
      for (const w of r.warnings) console.log(`! ${w}`);
      const count = (k: string) => r.actions.filter((a) => a.kind === k).length;
      console.log(
        `\n${values['dry-run'] ? '[dry-run] ' : ''}${count('write')} scritti, ${count('remove')} rimossi, ` +
          `${count('unchanged')} invariati, ${count('conflict') + count('keep')} saltati`,
      );
      if (r.secrets.length) console.log(`Variabili d'ambiente richieste: ${r.secrets.join(', ')}`);
      return count('conflict') ? 2 : 0;
    }
    case 'list': {
      const catalog = loadCatalog();
      const targets = loadBuiltinTargets();
      console.log(`CLI: ${Object.entries(targets).map(([id, t]) => `${id} (${t.label ?? id})`).join(', ')}\n`);
      for (const c of catalog.categories) {
        console.log(`${c.label}${c.group ? ' (una sola scelta)' : ''}`);
        for (const i of catalog.items.filter((x) => x.category === c.id)) {
          console.log(`  ${i.id.padEnd(22)} ${i.description}`);
        }
      }
      return 0;
    }
    default:
      console.error(`Comando sconosciuto: ${cmd}\n`);
      process.stdout.write(HELP);
      return 1;
  }
}

main().then(
  (code) => (process.exitCode = code),
  (err) => {
    console.error(`agent-kit: ${(err as Error).message}`);
    process.exitCode = 1;
  },
);
