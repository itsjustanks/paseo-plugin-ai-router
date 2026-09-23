# AI Router — Paseo plugin

Routes the agents a Paseo daemon launches through one OmniRoute endpoint. It keeps an "AI Router"
provider in Paseo with every model of your connected accounts (Claude and GPT), can add a "Codex via
OmniRoute" provider, and shows the router's accounts, usage and settings to whoever holds the keys for
them. It only reads what OmniRoute already counts: no pricing tables, no local usage store. Advanced
routing (combos, fallbacks, per-provider rules) stays in OmniRoute's dashboard. It also puts a
**context badge** on every chat: how full its context window is, and what fills it.

## Install and update

No build step. The daemon compiles the TypeScript itself and supplies the SDK, React, React Native,
TanStack Query and Zod, so the plugin directory needs no `node_modules`.

```sh
# on the daemon's machine (inside the container, for a Docker daemon)
paseo plugin install git:https://github.com/itsjustanks/paseo-plugin-ai-router.git:apps/paseo
paseo plugin ls                    # expect ai-router: running
paseo plugin update ai-router      # later: review and apply a new version (--yes to skip the prompt)
```

A local checkout works too: `paseo plugin install /absolute/path/to/paseo-plugin-ai-router:apps/paseo`
(a directory install runs in place, so keep the copy there). Plugins must be enabled on the daemon
(`pluginsEnabled` in its `config.json`). Requires Paseo 0.8 or later; checked against Paseo 0.9.1.

For a fleet, give every daemon the connection through the environment and nothing else is needed:

```sh
AI_ROUTER_URL=http://10.0.0.5:20128   AI_ROUTER_KEY=sk-…   # one key per daemon, named after it
AI_ROUTER_CONSOLE_URL=https://ai-router.example.com         # optional: the public address (custom domain)
```

## The panel

Nine tabs in one row; at narrow widths each shows its icon and the active one its name too. Tabs
that need more access than the daemon has are not shown, and one small line says what a read token or
manage key would add.

