# Changelog

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
