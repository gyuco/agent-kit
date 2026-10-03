# Pubblicare gyukit su npm

Tutti i comandi vanno lanciati **dentro la cartella del progetto**:

```bash
cd /Users/giuseppeconcas/workspace/my-workspace/agent-kit
```

## 1. Prima pubblicazione (una volta sola, a mano)

```bash
npm whoami                 # deve stampare: giuconcas  (altrimenti: npm login)
npm pack --dry-run         # controlla l'elenco dei file che verranno pubblicati
npm publish                # ricompila, lancia i test e pubblica; chiede il codice 2FA
```

Verifica:

```bash
npm view gyukit version
npx gyukit --help
```

Poi salva la rinomina su GitHub:

```bash
git add -A
git commit -m "Rename npm package to gyukit"
git push
```

## 2. Configurazione su npmjs.com (una volta sola)

Su https://www.npmjs.com/package/gyukit → **Settings**:

1. **Trusted Publisher → GitHub Actions**
   - Organization or user: `gyuco`
   - Repository: `agent-kit`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
2. **Publishing access** → *Require two-factor authentication and disallow tokens*

Da qui in poi si pubblica solo tramite GitHub Actions, senza token.

## 3. Rilasci successivi

```bash
npm version patch          # 0.1.1 → 0.1.2  (minor / major per cambi più grandi)
git push --follow-tags     # il tag vX.Y.Z avvia il workflow "Publish to npm"
```

Poi su GitHub → **Actions** → *Publish to npm* → **Review deployments** → approva.
Il workflow controlla che il tag corrisponda a `package.json`, ricompila, lancia i test e pubblica con provenance.

## Problemi comuni

| Errore | Causa | Soluzione |
|---|---|---|
| `ENOENT ... package.json` | comando lanciato fuori dalla cartella | `cd` nella cartella del progetto |
| `403 Package name too similar` | npm rifiuta nomi simili a pacchetti esistenti | scegliere un altro nome in `package.json` (`name` e `bin`) |
| `403 You cannot publish over the previously published versions` | versione già pubblicata | `npm version patch` e riprova |
| Workflow fermo su "Waiting" | serve la tua approvazione (environment `npm`) | Actions → Review deployments |
| Workflow fallisce con errore OIDC / 404 | trusted publisher non configurato o dati diversi | ricontrolla il punto 2 |

> Nota: il tag `v0.1.1` già presente su GitHub punta al commit con il vecchio nome `agent-kit` e non è mai stato pubblicato. Puoi ignorarlo: il primo rilascio automatico sarà `v0.1.2`.
