# lgboard — Roadmap

Documento vivo. Aggiornato 2026-07-28.

Tracking dei lavori in corso, idee per il futuro, decisioni che richiedono input
dell'utente. La versione canonica vive sul repo; modifiche via PR.

---

## Aggiornamento 2026-07-28: l'host è cambiato

lgboard non gira più sul mini-PC originale. Le sezioni datate 2026-04-25 qui
sotto restano come cronaca, ma dove parlano di "lgserver" intendono l'hardware
vecchio: i riferimenti operativi validi sono questi.

| | Prima (fino a luglio 2026) | Ora |
|---|---|---|
| Host dashboard | `lgserver`, AMD G-T44R, 1.6 GB RAM | `lgserver-new`, Intel i7-8550U 8 core, 7.6 GB RAM, Debian 13 |
| Indirizzo | 192.168.1.143 | 192.168.1.161, dashboard su `:8080` |
| Ruolo del vecchio host | tutto | solo server NFS (`/media/hdd1`, `/media/hdd2`) e agent stats |

Conseguenze pratiche:

- **Watchtower non è più deployato.** L'auto-pull notturno dell'immagine non
  esiste su lgserver-new: il container `dashboard` ha `restart: unless-stopped`
  e va aggiornato a mano. Questo invalida il piano del plugin Watchtower più
  sotto, che assumeva un Watchtower già attivo.
- **Gli alias di deploy puntano all'host sbagliato.** `lgboard-now` e
  `lgserver-now` nei dotfiles fanno ancora `ssh lgserver`: vanno ripuntati su
  `lgserver-new` prima di poterli usare.
- **Il vecchio host resta nella dashboard**, ma come host remoto: ci gira
  lgboard in `agentMode` (container `lgboard-agent`, porta 8077) che espone
  `/api/stats`, ed è registrato in `stats.remoteHosts` insieme al Mac.
- **Ollama diventa plausibile.** La stima pessimista più sotto era tarata su
  1.6 GB di RAM e un core. Con 8 core e 7.6 GB un modello 7-8B quantizzato gira
  su CPU, lento ma usabile; non c'è GPU discreta, quindi niente accelerazione.

Fatto da allora, oltre a quanto elencato sotto:

- ✅ Plugin `host-status`: panoramica salute host (mount NFS verificati come
  effettivamente leggibili, architettura dei binari) e pannello alert
  dell'aggregatore. Copre buona parte della voce "Notification center" del
  backlog.

---

## Stato attuale (2026-04-25, fine giornata)

### Done

- ✅ Repo pubblico `github.com/lglot/lgboard` (MIT) con CI GitHub Actions →
  `ghcr.io/lglot/lgboard:latest`
- ✅ Stats reali (CPU, RAM, disk, temperatura via `/sys/class/hwmon`,
  multi-disk, network sparkline)
- ✅ Health check vero — `internalUrl` bypassa SWAG/Authelia, container
  `exited` segnati `down` senza probe HTTP
- ✅ Auto-detect Docker — server matcha apps con container, popola
  `internalUrl` da solo (`server/discovery.py`)
- ✅ Pin / unpin servizi dalla GUI (`PATCH /api/apps/<id>` con whitelist
  campi: `fav, target, desc, icon, iconSvgPath, containerName`)
- ✅ Github mark in footer + rimosso da quickActions
- ✅ Cache‑bust automatico — server rimaschera `style.css?v=<ts>` e
  `components.jsx?v=<ts>` ad ogni boot, defeats Cloudflare edge
- ✅ Sistema plugin (server + frontend loader, `/api/plugins`, `/_p/<id>/<file>`)
- ✅ `PLUGINS.md` — spec manifest, permessi, registry community
- ✅ Plugin store modal (lista installati + community placeholder)
- ✅ SSH plugin **scaffold** (server + UI + manifest), bottone Shell sui tile
  Docker, modal con iframe a sessione effimera
- ✅ Pipeline auto-deploy:
  - Mac: `~/code/homelab/lgboard`, `~/code/homelab/home_server`
  - GH: lgboard pubblico → GHCR; home_server privato (force-pushed in sync)
  - lgserver: `image: ghcr.io/lglot/lgboard:latest`, `pull_policy: always`,
    Watchtower nightly per auto-pull *(superato: vedi aggiornamento in testa)*
  - Override istantaneo: alias `lgboard-now`, `lgserver-now`, `lgboard-build`
    *(i primi due puntano ancora al vecchio host)*
