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

const { mounts, renderThroughDataArrival, routerErrorsCheck, alertRegistryCheck, alertButtonsCheck, commandsCheck, followAgentsCheck, openedAgents, tabBarWidthCheck, nativeRegistrationCheck, quickActionsCheck, titleFollowsTabCheck } = await import(join(plugin, "node_modules", ".cache", "hook-order", "entry.mjs"));

/** Text each state must show once data arrives, so a render that silently drops a section fails. */
const TABS = ["Overview", "Accounts", "Models", "Help"];
/** Where each old tab's content now shows (0.18.0): a heading or fold-out title on its new tab. */
const H = {
  Overview: "How it works",
  Activity: "Recent traffic",
  Models: "Send chats through the router",
  Providers: "Send chats through the router",
  Accounts: "This key's spending",
  Usage: "30 days",
  Settings: "What does AI Router add to Paseo?",
  Connection: "How is this computer connected?",
  Tips: "Which plugins work well with AI Router?",
};
/** Overview's guide: what AI Router is, how it works, how to use it, and the words. */
const GUIDE = ["What is AI Router?", "through one shared router, OmniRoute", "You sign in to each AI account once, on the router", "How it works", "1. You pick a model", "2. AI Router sends it", "3. OmniRoute picks an account", "4. The answer comes back", "If an account is busy", "the router tries another one by itself", "How to use it", "Start a new chat in Paseo.", "“Auto · Coding”", "Set the thinking level and mode as you normally would.", "Rather keep the built-in Claude or Codex provider?", "Send it through the router on the Models tab", "Open Models", "Words you'll see", "Provider", "Model", "Combo", "Router (OmniRoute)", "Account", "Key and access tier", "Routing", "Daemon"];
/** The intro block and "What you can do here" are gone since 0.18.0. */
const LEARN_MORE = "What you can do here";
const IN_PASEO = ["A chat shows a warning chip from AI Router only while the router can't serve it", "Sync AI Router models to Paseo", "/ai-router sync"];
const MCP = ["Also try Connectors: add the tools your agents use, such as GitHub or Linear, in one place for Claude Code, Codex and the rest.", "View plugin"];
/** Help's questions (0.20.0): every one folded, the guide among them. */
const HELP_GUIDE = "How does AI Router work?";
/** The setup form (0.20.0): three steps, no one-option router picker, the optional fields under Advanced. */
const SETUP = ["1. Endpoint URL", "http://10.0.0.5:20128", "2. API key", "named after it, so usage shows per daemon", "Advanced (optional): public address and SSH target", "3. Test connection & save", "Nothing is saved until it does"];
const ADVANCED = "Combos (named groups of models), fallbacks and per-provider rules live in the OmniRoute dashboard";
const expected = {
  "routing: down, Codex offer, Claude sign-in expired": ["OmniRoute unreachable", "The router isn't answering, and Claude's own sign-in on this computer has expired, so switching Claude off the router would leave its chats unable to answer. Wait for the router, or sign Claude in on this computer first.", "and new Claude chats have no working sign-in of their own here", "re-routed Codex can't answer", "The router isn't answering. Codex can use this computer's own sign-in until it's back.", "Use this computer's own sign-in for Codex", "Codex · through the router", "On · Uses your team's accounts on the router"],
  "routing: down, Codex own sign-in asks first": ["New Codex chats here will use this computer's own sign-in (Codex's own ChatGPT login) instead of the router.", "Nothing switches back by itself", "Yes, use own sign-in", "Cancel"],
  "routing: down, Codex own sign-in confirmed": ["Done: Codex now uses this computer's own sign-in for new chats."],
  "routing: Codex paused, no own sign-in": ["The router has paused Codex, and this computer has no Codex sign-in of its own, so switching Codex off the router would leave its chats unable to answer."],
  "routing: router back, switch back": ["Done: Codex now goes through the router, so new Codex chats use your team's accounts."],
  "routing: Overview Codex switch asks first": ["New Codex chats here will use your team's accounts on the router", "Yes, send Codex through the router", "Cancel"],
  "routing: Overview Codex switch confirmed": ["Done: Codex now goes through the router"],
  "routing: chip popover offer": ["Router down", "OmniRoute isn't answering", "The router isn't answering, and Claude's own sign-in on this computer has expired", "Use this computer's own sign-in for Codex", "Open AI Router"],
  "routing: error card offer (Claude paused)": ["Claude is paused on the router after repeated errors", "Use this computer's own sign-in for Claude", "Details"],
  "router error card (Claude paused, manage key)": ["Claude is paused on the router after repeated errors", "OmniRoute tries Claude again by itself", "This chat won't retry", "Open AI Router", "Resume now", "Details"],
  "router error card (resume asks first)": ["OmniRoute sends Claude requests again now, instead of waiting out the pause.", "Yes, resume now", "Cancel"],
  "router error card (resume confirmed)": ["Claude is back in rotation."],
  "router error card (paused, read token only)": ["Claude is paused on the router after repeated errors", "OmniRoute has resumed Claude since.", "Open AI Router"],
  "router error card (cooling down)": ["Claude accounts are cooling down until", ":41", "The router moves to another account by itself", "Open AI Router", "Details"],
  "router error card (details)": ["Hide details", "API Error: 503 [claude/claude-fable-5-1] [429]", "check your inference gateway (10.0.0.5:20128)"],
  "router error card (open AI Router)": ["Claude accounts are cooling down"],
  "router error card (chat on its own sign-in)": ["API Error: 503 [claude/claude-fable-5-1] [429]: rate_limit_error"],
  "router error card (another gateway, not in the log)": ["proxy.example.com:8080"],
  "router error card (our gateway, log says own sign-in)": ["Claude accounts are cooling down until"],
  "setup (not connected, opens on Connection)": ["Hide how AI Router works", "This computer (test) isn't connected to a router yet. Each computer has its own connection", "Set up", "Three steps, about two minutes", "until you pick the AI Router provider", "Where this daemon reaches your OmniRoute", ...SETUP],
  "setup (advanced fields)": ["Hide advanced", "Your daemons use the endpoint above; people and browsers outside your network use this address.", "Public address (custom domain)", "SSH target that can reach the router"],
  "setup (env, no key, narrow)": ["Not connected yet: no API key set for http://127.0.0.1:20128", "connection refused at", "Pre-filled from this daemon's AI_ROUTER_* variables", "AI_ROUTER_TOKEN set without AI_ROUTER_URL"],
  "misconfigured (opens on Connection)": ["Not connected yet: the saved endpoint in connection.json is not a usable http(s) URL.", "The saved public address is not a usable http(s) URL; it is ignored.", "1. Endpoint URL", "Disconnect (remove saved connection)"],
  "misconfigured overview": ["Not connected yet: the saved endpoint in connection.json is not a usable http(s) URL.", "1. Endpoint URL", ...GUIDE],
  "connection tab (operator, private dashboard)": ["Connected to OmniRoute", "Endpoint", "http://10.0.0.5:20128", "API key", "…abcd", "Set by", "saved plugin settings", "Edit", "Disconnect", "Stored in /root/.paseo/plugin-settings/ai-router", "More access (optional)", "The API key is enough to route agents", "Read token (optional)", "Saved …wxyz", "Manage key (optional)", "Anyone who can run commands on this daemon can use this key to change the router.", "Dashboard", "http://10.0.0.5:20128/dashboard", "Copy link", "Its login comes from your router admin.", "Hide how to open it from elsewhere", "private network (10.0.0.5:20128)", "root@router.example.com", "Copy SSH command"],
  "connection tab (admin, tunnels)": ["OmniRoute's tunnels", "A tunnel puts the dashboard on the internet, behind OmniRoute's own login.", "Cloudflare tunnel", "running", "https://quiet-river-demo.trycloudflare.com", "Stop", "Use as the public address", "ngrok tunnel", "not installed", "Tailscale Funnel", "Start", "via Cloudflare tunnel", "AI_ROUTER_CONSOLE_URL"],
  "connection tab (basic, narrow)": ["Read token (optional)", "Not set", "Add"],
  "connection tab (editing)": ["Edit connection", "1. Endpoint URL", "Test connection & save", "Cancel"],
  "connection tab (router down)": ["connection refused at http://10.0.0.5:20128/api/health/ping", "Edit", "Disconnect"],
  "overview (routing on, narrow)": ["New to AI Router? How it works", "All set: AI Router is working", "Pick AI Router when you start a chat.", "Versions", "Up to date", "OmniRoute 3.8.51 · AI Router 0.21.0", "What's new →", "Connected to OmniRoute · Read token", "Router", "Up · 12 ms", "Models in Paseo", "12 models", "Models →", "Claude · through the router", "On · Uses your team's accounts on the router", "Codex · through the router", "Off · Uses this computer's own sign-in", "AI Router", " · test", "Last Claude agent (", "routed through OmniRoute", "Recent traffic →", "Open OmniRoute dashboard", "Sync models"],
  "overview (guide opened)": ["Hide how AI Router works", "On your router now:", ...GUIDE],
  "overview (drift)": ["Models in Paseo", "2 out of step with OmniRoute"],
  "overview (Codex re-routed)": ["Codex · through the router", "On · Uses your team's accounts on the router"],
  "overview (basic)": ["Key only", "Last AI Router agent (", "routed through OmniRoute", "New to AI Router? How it works"],
  "overview (admin, tunnel)": ["Manage key", "Open OmniRoute dashboard", "via Cloudflare tunnel"],
  "overview (routing off)": ["Connected: one step left", "Sync the models to add AI Router to Paseo's provider menu.", "Claude · through the router", "Off · Uses this computer's own sign-in", "Not synced", "Sync models to Paseo", "Hide how AI Router works", "What is AI Router?", "Not in the menu yet? Sync models on the Models tab"],
  "overview (last agent skipped)": ["used its own sign-in — the router did not answer (connection refused)"],
  "overview (router down)": ["OmniRoute unreachable — last seen", "connection refused at http://10.0.0.5:20128/api/health/ping", "Until it answers, AI Router chats can't start, new Claude chats use this computer's own sign-in.", "The router isn't answering. Claude can use this computer's own sign-in until it's back.", "Use this computer's own sign-in for Claude", "Check the connection", "Refresh"],
  "overview (Claude paused)": ["Working, but Claude is paused", "OmniRoute paused Claude after errors and retries by itself.", "Up · Claude paused", "Claude requests fail until OmniRoute retries", "Accounts →", "Last AI Router agent (", "did not start — no API key set"],
  "models tab": [H.Models, "Combo · 5", "team-review", "Sync models to Paseo", "In Paseo", "in step with OmniRoute", "12 of the 734 models OmniRoute lists: one per model.", "Effort levels (Paseo's thinking control), duplicates, providers with no account and unproven variants are left out.", "runs by itself every 5 minutes and when the app connects", "Remove from Paseo", "old \"AI Router Codex\" provider", "Models in Paseo's picker", "Claude · 4", "Opus 5.5", "cc/claude-opus-5-5", "failed", "Codex · 3", "GPT-5.6 Sol", "Test", "Test another model", "Claude Code version 2.1.280 or newer is required"],
  "accounts tab (your access)": ["This key's spending", "This key", "daemon-a", "12 models on connected accounts", "Spend (monthly)", "$3.42 of $50.00", "resets 2026-10-01", "Tokens", "Claude quota", "5h: 64% left"],
  "models tab (basic, key hides its spend)": ["This key's spending", "12 models on connected accounts", "lacks the self:usage scope", "See your team's accounts and usage"],
  "models tab (testing one)": ["cc/claude-opus-5-5 answered in 640 ms"],
  "models tab (not synced)": ["Not synced", "Paseo has no AI Router provider yet", "Test a model"],
  "models tab (drift)": ["out of step with OmniRoute", "OmniRoute offers 2 models Paseo doesn't list yet: cx/gpt-6-luna, cc/claude-sonnet-5-5.", "Sync now", "14 of the 736 models OmniRoute lists"],
  "providers tab (basic, narrow)": [H.Providers, "AI Router chats always go through OmniRoute. Built-in Claude and Codex can too; each switch asks first, and Overview has the same two.", "Always through OmniRoute · 12 models", "On · Uses your team's accounts on the router", "Codex", "Codex is in the AI Router provider: 3 models.", "Codex extras", "Other providers", "GitHub Copilot, Gemini, OpenCode, Pi: not switched here; they keep their own sign-in.", ADVANCED, "Open dashboard", "Agent apps", "Tidy up", "3 enabled providers can't run here", "Settings → Providers turns any back on", "Tidy up…"],
  "providers tab (re-route Claude asks first)": ["New Claude chats here will use your team's accounts on the router, not this computer's own sign-in.", "Open chats switch when reopened.", "A chat that starts while the router is down uses this computer's own sign-in.", "Fast mode stays off for them", "Yes, send Claude through the router", "Cancel"],
  "providers tab (re-route Claude confirmed)": ["Done: Claude now goes through the router, so new Claude chats use your team's accounts."],
  "providers tab (own sign-in asks first)": ["New Claude chats here will use this computer's own sign-in. Without one they won't answer; the AI Router provider still reaches Claude through the router.", "Use own sign-in", "Cancel"],
  "providers tab (own sign-in asks first, cancel)": ["On · Uses your team's accounts on the router", "Fast mode is off for these chats"],
  "providers tab (tidy up preview)": ["These will be turned off:", "• GitHub Copilot — never finished loading", "• OpenCode — not installed on this daemon", "• Pi — never finished loading", "Turn off 3", "Cancel", "One is on", "\"Codex via OmniRoute\" is in Paseo's menu · 3 models", "4 Codex accounts connected in OmniRoute; their 3 models are in the AI Router provider."],
  "providers tab (not connected)": ["Send chats through the router", "GitHub Copilot, Gemini, OpenCode, Pi: not switched here"],
  "providers tab (re-route Codex asks first)": ["4 Codex accounts connected in OmniRoute; their 3 models are in the AI Router provider.", "New Codex chats here will use your team's accounts on the router, not this computer's own sign-in.", "~/.codex isn't changed", "While the router is down, these chats won't answer until you switch back.", "Yes, send Codex through the router", "Cancel"],
  "providers tab (re-route Codex confirmed)": ["Done: Codex now goes through the router, so new Codex chats use your team's accounts. Open chats switch when they restart."],
  "providers tab (Codex back on own sign-in asks first)": ["New Codex chats here will use this computer's own sign-in.", "Use own sign-in"],
  "providers tab (agent apps, Mac)": ["Agent apps", "The Claude Code and Codex this daemon runs", "Claude Code", "2.1.289", "Up to date", "Installed with Claude Code's own installer", "Codex", "0.156.1", "0.160.0 available", "Installed with npm", "Where it's installed", "Update to 0.160.0", "Latest versions come from npm, checked every hour and on Refresh."],
  "providers tab (agent apps, where installed)": ["Hide where it's installed", "/Users/me/.local/share/claude/versions/2.1.289"],
  "providers tab (agent apps asks first)": ["Runs \"npm install -g @openai/codex@latest --prefix /Users/me/.npm-global\" on this daemon, as the daemon's own user.", "running chats keep the old one until they restart", "Update Codex", "Cancel"],
  "providers tab (agent apps updating)": ["Updating…", "Running \"npm install -g @openai/codex@latest --prefix /Users/me/.npm-global\"…", "Hide output", "changed 1 package in 6s"],
  "accounts tab (Paseo 0.11 daemon)": ["3 accounts · 3 healthy", "Also on Paseo's Usage page (Settings → Usage), where a limit can be pinned to the sidebar."],
  "accounts tab (operator)": [H.Accounts, "3 accounts · 3 healthy", "Add account", "Signing in Codex from another computer?", "1 usage-limit reset credit banked", "healthy · 96% of 128 requests answered in 24 h", "Is the router healthy?", "version 3.8.50", "running 1d 1h", "Usage", "Who uses the most"],
  "accounts tab (admin, attention)": ["3 need attention", "Check all", "Check now", "Refresh token", "Clear cooldown", "Release cooldown", "Use a reset credit", "2 usage-limit reset credits banked", "Re-login in dashboard", "Sign-in expired (2026-09-20)", "degraded · 40% of 10 requests answered in 24 h · failing: gpt-5.6-sol"],
  "accounts tab (Claude paused)": ["Claude paused after errors", "Claude requests fail until OmniRoute retries in 30 s; other providers work.", "Resume now"],
  "accounts tab (token rejected)": ["Could not read accounts", "Accounts: 401 — read token rejected", "Try again"],
  "usage tab (in the surface)": [H.Usage, "Today", "7 days", "30 days", "Custom", "every 5 minutes", "Refresh", "Requests", "98.4% succeeded", "Tokens", "in ·", "Value", "at API prices · billed", "Who uses the most", "Worth = at API prices", "worth $", "Average latency", "3.8 s", "1.6% fell back to another model", "Requests per day", "Busiest day:", "Tap a day for its numbers", "Tokens per day, by provider", "Claude", "Codex", "GLM", "Provider split", "Top models", "claude-sonnet-5", "gpt-6-sol", "12% failed", "Swatch colour = the model's provider.", "daemon-a", "this daemon", "daemon-b", "By account", "so…@example.com", "Failed requests by kind", "rate limit", "upstream 5xx", "Activity, last 52 weeks", "Fewer tokens", "More", "12 days in a row with traffic", "busiest weekday: Tue"],
  "usage tab (30 days, narrow)": ["the last 30 days.", "Activity, last 17 weeks", "Requests per day", "Day by day"],
  "usage tab (24 hours)": ["Who uses the most", "today.", "Provider split", "Which providers and models"],
  "usage tab (in the surface, empty)": ["No requests the last 7 days"],
  "usage tab (router down, last answer)": ["Router unreachable — showing its answer as of", "Usage: the router is not answering", "Requests per day"],
  "models tab (combo profiles)": ["Combos as agent profiles", "Show combos as agent profiles", "with its description as notes", "Auto · coding", "auto/coding", "OmniRoute auto combo \"auto/coding\": Quality-first for code. Use it as the model on the AI Router provider", "Auto · best reasoning", "Best discovery (10% explore)", "Team review", "Opus 5.5 first, GPT-6 Sol when Claude is busy. 2 models, priority strategy."],
  "models tab (combo profiles off)": ["Show combos as agent profiles"],
  "models tab (switch combo profiles)": ["Combo profiles removed from Paseo. Your own profiles are unchanged."],
  "settings tab (operator, stacked compression)": [H.Settings, "Context compression", "Now: RTK → Caveman", "12.3k tokens saved", "RTK is on: Can drop a line an agent needed", "Caveman is on:", "Recommended for Claude Code and Codex agents: Lite only", "prompt caching", "2,000 characters", "What each engine does", "Router settings", "Read-only here", "Circuit breakers", "More in OmniRoute", "In the dashboard, which has its own login", "Add a provider", "Provider quotas", "Context sources for MCP", "Routing rules", "Embedded services", "OpenWA"],
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
  "activity (not connected)": [H.Activity, "Agent sessions on this daemon", "Once a router is connected with a read token, every request it served shows here."],
  "overview (last agent links to Activity)": [H.Activity, "Agent sessions on this daemon"],
  "tab walk (basic)": [H.Overview],
  "tab walk (operator)": [H.Overview],
  "tab walk (admin)": [H.Overview],
  "tab walk (router down)": ["OmniRoute unreachable"],
  "tab walk (not connected)": ["1. Endpoint URL"],
  "router settings (read-only)": ["Router settings", "Read-only here", "Circuit breakers", "Claude paused", "Prefer Claude Code for bare Claude model names", "Routing strategy", "Change in dashboard"],
  "router settings (manage key)": ["Your manage key lets you change these here.", "Turn off", "Reset circuit breakers and model cooldowns", "Open in dashboard"],
  "router settings (no token)": ["Router settings: read token needed", "Add a read token to see the router's settings."],
  "usage tab": ["Day by day", "Which providers and models", "Who uses the most", "this daemon", "daemon-a"],
  "usage tab (no token)": ["Usage: read token needed", "Add a read-only access token"],
  "overview (MCP card)": [...MCP, "Copy install source", "Hide"],
  "overview (MCP installed, narrow)": ["All set: AI Router is working"],
  "overview (hide the MCP card)": ["Connectors line hidden. Help → \"What does AI Router add to Paseo?\" brings it back."],
  "tips tab (operator)": [H.Tips, "Recommended plugins", "0 of 3 installed here.", "Install one in Paseo's Settings → Plugins by pasting its source", "Plugins run with the daemon's access", "Connectors", "by itsjustanks", "Add the tools your agents use, such as GitHub or Linear", "Remote Editor", "--ref 56bc4056630ebd766395ba3e71c6d92268e95f59", "Tell Agent", "paseo plugin add npm:@omercnet/paseo-tell-agent@1.2.0", "paseo plugin add git:https://github.com/itsjustanks/paseo-mcp.git", "View on Paseo Cafe", "Copy install command", "Browse every plugin on Paseo Cafe"],
  "tips tab (admin, two installed, copy one)": ["2 of 3 installed here.", "Installed", "Copied the Tell Agent install command"],
  "tips tab (not connected)": [H.Tips, "0 of 3 installed"],
  "settings tab (basic)": [H.Settings, ...IN_PASEO, "Which router settings matter?", "A read token shows how the router compresses prompts", "Add a read token"],
  "settings tab (not connected)": [...IN_PASEO, "Connect a router to see its settings.", "Set up"],
  "settings tab (MCP line off)": ["The Connectors line is back on Overview.", "Why are long prompts shortened?"],
  "alert chip (router down)": ["Router down"],
  "activity (open an agent)": [H.Activity, "Open", "Agent: Draft release notes"],
  "overview (guide opens Models)": [H.Models, "Sync models to Paseo"],
  "overview (not connected)": ["Hide how AI Router works", "1. Endpoint URL", "Recent traffic", ...GUIDE],
  "setup (link opens the guide)": ["1. Endpoint URL", "What is AI Router?", "How it works"],
  "help tab (operator)": [HELP_GUIDE, "How is this computer connected?", "OmniRoute at http://10.0.0.5:20128", "How do I see accounts and usage?", "How do other people use this router?", "How do I open the router's dashboard?", "What does AI Router add to Paseo?", "Why are long prompts shortened?", "Which router settings matter?", "What else can OmniRoute do?", "Which plugins work well with AI Router?"],
  "help tab (guide question)": [HELP_GUIDE, ...GUIDE],
  "help tab (basic, narrow)": ["How is this computer connected?", "How do I see accounts and usage?", "Which router settings matter?", "Needs a read token", "Which plugins work well with AI Router?"],
  "help tab (not connected)": [HELP_GUIDE, "How is this computer connected?", "Not connected yet", "What does AI Router add to Paseo?", "Which plugins work well with AI Router?"],
  "help tab (press a question)": ["Recommended plugins", "Connectors", "Tell Agent"],
  "accounts tab (basic)": ["See your team's accounts and usage", "A read token shows each account", "Add a read token", "This key's spending"],
  "accounts tab (not connected)": ["Connect a router first", "Set up"],
  "models tab (not connected)": ["Connect a router first", "Set up", "Send chats through the router", "Claude", "Off · Uses this computer's own sign-in", "Connect a router first to turn this on.", "Other providers", "Codex extras", "Tidy up Paseo's provider menu", "Claude Code and Codex versions"],
  "deep link (tab=connection)": ["Connected to OmniRoute", "More access (optional)", "Share this router", "Dashboard"],
  "deep link (tab=usage)": ["3 accounts · 3 healthy", "Requests per day", "Tokens per day, by provider", "Provider split", "By account", "Activity, last 52 weeks"],
  "deep link (tab=help, open=tips)": ["Recommended plugins", "0 of 3 installed here."],
  "deep link (unknown tab)": ["All set: AI Router is working"],
};

