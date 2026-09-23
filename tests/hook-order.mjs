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

const { mounts, renderThroughDataArrival, badgeRegistryCheck, openedAgents, tabBarWidthCheck } = await import(join(plugin, "node_modules", ".cache", "hook-order", "entry.mjs"));

/** Text each state must show once data arrives, so a render that silently drops a section fails. */
const BASIC_TABS = ["Overview", "Activity", "Models", "Providers", "Settings", "Connection", "Tips"];
const ALL_TABS = ["Overview", "Activity", "Models", "Providers", "Accounts", "Usage", "Settings", "Connection", "Tips"];
const H = {
  Overview: "Is traffic going through the router, and what to do next.",
  Activity: "What went through the router: each agent session on this daemon",
  Models: "The models this key can use through the router",
  Providers: "Every agent provider on this daemon, and which ones can go through OmniRoute.",
  Accounts: "Each connected subscription, how much it has left",
  Usage: "Usage & analytics: requests, tokens, cost and failures across the router",
  Settings: "What AI Router adds to Paseo",
  Connection: "Which router this daemon uses, the keys it holds",
  Tips: "Recommended plugins to level up your Paseo, from Paseo Cafe.",
};
const IN_PASEO = ["In Paseo", "Context badge on each chat", "amber from 60 %, red from 85 %", "Needs no read token", "\"Check out MCP\" card on Overview"];
const MCP = ["Check out MCP", "Manage MCP servers for Claude Code, Codex and your other agents in one place — sign-ins, tools and per-workspace switches.", "View plugin"];
const ADVANCED = "Advanced routing (combos, fallbacks, per-provider rules) lives in the OmniRoute dashboard";
const expected = {
  "setup (not connected, opens on Connection)": [H.Connection, "Not connected yet. Routing stays off", "Set up", "Four steps, about two minutes", "pick the AI Router provider to use OmniRoute", "1. Choose your router", "OmniRoute", "2. Endpoint URL", "http://10.0.0.5:20128", "3. API key", "named after it, so usage shows per daemon", "4. Test connection & save", "Nothing is saved until it does"],
  "setup (env, no key, narrow)": ["Not connected yet: no API key set for http://127.0.0.1:20128", "connection refused at", "Pre-filled from the AI_ROUTER_*", "AI_ROUTER_TOKEN set without AI_ROUTER_URL"],
  "misconfigured (opens on Connection)": [H.Connection, "Not connected yet: the saved endpoint in connection.json is not a usable http(s) URL.", "The saved public address is not a usable http(s) URL; it is ignored.", "1. Choose your router", "Disconnect (remove saved connection)"],
  "misconfigured overview": ["Connect a router first", "Not connected yet: the saved endpoint in connection.json is not a usable http(s) URL.", "Open Connection"],
  "connection tab (operator, private dashboard)": ["Connected to OmniRoute", "Endpoint", "http://10.0.0.5:20128", "API key", "…abcd", "Set by", "saved plugin settings", "Check now", "Edit", "Disconnect", "Stored in /root/.paseo/plugin-settings/ai-router", "More access (optional)", "The API key is enough to route agents", "Read token (optional)", "Saved …wxyz", "Manage key (optional)", "Anyone who can run commands on this daemon can use this key to change the router.", "Dashboard", "http://10.0.0.5:20128/dashboard", "Copy link", "Dashboard login: ask your router admin.", "Hide how to open it from elsewhere", "private network (10.0.0.5:20128)", "root@router.example.com", "Copy SSH command"],
  "connection tab (admin, tunnels)": ["OmniRoute's tunnels", "Starting a tunnel makes the dashboard reachable from the internet. Its login is still required.", "Cloudflare tunnel", "running", "https://quiet-river-demo.trycloudflare.com", "Stop", "Use as the public address", "ngrok tunnel", "not installed", "Tailscale Funnel", "Start", "via Cloudflare tunnel", "AI_ROUTER_CONSOLE_URL"],
  "connection tab (basic, narrow)": ["Read token (optional)", "Not set", "Add"],
  "connection tab (editing)": ["Edit connection", "1. Choose your router", "Test connection & save", "Cancel"],
  "connection tab (router down)": ["connection refused at http://10.0.0.5:20128/api/health/ping", "Check now", "Edit", "Disconnect"],
  "overview (routing on, narrow)": [H.Overview, "Up · 12 ms", "AI Router provider", "12 models", "pick it in Paseo to use OmniRoute", "Models →", "Built-in Claude", "Re-routed", "its chats go through OmniRoute", "Re-route providers →", "Access", "Read token", "Connection →", "Last Claude agent (", "routed through OmniRoute", "Activity →", "Open OmniRoute dashboard", "Sync models again", "Pick \"AI Router\" in Paseo's provider menu", "More with a manage key"],
  "overview (basic)": ["Key only", "More with a read token", "Last AI Router agent (", "routed through OmniRoute"],
  "overview (admin, tunnel)": ["Manage key", "Open OmniRoute dashboard", "via Cloudflare tunnel"],
  "overview (routing off)": ["Own sign-in", "Not synced", "Sync models to Paseo", "Built-in Claude keeps its own sign-in unless you re-route it on Providers."],
  "overview (last agent skipped)": ["used its own sign-in — the router did not answer (connection refused)"],
  "overview (router down)": ["OmniRoute unreachable — last seen", "connection refused at http://10.0.0.5:20128/api/health/ping", "Until it answers, AI Router agents will not start, and re-routed Claude agents keep their own sign-in.", "Open Connection", "Check again"],
  "overview (Claude paused)": ["Up · Claude paused", "Claude requests fail until OmniRoute retries", "Accounts →", "Last AI Router agent (", "did not start — no API key set"],
  "models tab": [H.Models, "Combo · 5", "team-review", "Your access", "This key", "daemon-a", "12 models on connected accounts", "Spend (monthly)", "$3.42 of $50.00", "resets 2026-10-01", "Tokens", "Claude quota", "5h: 64% left", "Sync models to Paseo", "It stays current by itself", "Remove from Paseo", "Combo 5 · Claude 4 · Codex 3", "old \"AI Router Codex\" provider", "In Paseo's model picker", "Claude · 4", "Opus 5.5", "cc/claude-opus-5-5", "failed", "Codex · 3", "GPT-5.6 Sol", "Test", "Test another model", "Claude Code version 2.1.280 or newer is required"],
  "models tab (basic, key hides its spend)": ["Your access", "12 models on connected accounts", "lacks the self:usage scope"],
  "models tab (testing one)": ["cc/claude-opus-5-5 answered in 640 ms"],
  "models tab (not synced)": ["Not synced yet: Paseo has no AI Router provider.", "Test a model"],
  "providers tab (basic, narrow)": [H.Providers, "Re-route providers", "The AI Router provider is the way to use OmniRoute", "A built-in provider keeps its own sign-in unless you re-route it here.", "Always through OmniRoute", "12 models", "Through OmniRoute", "Add Codex via OmniRoute", "no Codex login needed here", "Can't be re-routed: GitHub Copilot, Gemini, OpenCode, Pi.", ADVANCED, "Open dashboard", "Dashboard login: ask your router admin.", "Agent providers on this daemon", "Claude", "Available", "Codex", "Not installed", "GitHub Copilot", "Still loading", "Gemini", "yours", "Tidy up", "3 enabled providers are not usable on this daemon", "Tidy up…"],
  "providers tab (re-route Claude asks first)": ["New Claude chats on this daemon will use OmniRoute's accounts instead of this daemon's own Claude sign-in.", "Open chats switch when they reopen.", "if OmniRoute is down a chat keeps its own sign-in", "Re-route Claude", "Cancel"],
  "providers tab (re-route Claude confirmed)": ["Claude re-routed: new Claude chats use OmniRoute."],
  "providers tab (own sign-in asks first)": ["New Claude chats will use this daemon's own Claude sign-in. If this daemon has none, they won't answer: pick the AI Router provider for Claude through OmniRoute instead.", "Use own sign-in", "Cancel"],
  "providers tab (own sign-in asks first, cancel)": ["Through OmniRoute"],
  "providers tab (tidy up preview)": ["These will be turned off:", "• GitHub Copilot — never finished loading", "• OpenCode — not installed on this daemon", "• Pi — never finished loading", "Turn off 3", "Cancel", "Codex via OmniRoute · 3 models"],
  "providers tab (not connected)": ["Agent providers on this daemon", "GitHub Copilot"],
  "accounts tab (operator)": [H.Accounts, "3 accounts · 3 healthy", "Add account", "Codex sign-in in the dashboard calls back to port 1455", "healthy · 96% of 128 requests answered in 24 h", "Router health", "version 3.8.50", "running 1d 1h"],
  "accounts tab (admin, attention)": ["2 need attention", "Check all", "Check now", "Refresh token", "Re-login in dashboard", "Sign-in expired (2026-09-20)", "degraded · 40% of 10 requests answered in 24 h · failing: gpt-5.6-sol"],
  "accounts tab (Claude paused)": ["Claude traffic paused by OmniRoute's circuit breaker", "The Settings tab can reset it."],
  "accounts tab (token rejected)": ["Could not read accounts", "Accounts: 401 — read token rejected", "Try again"],
  "usage tab (in the surface)": [H.Usage, "24 hours", "7 days", "30 days", "Requests", "98.4% succeeded", "Tokens", "in ·", "Estimated cost", "as OmniRoute prices it", "Average latency", "3.8 s", "1.6% fell back to another model", "Requests per day", "Busiest day:", "Tap a day for its numbers", "Tokens per day, by provider", "Claude", "Codex", "GLM", "Provider split", "Top models", "claude-sonnet-5", "gpt-6-sol", "12% failed", "The swatch is the model's provider", "By daemon", "daemon-a", "this daemon", "daemon-b", "By account", "so…@example.com", "Failed requests by kind", "rate limit", "upstream 5xx", "Activity, last 52 weeks", "Fewer tokens", "More", "12 days in a row with traffic", "busiest weekday: Tue"],
  "usage tab (30 days, narrow)": ["Last 30 days.", "Activity, last 17 weeks", "Requests per day"],
  "usage tab (24 hours)": ["Daily charts start at 7 days", "Last 24 hours.", "Provider split"],
  "usage tab (in the surface, empty)": ["No requests in the last 7 days"],
  "usage tab (router down, last answer)": ["Router unreachable — showing its answer as of", "Usage: the router is not answering", "Requests per day"],
  "models tab (combo profiles)": ["Combos as agent profiles", "Show combos as agent profiles", "orchestrating agents read them", "Auto · coding", "auto/coding", "OmniRoute auto combo \"auto/coding\": Quality-first for code. Picks from Codex, Claude.", "Auto · best reasoning", "Best discovery (10% explore)", "Team review", "Opus 5.5 first, GPT-6 Sol when Claude is busy. 2 models, priority strategy."],
  "models tab (combo profiles off)": ["Show combos as agent profiles"],
  "models tab (switch combo profiles)": ["Combo profiles removed from Paseo. Your own profiles are unchanged."],
  "settings tab (operator, stacked compression)": [H.Settings, ADVANCED, "Context compression", "Now: RTK → Caveman", "12.3k tokens saved", "RTK is on: Can drop a line an agent needed", "Caveman is on:", "Recommended for Claude Code and Codex agents: Lite only", "prompt caching", "2,000 characters", "What each engine does", "Router settings", "Read-only here", "Circuit breakers", "More in OmniRoute", "Add a provider", "Provider quotas", "Context sources for MCP", "Routing rules", "Embedded services", "OpenWA"],
  "settings tab (admin, apply recommended)": ["Confirm: Lite only", "Turns every engine off except Lite", "Cancel", "Hide what each engine does", "Session dedup", "avoid for agents", "For agents: Safe for Claude Code.", "OmniGlyph", "Your manage key lets you change these here."],
  "settings tab (recommended already)": ["Now: Lite", "recommended setting", "Turn compression off"],
  "connection tab (public address ok)": ["Public address", "https://ai-router.example.com", "HTTPS OK · ai-router.example.com", "Your daemons use the endpoint above; people and browsers outside your network use this address.", "Share this router", "Endpoint", "Ask your router admin for your own key", "Claude Code", "export ANTHROPIC_BASE_URL=https://ai-router.example.com", "export ANTHROPIC_AUTH_TOKEN=<your key>", "export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1", "beta", "Codex", 'base_url = "https://ai-router.example.com/v1"', "Paseo", "paseo plugin install git:https://github.com/itsjustanks/paseo-plugin-ai-router.git:apps/paseo", "export AI_ROUTER_URL=https://ai-router.example.com", "Copied the Claude Code setup", "Dashboard login: ask your router admin."],
  "connection tab (public address pending, narrow)": ["Public address", "DNS not pointing here yet", "The public address is not ready yet", "Share this router"],
  "connection tab (no public address)": ["Public address", "Not set", "Share this router", "Set a public address (custom domain) under Edit"],
  "overview (public address ok)": ["Open OmniRoute dashboard", "via custom domain"],
  "activity (operator)": [H.Activity, "Agent sessions on this daemon", "Kept for the last 200.", "Fix the login bug", "routed", "Claude", "requests linked in OmniRoute's log", "Review the parser", "Codex via OmniRoute", "Tidy the docs", "own sign-in", "the router did not answer (connection refused)", "Show all 11", "Requests through the router", "This daemon", "All daemons", "Errors only", "claude-sonnet-5", "gpt-5.6-sol", "claude-opus-5-5", "cc/claude-opus-5-5 → glm-5.2", "fallback", "Claude · so…@example.com · 1.8 s · 12.4k in / 820 out", "Agent: Fix the login bug", "Agent: Review the parser (likely)", "Agent: Draft release notes", "429", "Why?", "Refreshes every 10 seconds while this tab is open.", "prompts and responses never leave the router"],
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
  "usage tab": ["Requests per day", "Top models", "By daemon", "this daemon", "daemon-a"],
  "usage tab (no token)": ["Usage: read token needed", "Add a read-only access token"],
  "overview (MCP card)": [...MCP, "Copy install source", "Hide"],
  "overview (MCP installed, narrow)": [...MCP, "Installed"],
  "overview (hide the MCP card)": ["MCP card hidden. Settings → In Paseo brings it back."],
  "tips tab (operator)": [H.Tips, "Recommended plugins", "0 of 6 installed on this daemon", "Plugins run with the daemon's own access", "Paseo MCP", "by itsjustanks", "Shared Browser", "Activity", "Advanced Markdown", "Mermaid", "Remote Editor", "--ref 56bc4056630ebd766395ba3e71c6d92268e95f59", "Tell Agent", "paseo plugin add git:https://github.com/itsjustanks/paseo-mcp.git", "View on Paseo Cafe", "Copy install command", "Browse every plugin on Paseo Cafe"],
  "tips tab (admin, two installed, copy one)": ["2 of 6 installed on this daemon", "Installed", "Copied the Activity install command"],
  "tips tab (not connected)": [H.Tips, "0 of 6 installed"],
  "settings tab (basic)": [H.Settings, ...IN_PASEO, "Router settings", "A read token shows how the router compresses prompts", "Add a read token on Connection"],
  "settings tab (not connected)": [...IN_PASEO, "Connect a router to see its settings.", "Open Connection"],
  "settings tab (badge off)": ["Context badge off.", "Context compression"],
  "context chip": ["186k / 1M"],
  "context chip (nearly full)": ["190k / 200k"],
  "context panel (operator)": ["Context", "Fix the login bug", "186,204 of 1,000,000 tokens", "19% full", "Exact: as the agent reported it after its last turn.", "What's using it", "Biggest first.", "MCP tool results", "IKIT: Attio ≈ 50k", "linear", "Files read", "package-lock.json ≈ 40k", "src/server/handlers.ts ≈ 24k", "System prompt, tools and instructions", "40k · 21% · measured", "Measured by OmniRoute: the chat's first request, less its first message (counted under your messages).", "Not in the chat's history", "the rest", "images, attachments, and tool output Paseo keeps shorter", "Command output", "npm ≈", "Web pages and web searches", "docs.example.com", "Tip: Whole-file reads stay in context: ask for just the lines you need", "Measured by OmniRoute", "Latest request: 185,004 tokens in (claude-opus-5-5", "First request: 41,300 tokens in", "the system prompt, tools and instructions, plus the first message", "Thinking isn't counted, and images and attachments aren't in the chat's history", "Refresh", "Hide the context badge"],
  "context panel (compacted, nearly full, narrow)": ["86% full", "Nearly full: compact the chat now (/compact)", "Counted since the chat was last compacted", "System prompt, tools, instructions and the compaction summary", "a summary of what came before"],
  "context panel (basic)": ["58,400 of 200,000 tokens", "A read token adds what OmniRoute measured for this chat"],
  "context panel (no turn yet)": ["No context size yet", "the agent reports it after a turn"],
  "context panel (timeline error, refresh)": ["Couldn't read this chat's context", "Reading the chat's timeline took longer than 8 s"],
  "context panel (hide the badge)": ["Context badge off for this daemon. AI Router → Settings → In Paseo turns it back on."],
  "context chip (router down)": ["Router down · 186k / 1M"],
  "context chip (router down, no turn yet)": ["Router down"],
  "context panel (router down)": ["Router down", "OmniRoute isn't answering (connection refused). This chat's requests go through it", "Open AI Router", "186,204 of 1,000,000 tokens"],
  "activity (open an agent)": [H.Activity, "Open", "Agent: Draft release notes"],
};

