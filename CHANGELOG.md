# Changelog

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