- ✅ Memoria Claude `feedback_deploy_workflow.md` — Claude esegue deploy
  autonomamente
- ✅ SWAG conf per ttyd (`/_p/ssh/<sid>/` → `lgboard-ttyd-<sid>:7681`),
  authelia-location.conf incluso, WebSocket OK

### In flight

- ⚠️ **SSH plugin end-to-end** — manca permission Docker socket RW per
  spawnare container ttyd effimeri. Vedi [Decisione 1](#decisione-1--ssh-plugin-docker-socket).

### Pianificato

- 📋 [Watchtower plugin](#plugin-watchtower)
- 📋 [AI plugin (`concierge`)](#plugin-ai--concierge)
- 📋 Plugin install via UI (oggi solo lettura registry)
- 📋 Permission UI per concedere capability dal Tweaks panel

---

## Decisione 1 — SSH plugin Docker socket

Per spawnare container ttyd effimeri il plugin chiama
`POST /containers/create`. Oggi lgboard monta `/var/run/docker.sock:ro` — il
create fallisce silenziosamente. Servono privilegi elevati.

### Opzione A — `docker.sock:rw` su dashboard

- Bassa complessità, una riga di compose
- **Rischio**: chiunque exploiti l'app HTTP ha host root via Docker API
- Mitigazione: lgboard è dietro Authelia + Cloudflare Tunnel (no port forward)
- Verdetto: accettabile per single-user homelab, **NO** per multi-tenant

### Opzione B — `tecnativa/docker-socket-proxy`

- Container intermedio che filtra le call Docker. lgboard punta a
  `tcp://socket-proxy:2375`
- Env tipo:
  ```
  CONTAINERS=1   # GET /containers/json
  EXEC=1         # exec into running containers
  POST=1         # need POST /containers/create per ttyd ephemeri
  DELETE=1       # cleanup ttyd su sessione chiusa
  ```
- Pro: superficie API ridotta del ~70%, surface attack ridotta nettamente
- Con: non blocca completamente — `POST + EXEC` insieme è ancora root host
  via via diversa
- Verdetto: **consigliato**. È il pattern Portainer/Yacht/Dockge.

### Opzione C — Skippare ephemeral spawn

- ttyd "long-running", una sola istanza, multiplexing per tab? `gotty` lo fa
  ma poi serve auth per-sessione lato app
- Complessità maggiore, gain marginale

**Mio voto**: **B**. Aggiungo servizio compose `socket-proxy`, plugin punta a
`tcp://socket-proxy:2375`. Setup ~15 min.

**Domanda per Luigi**: vai con B?

---

## Plugin: Watchtower

### Scope

Tile-action "Aggiorna ora" su ogni servizio Docker, più tab `/_p/watchtower`
per overview e force-update.

### Tecnica

> ⚠️ Premessa non più valida dopo la migrazione: su lgserver-new Watchtower non
> è deployato. Prima di questo piano va deciso se reintrodurlo o se sostituire
> il plugin con un semplice "pull e ricrea" via Docker API.

- Watchtower è già up. HTTP API NON abilitata.
- Per abilitarla: env `WATCHTOWER_HTTP_API_UPDATE=true` + token
  `WATCHTOWER_HTTP_API_TOKEN=<secret>`
- Endpoint: `POST http://watchtower:8080/v1/update` con `Authorization: Bearer`
- Plugin proxy: `POST /api/_p/watchtower/update` ⇒ chiamata interna a
  Watchtower con token leggi da `/config/plugins/watchtower/secret`
- Per per-container update: passare `Containers-Header` con CSV

### UI

- Tile action: bottone refresh con tooltip "Cerca nuova immagine"
- Tab dedicato: tabella container monitorati, colonne `image · last update ·
  digest hash · azioni`
- Force-update globale + per-container

### Permission

- `network.fetch` solo verso `watchtower:8080`
- `config.write` per persist token

### Output Gotify

- Watchtower già notifica via Gotify. Mostriamo le ultime 20 notifiche
  via `GET https://lgser.me/gotify/message?limit=20` (con Gotify app token)
- Pannello "Recent updates" sopra la tabella

**Tempo stimato**: 1.5h. Niente privilegi nuovi se Gotify token già esiste.

---

## Plugin: AI / `concierge`

### Naming

Tre proposte (puoi scegliere o dire la tua):

- **`concierge`** — vibe da maggiordomo del homelab, sincero al lavoro
- **`atlas`** — porta il peso dell'infra
- **`oracle`** — guarda la macchina e risponde

Personalmente: **`concierge`**. Suggerisce conversazione, non veggenza.

### Scope: chat con backend pluggabile

Plugin che apre un pannello di chat a destra (o tab dedicato `/_p/concierge`).
La conversazione è testuale, markdown-rendered. Il backend è pluggabile via
config: tu scegli **uno solo per volta**, plugin agnostico.

### Backend supportati

| Backend       | Descrizione                                             | Auth        |
|---------------|---------------------------------------------------------|-------------|
| `ollama`      | LLM locale (Ollama HTTP API a `http://ollama:11434`)    | nessuna     |
| `openai`      | OpenAI / compatible (`/v1/chat/completions`)            | API key     |
| `gemini`      | Google Generative Language API                          | API key     |
| `anthropic`   | Claude via Messages API                                 | API key     |
| `openclaw`    | Gateway a OpenClaw — `concierge` come canale aggiuntivo | shared key  |

Config (in `/config/plugins/concierge/config.json`):

```jsonc
{
  "backend": "openai",
  "providers": {
    "openai":   { "apiKey": "sk-...", "model": "gpt-4.1-mini", "baseUrl": "https://api.openai.com/v1" },
    "gemini":   { "apiKey": "...",    "model": "gemini-1.5-pro" },
    "anthropic":{ "apiKey": "...",    "model": "claude-sonnet-4-6" },
    "ollama":   { "baseUrl": "http://ollama:11434", "model": "llama3.1:8b" },
    "openclaw": { "baseUrl": "http://openclaw-host/api/channels/concierge", "sharedKey": "..." }
  },
  "agentic": false,
  "agenticAllowedTools": ["read.stats", "read.logs", "containers.list"]
}
```

### Modalità

#### 1) Read-only chat (default)

Risponde a domande sullo stato del server. La risposta è solo testo, nessuna
azione. Esempi:

- "Quanti container running ci sono?"
- "Mostra l'uso CPU degli ultimi 5 minuti"
- "Qual è il container che sta consumando più RAM?"

Implementazione: il plugin `concierge` espone al modello un set di **tool** in
sola lettura (e.g. `get_stats`, `list_containers`, `get_health`,
`get_disk_usage`). Il modello chiama il tool, plugin esegue, risposta torna in
chat. Nessuna mutazione.

#### 2) Agentic (opt-in, gated)

Tool che mutano:

- `restart_container(name)` — ma solo containers in `agenticAllowedContainers`
- `update_container(name)` — chiama Watchtower plugin
- `add_app_to_dashboard(spec)` — POST `/api/apps`
- `pin_app(id, fav)` — PATCH `/api/apps/<id>`

**Sicurezza**:

- Whitelist tool in config
- Whitelist container in config (no Authelia, no SWAG, no dashboard stesso)
- **Conferma utente prima di esecuzione** — UI mostra pulsante "Esegui" che
  l'utente conferma manualmente (no auto-exec dalla risposta del modello)
- Audit log: ogni chiamata tool scritta in `/config/plugins/concierge/audit.jsonl`
- Rate limit: max 30 tool call / 5 min

### Streaming

Python stdlib `http.server` non gestisce gracefully le risposte streaming
lunghe via SSE. Tre opzioni:

- **A)** Risposta non streaming — comoda, perde la "live typing". Per chat
  brevi (sotto i 1k token) è OK.
- **B)** Chunked Transfer-Encoding — `wfile.write(chunk)` + flush. Funziona
  con `http.server` ma fragile su client mobili.
- **C)** Server-Sent Events (SSE) — keepalive lungo, perfetto per LLM.
  Richiede thread dedicato con socket leak-proof. Fattibile ma fa ~80 righe.