/** Text a state must NOT show: a hidden tier feature, or a fact that moved. */
const absent = {
  "setup (not connected, opens on Connection)": ["Accounts", "Usage"],
  "connection tab (operator, private dashboard)": ["Starting a tunnel makes", "password"],
  "overview (basic)": ["Accounts", "Usage"],
  "overview (routing off)": ["Route Claude agents through AI Router", "Turn Claude routing off"],
  "providers tab (basic, narrow)": ["Not supported", "AI Router Codex"],
  "providers tab (own sign-in asks first, cancel)": ["If this daemon has none, they won't answer", "Use own sign-in", "Claude back on its own sign-in"],
  "providers tab (re-route Claude asks first)": ["Claude re-routed"],
  "providers tab (re-route Claude confirmed)": ["New Claude chats on this daemon will use OmniRoute's accounts"],
  "overview (MCP installed, narrow)": ["Copy install source"],
  "tips tab (operator)": ["Smart Session", "smart-session"],
  "overview (hide the MCP card)": ["Check out MCP"],
  "tips tab (admin, two installed, copy one)": ["npm:@omercnet/paseo-shared-browser"],
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
    Activity: [H.Activity, "Agent sessions on this daemon", "More with a read token"],
    Models: [H.Models, "Your access"],
    Providers: [H.Providers, "Tidy up"],
    Settings: [H.Settings, "In Paseo", "A read token shows how the router compresses prompts"],
    Connection: [H.Connection, "More access (optional)"],
    Tips: [H.Tips, "Paseo MCP"],
  },
  "tab walk (operator)": {
    Overview: [H.Overview, "Up · 12 ms", "Read token"],
    Activity: [H.Activity, "Requests through the router", "Agent: Fix the login bug"],
    Models: [H.Models, "In Paseo's model picker", "GPT-5.6 Terra"],
    Providers: [H.Providers, "Agent providers on this daemon"],
    Accounts: [H.Accounts, "3 accounts · 3 healthy"],
    Usage: [H.Usage, "Requests per day", "By account"],
    Settings: [H.Settings, "In Paseo", "Context compression", "More in OmniRoute"],
    Connection: [H.Connection, "More access (optional)", "Check now"],
    Tips: [H.Tips, "0 of 6 installed"],
  },
  "tab walk (admin)": {
    Overview: ["Up · Claude paused", "Accounts →"],
    Activity: ["Requests through the router", "This daemon"],
    Models: ["Sync models to Paseo", "Test another model"],
    Providers: ["Codex via OmniRoute"],
    Accounts: ["Claude traffic paused by OmniRoute's circuit breaker", "Check all"],
    Usage: ["By daemon", "Top models"],
    Settings: ["Apply recommended…", "Reset circuit breakers and model cooldowns"],
    Connection: ["Saved …89ab", "OmniRoute's tunnels"],
    Tips: ["Recommended plugins"],
  },
  "tab walk (router down)": {
    Overview: ["OmniRoute unreachable — last seen", "Open Connection"],
    Activity: [H.Activity, "Router unreachable — showing its answer as of"],
    Models: [H.Models, "Your access"],
    Providers: [H.Providers, "Agent providers on this daemon"],
    Accounts: [H.Accounts],
    Usage: [H.Usage],
    Settings: [H.Settings, "Context compression"],
    Connection: [H.Connection, "connection refused", "Check now"],
    Tips: [H.Tips],
  },
  "tab walk (not connected)": {
    Overview: [H.Overview, ...notConnected],
    Activity: [H.Activity, "Agent sessions on this daemon", "Once a router is connected"],
    Models: [H.Models, ...notConnected],
    Providers: [H.Providers, "Agent providers on this daemon"],
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
  assert.deepEqual(openedAgents.slice(-2), ["agent-7", "agent-5"], "Activity's Open asks Paseo to open that agent");
  console.log("ok   activity opens agents through Paseo's navigation");
} catch (error) {
  failed += 1;
  console.error(`FAIL context badge registry: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const bar = await tabBarWidthCheck();
  for (const label of ["Overview", "Activity", "Settings", "Connection", "Tips"]) assert.ok(bar.wide.includes(label), `wide bar shows "${label}"`);
  assert.equal(bar.tight.trim(), "Usage", "at 772 px (a half-width window) only the active tab keeps its label");
  assert.equal(bar.tightIcons, 9, "every tab keeps its icon, so none is cut off");
  console.log("ok   tab bar gives way to icons when the labels do not fit");
} catch (error) {
  failed += 1;
  console.error(`FAIL tab bar width: ${error instanceof Error ? error.message : String(error)}`);
}

if (failed) {
  console.error(`hook-order: ${failed} failing`);
  process.exit(1);
}
console.log("hook-order: every component keeps its hook order across data arrival, button presses and tab switches");
