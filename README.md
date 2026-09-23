# AI Router — Paseo plugin

Routes the agents a Paseo daemon launches through one OmniRoute endpoint. It keeps an "AI Router"
provider in Paseo with every model of your connected accounts (Claude and GPT), can add a "Codex via
OmniRoute" provider, and shows the router's accounts, usage and settings to whoever holds the keys for
them. It only reads what OmniRoute already counts: no transcript parsing, no pricing tables, no
local usage store. Advanced routing (combos, fallbacks, per-provider rules) stays in OmniRoute's dashboard.

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
AI_ROUTER_CONSOLE_URL=https://…/dashboard                   # optional: where "Open dashboard" goes
```

## The panel

Seven tabs in one row; at narrow widths each shows its icon and the active one its name too. Tabs
that need more access than the daemon has are not shown, and one small line says what a read token or
manage key would add.

| Tab | What it holds |
| --- | --- |
| **Overview** | Router up, down or paused; Claude routing; models in Paseo; this daemon's access; the last agent; open dashboard, sync models, routing on or off. When the router is unreachable: when it was last seen, the error, and **Open Connection**. |
| **Models** | **Your access** (this key's name, its spend against its limit, the quota of the accounts it may use); **Combos as agent profiles** (a switch, on by default, and the profiles kept in Paseo); the synced models by provider, OmniRoute's combos first, with a **Test** on each; and a test for any other model id. |
| **Providers** | Every Paseo provider on this daemon with its status and an enabled switch, and what OmniRoute can do for it: Claude's routing switch, **Codex via OmniRoute**, or "not supported". **Tidy up** turns off Paseo's own providers that cannot run here, after showing the list. |
| **Accounts** | Each OmniRoute account: health, quota, cooldowns, the last 24 hours, sign-in expiry, and the router's health strip. With a manage key: **Check now**, **Check all**, **Refresh token**. **Re-login** and **Add account** open the dashboard. |
| **Usage** | **Usage & analytics** for 24 hours, 7 days or 30 days: requests, tokens, estimated cost and latency; requests per day; tokens per day stacked by provider; the provider split; top models; by daemon and by account; failed requests by kind; a year of activity. |
| **Settings** | Context compression in plain words, with the setting to use for coding agents; circuit breakers, bare-name routing and the routing strategy; **More in OmniRoute**. |
| **Connection** | Router, endpoint, key, where they come from; the read token and manage key; the dashboard address with the SSH help; with a manage key, OmniRoute's tunnels. The setup lives here, and the panel opens on it until a router is set up. |

The plugin never stores, shows or asks for OmniRoute's admin password. The panel says "Dashboard
login: ask your router admin" where it matters.

## Access tiers

The endpoint is shared by many people and agents, so what the panel shows follows the credentials
this daemon holds, and a key never sees another key's data.

| Feature | Basic: endpoint + API key | Operator: + read token | Admin: + manage key |
| --- | --- | --- | --- |
| Routing Claude and the AI Router provider, the hook | yes | yes | yes |
| Router up/down and latency | `GET /api/health/ping` (public) | same | same |
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
| Built-in `claude` provider | routing is on | `ANTHROPIC_BASE_URL=<endpoint>` (no `/v1`), `ANTHROPIC_AUTH_TOKEN=<key>`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` |
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

## Dashboard access

"Open dashboard" uses, in order: a running OmniRoute tunnel an admin's manage key can see, then the
dashboard URL from the connection settings or `AI_ROUTER_CONSOLE_URL`, then `<endpoint>/dashboard`.
A tunnel host (`*.trycloudflare.com`, `*.ngrok-free.app`, `*.ts.net`) shows "via Cloudflare tunnel"
and similar. Admins can start and stop OmniRoute's Cloudflare, ngrok and Tailscale tunnels on the
Connection tab ("makes the dashboard reachable from the internet; its login is still required") and
save a running tunnel's address as this daemon's dashboard URL. For every daemon to use it, set it as
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
(4 s for health, 10 s for reads). Once a check has found the router down, the Accounts, Usage and
Settings tabs answer immediately with their last good answer, marked "Router unreachable — showing its
answer as of HH:MM", or with the error if there is none. The Overview says when the router was last
seen (kept across restarts) and offers **Open Connection**, where the health check, editing the
endpoint and keys, Test & save and Disconnect all work without the router.

## Configuration and precedence

| Source | Where | Notes |
| --- | --- | --- |
| Saved plugin settings | `$PASEO_HOME/plugin-settings/ai-router/connection.json` (mode 0600) | Written by **Test & save** only. Wins outright. Holds the router type, endpoint, key, read token and manage key. |
| Environment | `AI_ROUTER_URL`, `AI_ROUTER_KEY`, `AI_ROUTER_TOKEN`, `AI_ROUTER_CONSOLE_URL` | Used only when nothing is saved. Seeds the connection for fleet installs. |
| Defaults | none | There is no default endpoint. |

- Precedence is per record, not per field: once a connection is saved, the `AI_ROUTER_*` variables are
  ignored entirely, so an env key never pairs with a saved endpoint. **Disconnect** removes the saved
  file and the environment applies again.
- `AI_ROUTER_KEY`, `_TOKEN` and `_CONSOLE_URL` without `AI_ROUTER_URL` are ignored, with a warning.
- A saved file or `AI_ROUTER_URL` that is present but broken blocks routing. It never falls through to
  another source or to localhost.
- The environment never supplies a manage key and never turns routing on. `routeAgents` lives in the
  Paseo settings document `$PASEO_HOME/plugin-settings/ai-router/routing.json` and defaults to off.
- `PASEO_HOME` defaults to `~/.paseo`. Keys are kept out of the settings document on purpose: Paseo
  sends settings documents to every client, and a key must never reach one.

## Layout

```
apps/paseo/
  index.client.tsx, index.server.ts   entry points
  client/                             the panel (tabs, cards)
  server/                             hooks, the provider sync, Paseo's config, the Providers tab
  server/routers/index.ts             the router registry and the adapter interface
  server/routers/copy.ts              each router's UI copy, safe for the client
  server/routers/omniroute/           OmniRoute: adapter, HTTP reads, parsers, copy
  shared/                             contracts and pure logic
```

Adding a router means one more folder under `server/routers/` and its id in `shared/logic.ts`.

## Seeing it without a daemon

`npm run preview:ui` (in `apps/paseo`) serves the panel in a browser at
`http://127.0.0.1:43199/?state=setup&theme=light`, fed by the same fixtures as the hook-order test,
with the Lucide icons the Paseo app draws. States: `setup`, `overview`, `overview-basic`,
`overview-admin`, `overview-router-down`, `overview-claude-paused`, `models`, `models-basic`,
`providers`, `providers-admin`, `accounts-operator`, `accounts-admin`, `accounts-claude-paused`,
`models-profiles-off`, `usage-populated`, `usage-30-days`, `usage-24-hours`, `usage-empty`, `usage-router-down`, `settings-operator`, `settings-manage-key`, `settings-recommended`,
`connection`, `connection-basic`, `connection-admin`, `connection-router-down`,
`connection-misconfigured`. `npm run screenshots` renders every state in light and dark at 1280 px and
420 px into `docs/screenshots/`, using the installed Google Chrome. `docs/screenshots/before/` holds
three 0.3.4 views under the name of the current screenshot they compare with.

## Development

```sh
cd apps/paseo
npm install
npm run typecheck
npm test   # pure logic; parsers against real OmniRoute responses (tests/fixtures); the real server
           # code against a fake OmniRoute, including a router that is down, one that hangs and a
           # broken connection.json; and a hook-order render check of every tab at every access tier
```
