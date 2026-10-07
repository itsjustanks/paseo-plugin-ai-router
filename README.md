# AI Router — Paseo plugin

Routes the agents a Paseo daemon launches through one OmniRoute endpoint. It keeps an "AI Router"
provider in Paseo with every model of your connected accounts (Claude and GPT), can add a "Codex via
OmniRoute" provider, and shows the router's accounts, usage and settings to whoever holds the keys for
them. It only reads what OmniRoute already counts: no pricing tables, no local usage store. Advanced
routing (combos, fallbacks, per-provider rules) stays in OmniRoute's dashboard. A chat gets a chip
from AI Router only while the router can't serve it ("Router down", "Claude paused"). Where Paseo
already does something
(the context meter, provider switches, installing plugins, agent profiles), AI Router builds on it
instead of repeating it.

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
(`pluginsEnabled` in its `config.json`). Requires Paseo 0.9 or later (since 0.20.0; 0.19.0 and older ran on 0.8); checked against Paseo 0.11.

For a fleet, give every daemon the connection through the environment and nothing else is needed:

```sh
AI_ROUTER_URL=http://10.0.0.5:20128   AI_ROUTER_KEY=sk-…   # one key per daemon, named after it
AI_ROUTER_CONSOLE_URL=https://ai-router.example.com         # optional: the public address (custom domain)
```

## The panel

Four tabs (0.18.0), by what a person comes to do. Whenever the names do not fit (a phone, a narrow
window) each shows its icon and the active one its name too. There is no intro block under the bar:
each tab starts with its own content, status first. Everything technical or less used sits in
**fold-outs**: a card of rows (an icon, a title, a one-line summary and a chevron), each opening in
place. Nothing was removed; it was folded.