/** Text a state must NOT show: a hidden tier feature, or a fact that moved. */
const absent = {
  "routing: Codex paused, no own sign-in": ["Use this computer's own sign-in for Codex"],
  "routing: router back, switch back": ["Switch back to the router"],
  "routing: error card offer (Claude paused)": ["Switch back to the router"],
  "router error card (Claude paused, manage key)": ["OmniRoute has resumed"],
  "router error card (paused, read token only)": ["Resume now"],
  "router error card (cooling down)": ["Use this computer's own sign-in", "Resume now", "API Error", "Hide details"],
  "router error card (chat on its own sign-in)": ["Open AI Router", "cooling down", "Details"],
  "router error card (another gateway, not in the log)": ["Open AI Router", "cooling down"],
  "accounts tab (operator)": ["Paseo's Usage page", "Check now", "Check all", "Refresh token"],
  "connection tab (operator, private dashboard)": ["Starting a tunnel makes", "Check now"],
  "overview (basic)": ["Use this computer's own sign-in", "Switch back to the router", LEARN_MORE, "What is AI Router?"],
  "overview (routing off)": ["Route Claude agents through AI Router", "Turn Claude routing off", "All set", "On your router now:"],
  "providers tab (basic, narrow)": ["Agent providers on this daemon", "Enabled", "Disabled", "Not supported", "AI Router Codex", "Add a Codex provider that runs on the router's accounts", "Can't be re-routed", "Send the built-in Claude provider through the router"],
  "overview (routing on, narrow)": ["See at a glance whether the shared router is answering", "What is AI Router?", "More with a manage key", LEARN_MORE, "Pick \"AI Router\" in Paseo's provider menu"],
  "providers tab (agent apps, Mac)": ["Update Claude Code", "/Users/me/.npm-global", "Check now"],
  "models tab": ["out of step"],
  "providers tab (own sign-in asks first, cancel)": ["If this daemon has none, they won't answer", "Use own sign-in", "Claude back on its own sign-in"],
  "providers tab (re-route Claude asks first)": ["Claude re-routed"],
  "providers tab (re-route Claude confirmed)": ["New Claude chats on this daemon will use OmniRoute's accounts"],
  "overview (MCP installed, narrow)": ["Copy install source", "Also try Connectors", "MCP"],
  "help tab (operator)": ["Common questions", "How AI Router works", "What is AI Router?", "Words you'll see", ADVANCED],
  "help tab (not connected)": ["1. Endpoint URL", "Test connection & save", "What is AI Router?", "Common questions", "Set up"],
  "models tab (not connected)": ["Sync models, above, adds it", "This key can't see OmniRoute's accounts", "Not connected yet: no endpoint URL set.", "Not in Paseo yet"],
  "setup (not connected, opens on Connection)": ["Choose your router", "Self-hosted AI router", "Public address (custom domain)", "SSH target that can reach the router"],
  "settings tab (basic)": ["MCP plugin line on Overview", "In Paseo", "Why are long prompts shortened?", "What else can OmniRoute do?", "Breakdown"],
  "overview (router down)": ["Check again", "Up · "],
  "tips tab (operator)": ["Not on Paseo 0.9.1 yet", "Can't install here yet", "Smart Session", "smart-session", "Shared Browser", "shared-browser", "Advanced Markdown", "advanced-markdown"],
  "overview (hide the MCP card)": ["Also try Connectors"],
  "tips tab (admin, two installed, copy one)": ["paseo plugin add alhassanaraouf/paseo-remote-editor", "Shared Browser", "Advanced Markdown"],
  "settings tab (not connected)": ["Breakdown"],
  "overview (admin, tunnel)": ["More with"],
  "settings tab (operator, stacked compression)": ["Apply recommended", "Shrinks long prompts"],
  "settings tab (recommended already)": ["Apply recommended"],
  "models tab (combo profiles off)": ["Auto · coding"],
  "usage tab (24 hours)": ["Requests per day", "Tokens per day"],
  "accounts tab (Claude paused)": ["The Settings tab can reset it."],
  "router settings (read-only)": ["Context compression"],
  "connection tab (public address ok)": ["sk-", "oma_live"],
  "overview (public address ok)": ["via Cloudflare tunnel"],
  "activity (operator)": ["daemon-a", "daemon-b", "cc/claude-sonnet-5", "Show fewer", "Tried first"],
  "activity (errors only)": ["gpt-5.6-sol", "glm-5.2", "Agent: Draft release notes"],
  "activity (all daemons, a model)": ["gpt-5.6-sol", "glm-5.2"],
  "activity (show older)": ["Show older"],
  "activity (basic)": ["Requests through the router", "This daemon"],
  "activity (not connected)": ["More with a read token"],
};

