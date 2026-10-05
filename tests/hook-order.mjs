// Mounts every contributed client component with no data, then with data, and
// fails on any React hook-order complaint. 0.11.0 to 0.14.0 shipped a
// useMutation after the surface's loading return — React error #310 in the
// app — because nothing rendered these components outside Paseo.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "apps", "paseo");
process.env.NODE_ENV = "development";

const build = spawnSync(process.execPath, [join(plugin, "node_modules", "vite", "bin", "vite.js"), "build", "--config", join(plugin, "tests", "hook-order", "vite.config.mts")], {
  cwd: plugin,
  stdio: "inherit",
});
if (build.status !== 0) {
  console.error("hook-order: bundling the test entry failed");
  process.exit(1);
}

const { mounts, renderThroughDataArrival, badgeRegistryCheck, badgeButtonsCheck, followAgentsCheck, openedAgents, tabBarWidthCheck, nativeRegistrationCheck, quickActionsCheck } = await import(join(plugin, "node_modules", ".cache", "hook-order", "entry.mjs"));

/** Text each state must show once data arrives, so a render that silently drops a section fails. */
const BASIC_TABS = ["Overview", "Traffic", "Models", "Providers", "Settings", "Connection", "Tips"];
const ALL_TABS = ["Overview", "Traffic", "Models", "Providers", "Accounts", "Usage", "Settings", "Connection", "Tips"];
const H = {
  Overview: "How it works",
  Activity: "The chats and requests that went through the router",
  Models: "The models your chats can use through the router.",
  Providers: "Which of Paseo's providers go through the router. Each one's on/off switch stays in Paseo's Settings → Providers.",
  Accounts: "The subscriptions signed in on the router",
  Usage: "How much the router was used, by which daemon, and what it was worth",
  Settings: "What AI Router adds to Paseo and, with a read token",
  Connection: "Which router this computer uses, its keys",
  Tips: "Paseo plugins that work well with AI Router, from Paseo Cafe.",
};
/** Overview's guide: what AI Router is, how it works, how to use it, and the words. */
const GUIDE = ["What is AI Router?", "through one shared router, OmniRoute", "You sign in to each AI account once, on the router", "How it works", "1. You pick a model", "2. AI Router sends it", "3. OmniRoute picks an account", "4. The answer comes back", "If an account is busy", "the router tries another one by itself", "How to use it", "Start a new chat in Paseo.", "“Auto · Coding”", "Set the thinking level and mode as you normally would.", "Rather keep the built-in Claude or Codex provider?", "Re-route it in the Providers tab", "Open Providers", "Words you'll see", "Provider", "Model", "Combo", "Router (OmniRoute)", "Account", "Key and access tier", "Routing", "Daemon"];
/** A wide tab lists what can be done there; a narrow one folds it behind a toggle. */
const LEARN_MORE = "What you can do here";
const IN_PASEO = ["In Paseo", "Context breakdown chip on each chat", "Beside Paseo's context meter: tap it to see what fills the chat", "MCP plugin line on Overview"];
const MCP = ["Also try MCP: manage MCP servers for Claude Code, Codex and your other agents in one place.", "View plugin"];
const ADVANCED = "Combos (named groups of models), fallbacks and per-provider rules live in the OmniRoute dashboard";
const expected = {
  "setup (not connected, opens on Connection)": [H.Connection, "Not connected yet. Routing stays off", "Set up", "Four steps, about two minutes", "until you pick the AI Router provider", "1. Choose your router", "OmniRoute", "2. Endpoint URL", "http://10.0.0.5:20128", "3. API key", "named after it, so usage shows per daemon", "4. Test connection & save", "Nothing is saved until it does", "New to AI Router? Overview explains what it is and how it works"],
  "setup (env, no key, narrow)": ["Not connected yet: no API key set for http://127.0.0.1:20128", "connection refused at", "Pre-filled from this daemon's AI_ROUTER_* variables", "AI_ROUTER_TOKEN set without AI_ROUTER_URL"],
  "misconfigured (opens on Connection)": [H.Connection, "Not connected yet: the saved endpoint in connection.json is not a usable http(s) URL.", "The saved public address is not a usable http(s) URL; it is ignored.", "1. Choose your router", "Disconnect (remove saved connection)"],
  "misconfigured overview": ["Connect a router first", "Not connected yet: the saved endpoint in connection.json is not a usable http(s) URL.", "Open Connection", ...GUIDE],
  "connection tab (operator, private dashboard)": ["Connected to OmniRoute", "Endpoint", "http://10.0.0.5:20128", "API key", "…abcd", "Set by", "saved plugin settings", "Check now", "Edit", "Disconnect", "Stored in /root/.paseo/plugin-settings/ai-router", "More access (optional)", "The API key is enough to route agents", "Read token (optional)", "Saved …wxyz", "Manage key (optional)", "Anyone who can run commands on this daemon can use this key to change the router.", "Dashboard", "http://10.0.0.5:20128/dashboard", "Copy link", "Its login comes from your router admin.", "Hide how to open it from elsewhere", "private network (10.0.0.5:20128)", "root@router.example.com", "Copy SSH command"],
  "connection tab (admin, tunnels)": ["OmniRoute's tunnels", "A tunnel puts the dashboard on the internet, behind OmniRoute's own login.", "Cloudflare tunnel", "running", "https://quiet-river-demo.trycloudflare.com", "Stop", "Use as the public address", "ngrok tunnel", "not installed", "Tailscale Funnel", "Start", "via Cloudflare tunnel", "AI_ROUTER_CONSOLE_URL"],
  "connection tab (basic, narrow)": ["Read token (optional)", "Not set", "Add"],
  "connection tab (editing)": ["Edit connection", "1. Choose your router", "Test connection & save", "Cancel"],
  "connection tab (router down)": ["connection refused at http://10.0.0.5:20128/api/health/ping", "Check now", "Edit", "Disconnect"],
  "overview (routing on, narrow)": ["New to AI Router? How it works", "All set: AI Router is working", "Pick AI Router when you start a chat.", "Versions", "Up to date", "OmniRoute 3.8.51 · AI Router 0.16.0", "What's new →", "Connected to OmniRoute · Read token", "Router", "Up · 12 ms", "Models in Paseo", "12 models", "Models →", "Re-routed", "Claude", "Providers →", "Last Claude agent (", "routed through OmniRoute", "Traffic →", "Open OmniRoute dashboard", "Sync models"],
  "overview (guide opened)": ["Hide how AI Router works", "On your router now:", ...GUIDE],
  "overview (drift)": ["Models in Paseo", "2 out of step with OmniRoute"],
  "overview (Codex re-routed)": ["Re-routed", "Claude and Codex"],
  "overview (basic)": ["Key only", "Last AI Router agent (", "routed through OmniRoute", "New to AI Router? How it works"],
  "overview (admin, tunnel)": ["Manage key", "Open OmniRoute dashboard", "via Cloudflare tunnel"],
  "overview (routing off)": ["Connected: one step left", "Sync the models to add AI Router to Paseo's provider menu.", "None", "built-in providers use their own sign-in", "Not synced", "Sync models to Paseo", "Hide how AI Router works", "What is AI Router?", "Not in the menu yet? Sync models on the Models tab"],
  "overview (last agent skipped)": ["used its own sign-in — the router did not answer (connection refused)"],
  "overview (router down)": ["OmniRoute unreachable — last seen", "connection refused at http://10.0.0.5:20128/api/health/ping", "Until it answers, AI Router chats can't start, re-routed Claude uses its own sign-in.", "Open Connection", "Check again"],
  "overview (Claude paused)": ["Working, but Claude is paused", "OmniRoute paused Claude after errors and retries by itself.", "Up · Claude paused", "Claude requests fail until OmniRoute retries", "Accounts →", "Last AI Router agent (", "did not start — no API key set"],
  "models tab": [H.Models, "Combo · 5", "team-review", "Your access", "This key", "daemon-a", "12 models on connected accounts", "Spend (monthly)", "$3.42 of $50.00", "resets 2026-10-01", "Tokens", "Claude quota", "5h: 64% left", "Sync models to Paseo", "In Paseo", "in step with OmniRoute", "12 of the 734 models OmniRoute lists: one per model.", "Effort levels (Paseo's thinking control), duplicates, providers with no account and unproven variants are left out.", "runs by itself every 5 minutes and when the app connects", "Remove from Paseo", "old \"AI Router Codex\" provider", "In Paseo's model picker", "Claude · 4", "Opus 5.5", "cc/claude-opus-5-5", "failed", "Codex · 3", "GPT-5.6 Sol", "Test", "Test another model", "Claude Code version 2.1.280 or newer is required"],
  "models tab (basic, key hides its spend)": ["Your access", "12 models on connected accounts", "lacks the self:usage scope"],
  "models tab (testing one)": ["cc/claude-opus-5-5 answered in 640 ms"],
  "models tab (not synced)": ["Not synced", "Paseo has no AI Router provider yet", "Test a model"],
  "models tab (drift)": ["out of step with OmniRoute", "OmniRoute offers 2 models Paseo doesn't list yet: cx/gpt-6-luna, cc/claude-sonnet-5-5.", "Sync now", "14 of the 736 models OmniRoute lists"],
  "providers tab (basic, narrow)": [H.Providers, LEARN_MORE, "Re-route providers", "AI Router always goes through OmniRoute. Claude can too; the switch asks first.", "Always through OmniRoute · 12 models", "Through OmniRoute", "Codex", "Codex is in the AI Router provider: 3 models.", "Optional extras", "Other providers", "GitHub Copilot, Gemini, OpenCode, Pi: not switched here; they keep their own sign-in.", ADVANCED, "Open dashboard", "Agent apps", "Tidy up", "3 enabled providers can't run here", "Settings → Providers turns any back on", "Tidy up…"],
  "providers tab (re-route Claude asks first)": ["New Claude chats here will use OmniRoute's accounts, not this daemon's sign-in", "open chats switch when reopened", "Fast mode stays off: OmniRoute can't pass it on yet.", "If OmniRoute is down, they use their own sign-in.", "Re-route Claude", "Cancel"],
  "providers tab (re-route Claude confirmed)": ["Claude re-routed: new Claude chats use OmniRoute."],
  "providers tab (own sign-in asks first)": ["New Claude chats will use this daemon's own sign-in. Without one they won't answer; the AI Router provider still reaches Claude through OmniRoute.", "Use own sign-in", "Cancel"],
  "providers tab (own sign-in asks first, cancel)": ["Through OmniRoute", "Fast mode is off for these chats"],
  "providers tab (tidy up preview)": ["These will be turned off:", "• GitHub Copilot — never finished loading", "• OpenCode — not installed on this daemon", "• Pi — never finished loading", "Turn off 3", "Cancel", "Hide optional extras", "\"Codex via OmniRoute\" is in Paseo's menu · 3 models", "4 Codex accounts connected in OmniRoute; their 3 models are in the AI Router provider."],
  "providers tab (not connected)": ["Re-route providers", "GitHub Copilot, Gemini, OpenCode, Pi: not switched here"],
  "providers tab (re-route Codex asks first)": ["4 Codex accounts connected in OmniRoute; their 3 models are in the AI Router provider.", "New built-in Codex chats here will use OmniRoute's accounts, not this daemon's sign-in", "~/.codex isn't changed", "Unlike Claude there's no fallback", "Re-route Codex", "Cancel"],
  "providers tab (re-route Codex confirmed)": ["Built-in Codex re-routed: new Codex chats use OmniRoute. Open chats switch when they restart."],
  "providers tab (Codex back on own sign-in asks first)": ["New built-in Codex chats will use this daemon's own sign-in.", "Use own sign-in"],
  "providers tab (agent apps, Mac)": ["Agent apps", "The Claude Code and Codex this daemon runs", "Claude Code", "2.1.289", "Up to date", "Installed with Claude Code's own installer", "Codex", "0.156.1", "0.160.0 available", "Installed with npm, in /Users/me/.npm-global", "Update to 0.160.0", "Latest versions come from npm, checked every hour.", "Check now"],
  "providers tab (agent apps asks first)": ["Runs \"npm install -g @openai/codex@latest --prefix /Users/me/.npm-global\" on this daemon, as the daemon's own user.", "running chats keep the old one until they restart", "Update Codex", "Cancel"],
  "providers tab (agent apps updating)": ["Updating…", "Running \"npm install -g @openai/codex@latest --prefix /Users/me/.npm-global\"…", "Hide output", "changed 1 package in 6s"],
  "accounts tab (Paseo 0.11 daemon)": ["3 accounts · 3 healthy", "Also on Paseo's Usage page (Settings → Usage), where a limit can be pinned to the sidebar."],
  "accounts tab (operator)": [H.Accounts, "3 accounts · 3 healthy", "Add account", "Signing in Codex from another computer?", "1 usage-limit reset credit banked", "healthy · 96% of 128 requests answered in 24 h", "Router health", "version 3.8.50", "running 1d 1h"],
  "accounts tab (admin, attention)": ["3 need attention", "Check all", "Check now", "Refresh token", "Clear cooldown", "Release cooldown", "Use a reset credit", "2 usage-limit reset credits banked", "Re-login in dashboard", "Sign-in expired (2026-09-20)", "degraded · 40% of 10 requests answered in 24 h · failing: gpt-5.6-sol"],
  "accounts tab (Claude paused)": ["Claude paused after errors", "Claude requests fail until OmniRoute retries in 30 s; other providers work.", "Resume now"],
  "accounts tab (token rejected)": ["Could not read accounts", "Accounts: 401 — read token rejected", "Try again"],
  "usage tab (in the surface)": [H.Usage, "Today", "7 days", "30 days", "Custom", "every 5 minutes", "Refresh", "Requests", "98.4% succeeded", "Tokens", "in ·", "Value", "at API prices · billed", "Who uses the most", "Worth = at API prices", "worth $", "Average latency", "3.8 s", "1.6% fell back to another model", "Requests per day", "Busiest day:", "Tap a day for its numbers", "Tokens per day, by provider", "Claude", "Codex", "GLM", "Provider split", "Top models", "claude-sonnet-5", "gpt-6-sol", "12% failed", "Swatch colour = the model's provider.", "daemon-a", "this daemon", "daemon-b", "By account", "so…@example.com", "Failed requests by kind", "rate limit", "upstream 5xx", "Activity, last 52 weeks", "Fewer tokens", "More", "12 days in a row with traffic", "busiest weekday: Tue"],
  "usage tab (30 days, narrow)": ["the last 30 days.", "Activity, last 17 weeks", "Requests per day"],
  "usage tab (24 hours)": ["Who uses the most", "today.", "Provider split"],
  "usage tab (in the surface, empty)": ["No requests the last 7 days"],
  "usage tab (router down, last answer)": ["Router unreachable — showing its answer as of", "Usage: the router is not answering", "Requests per day"],
  "models tab (combo profiles)": ["Combos as agent profiles", "Show combos as agent profiles", "with its description as notes", "Auto · coding", "auto/coding", "OmniRoute auto combo \"auto/coding\": Quality-first for code. Use it as the model on the AI Router provider", "Auto · best reasoning", "Best discovery (10% explore)", "Team review", "Opus 5.5 first, GPT-6 Sol when Claude is busy. 2 models, priority strategy."],
  "models tab (combo profiles off)": ["Show combos as agent profiles"],
  "models tab (switch combo profiles)": ["Combo profiles removed from Paseo. Your own profiles are unchanged."],
  "settings tab (operator, stacked compression)": [H.Settings, ADVANCED, "Context compression", "Now: RTK → Caveman", "12.3k tokens saved", "RTK is on: Can drop a line an agent needed", "Caveman is on:", "Recommended for Claude Code and Codex agents: Lite only", "prompt caching", "2,000 characters", "What each engine does", "Router settings", "Read-only here", "Circuit breakers", "More in OmniRoute", "In the dashboard, which has its own login", "Add a provider", "Provider quotas", "Context sources for MCP", "Routing rules", "Embedded services", "OpenWA"],
  "settings tab (admin, apply recommended)": ["Confirm: Lite only", "Turns every engine off except Lite", "Cancel", "Hide what each engine does", "Session dedup", "avoid for agents", "For agents: Safe for Claude Code.", "OmniGlyph", "Your manage key lets you change these here."],
  "settings tab (recommended already)": ["Now: Lite", "recommended setting", "Turn compression off"],
  "connection tab (public address ok)": ["Public address", "https://ai-router.example.com", "HTTPS OK · ai-router.example.com", "Your daemons use the endpoint above; people and browsers outside your network use this address.", "Share this router", "Endpoint", "Your own, from the router admin", "Claude Code", "export ANTHROPIC_BASE_URL=https://ai-router.example.com", "export ANTHROPIC_AUTH_TOKEN=<your key>", "export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1", "export CLAUDE_CODE_DISABLE_FAST_MODE=1", "beta", "Codex", 'base_url = "https://ai-router.example.com/v1"', "Paseo", "paseo plugin install git:https://github.com/itsjustanks/paseo-plugin-ai-router.git:apps/paseo", "export AI_ROUTER_URL=https://ai-router.example.com", "Copied the Claude Code setup", "Its login comes from your router admin."],
  "connection tab (public address pending, narrow)": ["Public address", "DNS not pointing here yet", "The public address is not ready yet", "Share this router"],
  "connection tab (no public address)": ["Public address", "Not set", "Share this router", "Set a public address (custom domain) under Edit"],
  "overview (public address ok)": ["Open OmniRoute dashboard", "via custom domain"],
  "activity (operator)": [H.Activity, "Agent sessions on this daemon", "The last 200 are kept.", "Fix the login bug", "routed", "Claude", "requests linked in OmniRoute's log", "Review the parser", "Codex via OmniRoute", "Tidy the docs", "own sign-in", "the router did not answer (connection refused)", "Show all 11", "Requests through the router", "This daemon", "All daemons", "Errors only", "claude-sonnet-5", "gpt-5.6-sol", "claude-opus-5-5", "cc/claude-opus-5-5 → glm-5.2", "fallback", "Claude · so…@example.com · 1.8 s · 12.4k in / 820 out", "Agent: Fix the login bug", "Agent: Review the parser (likely)", "Agent: Draft release notes", "429", "Why?", "Refreshes every 10 seconds while this tab is open.", "prompts and responses never leave the router"],
  "activity (operator, narrow, all sessions)": ["Show fewer", "Agent agent-15", "not started", "no API key set"],
  "activity (errors only)": ["429", "[429] Rate limited: the 5-hour limit resets at 16:00", "Agent: Fix the login bug"],
  "activity (all daemons, a model)": ["claude-haiku-4-5", "daemon-b", "Claude · so…@example.com · 640 ms · 800 in / 90 out"],
  "activity (why this route)": ["Hide", "Direct request served by glm/glm-5.2 after claude answered 503.", "Account: te…@example.com", "Recent health: Claude answered 2 of the last 5 requests.", "Tried first", "Claude · claude-opus-5-5 answered 503: upstream unavailable", "Detailed request pipeline payloads were not persisted", "Request r-300. Prompts and responses are never shown here."],
  "activity (show older)": ["claude-haiku-4-5", "claude-sonnet-5"],
  "activity (nothing yet)": ["No requests match from this daemon."],
  "activity (basic)": ["Agent sessions on this daemon", "Fix the login bug", "More with a read token", "A read token adds every request the router served"],
  "activity (router down, last answer)": ["Router unreachable — showing its answer as of", "Requests: the router is not answering", "Agent: Fix the login bug"],
  "activity (not connected)": ["Agent sessions on this daemon", "Once a router is connected with a read token, every request it served shows here."],
  "overview (last agent links to Activity)": [H.Activity, "Agent sessions on this daemon"],
  "tab walk (basic)": [H.Overview],
  "tab walk (operator)": [H.Overview],
  "tab walk (admin)": [H.Overview],
  "tab walk (router down)": ["OmniRoute unreachable"],
  "tab walk (not connected)": [H.Connection],
  "router settings (read-only)": ["Router settings", "Read-only here", "Circuit breakers", "Claude paused", "Prefer Claude Code for bare Claude model names", "Routing strategy", "Change in dashboard"],
  "router settings (manage key)": ["Your manage key lets you change these here.", "Turn off", "Reset circuit breakers and model cooldowns", "Open in dashboard"],
  "router settings (no token)": ["Router settings: read token needed", "Add a read token to see the router's settings."],
  "usage tab": ["Requests per day", "Top models", "Who uses the most", "this daemon", "daemon-a"],
  "usage tab (no token)": ["Usage: read token needed", "Add a read-only access token"],
  "overview (MCP card)": [...MCP, "Copy install source", "Hide"],
  "overview (MCP installed, narrow)": ["MCP plugin installed: manage MCP servers for all your agents in one place.", "View plugin"],
  "overview (hide the MCP card)": ["MCP line hidden. Settings → In Paseo brings it back."],
  "tips tab (operator)": [H.Tips, "Recommended plugins", "0 of 4 installed here.", "Install one in Paseo's Settings → Plugins by pasting its source", "Plugins run with the daemon's access", "Paseo MCP", "by itsjustanks", "Activity", "Remote Editor", "--ref 56bc4056630ebd766395ba3e71c6d92268e95f59", "Tell Agent", "paseo plugin add npm:@omercnet/paseo-tell-agent@1.2.0", "paseo plugin add git:https://github.com/itsjustanks/paseo-mcp.git", "View on Paseo Cafe", "Copy install command", "Browse every plugin on Paseo Cafe"],
  "tips tab (admin, two installed, copy one)": ["2 of 4 installed here.", "Installed", "Copied the Activity install command"],
  "tips tab (not connected)": [H.Tips, "0 of 4 installed"],
  "settings tab (basic)": [H.Settings, ...IN_PASEO, "Router settings", "A read token shows how the router compresses prompts", "Add a read token on Connection"],
  "settings tab (not connected)": [...IN_PASEO, "Connect a router to see its settings.", "Open Connection"],
  "settings tab (badge off)": ["Breakdown chip off.", "Context compression"],
  "context chip": ["Breakdown"],
  "context chip (nearly full)": ["Breakdown"],
  "context panel (operator)": ["Context", "Fix the login bug", "186,204 of 1,000,000 tokens", "19% full", "Exact: as the agent reported it after its last turn.", "What's using it", "Biggest first.", "MCP tool results", "IKIT: Attio ≈ 50k", "linear", "Files read", "package-lock.json ≈ 40k", "src/server/handlers.ts ≈ 24k", "System prompt, tools and instructions", "40k · 21% · measured", "Measured by OmniRoute: the chat's first request, less its first message (counted under your messages).", "Not in the chat's history", "the rest", "images, attachments, and tool output Paseo keeps shorter", "Command output", "npm ≈", "Web pages and web searches", "docs.example.com", "Tip: Whole-file reads stay in context: ask for just the lines you need", "Measured by OmniRoute", "Latest request: 185,004 tokens in (claude-opus-5-5", "First request: 41,300 tokens in", "the system prompt, tools and instructions, plus the first message", "Thinking isn't counted, and images and attachments aren't in the chat's history", "Refresh", "Hide the Breakdown chip"],
  "context panel (compacted, nearly full, narrow)": ["86% full", "Nearly full: compact the chat now (/compact)", "Counted since the chat was last compacted", "System prompt, tools, instructions and the compaction summary", "a summary of what came before"],
  "context panel (basic)": ["58,400 of 200,000 tokens", "A read token adds what OmniRoute measured for this chat"],
  "context panel (no turn yet)": ["No context size yet", "the agent reports it after a turn"],
  "context panel (timeline error, refresh)": ["Couldn't read this chat's context", "Reading the chat's timeline took longer than 8 s"],
  "context panel (hide the badge)": ["Breakdown chip off for this daemon. AI Router → Settings → In Paseo turns it back on."],
  "context chip (router down)": ["Router down"],
  "context chip (router down, no turn yet)": ["Router down"],
  "context panel (router down)": ["Router down", "OmniRoute isn't answering (connection refused). This chat's requests go through it", "Open AI Router", "186,204 of 1,000,000 tokens"],
  "activity (open an agent)": [H.Activity, "Open", "Agent: Draft release notes"],
  "providers tab (narrow, learn more)": [H.Providers, "Hide what you can do here", "Re-route built-in Claude or Codex (each asks first)", "See how Codex reaches the router's accounts", "Update Claude Code and Codex on this daemon", "Turn off providers that can't run here"],
  "overview (guide opens Providers)": [H.Providers, "Re-route providers"],
  "overview (not connected)": ["Hide how AI Router works", "Connect a router first", ...GUIDE],
  "setup (link opens the guide)": ["Connect a router first", "What is AI Router?", "How it works"],
};