| Tab | What it holds |
| --- | --- |
| **Overview** | The status card: the state in words (working, one step left, paused, or unreachable since when), with rows for the router, the models in Paseo and **Versions** with **What's new**; then the two routing switches, **Claude · through the router** and **Codex · through the router** (each says what on and off mean and asks first; 0.21.0); while the router is down or has paused Claude or Codex, a one-press **Use this computer's own sign-in for …** (asks first, never automatic; only when this computer has a sign-in of its own, else it says so), and **Switch back to the router** once it works again; the last chat (**Recent traffic →**); open the dashboard, sync models. When the router is unreachable: when it was last seen, the error, and **Check the connection**. Then **New to AI Router? How it works** (open until setup is done), and one fold-out, **Recent traffic**: the chats started here, routed or not and why, and with a read token every request the router served (filters, **Open** on each agent, and why it went where it did). At the bottom, a one-line suggestion to add Connectors, only while it isn't installed. Before a router is set up, Overview holds the three-step setup instead of the status card (the public address and SSH target sit under **Advanced**). |
| **Accounts** | Each OmniRoute account: health, quota, cooldowns, sign-in expiry, and with a manage key **Check now**, **Check all**, **Refresh token** and the resets OmniRoute offers (each asks first); a paused provider gets **Resume now**. Then **Usage** for today, 7 days, 30 days or your own dates: the totals and **Who uses the most** (one row per daemon's key). Folded: **Day by day**, **Which providers and models**, **Which account answered**, **What failed**, **The last year**, **Is the router healthy?** and **This key's spending**. Without a read token: what one adds, and this key's own spending. |
| **Models** | **Sync models to Paseo** (in step or not, and why OmniRoute lists more), then **Send chats through the router**: the AI Router provider, built-in Claude's switch (asks first) and what OmniRoute has for Codex. Folded: **Models in Paseo's picker** (each with **Test**, and a test for any model id), **Combos as agent profiles**, **Codex extras** (built-in Codex through the router; a separate "Codex via OmniRoute" provider; open when one is on), **Tidy up Paseo's provider menu**, and **Claude Code and Codex versions** (with updates; the install folder folded). Before a router is connected: one **Connect a router first** line with **Set up**, the switches shown but off-limits. |
| **Help** | Plain questions only, each folded: *How does AI Router work?* (the guide), *How is this computer connected?* (endpoint, public address, key, Edit / Disconnect; before setup, a pointer to Overview's form), *How do I see accounts and usage?* (read token and manage key), *How do other people use this router?* (sharing through the public address), *How do I open the router's dashboard?* (address, private-network help, OmniRoute's tunnels for admins), *What does AI Router add to Paseo?* (the warning chip and the commands), *Why are long prompts shortened?* (compression), *Which router settings matter?*, *What else can OmniRoute do?*, and *Which plugins work well with AI Router?* (Connectors, Remote Editor, Tell Agent). |

**Refresh** (0.20.0), in the page header, is the one way to check again: the router's health, Paseo's
providers and the agent apps' latest versions. On Paseo 0.11 the window title follows the tab
("AI Router · Accounts").

**Which computer** (0.21.0): the page header, the window title ("AI Router · team-server · Accounts")
and the sidebar popover name the host, using Paseo's own name for it. Each computer has its own
connection, so a computer that isn't connected says so under its name ("AI Router · MacBook Air: This
Mac isn't connected to a router yet"). The same switch-back offer shows in the sidebar popover, the chat's **Router down**
chip (on Paseo 0.11 it opens a small popover) and the router-error card in a chat.

**Old tab names still work.** A screen opened with `params.tab` (or a link inside the panel) may name
any of the nine tabs before 0.18.0; each lands on its new tab with its fold-outs open: Traffic →
Overview's **Recent traffic**; Providers → Models with **Codex extras**, **Tidy up** and the versions
open; Usage → Accounts with the usage fold-outs open; Settings, Connection and Tips → Help with their
questions open. `params.open` (a comma list of fold-out ids) opens more. Unknown names land on Overview.

**Commands** (0.18.0): the Command Center has **Sync AI Router models to Paseo** and **Check the AI
Router connection**; in a chat, `/ai-router sync` and `/ai-router check` (on apps with plugin slash
commands). Each runs, then opens AI Router with the answer at the top. No sidebar footer item: the
sidebar row's status dot already says whether the router works, and its popover has the same actions.

The plugin never stores, shows or asks for OmniRoute's admin password. The panel says "Dashboard
login: ask your router admin" where it matters.

## On Paseo 0.11 and later

Where the Paseo app or daemon has its own way to show something, AI Router uses it. Each feature is
looked for when the plugin loads; an older Paseo (the fleet's 0.9.1, or 0.10) gets exactly what it
got before.

- **Paseo's Usage page** (daemon 0.11+, Settings → Usage): one **AI Router** card per router account,
  named in its header ("AI Router · Claude #1", "AI Router · Codex #2", numbered by OmniRoute priority), with each limit's used and left and its reset time, the account's masked
  name, its status (paused, cooling down, sign-in expiring) and the last 24 hours. An account that can't
  be used says why (turned off, sign-in expired, banned, no limits reported yet). A key-only connection
  shows one card saying a read token is needed; a daemon that isn't connected shows none. The cards
  share the Accounts tab's read: Paseo asks when the page opens and keeps each card five minutes, and
  after a failed read AI Router waits 30 seconds, then longer, up to 15 minutes. Card keys are a hash of
  the router's account id, never an email or a key. The usage helpers are copied from the 0.11 SDK, not
  imported, because Paseo 0.9.1 and 0.10 refuse to build a plugin that names
  `@getpaseo/plugin/server/usage`.
- **A chat's own accounts on its context-window card** (daemon 0.11.0-beta.5+): hovering a chat's
  context meter shows the limits of the router accounts that chat runs on. Claude models (`cc/…`) show
  the Claude accounts, Codex models (`cx/…`) the Codex ones, Kimi (`kmc/…`) Kimi's, a combo its members'
  accounts (an auto combo: any of them). When OmniRoute's call log, already read for Recent traffic,
  names the account that served the chat, only that one shows. A chat that doesn't go
  through this router shows none. Hovers reuse the Usage page's read and never ask the router anything
  of their own. Earlier 0.11 betas show the Usage page only.
- **Closed chats are let go at once** (daemon 0.11.0-beta.4+): when Paseo closes or archives a chat, its
  chip alerts are dropped straight away instead of waiting to expire.
- **A screen and the app's own sidebar row** (app 0.11+): the panel opens as a screen titled "AI Router"
  (an older app titled it by its id when opened from the command menu), and the sidebar entry is
  Paseo's row, highlighted while the screen is open.
- **External links** go through the app's `openExternalUrl` (apps since 0.9), with `Linking.openURL`
  only for older apps.

Not used: provider status (Paseo's `ProviderStatus` is for providers a plugin runs itself; the AI Router
provider is a settings entry built on Claude), header buttons and popovers (nothing they would add).

## Access tiers

The endpoint is shared by many people and agents, so what the panel shows follows the credentials
this daemon holds, and a key never sees another key's data.

| Feature | Basic: endpoint + API key | Operator: + read token | Admin: + manage key |
| --- | --- | --- | --- |
| Routing Claude and the AI Router provider, the hook | yes | yes | yes |
| Router up/down and latency | `GET /api/health/ping` (public) | same | same |
| Public address status | `GET <public address>/api/health/ping` (public, no credentials sent) | same | same |
| Traffic: agent sessions on this daemon | yes (this daemon's own hook; no router call) | yes | yes |
| Traffic: requests | — | `GET /api/usage/call-logs`, `GET /api/keys` | same |
| Traffic: why a request went where it did | — | `GET /api/routing/decisions/{callLogId}` | same |
| Version, uptime, paused providers | — | `GET /api/monitoring/health` | same |
| Model list for the AI Router provider | `GET /v1/models?configuredOnly=true` (OmniRoute limits it to active accounts and the key's allowed models) | `GET /v1/models` filtered by active accounts in `GET /api/providers` | same |
| Test a model | `POST /v1/messages` | same | same |
| Your access (this key only) | `GET /v1/me/status` (needs the key's `self:usage` scope, which OmniRoute gives new keys) | same | same |
| Send chats through the router, Codex via OmniRoute, Tidy up | yes (Paseo's own API; models from the list above) | yes | yes |
| Accounts: health, quota, cooldowns, expiry | — | `GET /api/providers`, `/api/rate-limits`, `/api/usage/provider-limits`, `/api/providers/health-matrix`, `/api/providers/expiration`, `/api/provider-stats`, `/api/monitoring/health` | same |
| Usage & analytics, all keys | — | `GET /api/usage/analytics?range=1d`, `7d` or `30d`, `GET /api/keys` | same |
| Combo descriptions for profiles | `GET /v1/models` (custom combos' own descriptions) | `GET /v1/models`, `GET /api/combos` (never `/api/combos/auto`) | same |
| Router settings, read | — | `GET /api/settings`, `/api/context/combos/default`, `/api/analytics/compression`, `/api/resilience`, `/api/resilience/model-cooldowns` | same |
| Settings changes, breaker reset | — | — | `PUT /api/settings/compression`, `PATCH /api/settings`, `POST /api/resilience/reset` |
| Apply recommended compression | — | — | `GET` then `PUT /api/settings/compression` |
| Account actions | — | — | `POST /api/providers/{id}/test`, `/api/providers/{id}/refresh`, `/api/providers/test-batch` |
| Tunnels | — | — | `GET /api/tunnels/{cloudflared,ngrok,tailscale}`, `POST /api/tunnels/{cloudflared,ngrok}`, `POST /api/tunnels/tailscale/{enable,disable}` |
| Router-alert chip on a chat | yes (the health check the panel shares, at most once a minute) | yes, plus paused providers | same |
| Tips and the Connectors line: "Installed" | yes (`$PASEO_HOME/plugins/sources.json`) | yes | yes |

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
           "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1", "CLAUDE_CODE_DISABLE_FAST_MODE": "1" },
  "models": [{ "id": "cc/claude-sonnet-5", "label": "Claude · Sonnet 5", "isDefault": true,
               "thinkingOptions": [{ "id": "low", "label": "Low" }, "…", { "id": "high", "label": "High", "isDefault": true }, "…"] },
             { "id": "cx/gpt-6-sol", "label": "Codex · GPT-6 Sol", "thinkingOptions": ["…"] }, "…"] }
```

**Thinking levels.** Paseo gives a model id it doesn't know (every `cc/…` and `cx/…`) the generic
low, medium, high and max. The entry lists each model's own levels instead:

- OmniRoute's `capabilities.effort_tiers` for the model in `/v1/models` (Claude models list them);
- otherwise Paseo's own levels for the same upstream model (`root`, such as `gpt-6-sol`), read with
  `providers.listModels("claude" | "codex")` at most every 10 minutes and kept in
  `plugin-settings/ai-router/native-thinking.json` for the sync at plugin load;
- only levels Claude Code sends as effort and OmniRoute carries through: low, medium, high, Extra High
  and max. Not "off" (Paseo refuses it for gateway ids and would not start the agent), not "ultracode"
  and not Codex's "ultra" (not proven through OmniRoute yet). A model Paseo itself gives no levels
  (Haiku) gets none; combos, and models nothing is known about, keep Paseo's generic set.
- The default is Paseo's own for that model, else High.

If an older OmniRoute ignores `?configuredOnly=true` for a plain key (hundreds of models come back),
the sync refuses rather than list them all, and says to add a read token or update OmniRoute.

## Combos as agent profiles

Each OmniRoute combo in the AI Router model list becomes a Paseo agent profile, so it can be picked
directly when starting an agent. With a read token that is every auto combo `/v1/models` lists (`auto`,
`auto/…`) plus the custom combos `/api/combos` names; without one, the core auto combos. The sync never
calls `/api/combos/auto`: it scores every candidate pool across the whole catalogue on each call (79 s
at full CPU on a 1,500-model router), and `/v1/models` already lists the same ids.

```json
{ "id": "ai-router:auto/coding", "name": "Auto · coding", "icon": "code", "color": "blue",
  "provider": "ai-router", "model": "auto/coding",
  "notes": "OmniRoute auto combo \"auto/coding\": Quality-first for code. Use it as the model on …" }
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
- **Show combos as agent profiles** on the Models tab (folded under **Combos as agent profiles**) (host-wide, on by default) turns them off and on.

## Routing

The `agent.session_open` hook only edits the launch environment.

| Session | Rewritten when | Environment added |
| --- | --- | --- |
| Built-in `claude` provider | sent through the router on Models (off by default; turning it on asks first) | `ANTHROPIC_BASE_URL=<endpoint>` (no `/v1`), `ANTHROPIC_AUTH_TOKEN=<key>`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`, `CLAUDE_CODE_DISABLE_FAST_MODE=1`, and `x-omniroute-session-id: paseo-<agent id>` added to `ANTHROPIC_CUSTOM_HEADERS` |
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

`CLAUDE_CODE_DISABLE_FAST_MODE=1`: Fast mode sends `speed: "fast"`, which needs the fast-mode beta.
OmniRoute (3.8.51) neither sends that beta nor forwards the client's, so Anthropic answers 400
"speed: Extra inputs are not permitted". With this, Claude Code leaves `speed` out even when Paseo's
Fast switch is on, including one flipped mid-chat; the switch has no effect on routed chats, and the
Models tab says so. Paseo shows no Fast switch for the AI Router provider's `cc/…` models anyway.

`ANTHROPIC_CUSTOM_HEADERS` holds newline-separated `Name: value` lines that Claude Code sends with
every request. The hook keeps any lines already there and adds `x-omniroute-session-id`, unless one is
already set; OmniRoute records it as the request's `sessionTag`, which is how Traffic names the agent
behind each request exactly. It carries only the Paseo agent id.

**Codex via OmniRoute.** Built-in Codex builds its model provider from config, not from launch env,
and most daemons have no Codex login. Models → **Codex extras** adds `codex-ai-router`:
`extends: "codex"`, `env.OPENAI_BASE_URL = <endpoint>/v1` and a placeholder `OPENAI_API_KEY`, with the
Codex accounts' models (`cx/…`). Paseo turns such an entry into a Codex `model_provider` with
`wire_api = "responses"` that reads its key from `OPENAI_API_KEY` instead of a ChatGPT login; the hook
puts the real key there at launch. The auto-sync keeps it pointed at the endpoint while it exists.

**Model names.** Paseo passes Claude Code bare ids such as `claude-sonnet-5` on the built-in `claude`
provider. OmniRoute resolves a bare id to the first active provider that serves it; if both `cc/` and
`claude/` are connected, turn on **Prefer Claude Code for unprefixed Claude models** (Help → *Which router settings matter?*).

## Context compression

Help → *Why are long prompts shortened?* explains each OmniRoute engine in plain words, flags the ones that are on and can
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

## Recent traffic

On Overview, folded (the Traffic tab before 0.18.0). **Agent sessions on this daemon**, for every tier: each time an agent starts or resumes, the hook
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

**Which agent sent it.** Claude sessions (built-in Claude while it is re-routed, and the AI Router
provider) send `x-omniroute-session-id: paseo-<agent id>`, so those rows name their agent exactly.
Codex via OmniRoute cannot carry a header (Paseo builds its model provider), so its rows are matched
as **likely**: this daemon's key, the agent whose model matches, and the most recent routed session
that opened before the request. Other daemons' requests are never matched.

## Router alerts on a chat

Paseo already shows how full a chat's context window is (the meter in the message box, and its hover
card, where 0.17.0 adds the router accounts that chat runs on). AI Router adds nothing there. Until
0.18.0 it put a **Breakdown** chip on every chat with a **Context** panel of estimates; that is gone.

What stays is a chip **only while the router can't serve a chat**: "Router down" for every open chat
whose latest start went through OmniRoute, "Claude paused" (or Codex) when OmniRoute's circuit breaker
holds that chat's provider open (read token). An AI Router chat, which can use either, is told "if its
model runs there". The chip goes away by itself once the problem clears. Pressing it opens AI Router,
whose status card says what is wrong and what to do. There is no switch: it only ever appears when
something needs attention.

What it costs: one small read (`ai-router.alerts`) once a minute while a chat is open (backing off to
15 minutes if the daemon does not answer), from the health check the panel shares: at most one ping a
minute and never more than 1.5 s of waiting. At most one read is ever out at a time.

## Router errors in a chat

When a request through OmniRoute fails, a routed chat used to show the raw text, for example
"API Error: 503 Provider claude circuit breaker is open … check your inference gateway (…)". Since
0.19.0 AI Router shows a small card in its place instead:

- **what happened, in one line**: "Claude is paused on the router after repeated errors", "Claude
  accounts are cooling down until 16:45", "No Codex account is signed in on the router", "A Claude
  account's sign-in has run out on the router", "Anthropic asks for a newer Claude Code than the router
  sends", "Codex didn't answer through the router";
- **whether anything retries by itself**: OmniRoute moves to another account, or tries a paused
  provider again, on its own; the chat itself has stopped retrying, so the card says when to send the
  message again;
- **Open AI Router** (its Accounts tab) and, for a paused provider with a manage key, **Resume now**
  (asks first; the same reset as on Accounts). Once OmniRoute has resumed the provider, the card says so;
- **Details**: the original text, unchanged.

What counts: only an item that is an error by its form (Claude Code's "API Error: …", Paseo's
"[System Error] …" for a failed turn, or an `error` item) and carries one of OmniRoute's own marks
(`[provider/model] [status]`, "Provider … circuit breaker is open", "No active credentials for
provider", "All accounts rate limited", or Claude Code naming the gateway). A reply that talks about
these errors is never touched, and neither are Anthropic's or OpenAI's own errors ("Prompt is too
long", a native rate limit, "You've hit your usage limit"). The card then asks the daemon whether that
chat went through this router (the hook's session log, one local read per chat): a chat on its own
sign-in, or one whose gateway is somebody else's, shows the original text as it was. Built on Paseo's
timeline transformers and renderers, found at runtime; an app without them shows the text as before.
The matching is tested against 26 real error texts from a daemon's chats (keys, emails and addresses
removed) and OmniRoute's own message templates (`tests/fixtures/router-errors.json`).

## Public address and dashboard access

OmniRoute can have a **public address** (custom domain), such as `https://ai-router.example.com`.
The daemons keep using the private endpoint; people and browsers outside the network use the public
address. It is set in Help → *How is this computer connected?* (**Public address (custom domain)**) or with
`AI_ROUTER_CONSOLE_URL`, under the same precedence as the rest of the connection, and stored without
a trailing `/dashboard`.

The panel checks it with `GET <public address>/api/health/ping` (4 s, no credentials,
re-checked after a minute or on **Check now**) and says what it found: "HTTPS OK · host", or
"DNS not pointing here yet", "Certificate not issued yet", "Certificate is for another name",
"Certificate expired", "Not serving HTTPS on this address", "HTTPS works, but OmniRoute behind it is
not answering (502)", "Answers, but not as OmniRoute" or "Unreachable".

**Share this router** (every tier) shows how someone else connects through the public address, with
`<your key>` in place of a key (each person or machine should get its own):

- Claude Code: `ANTHROPIC_BASE_URL=<public address>`, `ANTHROPIC_AUTH_TOKEN=<your key>`,
  `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` and `CLAUDE_CODE_DISABLE_FAST_MODE=1` (see
  [Routing](#routing) for why).
- Codex and other OpenAI-compatible tools: `<public address>/v1`, with a `~/.codex/config.toml` block.
- Another Paseo daemon: install this plugin from GitHub, then use the public address as its endpoint.

"Open dashboard" uses, in order: the public address when its check passed ("via custom domain"), a
running OmniRoute tunnel an admin's manage key can see, then `<endpoint>/dashboard`. A tunnel host
(`*.trycloudflare.com`, `*.ngrok-free.app`, `*.ts.net`) shows "via Cloudflare tunnel" and similar.
Admins can start and stop OmniRoute's Cloudflare, ngrok and Tailscale tunnels in Help → *How do I open the router's dashboard?*
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
(4 s for health, 10 s for reads). Once a check has found the router down, recent traffic, accounts, usage and
router settings answer immediately with their last good answer, marked "Router unreachable — showing its
answer as of HH:MM", or with the error if there is none. The Overview says when the router was last
seen (kept across restarts) and offers **Check the connection**, which opens Help at the connection, where the health check, editing the
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
  assets/ai-router.svg                the AI Router card icon on Paseo's Usage page
  client/                             the panel (tabs, cards)
  server/                             hooks, the provider sync, Paseo's config, providers and agent apps
  server/usage.ts                     the Usage page cards (Paseo 0.11+) and a chat's own accounts
  shared/usage-scope.ts               which router accounts a chat runs on (pure)
  server/routers/index.ts             the router registry and the adapter interface
  server/routers/omniroute/           OmniRoute: adapter and HTTP reads
  shared/                             contracts and pure logic, the only code the client imports
  shared/alerts.ts                    which chats a router problem reaches (pure)
  shared/router-errors.ts             which chat items are OmniRoute's errors, and their plain words (pure)
  shared/tabs.ts                      the four tabs and where each old tab id goes (pure)
  shared/plugins.ts                   Help's recommended plugins
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
`providers`, `providers-admin`, `accounts-operator`, `accounts-admin`, `accounts-claude-paused`, `accounts-native-usage`,
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
