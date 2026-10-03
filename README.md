# agent-kit

Interactive installer that sets up agents, skills, MCP servers, memory, code indexing,
token-saving tools and workflows (BMAD, Spec Kit, OpenSpec…) for **any** coding-agent CLI:
Claude Code, Codex, OpenCode, pi, Cursor, GitHub Copilot — or any other you describe in YAML.

```bash
npx gyukit          # wizard in the current directory
npx gyukit --yes    # accept suggestions, no prompts
npx gyukit sync     # re-apply .agentkit.yaml (CI), never prompts
npx gyukit list     # show catalog and supported CLIs
```

## How suggestions work (deterministic)

No LLM, no network for the proposal. The wizard reads the project directory —
CLIs on `PATH` and their config dirs, dependencies (`package.json`, `requirements.txt`, `pyproject.toml`),
languages by file count, git remote host, marker files — and evaluates fixed rules from
[`catalog/catalog.yaml`](catalog/catalog.yaml). Same project + same agent-kit version ⇒ same proposal.

- Items scoring ≥ 50 are preselected; order is score desc, then id.
- Memory, indexing and methodology are exclusive (one choice).
- Items needing a missing binary (`uv`, `npx`…) or only working with unselected CLIs are never preselected.
- On re-run, your saved choices take precedence over suggestions.

## What gets installed, and how

| Step kind | Effect |
|---|---|
| `copy` | Skills/agents fetched from a pinned git repo, translated per CLI, tracked in the lockfile |
| `mcp` | Server added to each CLI's MCP config in its own format (`.mcp.json`, `.codex/config.toml`, `opencode.json`, `.cursor/mcp.json`, `.vscode/mcp.json`). Secrets are env-var references only |
| `instructions` | Section in a managed block of `AGENTS.md` / `CLAUDE.md` |
| `command` | External installer (BMAD-style tools, `uv tool install`…): the wizard asks to **run it now, show it, or skip**. `--yes` and `sync` only show it |

## Files in your project

- `.agentkit.yaml` — your choices (commit it).
- `.agentkit.lock.json` — resolved commits + hashes of everything written (commit it; `sync --frozen` reproduces it exactly).

Safety: files you edited (or that existed before) are never overwritten, managed blocks never touch text outside
their markers, MCP entries you configured yourself are left alone; `--force` overrides. Removing an item
removes what it installed, if unchanged.

## Adding a CLI or a catalog item

Edit YAML only:

- New CLI → `catalog/targets.yaml` (skills dir, instructions file, MCP file + format, agent field mapping, detection).
- New option → `catalog/catalog.yaml` (category, install steps, suggestion rules).
- Project-specific CLI → `targetDefinitions` in `.agentkit.yaml`.

Your own agents/skills repo follows `template/` (`skills/`, `agents/`, `instructions/`, optional `targets.yaml`).

## Development

```bash
npm install
npm test
node dist/src/cli.js --dry-run --cwd /some/project
```

## Releasing

Publishing runs in GitHub Actions via npm trusted publishing (OIDC, automatic provenance, no npm token stored).

```bash
npm version patch        # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags   # the tag triggers .github/workflows/publish.yml
```

The workflow fails if the tag does not match `package.json`, and `prepublishOnly` rebuilds and runs the tests before publishing.