/** Text a state must NOT show: a hidden tier feature, or a fact that moved. */
const absent = {
  "accounts tab (operator)": ["Paseo's Usage page"],
  "setup (not connected, opens on Connection)": ["Accounts", "Usage"],
  "connection tab (operator, private dashboard)": ["Starting a tunnel makes", "password"],
  "overview (basic)": ["Accounts", "Usage", LEARN_MORE, "What is AI Router?"],
  "context chip": ["186k", "1M"],
  "context chip (nearly full)": ["190k", "200k"],
  "context chip (router down)": ["186k"],
  "overview (routing off)": ["Route Claude agents through AI Router", "Turn Claude routing off", "All set", "On your router now:"],
  "providers tab (basic, narrow)": ["Agent providers on this daemon", "Enabled", "Disabled", "Not supported", "AI Router Codex", "Add a Codex provider that runs on the router's accounts", "Can't be re-routed", "Send the built-in Claude provider through the router"],
  "overview (routing on, narrow)": ["See at a glance whether the shared router is answering", "What is AI Router?", "More with a manage key", LEARN_MORE, "Pick \"AI Router\" in Paseo's provider menu"],
  "providers tab (agent apps, Mac)": ["Update Claude Code"],
  "models tab": ["out of step"],
  "providers tab (own sign-in asks first, cancel)": ["If this daemon has none, they won't answer", "Use own sign-in", "Claude back on its own sign-in"],
  "providers tab (re-route Claude asks first)": ["Claude re-routed"],
  "providers tab (re-route Claude confirmed)": ["New Claude chats on this daemon will use OmniRoute's accounts"],
  "overview (MCP installed, narrow)": ["Copy install source"],
  "tips tab (operator)": ["Not on Paseo 0.9.1 yet", "Can't install here yet", "Smart Session", "smart-session", "Shared Browser", "shared-browser", "Advanced Markdown", "advanced-markdown"],
  "overview (hide the MCP card)": ["Also try MCP"],
  "tips tab (admin, two installed, copy one)": ["paseo plugin add alhassanaraouf/paseo-remote-editor", "Shared Browser", "Advanced Markdown"],
  "settings tab (basic)": ["Context compression", "More in OmniRoute"],
  "settings tab (not connected)": ["Connect a router first"],
  "context panel (operator)": ["Nearly full", "A read token adds", "PROMPT"],
  "context panel (basic)": ["Latest request", "First request", "· measured"],
  "context panel (compacted, nearly full, narrow)": ["· measured"],
  "overview (admin, tunnel)": ["More with"],
  "overview (router down)": ["Up · "],
  "accounts tab (operator)": ["Check now", "Check all", "Refresh token"],
  "settings tab (operator, stacked compression)": ["Apply recommended", "Shrinks long prompts"],
  "settings tab (recommended already)": ["Apply recommended"],
  "models tab (combo profiles off)": ["Auto · coding"],
  "usage tab (24 hours)": ["Requests per day", "Tokens per day"],
  "accounts tab (Claude paused)": ["The Settings tab can reset it."],
  "router settings (read-only)": ["Context compression"],
  "connection tab (public address ok)": ["sk-", "oma_live", "password"],
  "overview (public address ok)": ["via Cloudflare tunnel"],
  "activity (operator)": ["daemon-a", "daemon-b", "cc/claude-sonnet-5", "Show fewer", "Hide", "Tried first"],
  "activity (errors only)": ["gpt-5.6-sol", "glm-5.2", "Agent: Draft release notes"],
  "activity (all daemons, a model)": ["gpt-5.6-sol", "glm-5.2"],
  "activity (show older)": ["Show older"],
  "activity (basic)": ["Requests through the router", "This daemon"],
  "activity (not connected)": ["More with a read token"],
};

