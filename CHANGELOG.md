# Changelog

## 0.15.1 — 2026-10-05

A hotfix: the context **Breakdown** chip shows again on current Paseo apps. `requirements.paseo` stays
`>=0.8.0`; both fixes are chosen at runtime, so 0.8 apps behave as before.

- **The chip is a button on Paseo 0.8.0 stable and later.** Those apps take composer chips as buttons
  (`title`, `icon`, `label`, `behavior`) and check them on add. AI Router still sent the old
  0.8.0-beta.1 shape (a React component), so the add threw, the chip never showed on 0.9 or 0.11 apps
  and the loop that keeps chips in step stopped. AI Router now works out the label itself and pushes
  it: "Breakdown" with a pie-chart icon, or the router problem ("Router down", "Claude paused") with a
  warning icon. Pressing it still opens the chat's Context panel. A 0.8.0-beta.1 app keeps the old
  component. One chip the app refuses no longer stops the others; it is tried again on the next pass.
- **Agents are followed on Paseo 0.9 and later.** Since 0.9 the plugin only hears agents through an
  observation it opens itself. AI Router now keeps one open, takes its list as the truth after every
  reconnect, and reopens it with backoff if the app drops it. On 0.8 it never opens one (that would
  replace the app's own). This feeds the chip and the Context panel's refresh.
- Found by the paseo-mcp agent while fixing the same bug in paseo-mcp 0.18.1, after @hteo1337's report
  (itsjustanks/paseo-mcp#1).

## 0.15.0 — 2026-10-04

A calmer panel, Codex that really can go through the router, update buttons for Claude Code and Codex,
and a Models tab that says when it last compared with OmniRoute. Every option and feature from 0.14.0
is still there. `requirements.paseo` stays `>=0.8.0`; everything newer is looked for at runtime.

- **A calm Overview.** It now leads with the state and the actions only: the status card (router,
  models in Paseo, re-routed providers, the last agent, Open dashboard and Sync models). What AI Router
  is, how it works, how to use it and the words you'll see now sit in one **"New to AI Router? How it
  works"** section. It is open until setup is done and folded away once everything works. The MCP
  card is now one quiet line, and the footer that repeated "how to use" is gone. Your access level
  moved into the page header ("Connected to OmniRoute · Read token").
- **"What you can do here" folds away on every tab** behind a small link, instead of a boxed list.
- **One spacing scale** (`SPACE` in `client/ui.tsx`: 2, 4, 8, 12, 16, 20, 24) used everywhere. Cards
  have 20 inside and 24 between them; no screen uses raw numbers any more. The type scale is unchanged.
- **Codex can be re-routed, and the panel now says so truthfully.** Before, "Can't be re-routed: …"
  sat right under the Codex row and read as if it meant Codex. Built-in Codex now has the same kind of
  ask-first switch as Claude. Codex ignores `OPENAI_BASE_URL` and `OPENAI_API_KEY` (checked with Codex
  0.160.0), so AI Router sets Paseo's own launch command for Codex instead: `codex -c
  model_provider=ai-router -c model_providers.ai-router={…}`. The key is added when each chat starts,
  under `AI_ROUTER_API_KEY`, and is never written anywhere. `~/.codex` is not changed. Switching off
  removes the command and puts the rest of Codex's entry back as it was. A launch command someone set
  themselves is never touched. Unlike Claude, a re-routed Codex chat can't fall back to its own sign-in
  while OmniRoute is down, and the switch says so before you confirm. The separate "Codex via
  OmniRoute" provider is still offered, folded under the switch. Other providers are listed as "not
  switched here", not "can't be re-routed".
- **Agent apps** (Providers tab). Shows the Claude Code and Codex this daemon runs, their version
  against npm's latest (checked hourly; offline it stays quiet), and how each was installed. **Update**
  asks first, runs as the daemon's own user, shows the output while it runs and reads the version
  again. Running chats keep the old version until they restart. The button appears only when AI Router
  knows the install method and can write there: npm global (the fleet's `/opt/npm-global`, a Mac's
  `~/.npm-global`) or Claude Code's own installer (`claude update`). For Homebrew, Codex's own installer
  or an unknown copy, it shows the exact command or says why there is none.
- **Model sync, said plainly** (Models tab). It shows when Paseo was last compared with OmniRoute and
  when the list last changed, and why OmniRoute lists more models than Paseo shows: for example "85 of
  the 734": one entry per model, with effort levels, duplicates, providers with no account and
  unproven variants left out on purpose. Drift is flagged only when it is real (a model the filter
  keeps that Paseo lacks, or the reverse), with **Sync now**. Overview shows the same drift on its
  Models row. The automatic sync is unchanged: at load, when the app connects, and every 5 minutes.
- **Paseo 0.11 extras, when the app has them.** The sidebar row gets a status dot. Pressing the dot
  opens a popover with the state and **Open AI Router**, **Open dashboard** and **Sync models**. On
  0.10+ daemons, a routing switch flipped anywhere (Paseo's Settings or another client) re-checks the
  combo profiles at once, through `registerSettings(...).subscribe()`.
- **Advanced routing** (combos, fallbacks, per-provider rules) is now one line at the bottom of
  Providers and Settings, instead of a banner at the top.
- **Tips recommends fewer plugins.** Shared Browser and Advanced Markdown are no longer listed; Tips now
  suggests Paseo MCP, Activity, Remote Editor and Tell Agent.
- **Activity is offered at 0.7.0**, the version Paseo Cafe now publishes.
- **Switching built-in Codex back is careful with secrets.** If Codex's entry in Paseo's config has its own
  environment settings, AI Router won't rewrite it (Paseo masks secret values when plugins read them) and
  says how to remove the launch command by hand.
- **Tell Agent can be installed again.** Its 1.2.0 builds and loads on Paseo 0.11 (checked on the Mac), so
  Tips offers Paseo Cafe's command for it instead of "Not on Paseo 0.9.1 yet".
- **Usage page cards name their account** (Paseo 0.11). Paseo's card header shows the source's name and
  the report's plan badge; the account's name only appeared small in the footer, so every card read
  "AI Router". The badge now carries the account, so the header reads "AI Router · Claude #1",
  "AI Router · Codex #2" (numbered by OmniRoute priority, never an email). How it signs in
  (Subscription or API key) moved to a "Signs in with" line. The read-token card is named after the router.

## 0.14.0 — 2026-10-04

Uses Paseo's own screens where the Paseo app or daemon has them, instead of AI Router drawing its
own. Each one is looked for when the plugin loads. On an older Paseo, including the fleet's 0.9.1 and
0.10, everything works exactly as in 0.13.0. Nothing about routing, settings or the AI Router provider
changed.

- **Your router's accounts on Paseo's Usage page** (Paseo 0.11 daemons, Settings → Usage). Each
  OmniRoute account gets its own **AI Router** card, such as "Claude #1" or "Codex #2". The card shows
  how much of each limit is used and left, when it resets, the account's masked name, any problem
  (paused, cooling down, sign-in expiring) and its last 24 hours. An account that can't be used says
  why: turned off, sign-in expired, banned, or no limits reported yet. Paseo lets you pin a limit to its
  sidebar.
  - A key-only connection shows one card explaining that a read token is needed.
  - A daemon that isn't connected shows no AI Router card.
  - The cards use the same read as the Accounts tab. Paseo asks only while the Usage page is open, so
    there is no new polling. After a failed read, AI Router waits before trying again, from 30 seconds
    up to 15 minutes.
  - Each card is identified by a hash of the router's account id, never by an email or a key.
- **The Accounts tab says so.** On a 0.11 daemon, one line at the top of the Accounts card points to
  Paseo's Usage page.
- **A proper screen and sidebar row** (Paseo 0.11 apps). The panel opens as a screen titled "AI
  Router"; before, opening it from the command menu titled it "ai-router". The sidebar entry is now
  Paseo's own row, highlighted while the screen is open. Older apps keep the previous sidebar item.
- **Links** still open in the system browser through Paseo's own opener, which apps have had since 0.9.
  The check for it is now stricter.
- **Left out on purpose.** Router health on the AI Router provider: Paseo's provider status only works
  for providers a plugin runs itself, and AI Router's provider is a settings entry built on Claude.
  Header buttons and popovers: nothing they would add.
- **For maintainers.** `requirements.paseo` stays `>=0.8.0`. The Usage-page types and helpers are
  copied from the 0.11 SDK rather than imported, because Paseo 0.9.1 and 0.10 refuse to build a plugin
  that names `@getpaseo/plugin/server/usage`, even in a type import. A test checks that plugin code only
  names SDK entries 0.9.1 knows. The card icon (`apps/paseo/assets/ai-router.svg`) is Lucide's `route`
  (ISC, in THIRD-PARTY-NOTICES.md).

## 0.13.0 — 2026-09-26

Written for someone who has never heard of a router or an API key. Every option, button, setting and
tab is still there and works as before; nothing on the daemon changed.

- **Overview explains itself.** A status card at the top says the state in words ("All set: AI Router
  is working", "Connected: one step left", "Working, but Claude is paused", or when the router was
  last seen), with the router, the AI Router provider, built-in Claude, access (now saying what it
  allows) and the last agent under it, then Open dashboard and Sync models. Below it: **What is AI
  Router?** (with the kinds of account the router offers now), **How it works** (four steps with icons
  and arrows, and what happens when an account is busy), **How to use it** (numbered steps; combos
  such as "Auto · Coding"; thinking level and mode work as normal; or keep built-in Claude and
  re-route it on Providers) and **Words you'll see** (provider, model, combo, router, account, key and
  access tier, routing, daemon). The guide also shows on Overview before a router is connected.
  **Check out MCP** stays at the bottom.
- **Every tab opens with an introduction.** Its icon, a clearer title ("Providers and re-routing",
  "Your team's AI accounts", "Usage and cost"), one or two plain sentences on what it is for, and
  **What you can do here**. On a phone that list folds away behind **Learn more**. This replaces the
  one-line headings.
- **Readable type.** One type scale for the whole panel: descriptions 15 px, secondary text 14,
  nothing below 13 (chips, chart axes), section titles 17, tab titles 20, the page title 22.
  Descriptions use the full text colour; muted grey is kept for times, ids and hints.
- **A little colour.** Cards carry an icon in a soft accent circle; banners and the reply to a button
  get a tinted background and an icon; the main buttons have icons; the header shows a coloured dot
  for the router's state. Everything comes from Paseo's own theme colours, in light and dark, with no
  new dependencies.

## 0.12.0 — 2026-09-24

- **The sync works again on a busy router.** Auto combos (and their `ai-router:auto/…` profiles) now
  come from `/v1/models`, which the sync reads anyway; custom combos still come from `/api/combos`.
  `/api/combos/auto` is no longer called at all, from the sync or the Settings tab: it scores every
  candidate pool on each call and took 79 s at full CPU, so every sync timed out ("Couldn't read
  OmniRoute's combo list") and ten daemons retrying it kept OmniRoute busy. The profile ids stay the
  same, so nothing is renamed or duplicated; auto combo notes lose their "Picks from …" line. The
  model list gets 30 s instead of 10, as it runs in the background.
- **Each model's own thinking levels.** The AI Router provider lists OmniRoute's effort tiers for a
  model, else Paseo's own levels for the same upstream model, instead of the generic four for every
  model: Opus 5.5 gets Low to Max with Extra High and Medium by default, GPT-6 Sol defaults to Extra
  High, Haiku gets none. Only levels OmniRoute carries through are offered (no off, ultracode or ultra).
- **Fast fails safe.** Routed Claude sessions (re-routed Claude and the AI Router provider) run with
  `CLAUDE_CODE_DISABLE_FAST_MODE=1`, so a Fast switch left on no longer turns every request into
  400 "speed: Extra inputs are not permitted"; OmniRoute can't pass Fast mode on yet. The Providers tab
  says so, and "Share this router" includes the line for Claude Code.

## 0.11.0 — 2026-09-24

Building on what Paseo already does, instead of repeating it (checked against the Paseo 0.9.1 app).

- **Breakdown chip.** Paseo's message box already has a context meter (percentage, tokens and session
  cost), so the chip no longer shows the same number. It reads **Breakdown** and opens what fills the
  chat; it still turns red with the reason ("Router down", "Claude paused") when a router problem
  reaches a routed chat.
- **Traffic, not Activity.** The tab showing what went through OmniRoute is now **Traffic**, so it is
  not confused with the Activity plugin (this daemon's own usage analytics); when that plugin is
  installed, Traffic points to it.
- **Providers.** The per-provider on/off table is gone: that is Paseo's Settings → Providers. The tab
  keeps what Paseo lacks: which providers can go through OmniRoute (re-routing Claude asks first) and
  **Tidy up**.
- **Tips.** Tell Agent does not build on Paseo 0.9.1 yet, so it says that instead of offering a
  command; the count covers the installable ones. Installing points to Paseo's own Settings → Plugins
  as well as the CLI.
- **Sync failures say why.** "Couldn't read OmniRoute's combo list" now carries the reason with its
  HTTP status, and a 401 from a web server's console lock (basic auth) in front of OmniRoute is named
  as such, instead of reading as a rejected read token. The same goes for the read-token check.

## 0.10.1 — 2026-09-24

**No tab cut off.** In a half-width desktop window or on a tablet, the nine tabs no longer run off the
edge (Tips vanished at about 820 px, Connection at 700 px). The tab bar measures itself and, when the
names do not fit, shows every tab's icon with the active tab's name, as on a phone.

## 0.10.0 — 2026-09-23

**The AI Router provider is the way in.** Overview now leads with the AI Router provider and its
models ("pick it in Paseo to use OmniRoute"); its actions are Open dashboard and Sync models. Built-in
Claude shows "Own sign-in" or "Re-routed", with a link to Providers.

**Re-route providers, asking first.** A new card at the top of Providers lists the providers that can
go through OmniRoute: AI Router (always), Claude (its own sign-in unless re-routed), Codex (through the
separate Codex via OmniRoute provider), and which can't. Switching Claude either way now asks first and
says what changes; nothing is saved until confirmed. Nothing is migrated: every daemon keeps the choice
it has saved.

**"Claude paused" is less absolute.** The chip's detail now says requests fail unless OmniRoute's own
combos or fallbacks send them elsewhere.

## 0.9.0 — 2026-09-23

**Router alerts in the chat.** The context chip turns red with the reason when a router problem
reaches a routed chat: "Router down · 186k / 1M", or "Claude paused" when OmniRoute's circuit breaker
holds the chat's provider open (read token). The Context panel opens with what it means for that chat
and **Open AI Router**. It rides on the chips' once-a-minute switch read, with at most one health ping
a minute per daemon.

**Open from Activity.** Each agent session, and each request linked to an agent, has **Open**, which
asks Paseo to go to that agent (hidden for archived agents and on hosts without navigation).

## 0.8.1 — 2026-09-23

**Tips tab.** Smart Session is no longer recommended: six plugins now (Paseo MCP, Shared Browser,
Activity, Advanced Markdown, Remote Editor, Tell Agent).

## 0.8.0 — 2026-09-23

**Context badge.** Every chat gets a chip beside its message box with how full its context window is
(`186k / 1M`), grey, then amber from 60 %, then red with a warning icon from 85 %. Tapping it opens a
**Context** panel: the exact total, what is using it biggest first (files read, command output, MCP
tool results by server, web pages, edits, sub-agent reports, messages, and the system prompt and tools
as "the rest"), one tip for the biggest part, and a warning when nearly full. Estimates are marked ≈.
With a read token, OmniRoute's size of the chat's first request measures the starting cost, and
anything still unexplained gets its own line. Works at every tier. The chip makes no calls (it reads
the agent updates the app already gets); the breakdown is worked out on the daemon only when the panel
is open, cached while the total is unchanged, and backs off on failure. **Settings → In Paseo** turns
it off and on (on by default). Also in the command palette: "Context used in this chat". Only
numbers and plain names cross to the app: file paths, program names (never a command's arguments),
tool and MCP server names, hosts and sub-agent types.

**Tips tab.** Recommended plugins from Paseo Cafe: Paseo MCP, Smart Session, Shared Browser, Activity,
Advanced Markdown, Remote Editor and Tell Agent, each with its Cafe page and install command, or
"Installed" when this daemon already has it (read from `$PASEO_HOME/plugins/sources.json`).

**Check out MCP.** A small card at the bottom of Overview for the sister plugin, with **View plugin**,
**Copy install source** (or "Installed") and **Hide**.

**Settings for everyone.** The Settings tab now shows at every tier, with the plugin's own switches
first; the router's settings still need a read token.

**Lighter on the daemon.** Activity reads Paseo's agent list at most every 20 seconds instead of every
refresh, and the cache of OmniRoute answers drops entries nobody will reuse (each Activity filter used
to stay in memory for good).

**Tests and preview.** Unit tests for the counting, server tests for the context RPC against a fake
timeline and the fake OmniRoute (paging, compaction, caching, back-off, tiers, no chat text leaving the
daemon), render tests for the chip, panel, Tips, Settings and the MCP card, and a test of the chip
registry. Preview states for the new views; `PREVIEW_PORT` for the screenshot script.

Settings keep version 1: the new switches get defaults, so routing stays exactly as saved.

Earlier versions: see the git history.