**Mio voto**: A per MVP, C poi quando il flusso diventa "noioso da aspettare"
(modelli da 8k token in su).

### Frontend

Pannello laterale o tab dedicato. Markdown renderer (KaTeX e tabelle no, troppo
peso). Cronologia conversazione persiste in localStorage `concierge.history`,
clear con bottone.

UI components:
- Chat window (messaggi user / assistant)
- Composer con auto-grow textarea, Cmd+Enter invia
- Tool call expanding panel (vedi cosa il modello ha chiesto)
- Backend selector (drop-down) con stato "configurato / mancante API key"

### `openclaw` come canale

Se vuoi che `concierge` sia "telegrm/slack-like" per OpenClaw, l'integrazione
è trasparente: OpenClaw espone già un'API per canali (`telegram`, `slack`,
`webchat`). Aggiungi un canale `lgboard-concierge` che riceve POST e mette
nel queue per agente. La risposta torna via webhook al plugin.

**Trade-off OpenClaw vs LLM diretto**:
- OpenClaw: ti dà già knowledge della tua infra (rubrica Slack, Jira, Gmail
  via tool). Riconosce te.
- LLM diretto: più veloce, meno integrato.

**Soluzione finale**: plugin agnostico con `openclaw` come **uno** dei backend.
Quando `backend: "openclaw"` Claude/lgboard plugin chiama il canale OpenClaw
e visualizza la risposta nel pannello chat. Stesso UX degli altri backend.