/** What each tab shows when pressed in a mounted surface, and which tabs the tier offers. */
const notConnected = ["Connect a router first", "Not connected yet: no endpoint URL set.", "Open Connection"];
const expectedTabs = {
  "tab walk (basic)": {
    Overview: [H.Overview, "Key only"],
    Traffic: [H.Activity, "Agent sessions on this daemon", "More with a read token"],
    Models: [H.Models, "Your access"],
    Providers: [H.Providers, "Tidy up"],
    Settings: [H.Settings, "In Paseo", "A read token shows how the router compresses prompts"],
    Connection: [H.Connection, "More access (optional)"],
    Tips: [H.Tips, "Paseo MCP"],
  },
  "tab walk (operator)": {
    Overview: [H.Overview, "Up · 12 ms", "Read token"],
    Traffic: [H.Activity, "Requests through the router", "Agent: Fix the login bug"],
    Models: [H.Models, "In Paseo's model picker", "GPT-5.6 Terra"],
    Providers: [H.Providers, "Re-route providers", "Through OmniRoute"],
    Accounts: [H.Accounts, "3 accounts · 3 healthy"],
    Usage: [H.Usage, "Requests per day", "By account"],
    Settings: [H.Settings, "In Paseo", "Context compression", "More in OmniRoute"],
    Connection: [H.Connection, "More access (optional)", "Check now"],
    Tips: [H.Tips, "0 of 4 installed"],
  },
  "tab walk (admin)": {
    Overview: ["Up · Claude paused", "Accounts →"],
    Traffic: ["Requests through the router", "This daemon"],
    Models: ["Sync models to Paseo", "Test another model"],
    Providers: ["Optional extras"],
    Accounts: ["Claude paused after errors", "Resume now", "Check all"],
    Usage: ["Who uses the most", "Top models"],
    Settings: ["Apply recommended…", "Reset circuit breakers and model cooldowns"],
    Connection: ["Saved …89ab", "OmniRoute's tunnels"],
    Tips: ["Recommended plugins"],
  },
  "tab walk (router down)": {
    Overview: ["OmniRoute unreachable — last seen", "Open Connection"],
    Traffic: [H.Activity, "Router unreachable — showing its answer as of"],
    Models: [H.Models, "Your access"],
    Providers: [H.Providers, "Re-route providers"],
    Accounts: [H.Accounts],
    Usage: [H.Usage],
    Settings: [H.Settings, "Context compression"],
    Connection: [H.Connection, "connection refused", "Check now"],
    Tips: [H.Tips],
  },
  "tab walk (not connected)": {
    Overview: [H.Overview, ...notConnected],
    Traffic: [H.Activity, "Agent sessions on this daemon", "Once a router is connected"],
    Models: [H.Models, ...notConnected],
    Providers: [H.Providers, "Re-route providers"],
    Settings: [H.Settings, "In Paseo", "Connect a router to see its settings."],
    Connection: [H.Connection, "1. Choose your router", "4. Test connection & save"],
    Tips: [H.Tips, "Tell Agent"],
  },
};
const walkTabs = { "tab walk (basic)": BASIC_TABS, "tab walk (operator)": ALL_TABS, "tab walk (admin)": ALL_TABS, "tab walk (router down)": ALL_TABS, "tab walk (not connected)": BASIC_TABS };

