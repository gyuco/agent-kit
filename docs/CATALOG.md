# Catalogo opzioni — bozza v0 (ricerca 2026-10-03)

Base dati per il wizard interattivo `npx agent-kit`. Ogni voce diventerà un record in `catalog.yaml`.
Le colonne **Install** e **Compat** guidano cosa il wizard può fare automaticamente; i comandi marcati ⚠️ vanno verificati prima di codificarli.

Legenda compatibilità: 🌐 qualsiasi CLI (MCP / Agent Skills / AGENTS.md) · 🟠 solo alcuni CLI · 🔵 solo Claude Code (plugin/hook)

---

## 1. Agenti (subagent)

| id | Cosa | Install | Compat | Note |
|---|---|---|---|---|
| `own-agents` | I tuoi agenti dal repo sorgente (già supportato da `sync`) | git copy + transform | 🟠 nativo dove ci sono subagent, altrove → skill | default |
| `voltagent-subagents` | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents): 100+ agenti per categoria | git copy (selezione per categoria) | 🟠 | formato Claude, va tradotto |
| `wshobson-agents` | [wshobson/agents](https://github.com/wshobson/agents): agenti per dominio, anche come plugin | git copy | 🟠 | formato Claude |

> Le collezioni grandi vanno **filtrate**: caricare 100 agenti spreca contesto (descrizioni sempre in prompt). Il wizard deve proporre pochi agenti per stack.

## 2. Skills

| id | Cosa | Install | Compat | Suggerito se |
|---|---|---|---|---|
| `own-skills` | Le tue skill dal repo sorgente | git copy | 🌐 | sempre |
| `anthropic-skills` | [anthropics/skills](https://github.com/anthropics/skills): pdf, docx, xlsx, frontend-design, skill-creator… | git copy selettivo | 🌐 | per tipo di file/progetto |
| `vercel-agent-skills` | vercel-labs/agent-skills: react-best-practices, web-design-guidelines | git copy / `npx skills add` | 🌐 | dipendenze `react` / `next` |
| `supabase-skills` | supabase/agent-skills | `npx skills add supabase/agent-skills` | 🌐 | cartella `supabase/` o dep `@supabase/*` |
| `skills-registry` | [skills.sh](https://www.skills.sh/): registry di Vercel (decine di migliaia di skill) | `npx skills add owner/repo` | 🌐 | ricerca manuale, **non** suggerito automaticamente |

## 3. MCP server

| id | Cosa | Avvio | Auth | Suggerito se |
|---|---|---|---|---|
| `context7` | Documentazione aggiornata delle librerie | `npx -y @upstash/context7-mcp` o remoto | opz. API key | qualsiasi progetto con dipendenze |
| `github` | Issue, PR, Actions | remoto ufficiale GitHub | OAuth/PAT | remote git su github.com |
| `playwright` | Automazione browser / e2e | `npx @playwright/mcp@latest` | — | progetto web frontend |
| `chrome-devtools` | Console, network, performance | `npx chrome-devtools-mcp@latest` | — | progetto web frontend |
| `supabase` | DB, migrazioni, log | remoto ufficiale | OAuth | `supabase/` presente |
| `firecrawl` | Scraping/ricerca web | `npx -y firecrawl-mcp` | API key | solo su richiesta |
| `sequential-thinking` | Ragionamento strutturato | `npx -y @modelcontextprotocol/server-sequential-thinking` | — | solo su richiesta |

Il wizard scrive la config MCP nel formato di ogni target (formati diversi):

| Target | File progetto | Formato |
|---|---|---|
| Claude Code | `.mcp.json` | JSON, `mcpServers` |
| Cursor | `.cursor/mcp.json` | JSON, `mcpServers` |
| VS Code / Copilot | `.vscode/mcp.json` | JSON, **`servers`** |
| Codex | `.codex/config.toml` | **TOML**, `[mcp_servers.<id>]` |
| OpenCode | `opencode.json` | JSON, `mcp` (schema proprio) |
| pi | — | niente MCP nativo (via estensioni) ⚠️ |

> I segreti non vanno mai scritti nei file: solo riferimenti a variabili d'ambiente (`${GITHUB_TOKEN}`), con un avviso alla fine.

## 4. Memoria

| id | Cosa | Install | Compat | Trade-off |
|---|---|---|---|---|
| `memory-files` | Nessun tool: convenzione `AGENTS.md` + `docs/decisions/` | template | 🌐 | **default**: zero dipendenze, versionato in git |
| `basic-memory` | Grafo semantico su Markdown, indice SQLite | `uvx basic-memory mcp` ⚠️ | 🌐 MCP | richiede Python/uv; i file restano la fonte di verità |
| `mcp-memory` | Server di riferimento MCP, grafo di conoscenza in JSON | `npx -y @modelcontextprotocol/server-memory` | 🌐 MCP | semplice, poco strutturato |
| `agentmemory` | [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory): memoria persistente multi-agente | ⚠️ | 🌐 MCP | runtime locale con più porte |
| `claude-mem` | [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem): cattura sessioni via hook + ricerca | plugin Claude Code | 🔵 | molto popolare, ma solo Claude Code |
| `mem0` | Memoria con estrazione LLM | MCP **ospitato** | 🌐 MCP | cloud: OpenMemory locale è stato rimosso a luglio 2026 |

Esclusivo: **una sola** memoria per progetto.

## 5. Indicizzazione del codice

| id | Approccio | Install | Requisiti | Suggerito se |
|---|---|---|---|---|
| `none` | grep/glob nativi dell'agente | — | — | repo piccolo (soglia: < ~500 file sorgente) |
| `serena` | [oraios/serena](https://github.com/oraios/serena): LSP (simboli, riferimenti, edit simbolico) | `uvx --from git+https://github.com/oraios/serena serena start-mcp-server` ⚠️ | uv | repo medio/grande, linguaggi con LSP |
| `claude-context` | [zilliztech/claude-context](https://github.com/zilliztech/claude-context): ricerca ibrida BM25 + vettoriale, indicizzazione incrementale | `npx @zilliz/claude-context-mcp` ⚠️ | API embedding + Milvus/Zilliz | repo grande, ok con un servizio esterno |
| `codegraphcontext` | [CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext): grafo del codice, 22 linguaggi, MIT | pip ⚠️ | Python + graph DB | serve analisi d'impatto / call graph |
| `gitnexus` | [GitNexus](https://github.com/abhigyanpatwari/GitNexus): knowledge graph | ⚠️ | — | ⚠️ **licenza non commerciale**: mai suggerito di default |
| `repomix` | [yamadashy/repomix](https://github.com/yamadashy/repomix): impacchetta il repo in un file (anche MCP) | `npx repomix` | — | snapshot per review o per altri LLM, non per l'indicizzazione continua |

Esclusivo: un solo indicizzatore "attivo" (repomix può stare accanto agli altri).

## 6. Risparmio token

| id | Cosa agisce su | Install | Compat | Note |
|---|---|---|---|---|
| `rtk` | Output della shell (git, npm, test…) | binario + `rtk init` | 🟠 hook per Claude Code, estensioni per altri IDE | già in uso da te; tipicamente −60/90% sull'output CLI |
| `context-mode` | Output dei tool MCP (li indicizza invece di riversarli nel contesto) | plugin ⚠️ | 🔵/🟠 | complementare a rtk |
| `caveman` | Output del modello (stile telegrafico) | skill | 🌐 | riduce i token in **uscita**; cambia il tono: opt-in |
| `ccusage` | Monitoraggio dei consumi (non risparmio) | `npx ccusage` | 🔵 | solo misurazione |
| `lean-config` | Buone pratiche: pochi MCP attivi, AGENTS.md corto, skill invece di istruzioni sempre caricate | template | 🌐 | **default**: il "risparmio" più grande è non caricare tutto |

## 7. Metodologie / workflow

| id | Filosofia | Install | Compat | Quando |
|---|---|---|---|---|
| `none` | — | — | — | default |
| `bmad` | [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD): team agile simulato (analyst, PM, architect, dev), PRD → architettura → story | `npx bmad-method install` | 🌐 (installer multi-IDE) | greenfield complesso, processo pesante |
| `spec-kit` | [github/spec-kit](https://github.com/github/spec-kit): constitution + specify → plan → tasks → implement | `uvx --from git+https://github.com/github/spec-kit.git specify init --here` ⚠️ | 🌐 | team in crescita, processo standard |
| `openspec` | [OpenSpec](https://github.com/Fission-AI/OpenSpec): spec delta per change, leggero | `npx @fission-ai/openspec init` ⚠️ | 🌐 | **brownfield**, modifiche incrementali |
| `gsd` | Get-Shit-Done: fasi pilotate con slash command, reset del contesto tra fasi | `npx get-shit-done-cc` ⚠️ | 🟠 | lavoro solo, contro il "context rot" |
| `superpowers` | [obra/superpowers](https://github.com/obra/superpowers): skill auto-attivate (brainstorming, TDD, debug, review) | plugin / skill | 🟠 (nativo in Claude Code; le skill altrove) | vuoi disciplina TDD senza un processo a fasi |

Esclusivo: **una sola** metodologia. Il wizard le esegue tramite il **loro installer** (non le copia), sempre con conferma esplicita perché scrivono molti file.

---

## Suggerimenti deterministici — proposta

Nessun LLM nel wizard. Stesso progetto + stessa versione del catalogo ⇒ stessi suggerimenti.

1. **Rilevamento** (solo lettura, nessuna rete) nella cwd:
   - CLI target: binari nel `PATH` (`claude`, `codex`, `opencode`, `pi`, `cursor-agent`, …) e cartelle esistenti (`.claude/`, `.codex/`, `.opencode/`, `.cursor/`, `.agents/`).
   - Stack: `package.json` (dipendenze), `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, …
   - Segnali: `supabase/`, remote `github.com`, `playwright.config.*`, numero di file sorgente, git presente o no.
   - Già installato: `.bmad-core/`, `.specify/`, `openspec/`, `.mcp.json`, ecc. (per non proporre doppioni).
2. **Regole** per ogni voce del catalogo: `when` (condizioni sui segnali) → `score`. Pre-selezionate le voci con score ≥ soglia; ordinamento per `score desc, id asc`.
3. **Gruppi esclusivi** (memoria, indicizzazione, metodologia): radio button, preselezione = score più alto, poi `none`.
4. **Output riproducibile**: le scelte vengono salvate in `.agentkit.yaml` → `npx agent-kit sync` non interattivo (CI) ricrea lo stesso stato. `--yes` accetta i suggerimenti senza prompt.
5. **Azioni a rischio** (installer esterni, `uvx`/`pip`, servizi cloud, licenze restrittive) → mai preselezionate, sempre con conferma separata e un riepilogo prima di eseguire.

### Schema di una voce (`catalog.yaml`)

```yaml
- id: playwright
  category: mcp               # agents | skills | mcp | memory | indexing | tokens | methodology
  name: Playwright MCP
  description: Browser automation and e2e testing
  homepage: https://github.com/microsoft/playwright-mcp
  license: Apache-2.0
  requires: [node]            # node | python | uv | docker | account
  install:
    kind: mcp                 # copy | skills-add | mcp | command | plugin
    server: { command: npx, args: ["@playwright/mcp@latest"] }
  compat: { all: true }       # oppure { only: [claude-code] }
  exclusiveGroup: null        # memory | indexing | methodology
  suggest:
    - when: { dependency: [react, vue, svelte, next, "@angular/core"] }
      score: 60
    - when: { file: "playwright.config.*" }
      score: 90
```