### Problemi noti / risk

- **API key in config.json**: file system permission 600 + warning UI se
  `/config/plugins/concierge/config.json` è leggibile da gruppo. No
  encryption-at-rest (key derivation root: serve master password che lgboard
  oggi non ha)
- **Costo**: `openai`/`gemini`/`anthropic` sono pay-per-token. Plugin mostra
  spesa ultime 24h se il provider espone usage API
- **Latenza Ollama locale**: dipende dal modello. Su lgserver-new (i7-8550U,
  8 core, 7.6 GB, nessuna GPU discreta) un 7-8B quantizzato gira su CPU, lento
  ma usabile; sotto i 3B è comodo. La stima originale (`1B-3B` al massimo,
  ~3-5 tok/s) era tarata sul vecchio host da 1.6 GB e va rifatta misurando
- **Agentic mode + container Authelia**: anche con whitelist, una mutate
  call richiede `apps.write` (per add/pin) o accesso Watchtower (per update).
  Permission cascading.

### Tempo stimato

MVP read-only (un solo backend, niente streaming, niente tools): **3-4h**.
Pieno (4 backend, streaming SSE, agentic con confirma + audit log): **1.5gg**.

---

## Backlog ulteriore (idee future, non priorità)

- **Backup plugin** — restic/borgbackup status + trigger backup
- **Logs viewer** — esiste Dozzle ma un tab "Last 100 lines per service"
  utile da dashboard
- **Metrics history** — mini timeseries store SQLite, sparkline 24h per
  servizio
- **Notification center** — aggrega Gotify + healthcheck transitions
- **Mobile-first iter** — l'attuale 3-col stats su iPhone è stretto
- **Public registry primo plugin** — pubblica `concierge` come template che
  altri possono forkare

---

## Domande aperte (richieste a Luigi)

1. **SSH plugin permesso Docker** → A (sock RW) / **B (socket-proxy)** / C (skip)?
2. **Watchtower plugin** → faccio adesso (1.5h) o schedulo per altra sessione?
3. **AI plugin** → nome **`concierge`** OK? Quale backend MVP per primo
   (ollama / openai / openclaw / altro)? Modalità **read-only** (sicuro) o
   **agentic** (richiede conferme per ogni tool, più infra)?
4. **Plugin install dalla UI** → ci tieni? Oppure for-now manuale via `git
   clone` in `/config/plugins/`?
5. **Streaming chat** → A (full-response) o C (SSE) per `concierge`?

---

## Note operative

- Aggiornare questo file ogni volta che si decide qualcosa di non-banale.
- Le decisioni che richiedono cambiamenti di superficie (sicurezza, layout
  config) vivono qui finché non vengono "promosse" a `PLUGINS.md` o a
  `README.md`.
- Quando un plugin nasce, eredita una sua sottosezione qui per il primo ciclo,
  poi si splittano nei rispettivi README.