let failed = 0;
for (const name of Object.keys(mounts)) {
  const complaints = [];
  const original = console.error;
  console.error = (...args) => {
    const line = args.map(String).join(" ");
    if (/order of Hooks|Rendered more hooks|Rendered fewer hooks|Should have a queue/.test(line)) complaints.push(line);
    // The renderer's own deprecation notice is not a finding about the plugin.
    else if (!/react-test-renderer is deprecated/.test(line)) original(...args);
  };
  try {
    const { before, after, tabs } = await renderThroughDataArrival(name);
    assert.equal(complaints.length, 0, `${name}: ${complaints[0]?.split("\n")[0]}`);
    assert.ok(before.nodes > 0, `${name}: rendered nothing before data arrived`);
    assert.ok(after.nodes > 0, `${name}: rendered nothing after data arrived`);
    assert.ok(expected[name], `${name}: no expected text listed`);
    for (const needle of expected[name]) assert.ok(after.text.includes(needle), `${name}: missing "${needle}"`);
    for (const needle of absent[name] ?? []) assert.ok(!after.text.includes(needle), `${name}: should not show "${needle}"`);
    const walk = expectedTabs[name];
    if (walk) {
      assert.deepEqual(Object.keys(tabs).sort(), [...walkTabs[name]].sort(), `${name}: the tier's tabs, and only those, can be pressed`);
      for (const [tab, needles] of Object.entries(walk)) {
        for (const needle of needles) assert.ok(tabs[tab].includes(needle), `${name} → ${tab}: missing "${needle}"`);
      }
    }
    console.log(`ok   ${name} (${before.nodes} elements before data, ${after.nodes} after${walk ? `, ${Object.keys(tabs).length} tabs pressed` : ""})`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    console.error = original;
  }
}

try {
  const seen = await badgeRegistryCheck();
  assert.deepEqual(seen.first, { added: ["a"], opened: 1 }, "a chip only for a chat that reported its window; none before a turn or once archived; it opens the panel");
  assert.deepEqual(seen.afterTurn, ["a", "b"], "a later turn does not add a second chip; a chat's first report adds its chip");
  assert.deepEqual(seen.offRemoved, ["a", "b"], "switching the badge off removes every chip at once");
  assert.equal(seen.backOn, 4, "switching it on again brings them back");
  assert.deepEqual(seen.removedAll, ["a", "a", "b", "b"], "a removed agent loses its chip, and stopping removes the rest");
  assert.ok(seen.rpcCalls <= 6, `the switch is read on demand, not per update (${seen.rpcCalls} reads)`);
  assert.deepEqual([seen.alerted, seen.cleared], [true, true], "a router problem gives an affected chat a chip even before its first turn, and takes it away once cleared");
  assert.deepEqual([seen.whileOut, seen.slowReads, seen.afterStop], [1, 2, 2], "three presses during a slow read: one read out, one queued, and nothing after stopping");
  console.log(`ok   context badge registry (${seen.rpcCalls} switch reads)`);
  const btn = await badgeButtonsCheck();
  assert.deepEqual(btn.invalid, [], "every chip and update passes the app's validateButton rules");
  assert.deepEqual(btn.afterRefusal, { refusedLeft: 0, added: ["a"] }, "a refused add does not throw out of the loop; the next pass adds the chip");
  assert.deepEqual(btn.first, [{ agentId: "a", label: "Breakdown", icon: "ChartPie" }], "0.9+: the snapshot gives a chip to the chat with a window; none before a turn or once archived");
  assert.deepEqual(btn.afterTurn, ["a", "b"], "an agent_update from the observation adds b's chip; other messages are ignored");
  assert.deepEqual(btn.alertUpdate, { label: "Router down", icon: "TriangleAlert" }, "a router problem is pushed as the label, with a warning icon");
  assert.deepEqual(btn.clearedUpdate, { label: "Breakdown", icon: "ChartPie" }, "and pushed back once it clears");
  assert.equal(btn.quietReads, 0, "an unchanged face is not pushed again");
  assert.deepEqual(btn.opened, [["ai-router-context", { workspaceId: "ws-1", agentId: "a" }]], "pressing the button opens that chat's panel");
  assert.deepEqual(btn.afterSnapshot, { added: ["a", "b", "d"], removed: ["a"] }, "a new snapshot replaces the list");
  assert.deepEqual(btn.removedAll, ["a", "b", "d"], "a removed agent loses its chip, and stopping removes the rest");
  assert.deepEqual([btn.listCalls, btn.oldSubscribeCalls, btn.released], [1, 0, 1], "one observation, never the bare listener, released on stop");
  console.log("ok   context badge as a button on Paseo 0.8.0 stable and later, fed by its own agent observation");
  const follow = await followAgentsCheck();
  assert.deepEqual(follow.onOld, { listCalls: 0, seen: ["up:p", "rm:p"] }, "0.8: the app's own listener, and never an observation of the plugin's");
  assert.deepEqual(follow.opened, { calls: 3, seen: ["all:a"] }, "0.9+: a refused open and one with no observation are retried with backoff; the list skips empty entries");
  assert.deepEqual(follow.reopened, { calls: 4, seen: ["all:a"] }, "a dropped observation is reopened and its list replaces what was known");
  assert.deepEqual([follow.released, follow.callsAfterStop], [1, 4], "stop releases the observation and opens nothing more");
  console.log("ok   agents followed on 0.8 (listener) and 0.9+ (own observation, reopened when dropped)");
  assert.deepEqual(openedAgents.slice(-2), ["agent-7", "agent-5"], "Activity's Open asks Paseo to open that agent");
  console.log("ok   activity opens agents through Paseo's navigation");
} catch (error) {
  failed += 1;
  console.error(`FAIL context badge registry: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const bar = await tabBarWidthCheck();
  for (const label of ["Overview", "Traffic", "Settings", "Connection", "Tips"]) assert.ok(bar.wide.includes(label), `wide bar shows "${label}"`);
  assert.equal(bar.tight.trim(), "Usage", "at 772 px (a half-width window) only the active tab keeps its label");
  assert.equal(bar.tightIcons, 9, "every tab keeps its icon, so none is cut off");
  console.log("ok   tab bar gives way to icons when the labels do not fit");
} catch (error) {
  failed += 1;
  console.error(`FAIL tab bar width: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const seen = nativeRegistrationCheck();
  // A 0.9 app (the fleet's): exactly what 0.13 registered.
  assert.deepEqual(seen.old.names, ["addSurface", "addSidebarItem", "addWorkspacePanel"], "0.9 app: the surface and the sidebar item, nothing newer");
  assert.equal(seen.old.calls.addSurface.id, "ai-router");
  assert.ok(seen.surfaceIsTheView, "the surface is the AI Router view");
  assert.deepEqual(seen.old.calls.addSidebarItem, { id: "ai-router", title: "AI Router", icon: "Route", surface: "ai-router" });
  assert.deepEqual(seen.old.opened, [["openSurface", "ai-router"]], "0.9 app: the command opens the surface");
  // A 0.11 app: a titled screen and the app's own sidebar row, highlighted while the screen is open.
  assert.deepEqual(seen.next.names, ["addWorkspacePanel"], "0.11 app: no surface or old sidebar item");
  assert.deepEqual(seen.next.screen, { id: "ai-router", title: "AI Router", sameView: true });
  assert.deepEqual(seen.next.item, { id: "ai-router", title: "AI Router" });
  assert.deepEqual(seen.row, { open: { icon: "Route", active: true, label: undefined }, elsewhere: { active: false }, pressed: [{ screenId: "ai-router" }], trailing: true });
  assert.deepEqual(seen.next.opened, [["openScreen", { screenId: "ai-router" }]], "0.11 app: the command uses openScreen");
  // A 0.11 app without the row component: the screen, and the old sidebar item pointing at it.
  assert.deepEqual(seen.partial, ["addSidebarItem", "addWorkspacePanel"]);
  // External links: the app's opener when it has one, else Linking.openURL.
  assert.deepEqual(seen.links, { noOpener: null, withOpener: true });
  console.log("ok   main view registers as a screen with the app's sidebar row on 0.11 apps, as before on older ones");
} catch (error) {
  failed += 1;
  console.error(`FAIL native registration: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const quick = await quickActionsCheck();
  assert.equal(quick.label, "AI Router: Working · 12 models. Quick actions", "the dot says the state");
  assert.ok(quick.popped, "pressing the dot opens the quick actions popover");
  assert.equal(quick.plainPressables, 0, "without popovers (older 0.11 builds) it is only a dot");
  for (const words of ["AI Router · Working · 12 models", "Open AI Router", "Open dashboard", "Sync models"]) assert.ok(quick.text.includes(words), `popover shows "${words}": ${quick.text}`);
  assert.ok(quick.synced && quick.text.includes("ok"), "Sync models runs the sync and shows its answer");
  assert.ok(quick.opened, "Open AI Router is there to press");
  assert.deepEqual(quick.screens, [{ screenId: "ai-router" }], "Open AI Router opens the screen");
  assert.equal(quick.closed, 1, "and closes the popover");
  console.log("ok   sidebar status dot opens quick actions on 0.11 apps");
} catch (error) {
  failed += 1;
  console.error(`FAIL quick actions: ${error instanceof Error ? error.message : String(error)}`);
}

if (failed) {
  console.error(`hook-order: ${failed} failing`);
  process.exit(1);
}
console.log("hook-order: every component keeps its hook order across data arrival, button presses and tab switches");