| Tab | What it holds |
| --- | --- |
| **Overview** | Router up, down or paused; Claude routing; models in Paseo; this daemon's access; the last agent; open dashboard, sync models, routing on or off. When the router is unreachable: when it was last seen, the error, and **Open Connection**. At the bottom, **Check out MCP** (the sister plugin; "Installed" when this daemon has it; **Hide**). |
| **Activity** | What went through the router. **Agent sessions on this daemon** (every tier): each start or resume, routed or not and why, with Paseo's agent title. **Requests through the router** (read token): each request with its time, status, requested → served model, provider and account, latency, tokens, combo or fallback, daemon and the Paseo agent that sent it; filters for this daemon or all, errors only, a model or a provider; tap a row for why OmniRoute routed it there. Refreshes every 10 seconds while open. See [Activity](#activity). |
| **Models** | **Your access** (this key's name, its spend against its limit, the quota of the accounts it may use); **Combos as agent profiles** (a switch, on by default, and the profiles kept in Paseo); the synced models by provider, OmniRoute's combos first, with a **Test** on each; and a test for any other model id. |
| **Providers** | Every Paseo provider on this daemon with its status and an enabled switch, and what OmniRoute can do for it: Claude's routing switch, **Codex via OmniRoute**, or "not supported". **Tidy up** turns off Paseo's own providers that cannot run here, after showing the list. |
| **Accounts** | Each OmniRoute account: health, quota, cooldowns, the last 24 hours, sign-in expiry, and the router's health strip. With a manage key: **Check now**, **Check all**, **Refresh token**. **Re-login** and **Add account** open the dashboard. |
| **Usage** | **Usage & analytics** for 24 hours, 7 days or 30 days: requests, tokens, estimated cost and latency; requests per day; tokens per day stacked by provider; the provider split; top models; by daemon and by account; failed requests by kind; a year of activity. |
| **Settings** | Every tier: **In Paseo**, the context badge and MCP card switches. With a read token: context compression in plain words, with the setting to use for coding agents; circuit breakers, bare-name routing and the routing strategy; **More in OmniRoute**. |
| **Connection** | Router, endpoint, **public address** and whether it answers, key, where they come from; **Share this router** (how others connect through the public address, never with a key); the read token and manage key; the dashboard address with the SSH help; with a manage key, OmniRoute's tunnels. The setup lives here, and the panel opens on it until a router is set up. |
| **Tips** | **Recommended plugins** from [Paseo Cafe](https://paseo.cafe/plugins/): Paseo MCP, Shared Browser, Activity, Advanced Markdown, Remote Editor and Tell Agent, each with its Cafe page and the install command Cafe publishes, or "Installed". |

The plugin never stores, shows or asks for OmniRoute's admin password. The panel says "Dashboard
login: ask your router admin" where it matters.

## Access tiers

The endpoint is shared by many people and agents, so what the panel shows follows the credentials
this daemon holds, and a key never sees another key's data.

| Feature | Basic: endpoint + API key | Operator: + read token | Admin: + manage key |
| --- | --- | --- | --- |
| Routing Claude and the AI Router provider, the hook | yes | yes | yes |
| Router up/down and latency | `GET /api/health/ping` (public) | same | same |
| Public address status | `GET <public address>/api/health/ping` (public, no credentials sent) | same | same |
| Activity: agent sessions on this daemon | yes (this daemon's own hook; no router call) | yes | yes |
| Activity: requests | — | `GET /api/usage/call-logs`, `GET /api/keys` | same |
| Activity: why a request went where it did | — | `GET /api/routing/decisions/{callLogId}` | same |
| Version, uptime, paused providers | — | `GET /api/monitoring/health` | same |
| Model list for the AI Router provider | `GET /v1/models?configuredOnly=true` (OmniRoute limits it to active accounts and the key's allowed models) | `GET /v1/models` filtered by active accounts in `GET /api/providers` | same |
| Test a model | `POST /v1/messages` | same | same |
| Your access (this key only) | `GET /v1/me/status` (needs the key's `self:usage` scope, which OmniRoute gives new keys) | same | same |
| Providers tab, Codex via OmniRoute, Tidy up | yes (Paseo's own API; models from the list above) | yes | yes |
| Accounts: health, quota, cooldowns, expiry | — | `GET /api/providers`, `/api/rate-limits`, `/api/usage/provider-limits`, `/api/providers/health-matrix`, `/api/providers/expiration`, `/api/provider-stats`, `/api/monitoring/health` | same |
| Usage & analytics, all keys | — | `GET /api/usage/analytics?range=1d`, `7d` or `30d`, `GET /api/keys` | same |
| Combo descriptions for profiles | `GET /v1/models` (custom combos' own descriptions) | `GET /api/combos/auto`, `GET /api/combos` | same |
| Router settings, read | — | `GET /api/settings`, `/api/context/combos/default`, `/api/analytics/compression`, `/api/resilience`, `/api/resilience/model-cooldowns`, `/api/combos/auto` | same |
| Settings changes, breaker reset | — | — | `PUT /api/settings/compression`, `PATCH /api/settings`, `POST /api/resilience/reset` |
| Apply recommended compression | — | — | `GET` then `PUT /api/settings/compression` |
| Account actions | — | — | `POST /api/providers/{id}/test`, `/api/providers/{id}/refresh`, `/api/providers/test-batch` |
| Tunnels | — | — | `GET /api/tunnels/{cloudflared,ngrok,tailscale}`, `POST /api/tunnels/{cloudflared,ngrok}`, `POST /api/tunnels/tailscale/{enable,disable}` |
| Context badge: the chip, and the breakdown's estimates | yes (Paseo's own agent updates and the chat's timeline, read on this daemon; no router call) | yes | yes |
| Context badge: what OmniRoute measured for the chat | — | `GET /api/usage/call-logs?limit=201&excludeTests=1&apiKey=<this key>`, rows matched by session tag | same |
| Tips and the MCP card: "Installed" | yes (`$PASEO_HOME/plugins/sources.json`) | yes | yes |

A manage key can also read, so an admin needs no separate read token. OmniRoute refuses read tokens
on its tunnel routes; they need a key with the `manage` scope. **Refresh token** uses
`/api/providers/{id}/refresh` (OmniRoute's `/refresh-token` only handles Kimi); for Codex OmniRoute
answers "skipped" on purpose, because refreshing one Codex account by hand can revoke its siblings.

## Keeping the AI Router provider current

Paseo 0.9's plugin SDK has `registerProvider`, but it wants a whole agent runtime (sessions, prompts,
tool calls, a timeline), not a Claude-derived provider with a model list; a plugin cannot say "extends
claude". Registering natively would mean re-implementing Claude Code's runtime, and existing
`ai-router` agents could no longer be resumed. So "AI Router" stays a provider entry in Paseo's config
(`agents.providers["ai-router"]`, same id as before), and the plugin keeps it current by itself:

- **At plugin load**, with no Paseo handle yet: it compares the entry with OmniRoute's current model
  list, writes `$PASEO_HOME/config.json` if they differ (only its own entries; the file must parse as
  a daemon config and not have changed meanwhile; its mode is kept) and runs `paseo daemon reload`,
  which is how Paseo applies an edited config without a restart. User-made entries are never touched.
- **When the Paseo app connects to the daemon**, panel open or not: the client contribution calls
  `ai-router.ensure`, which checks again through Paseo's own config API.
- **Every 5 minutes** after that, and on every RPC or hook. The model list is cached for 4 minutes;
  an entry is written only when something changed, so new models and providers appear by themselves.

It logs `[ai-router] synced N models (Claude X · Codex Y)` or why it skipped. A provider removed in
the panel is not put back until **Sync models to Paseo** is pressed. The real key is added at launch;
the entry holds only a placeholder.

The entry follows the 9router plugin's shape: `extends: "claude"`, owning its whole model list, because
OmniRoute translates the Anthropic Messages API for every provider it serves.

```json
{ "extends": "claude", "label": "AI Router",
  "env": { "ANTHROPIC_BASE_URL": "<endpoint>", "ANTHROPIC_AUTH_TOKEN": "set-at-launch-by-ai-router",
           "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1" },
  "models": [{ "id": "cc/claude-sonnet-5", "label": "Claude · Sonnet 5", "isDefault": true },
             { "id": "cx/gpt-6-sol", "label": "Codex · GPT-6 Sol" }, "…"] }
```

If an older OmniRoute ignores `?configuredOnly=true` for a plain key (hundreds of models come back),
the sync refuses rather than list them all, and says to add a read token or update OmniRoute.

## Combos as agent profiles

Each OmniRoute combo in the AI Router model list (the dashboard's auto and custom combos with a read
token; the core auto combos without one) becomes a Paseo agent profile, so it can be picked directly
when starting an agent:

```json
{ "id": "ai-router:auto/coding", "name": "Auto · coding", "icon": "code", "color": "blue",
  "provider": "ai-router", "model": "auto/coding",
  "notes": "OmniRoute auto combo \"auto/coding\": Quality-first for code. Picks from Codex, Claude. …" }
```

The notes are OmniRoute's own description: its wording for the auto variants, and a custom combo's
description, display name, model count and strategy. Paseo's `list_profiles` MCP tool shows them to
orchestrating agents. Profiles sync through the same channels as the provider: at plugin load (into
`config.json`, then `paseo daemon reload`), through `config.patch` when the app connects, and every
5 minutes. Rules:

- Only profiles whose id starts with `ai-router:` are ever added, updated or removed. Everyone else's
  profiles are passed back exactly as they were. On our own profiles only `name`, `provider`, `model`
  and `notes` are set, so an icon, colour or effort a person chose in Paseo survives.
- A combo that disappears takes its profile with it; removing the AI Router provider removes them all.
- In `config.json` Paseo keeps profiles at **`daemon.agentProfiles`** (Paseo 0.9.1's
  `persisted-config.js`: `agentProfiles` is a field of the strict `daemon` object). The config API
  shows the same list as a top-level `agentProfiles`. The plugin writes the file path, never a
  top-level key, which the strict schema would reject.
- **Show combos as agent profiles** on the Models tab (host-wide, on by default) turns them off and on.

## Routing

The `agent.session_open` hook only edits the launch environment.

| Session | Rewritten when | Environment added |
| --- | --- | --- |
| Built-in `claude` provider | routing is on | `ANTHROPIC_BASE_URL=<endpoint>` (no `/v1`), `ANTHROPIC_AUTH_TOKEN=<key>`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, and `x-omniroute-session-id: paseo-<agent id>` added to `ANTHROPIC_CUSTOM_HEADERS` |
| `ai-router` provider | always (choosing it is the opt-in) | the same |
| `codex-ai-router` ("Codex via OmniRoute") | always, while its entry points at the endpoint | `OPENAI_API_KEY=<key>` |
| `ai-router-codex` (0.1.0, legacy; syncing removes it) | the same | `OPENAI_API_KEY=<key>` |
| Anything else, including built-in `codex` | never | — |

A session is rewritten only when the connection has an endpoint and a key and its health check passed
within the last 30 seconds (otherwise it pings first, 4 s timeout). If not, a built-in Claude session is
left exactly as Paseo built it and keeps its normal sign-in. The router's own providers have no other
way to work, so they fail to open with the reason instead of reaching OmniRoute without a key (loading
an old agent's history is never blocked). Either way the reason is logged (`paseo plugin logs
ai-router`) and shown in the panel, e.g.
`routing skipped for claude session <id> (create): no API key set for http://10.0.0.5:20128`.

`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`: OmniRoute replaces Claude Code's `anthropic-beta` header
with its own list, and without the per-turn-control beta Claude Code 2.1.280's per-turn effort is
refused with 400 "messages.1.output_config: Extra inputs are not permitted".

`ANTHROPIC_CUSTOM_HEADERS` holds newline-separated `Name: value` lines that Claude Code sends with
every request. The hook keeps any lines already there and adds `x-omniroute-session-id`, unless one is
already set; OmniRoute records it as the request's `sessionTag`, which is how Activity names the agent
behind each request exactly. It carries only the Paseo agent id.

**Codex via OmniRoute.** Built-in Codex builds its model provider from config, not from launch env,
and most daemons have no Codex login. The Providers tab adds `codex-ai-router`:
`extends: "codex"`, `env.OPENAI_BASE_URL = <endpoint>/v1` and a placeholder `OPENAI_API_KEY`, with the
Codex accounts' models (`cx/…`). Paseo turns such an entry into a Codex `model_provider` with
`wire_api = "responses"` that reads its key from `OPENAI_API_KEY` instead of a ChatGPT login; the hook
puts the real key there at launch. The auto-sync keeps it pointed at the endpoint while it exists.

**Model names.** Paseo passes Claude Code bare ids such as `claude-sonnet-5` on the built-in `claude`
provider. OmniRoute resolves a bare id to the first active provider that serves it; if both `cc/` and
`claude/` are connected, turn on **Prefer Claude Code for unprefixed Claude models** (Settings tab).

## Context compression

The Settings tab explains each OmniRoute engine in plain words, flags the ones that are on and can
hurt agents, and recommends, for Claude Code and Codex agents, **Lite only, with Codex models
excluded**:

- Agents send the whole conversation every turn and rely on prompt caching. Lite is deterministic,
  so the cached part stays identical; Caveman, Aggressive, Ultra, Relevance and LLMLingua rewrite,
  age or drop content, which changes it every turn and can hide a failing test or an earlier instruction.
- Lite leaves Claude Code's tool results alone, but it cuts OpenAI-style tool output after 2,000
  characters (`OMNIROUTE_LITE_MAX_TOOL_LENGTH`), which reaches Codex shell output. Excluding `cx/*`
  and `codex/*` keeps Codex requests byte for byte.

Sources: OmniRoute's `docs/compression/*`, `open-sse/services/compression/engineCatalog.ts`, `lite.ts`
and `bodyAdapter.ts`. **Apply recommended…** (manage key, after a confirmation) sets Lite on and every
other engine off, and adds the exclusions when the router's compression settings support them. It is
never applied on its own.

## Activity

**Agent sessions on this daemon**, for every tier: each time an agent starts or resumes, the hook
records the agent id, the provider, whether it was routed, and if not, why. The last 200 are kept in
`$PASEO_HOME/plugin-settings/ai-router/sessions.json` (mode 0600; no keys, no content), so they
survive a restart. Titles come from Paseo's `agents.list`.

**Requests through the router**, with a read token, from OmniRoute's call log:

- `GET /api/usage/call-logs?limit=<n+1>&excludeTests=1`, plus `apiKey=<this key's id>` for "This
  daemon", `status=error` for "Errors only", and `model=` or `provider=` for a filter chip. OmniRoute
  matches these as substrings. `excludeTests=1` keeps only real `/v1` traffic. Pages are 25 rows, up
  to 200, and one extra row says whether there are older ones.
- Fields read from each row: `id`, `timestamp`, `status`, `requestedModel`, `model`, `provider`,
  `providerDisplay`, `account` (shown masked), `duration`, `tokens.in` and `tokens.out`, `apiKeyId`,
  `apiKeyName`, `comboName`, `error` (cut to 240 characters) and `sessionTag`. Nothing else is read.
  A row is a **fallback** when it was not a combo and the model served is not the one asked for
  (`cc/claude-sonnet-5` and `claude-sonnet-5` count as the same model).
- `GET /api/keys` finds this daemon's key (by its masked form) for "This daemon" and the
  "this daemon" mark.
- Tapping a row reads `GET /api/routing/decisions/{id}`, keeping only `summary`, `routeType`,
  `confidence`, `comboUsed`, `providerSelected`, `modelUsed`, `selectedTarget.account` (masked),
  `decision.factors` (name, value, status, details; at most 8), `decision.fallbacksTriggered`
  (provider, model, status, reason, time; at most 8) and `limitations`.
- Prompts and responses are never read or shown. `/api/usage/call-logs/{id}` is not used, because it
  returns the request and response bodies.

**Which agent sent it.** Claude sessions (built-in Claude while routing is on, and the AI Router
provider) send `x-omniroute-session-id: paseo-<agent id>`, so those rows name their agent exactly.
Codex via OmniRoute cannot carry a header (Paseo builds its model provider), so its rows are matched
as **likely**: this daemon's key, the agent whose model matches, and the most recent routed session
that opened before the request. Other daemons' requests are never matched.

## Context badge

Every chat that has reported its context window gets a chip beside its message box: **186k / 1M**,
grey until 60 % full, amber until 85 %, then red with a warning icon (so colour is not the only
signal). Tap it for the **Context** panel; the command palette's "Context used in this chat" opens it
too. **Settings → In Paseo** turns the badge off and on for the daemon (on by default, every tier).

What it can honestly say:

- **The total is exact.** It is `lastUsage.contextWindowUsedTokens` / `contextWindowMaxTokens`, which
  the agent's own CLI reports after each turn and Paseo keeps on the agent.
- **The parts are estimates (≈).** The panel asks the daemon (`ai-router.context`), which reads the
  chat's timeline newest first and counts about 4 characters per token, grouped as files read, command
  output, MCP tool results (by server), web pages and searches, code searches, edits and new files,
  sub-agent reports, other tool calls, your messages and agent replies, each with its biggest few
  names. Names are file paths, program names (`npm`, never a command's arguments), tool names, MCP
  server names, sites' hosts and sub-agent types: never a command line, a query, a URL's path or a
  description, which can carry a key or a prompt. It stops at the last compaction: what came before
  was summarised away. Thinking, Paseo's own worktree setup and plugin items are not counted. If the
  timeline changes while it is read (the agent reloaded), the count starts over once.
- **The rest** is the exact total minus those estimates: what never shows in the timeline, i.e. the
  system prompt, tool definitions (including every MCP server's tools), CLAUDE.md or AGENTS.md, and
  after a compaction its summary.
- **With a read token**, for chats whose requests carry the session tag, OmniRoute's call log gives the
  chat's first and latest request sizes (`tokens.in` counts cached input too). While no compaction has
  replaced the start (and the count reached it), the first request, less its first message (already
  counted under your messages), is shown as the start, **measured**, and whatever is still
  unexplained gets its own line, "Not in the chat's history" (images, attachments, tool output Paseo
  keeps shorter than the agent saw). Only this daemon's latest 200 requests are read, so on a busy
  daemon a long chat's first request may be out of reach; the panel says so.
- One tip for the biggest part, e.g. "turn off MCP servers this chat doesn't use" or "compact the chat
  (/compact)", and a warning once the window is nearly full.

What it costs: the chip makes no call at all; it reads the agent updates the app already receives.
The switch is read once a minute while a chat is open (backing off to 15 minutes if the daemon does not
answer). The breakdown is worked out only when the panel is open, on the daemon (at most 10 pages of
200 timeline entries; only a small summary crosses to the app, never the chat's text), and reused
while the chat's total is unchanged (up to 5 minutes). A failed read backs off from 30 seconds to 10
minutes unless **Refresh** is pressed; an answer whose router read failed is reused for 30 seconds
only. At most one switch read is ever out at a time.

## Public address and dashboard access

OmniRoute can have a **public address** (custom domain), such as `https://ai-router.example.com`.
The daemons keep using the private endpoint; people and browsers outside the network use the public
address. It is set on the Connection tab (**Public address (custom domain)**) or with
`AI_ROUTER_CONSOLE_URL`, under the same precedence as the rest of the connection, and stored without
a trailing `/dashboard`.

The Connection tab checks it with `GET <public address>/api/health/ping` (4 s, no credentials,
re-checked after a minute or on **Check now**) and says what it found: "HTTPS OK · host", or
"DNS not pointing here yet", "Certificate not issued yet", "Certificate is for another name",
"Certificate expired", "Not serving HTTPS on this address", "HTTPS works, but OmniRoute behind it is
not answering (502)", "Answers, but not as OmniRoute" or "Unreachable".

**Share this router** (every tier) shows how someone else connects through the public address, with
`<your key>` in place of a key (each person or machine should get its own):

- Claude Code: `ANTHROPIC_BASE_URL=<public address>`, `ANTHROPIC_AUTH_TOKEN=<your key>` and
  `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` (see [Routing](#routing) for why).
- Codex and other OpenAI-compatible tools: `<public address>/v1`, with a `~/.codex/config.toml` block.
- Another Paseo daemon: install this plugin from GitHub, then use the public address as its endpoint.

"Open dashboard" uses, in order: the public address when its check passed ("via custom domain"), a
running OmniRoute tunnel an admin's manage key can see, then `<endpoint>/dashboard`. A tunnel host
(`*.trycloudflare.com`, `*.ngrok-free.app`, `*.ts.net`) shows "via Cloudflare tunnel" and similar.
Admins can start and stop OmniRoute's Cloudflare, ngrok and Tailscale tunnels on the Connection tab
("makes the dashboard reachable from the internet; its login is still required") and save a running
tunnel's address as this daemon's public address. For every daemon to use it, set it as
`AI_ROUTER_CONSOLE_URL` there.

If the dashboard is on a private network (10.x, 172.16–31.x, 192.168.x, 127.x, 100.64/10, `.local`,
single-label names), the panel shows an SSH forward built from the **SSH target** setting:

```sh
ssh -N -L 20128:127.0.0.1:20128 -L 1455:127.0.0.1:1455 root@<router-host>
```

Port 1455 is Codex's sign-in callback. Daemon Link users can do the same with **Connect → Saved SSH
forward** (router host, remote port 20128).

## When the router is down

The panel opens at once whatever the router does. The status call waits at most 1.5 s for a health
check, then answers with the previous result marked "checking"; every router request has a timeout
(4 s for health, 10 s for reads). Once a check has found the router down, the Activity, Accounts, Usage and
Settings tabs answer immediately with their last good answer, marked "Router unreachable — showing its
answer as of HH:MM", or with the error if there is none. The Overview says when the router was last
seen (kept across restarts) and offers **Open Connection**, where the health check, editing the
endpoint and keys, Test & save and Disconnect all work without the router.

## Configuration and precedence

| Source | Where | Notes |
| --- | --- | --- |
| Saved plugin settings | `$PASEO_HOME/plugin-settings/ai-router/connection.json` (mode 0600) | Written by **Test & save** only. Wins outright. Holds the router type, endpoint, public address, key, read token and manage key. |
| Environment | `AI_ROUTER_URL`, `AI_ROUTER_KEY`, `AI_ROUTER_TOKEN`, `AI_ROUTER_CONSOLE_URL` (the public address) | Used only when nothing is saved. Seeds the connection for fleet installs. |
| Defaults | none | There is no default endpoint. |

- Precedence is per record, not per field: once a connection is saved, the `AI_ROUTER_*` variables are
  ignored entirely, so an env key never pairs with a saved endpoint. **Disconnect** removes the saved
  file and the environment applies again.
- `AI_ROUTER_KEY`, `_TOKEN` and `_CONSOLE_URL` without `AI_ROUTER_URL` are ignored, with a warning.
- A saved file or `AI_ROUTER_URL` that is present but broken blocks routing. It never falls through to
  another source or to localhost.
- The environment never supplies a manage key and never turns routing on. `routeAgents` lives in the
  Paseo settings document `$PASEO_HOME/plugin-settings/ai-router/routing.json` and defaults to off.
  The same document holds `comboProfiles`, `contextBadge` and `mcpCard` (each on unless turned off).
  Its version stays 1: new switches get defaults instead, because a new version would read every saved
  document as "newer" and switch routing off.
- `PASEO_HOME` defaults to `~/.paseo`. Keys are kept out of the settings document on purpose: Paseo
  sends settings documents to every client, and a key must never reach one.

## Layout

```
apps/paseo/
  index.client.tsx, index.server.ts   entry points
  client/                             the panel (tabs, cards)
  server/                             hooks, the provider sync, Paseo's config, the Providers tab
  server/routers/index.ts             the router registry and the adapter interface
  server/routers/omniroute/           OmniRoute: adapter and HTTP reads
  shared/                             contracts and pure logic, the only code the client imports
  shared/context.ts                   the context badge's counting (pure; the server runs it)
  shared/plugins.ts                   the Tips tab's recommended plugins
  shared/routers/                     each router's UI copy and response parsers
```

Adding a router means one more folder under `server/routers/` (and `shared/routers/`) and its id in
`shared/logic.ts`.

## Seeing it without a daemon

`npm run preview:ui` (in `apps/paseo`) serves the panel in a browser at
`http://127.0.0.1:43199/?state=setup&theme=light`, fed by the same fixtures as the hook-order test,
with the Lucide icons the Paseo app draws. States: `setup`, `overview`, `overview-basic`,
`overview-admin`, `overview-router-down`, `overview-claude-paused`, `activity`, `activity-basic`,
`activity-router-down`, `models`, `models-basic`,
`providers`, `providers-admin`, `accounts-operator`, `accounts-admin`, `accounts-claude-paused`,
`models-profiles-off`, `usage-populated`, `usage-30-days`, `usage-24-hours`, `usage-empty`, `usage-router-down`, `settings-operator`, `settings-manage-key`, `settings-recommended`,
`connection`, `connection-basic`, `connection-admin`, `connection-router-down`,
`connection-misconfigured`, `connection-public`, `connection-public-pending`, `settings-basic`, `tips`,
`tips-admin`, and the context panel with its chip: `context`, `context-full`, `context-basic`.
`npm run screenshots` renders every state in light and dark at 1280 px and 420 px into
`docs/screenshots/` (or a folder given after `--`), using the installed Google Chrome;
`PREVIEW_PORT=43299` when another plugin's preview holds 43199. `docs/screenshots/before/` holds three
0.3.4 views under the name of the current screenshot they compare with. The committed screenshots are
from 0.7.0: every daemon downloads this repository on install and update, so 0.8.0's were rendered and
checked but not committed.

## Development

```sh
cd apps/paseo
npm install
npm run typecheck
npm test   # pure logic; parsers against real OmniRoute responses (tests/fixtures); the real server
           # code against a fake OmniRoute, including a router that is down, one that hangs and a
           # broken connection.json; and a hook-order render check of every tab at every access tier
```