/** What each tab shows when pressed in a mounted surface. Every tier sees all four tabs. */
const notConnected = ["Connect a router first", "Set up"];
const expectedTabs = {
  "tab walk (basic)": {
    Overview: [H.Overview, "Key only", H.Activity],
    Accounts: ["See your team's accounts and usage", "Add a read token", H.Accounts],
    Models: ["Sync models to Paseo", H.Models, "Models in Paseo's picker", "Codex extras", "Tidy up Paseo's provider menu", "Claude Code and Codex versions"],
    Help: [HELP_GUIDE, H.Connection, "How do I see accounts and usage?", H.Settings, "Which router settings matter?", "Needs a read token", H.Tips],
  },
  "tab walk (operator)": {
    Overview: [H.Overview, "Up · 12 ms", "Read token"],
    Accounts: ["3 accounts · 3 healthy", "Usage", "Who uses the most", "Day by day", "Which account answered", "Is the router healthy?", H.Accounts],
    Models: ["Sync models to Paseo", H.Models, "On · Uses your team's accounts on the router", "Combos as agent profiles"],
    Help: [H.Connection, "Why are long prompts shortened?", "Which router settings matter?", "What else can OmniRoute do?", H.Tips, "0 of 3 installed here"],
  },
  "tab walk (admin)": {
    Overview: ["Up · Claude paused", "Accounts →"],
    Accounts: ["Claude paused after errors", "Resume now", "Check all", "Who uses the most"],
    Models: ["Sync models to Paseo", "Codex extras"],
    Help: ["How do I open the router's dashboard?", "Why are long prompts shortened?"],
  },
  "tab walk (router down)": {
    Overview: ["OmniRoute unreachable — last seen", "Check the connection"],
    Accounts: [H.Accounts],
    Models: [H.Models],
    Help: [H.Connection, "Why are long prompts shortened?"],
  },
  "tab walk (not connected)": {
    Overview: ["1. Endpoint URL", "3. Test connection & save", "Hide how AI Router works"],
    Accounts: notConnected,
    Models: [...notConnected, H.Models, "Codex extras"],
    Help: [HELP_GUIDE, H.Connection, "Not connected yet", H.Settings, "Connect a router first", H.Tips],
  },
};

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
      assert.deepEqual(Object.keys(tabs).sort(), [...TABS].sort(), `${name}: the four tabs, and only those, can be pressed`);
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
  const re = routerErrorsCheck();
  assert.deepEqual(re.renderer, [{ kind: "router-error", version: 1, parses: true, rejects: true }]);
  assert.deepEqual(re.transformers, [{ id: "router-error-assistant-message", itemType: "assistant_message" }, { id: "router-error-error", itemType: "error" }], "ids pass the app's rule, one per item type");
  assert.deepEqual(re.removed, ["renderer:router-error", "transformer:router-error-assistant-message", "transformer:router-error-error"], "stopping removes all three");
  assert.equal(re.older, 0, "an app without both hooks gets nothing");
  assert.deepEqual(re.refused, { kept: 0, undone: ["renderer"] }, "an app that refuses one: the rest is undone, native rendering stays");
  assert.deepEqual(re.routerItem, [{ type: "plugin", kind: "router-error", version: 1, source: "assistant", same: true }], "a router error becomes one card item, the original text kept");
  assert.equal(re.streaming, undefined, "a message still streaming is left alone");
  assert.equal(re.reply, undefined, "a reply that mentions the router is left alone");
  assert.equal(re.native, undefined, "Anthropic's own error is left alone");
  assert.deepEqual(re.errorItem, { message: "[codex/gpt-6-sol] Unavailable (reset after 13s)", source: "error" });
  assert.ok(openedAgents.includes("router:accounts"), "Open AI Router opens the Accounts tab");
  console.log("ok   router errors: timeline hooks registered when available, only router errors transformed");
} catch (error) {
  failed += 1;
  console.error(`FAIL router errors: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const seen = await alertRegistryCheck();
  assert.deepEqual(seen.calm, [], "0.18.0: a calm chat gets no chip, whatever its context");
  assert.deepEqual(seen.down, ["a"], "the router goes down: the open, routed chat gets a chip; an archived one does not");
  assert.equal(seen.opened, 1, "pressing it opens AI Router");
  assert.equal(seen.cleared, true, "the chip goes once the problem clears");
  assert.equal(seen.whileOut, 1, "a slow read is never joined by a second one");
  assert.equal(seen.stoppedReads, 0, "nothing is read after stopping");
  console.log("ok   router-alert chips (old component shape)");
  const btn = await alertButtonsCheck();
  assert.deepEqual(btn.invalid, [], "every chip and update passes the app's validateButton rules");
  assert.deepEqual(btn.afterRefusal, { refusedLeft: 0, added: [] }, "a refused add does not throw out of the loop");
  assert.deepEqual(btn.first, [{ agentId: "a", label: "Router down", icon: "TriangleAlert" }], "the next pass adds the chip, on the alerted chat only");
  assert.equal(btn.opened, 1, "pressing the button opens AI Router");
  assert.deepEqual(btn.pausedUpdate, { label: "Claude paused", icon: "TriangleAlert" }, "a different problem is pushed as the label, not a second chip");
  assert.equal(btn.quietUpdates, 0, "an unchanged face is not pushed again");
  assert.deepEqual(btn.afterClear, { added: ["a"], removed: ["a"] }, "the chip goes once the problem clears");
  assert.deepEqual(btn.afterSnapshot, ["a", "d"], "a new snapshot replaces the list; its alerted chat gets a chip");
  assert.deepEqual(btn.removedAll, ["a", "d"], "stopping removes the rest");
  assert.deepEqual([btn.listCalls, btn.oldSubscribeCalls, btn.released], [1, 0, 1], "one observation, never the bare listener, released on stop");
  console.log("ok   router-alert chips as buttons on Paseo 0.8.0 stable and later, fed by their own agent observation");
  const commands = await commandsCheck();
  assert.deepEqual(commands.ids, ["ai-router-sync", "ai-router-check"]);
  assert.deepEqual(commands.slash, [{ name: "ai-router", hint: "sync | check", context: "agent" }]);
  assert.equal(commands.cleanups, 3);
  assert.deepEqual(commands.synced, { text: "12 models synced to Paseo.", tone: "success" }, "Sync models leaves its reply for the screen");
  assert.deepEqual(commands.checked, { text: "OmniRoute did not answer: connection refused", tone: "danger" }, "Check router says what the panel's Check now says");
  assert.deepEqual(commands.slashChecked, commands.checked, "/ai-router check does the same");
  assert.equal(commands.slashOpened, null, "/ai-router alone just opens AI Router");
  assert.equal(commands.opened, 4, "each one opens AI Router");
  assert.deepEqual(commands.calls, ["ai-router.provider:{\"enabled\":true}", "ai-router.status:{\"refresh\":true}", "ai-router.status:{\"refresh\":true}"]);
  assert.deepEqual(commands.words, ["sync", "sync", "check", null]);
  assert.deepEqual(commands.older, { ids: ["ai-router-sync", "ai-router-check"], cleanups: 2 }, "an app without slash commands still gets the Command Center items");
  console.log("ok   Sync models and Check router from the Command Center and /ai-router");
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
  console.error(`FAIL chat alerts and commands: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const bar = await tabBarWidthCheck();
  for (const label of ["Overview", "Accounts", "Models", "Help"]) assert.ok(bar.wide.includes(label), `wide bar shows "${label}"`);
  assert.equal(bar.tight.trim(), "Accounts", "at 360 px only the active tab keeps its label");
  assert.equal(bar.tightIcons, 4, "every tab keeps its icon, so none is cut off");
  console.log("ok   tab bar gives way to icons when the labels do not fit");
} catch (error) {
  failed += 1;
  console.error(`FAIL tab bar width: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const seen = nativeRegistrationCheck();
  // A 0.9 app (the fleet's): exactly what 0.13 registered.
  assert.deepEqual(seen.old.names, ["addSurface", "addSidebarItem"], "0.9 app: the surface and the sidebar item, nothing newer; no context panel since 0.18.0");
  assert.equal(seen.old.calls.addSurface.id, "ai-router");
  assert.ok(seen.surfaceIsTheView, "the surface is the AI Router view");
  assert.deepEqual(seen.old.calls.addSidebarItem, { id: "ai-router", title: "AI Router", icon: "Route", surface: "ai-router" });
  assert.deepEqual(seen.old.opened, [["openSurface", "ai-router"]], "0.9 app: the command opens the surface");
  // A 0.11 app: a titled screen and the app's own sidebar row, highlighted while the screen is open.
  assert.deepEqual(seen.next.names, [], "0.11 app: no surface or old sidebar item");
  assert.deepEqual(seen.next.screen, { id: "ai-router", title: ["AI Router · test", "AI Router · test · Accounts", "AI Router · test · Help"], sameView: true }, "0.11 app: the title follows the tab (0.20.0)");
  assert.deepEqual(seen.next.item, { id: "ai-router", title: "AI Router" });
  assert.deepEqual(seen.row, { open: { icon: "Route", active: true, label: undefined }, elsewhere: { active: false }, pressed: [{ screenId: "ai-router" }], trailing: true });
  assert.deepEqual(seen.next.opened, [["openScreen", { screenId: "ai-router" }]], "0.11 app: the command uses openScreen");
  // A 0.11 app without the row component: the screen, and the old sidebar item pointing at it.
  assert.deepEqual(seen.partial, ["addSidebarItem"]);
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
  for (const words of ["AI Router · test", "Working · 12 models", "Open AI Router", "Open dashboard", "Sync models"]) assert.ok(quick.text.includes(words), `popover shows "${words}": ${quick.text}`);
  assert.ok(quick.synced && quick.text.includes("ok"), "Sync models runs the sync and shows its answer");
  assert.ok(quick.opened, "Open AI Router is there to press");
  assert.deepEqual(quick.screens, [{ screenId: "ai-router" }], "Open AI Router opens the screen");
  assert.equal(quick.closed, 1, "and closes the popover");
  console.log("ok   sidebar status dot opens quick actions on 0.11 apps");
} catch (error) {
  failed += 1;
  console.error(`FAIL quick actions: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const title = await titleFollowsTabCheck();
  assert.equal(title.afterDeepLink, 0, "a deep link to Help (with fold-outs) does not re-open the screen");
  assert.deepEqual(title.opened.slice(0, 2), [{ screenId: "ai-router", params: { tab: "models" } }, { screenId: "ai-router" }], "a tab press puts { tab } in the params; Overview takes none");
  assert.equal(title.activeAfterParams, "Accounts", "new params open their tab");
  assert.equal(title.activeAfterSidebar, "Overview", "opened again without params (the sidebar row): Overview");
  console.log("ok   the window title follows the tab on 0.11 apps");
} catch (error) {
  failed += 1;
  console.error(`FAIL title follows the tab: ${error instanceof Error ? error.message : String(error)}`);
}

if (failed) {
  console.error(`hook-order: ${failed} failing`);
  process.exit(1);
}
console.log("hook-order: every component keeps its hook order across data arrival, button presses and tab switches");
