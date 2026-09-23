// Drives the real session_open hook, health checks, connection save, accounts,
// usage and the AI Router provider against a fake OmniRoute on a random port,
// with PASEO_HOME in a temp dir. The fake answers with the real 3.8.50 fixtures.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "apps", "paseo");
const build = spawnSync(process.execPath, [join(plugin, "node_modules", "vite", "bin", "vite.js"), "build", "--config", join(plugin, "tests", "server", "vite.config.mts")], { cwd: plugin, stdio: "inherit" });
if (build.status !== 0) process.exit(1);

const fixtures = JSON.parse(readFileSync(join(here, "fixtures", "omniroute-3.8.50.json"), "utf8")).responses;
const settingsFixtures = JSON.parse(readFileSync(join(here, "fixtures", "omniroute-3.8.51-settings.json"), "utf8")).responses;
const KEY = "sk-good-0123456789abcd";
const TOKEN = "oma_live_good";
const MANAGE = "sk-manage-0123456789ab";
const home = mkdtempSync(join(tmpdir(), "ai-router-home-"));
process.env.PASEO_HOME = home;
for (const name of ["AI_ROUTER_URL", "AI_ROUTER_KEY", "AI_ROUTER_TOKEN", "AI_ROUTER_CONSOLE_URL"]) delete process.env[name];
const settingsDir = join(home, "plugin-settings", "ai-router");

const week = structuredClone(fixtures["/api/usage/analytics?range=7d"].body);
week.byApiKey = [
  { apiKey: "daemon-b (k2)", apiKeyId: "k2", apiKeyName: "daemon-b", requests: 9, totalTokens: 1200, cost: 0 },
  { apiKey: "daemon-a (k1)", apiKeyId: "k1", apiKeyName: "daemon-a", requests: 4, totalTokens: 64141, cost: 0.00013 },
];
const catalogue = {
  object: "list",
  data: [
    { id: "cc/claude-opus-5-5", owned_by: "claude", root: "claude-opus-5-5", parent: null },
    { id: "claude/claude-opus-5-5", owned_by: "claude", root: "claude-opus-5-5", parent: "cc/claude-opus-5-5" },
    { id: "cc/claude-sonnet-5", owned_by: "claude", root: "claude-sonnet-5", parent: null },
    { id: "cx/gpt-5.6-sol", owned_by: "codex", root: "gpt-5.6-sol", parent: null },
    { id: "glm/glm-5.2", owned_by: "glm", root: "glm-5.2", parent: null },
  ],
};
const managed = {
  "/api/providers": fixtures["/api/providers"].body,
  "/api/rate-limits": fixtures["/api/rate-limits"].body,
  "/api/monitoring/health": fixtures["/api/monitoring/health"].body,
  "/api/provider-stats": fixtures["/api/provider-stats"].body,
  "/api/usage/analytics?range=7d": week,
  "/api/usage/analytics?range=1d": fixtures["/api/usage/analytics?range=7d"].body,
  "/api/usage/analytics?range=30d": week,
  "/api/keys": { keys: [{ id: "k1", name: "daemon-a", key: `${KEY.slice(0, 8)}****${KEY.slice(-4)}` }, { id: "k2", name: "daemon-b", key: "sk-zzzzz****0000" }] },
  "/api/usage/call-logs?status=error&limit=1&provider=claude": [{ status: 400, provider: "claude", error: "[400] messages.1.output_config: Extra inputs are not permitted" }],
};
for (const path of ["/api/settings", "/api/context/combos/default", "/api/analytics/compression", "/api/resilience", "/api/resilience/model-cooldowns", "/api/combos/auto"]) managed[path] = settingsFixtures[path].body;
const compressionSettings = { enabled: false, engines: { lite: { enabled: false }, caveman: { enabled: false, level: "full" } }, exclusions: [] };
const writes = [];
// 0.5.0 reads: per-account health and expiry (read token), this key about itself (inference key), tunnels (manage key only).
managed["/api/providers/health-matrix"] = { providers: [{ provider: "claude", accounts: [{ connectionId: fixtures["/api/providers"].body.connections[0].id, isSynthetic: false, state: "healthy", issueCount: 0, models: [{ model: "claude-sonnet-5", status: "healthy", requests: 10, successes: 10 }] }] }] };
managed["/api/providers/expiration"] = { summary: { total: 0 }, list: [] };
const tunnelStatus = { cloudflared: { installed: true, running: false, publicUrl: null, phase: "stopped", lastError: null }, ngrok: { installed: false, running: false, publicUrl: null, phase: "not_installed" }, tailscale: { installed: true, running: false, tunnelUrl: null, phase: "stopped", enabled: false } };
const meStatus = { apiKey: { id: "k1", name: "daemon-a" }, usage: { cost: { period: "monthly", currency: "USD", usedUsd: 3.42, limitUsd: 50, remainingUsd: 46.58, usedPercent: 6.84, resetAt: "2026-10-01T00:00:00.000Z" }, tokens: { totalTokens: 1234567 } } };
/** Flip to make the fake router drop every connection, as a dead or unreachable one would. */
let routerDown = false;
/** Flip to list OmniRoute combos in /v1/models (and describe them to a read token). */
let withCombos = false;
const COMBO_ENTRIES = [
  { id: "auto", owned_by: "combo", root: "auto" }, { id: "auto/coding", owned_by: "combo", root: "auto/coding" }, { id: "auto/fast", owned_by: "combo", root: "auto/fast" },
  { id: "team-review", owned_by: "combo", root: "team-review", display_name: "Team review", description: "Opus 5.5 first, GPT-6 Sol when Claude is busy" },
];
managed["/api/combos/auto"] = { combos: [{ id: "auto", name: "Auto", candidatePool: ["codex", "claude"] }, { id: "auto/coding", name: "Auto Coding", candidatePool: ["codex", "claude"] }, { id: "auto/fast", name: "Auto Fast", candidatePool: ["codex", "claude"] }] };
managed["/api/combos"] = { combos: [{ name: "team-review", models: [{}, {}], strategy: "priority" }], total: 1 };

const router = createServer((req, res) => {
  if (routerDown) return req.socket.destroy();
  const auth = req.headers.authorization ?? "";
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/api/health/ping") return send(200, { status: "ok", timestamp: "t", latencyMs: 1 });
  const listed = withCombos ? { ...catalogue, data: [...COMBO_ENTRIES, ...catalogue.data] } : catalogue;
  if (req.url === "/v1/models") return auth === `Bearer ${KEY}` ? send(200, listed) : send(401, { error: { message: "Invalid API key" } });
  // OmniRoute narrows the list itself for a plain key: only models with an active account.
  if (req.url === "/v1/models?configuredOnly=true") return auth === `Bearer ${KEY}` ? send(200, { ...listed, data: listed.data.filter((m) => m.owned_by !== "glm") }) : send(401, { error: { message: "Invalid API key" } });
  if (req.url === "/v1/me/status") return auth === `Bearer ${KEY}` ? send(200, meStatus) : auth === `Bearer ${MANAGE}` ? send(403, { error: "Forbidden" }) : send(401, { error: "Unauthorized" });
  if (req.url === "/v1/messages" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const { model } = JSON.parse(raw);
      if (auth !== `Bearer ${KEY}`) return send(401, { error: { message: "Invalid API key" } });
      if (model === "cc/claude-opus-5-5") return send(400, { type: "error", error: { type: "invalid_request_error", message: "Claude Code version 2.1.280 or newer is required" } });
      send(200, { type: "message", content: [{ type: "text", text: "p" }] });
    });
    return;
  }
  const manage = auth === `Bearer ${MANAGE}`;
  const refuse = () => (auth === `Bearer ${KEY}` ? send(403, { error: "API key lacks 'manage' scope. Enable it in the API Keys dashboard." }) : send(401, { error: "Unauthorized" }));
  if (req.method !== "GET" || req.url === "/api/settings/compression" || req.url.startsWith("/api/tunnels/")) {
    // Writes, and isAuthenticated routes, take a manage-scoped API key only (OmniRoute's own rule).
    if (!manage) return refuse();
    if (req.method === "GET") return req.url === "/api/settings/compression" ? send(200, compressionSettings) : send(200, tunnelStatus[req.url.split("/").pop()]);
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      writes.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
      if (req.url === "/api/resilience/reset" && req.method === "POST") return send(200, { ok: true, resetCount: 2, message: "Reset 2 circuit breaker(s) and model lockouts" });
      if (/^\/api\/providers\/[^/]+\/test$/.test(req.url)) return send(200, { valid: true, latencyMs: 812, refreshed: false });
      if (/^\/api\/providers\/[^/]+\/refresh$/.test(req.url)) return send(200, { success: true, skipped: true, message: "Rotating-refresh provider: the token refreshes automatically on the next request." });
      if (req.url === "/api/providers/test-batch") return send(200, { mode: "all", results: [{ connectionId: "x", connectionName: "someone@example.com", valid: false, error: "401 token expired" }, { valid: true }], summary: { total: 2, passed: 1, failed: 1 } });
      if (req.url === "/api/tunnels/cloudflared") {
        tunnelStatus.cloudflared = { installed: true, running: true, publicUrl: "https://quiet-river-demo.trycloudflare.com", phase: "running", lastError: null };
        return send(200, { success: true, action: "enable", status: tunnelStatus.cloudflared });
      }
      send(200, { ok: true });
    });
    return;
  }
  if (req.url === "/api/monitoring/health" && auth !== `Bearer ${TOKEN}` && !manage) return send(200, { status: "healthy" });
  if (managed[req.url]) return auth === `Bearer ${TOKEN}` || manage ? send(200, managed[req.url]) : req.url === "/api/settings" && auth === `Bearer ${KEY}` ? refuse() : send(401, { error: "Invalid or expired access token" });
  send(404, { error: "not found" });
});
await new Promise((resolve) => router.listen(0, "127.0.0.1", resolve));
const LIVE = `http://127.0.0.1:${router.address().port}`;
const dead = createServer();
await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
const DEAD = `http://127.0.0.1:${dead.address().port}`;
await new Promise((resolve) => dead.close(resolve));

let passed = 0;
try {
  const server = await import(join(plugin, "node_modules", ".cache", "server-test", "entry.mjs"));
  let providers = {};
  const patches = [];
  const paseo = {
    config: {
      get: async () => ({ config: { providers } }),
      patch: async (patch) => {
        patches.push(patch);
        providers = { ...providers, ...(patch.providers ?? {}) };
        for (const id of patch.removeProviders ?? []) delete providers[id];
        return {};
      },
    },
    providers: { refresh: async () => ({}) },
  };
  let hook;
  server.registerRoutingHooks({ before: (name, handler) => { if (name === "agent.session_open") hook = handler; }, on() {} });
  const open = (provider, purpose = "interactive") => {
    const request = { agentId: "agent-1", workspaceId: null, provider, cwd: "/tmp", reason: "create", purpose, env: { KEEP: "1" } };
    return hook({ request }, { paseo, signal: new AbortController().signal }).then((result) => ({ request, result }));
  };
  const routing = (on) => { mkdirSync(settingsDir, { recursive: true }); writeFileSync(join(settingsDir, "routing.json"), JSON.stringify({ version: 1, values: { routeAgents: on } })); };

  // Fresh install: no settings, no connection.
  let { request, result } = await open("claude");
  assert.equal(result, request, "a fresh install changes nothing about how agents launch");
  assert.equal(server.getLastSession(), null);
  passed += 1;

  // Env seeds a connection but never turns routing on.
  process.env.AI_ROUTER_URL = LIVE;
  process.env.AI_ROUTER_KEY = KEY;
  ({ request, result } = await open("claude"));
  assert.equal(result, request, "env alone does not route");
  passed += 1;

  routing(true);
  delete process.env.AI_ROUTER_KEY;
  ({ request, result } = await open("claude"));
  assert.equal(result, request);
  assert.match(server.getLastSession().message, new RegExp(`routing skipped for claude session agent-1 \\(create\\): no API key set for ${LIVE}`));
  assert.equal(server.getLastSession().reason, `no API key set for ${LIVE}`, "the reason is kept for the panel's plain line");
  // The AI Router provider has no other way to work: it refuses, with the reason.
  await assert.rejects(open("ai-router"), new RegExp(`AI Router cannot start this agent: no API key set for ${LIVE}`));
  ({ request, result } = await open("ai-router", "history"));
  assert.equal(result, request, "loading history never fails");
  passed += 1;

  process.env.AI_ROUTER_URL = DEAD;
  process.env.AI_ROUTER_KEY = KEY;
  ({ request, result } = await open("claude"));
  assert.equal(result, request, "a dead endpoint is never written into the launch");
  assert.match(server.getLastSession().message, new RegExp(`${DEAD} is down: connection refused at ${DEAD}/api/health/ping`));
  await assert.rejects(open("ai-router"), /is down: connection refused/);
  passed += 1;

  process.env.AI_ROUTER_URL = `${LIVE}/v1`;
  ({ result } = await open("claude"));
  assert.deepEqual(result.env, { KEEP: "1", ANTHROPIC_BASE_URL: LIVE, ANTHROPIC_AUTH_TOKEN: KEY, CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1" });
  ({ result } = await open("ai-router"));
  assert.deepEqual(result.env, { KEEP: "1", ANTHROPIC_BASE_URL: LIVE, ANTHROPIC_AUTH_TOKEN: KEY, CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1" });
  ({ request, result } = await open("codex"));
  assert.equal(result, request, "built-in Codex is never touched");
  passed += 1;

  // Test connection: key proof, token proof, and nothing saved on failure.
  assert.equal((await server.testConnection({ endpoint: LIVE, apiKey: KEY, token: null })).message, "reachable, key accepted, 5 models");
  assert.equal((await server.testConnection({ endpoint: LIVE, apiKey: "sk-bad", token: null })).message, "401 — key rejected: Invalid API key");
  assert.equal((await server.testConnection({ endpoint: LIVE, apiKey: KEY, token: TOKEN })).message, "reachable, key accepted, 5 models · OmniRoute 3.8.50");
  assert.equal((await server.testConnection({ endpoint: DEAD, apiKey: KEY, token: null })).message, `connection refused at ${DEAD}/api/health/ping`);
  passed += 1;

  // Accounts and usage need the read token, and say so.
  let accounts = await server.handleAccounts({ refresh: true });
  assert.equal(accounts.state, "no-token");
  assert.match(accounts.message, /Settings → Access Tokens, scope: read/);
  assert.equal((await server.handleUsage({ refresh: true })).state, "no-token");
  server.AccountsSchema.parse(accounts);
  server.UsageSchema.parse(await server.handleUsage({ refresh: true }));
  passed += 1;

  process.env.AI_ROUTER_TOKEN = "oma_live_bad";
  accounts = await server.handleAccounts({ refresh: true });
  assert.equal(accounts.state, "error");
  assert.equal(accounts.message, "Accounts: 401 — read token rejected: Invalid or expired access token");
  assert.equal((await server.handleUsage({ refresh: true })).message, "Usage: 401 — read token rejected: Invalid or expired access token");
  server.AccountsSchema.parse(accounts);
  server.UsageSchema.parse(await server.handleUsage({ refresh: true }));
  passed += 1;

  process.env.AI_ROUTER_TOKEN = TOKEN;
  accounts = await server.handleAccounts({ refresh: true });
  assert.equal(accounts.state, "ok");
  assert.deepEqual(accounts.accounts.map((a) => [a.shortName, a.state]), [["Claude #1", "healthy"], ["Codex #1", "healthy"], ["Codex #2", "healthy"]]);
  assert.deepEqual(accounts.notes, ["Quota bars unavailable: 404 — /api/usage/provider-limits not found; is OmniRoute older than 3.8?"], "a missing part is named, the rest still shows");
  assert.equal(accounts.router.breakers.text, "No provider paused");
  const usage = await server.handleUsage({ refresh: true });
  assert.equal(usage.state, "ok");
  assert.equal(usage.range, "7d", "a week unless asked");
  assert.equal(usage.totals.requests, 4);
  assert.deepEqual(usage.providerTrend.providers, ["Claude", "Codex"]);
  assert.equal(usage.trend.length, 7);
  const day = await server.handleUsage({ refresh: true, range: "1d" });
  assert.deepEqual([day.range, day.trend.length], ["1d", 2], "each range is its own call and cache");
  server.UsageSchema.parse(day);
  assert.equal(usage.ownKey, "daemon-a");
  assert.deepEqual(usage.byDaemon.map((r) => [r.label, !!r.thisDaemon]), [["daemon-b", false], ["daemon-a", true]]);
  passed += 1;

  // The AI Router provider: models of active accounts only, the key never written, the old Codex entry removed.
  providers = { "ai-router-codex": { extends: "codex", env: { OPENAI_BASE_URL: `${LIVE}/v1`, OPENAI_API_KEY: "set-at-launch-by-ai-router" } } };
  const synced = await server.handleAiProvider({ enabled: true }, { paseo });
  assert.deepEqual(synced, { ok: true, message: "Synced 3 models to Paseo (Claude 2 · Codex 1). Removed the old AI Router Codex provider." });
  assert.deepEqual(Object.keys(providers), ["ai-router"]);
  assert.deepEqual(providers["ai-router"].models.map((m) => m.label), ["Claude · Opus 5.5", "Claude · Sonnet 5", "Codex · GPT-5.6 Sol"]);
  assert.equal(JSON.stringify(patches).includes(KEY), false, "the key never lands in Paseo's config");
  // A shared user has only the key: OmniRoute narrows the list itself (?configuredOnly=true).
  delete process.env.AI_ROUTER_TOKEN;
  assert.deepEqual(await server.handleAiProvider({ enabled: true }, { paseo }), { ok: true, message: "Synced 3 models to Paseo (Claude 2 · Codex 1)." });
  assert.deepEqual(providers["ai-router"].models.map((m) => m.id), ["cc/claude-opus-5-5", "cc/claude-sonnet-5", "cx/gpt-5.6-sol"], "glm has no active account, so it is not listed");
  process.env.AI_ROUTER_TOKEN = TOKEN;
  passed += 1;

  // A model the router refuses shows the upstream words.
  assert.deepEqual(await server.handleModelTest({ model: "cc/claude-opus-5-5" }), { ok: false, message: "cc/claude-opus-5-5: 400 — /v1/messages failed: Claude Code version 2.1.280 or newer is required" });
  assert.match((await server.handleModelTest({ model: "cx/gpt-5.6-sol" })).message, /^cx\/gpt-5\.6-sol answered in \d+ ms$/);
  passed += 1;

  const rejected = await server.handleConnectionTest({ endpoint: LIVE, apiKey: "sk-bad" }, { paseo });
  assert.deepEqual(rejected, { ok: false, saved: false, message: "401 — key rejected: Invalid API key. Nothing was saved." });
  const saved = await server.handleConnectionTest({ endpoint: `${LIVE}/`, apiKey: KEY, token: TOKEN }, { paseo });
  assert.equal(saved.saved, true);
  assert.match(saved.message, /Saved\. Synced 3 models to Paseo/, "saving refreshes an existing AI Router provider");
  assert.equal(statSync(join(settingsDir, "connection.json")).mode & 0o777, 0o600, "the saved key is private to the daemon's user");
  passed += 1;

  // Router settings: read with the read token, read-only until a manage key is saved.
  let settings = await server.handleSettings({ refresh: true });
  server.RouterSettingsSchema.parse(settings);
  assert.equal(settings.canEdit, false);
  assert.deepEqual(settings.items.map((i) => [i.id, i.value]), [["breakers", "None paused"], ["preferClaudeCode", "On"], ["routing", "fallback"]], "compression has its own card");
  assert.deepEqual(await server.handleSettingApply({ id: "compression", on: true }), { ok: false, message: "Add a manage key first, or change this in OmniRoute's dashboard." });
  const badManage = await server.handleConnectionTest({ endpoint: LIVE, manageKey: KEY }, { paseo });
  assert.match(badManage.message, /manage key: 403 — manage key not allowed on \/api\/settings: API key lacks 'manage' scope.*Nothing was saved\.$/);
  assert.equal(badManage.saved, false, "a rejected manage key is not kept");
  const badToken = await server.handleConnectionTest({ endpoint: LIVE, token: "oma_live_bad" }, { paseo });
  assert.equal(badToken.saved, false, "a rejected read token is not kept");
  assert.match(badToken.message, /read token: token not accepted/);
  const goodManage = await server.handleConnectionTest({ endpoint: LIVE, manageKey: MANAGE }, { paseo });
  assert.match(goodManage.message, /manage key accepted/);
  settings = await server.handleSettings({ refresh: true });
  assert.equal(settings.canEdit, true);
  passed += 1;

  // Writes go out with the manage key and exactly the payloads OmniRoute's schemas take.
  assert.deepEqual(await server.handleSettingApply({ id: "compression", on: true }), { ok: true, message: "Compression turned on." });
  assert.deepEqual(await server.handleSettingApply({ id: "preferClaudeCode", on: false }), { ok: true, message: "Prefer Claude Code for bare Claude names turned off." });
  assert.deepEqual(await server.handleSettingApply({ id: "breakers" }), { ok: true, message: "Reset 2 circuit breaker(s) and model lockouts" });
  assert.deepEqual(writes, [
    { method: "PUT", url: "/api/settings/compression", body: { enabled: true, engines: { lite: { enabled: true }, caveman: { enabled: false, level: "full" } } } },
    { method: "PATCH", url: "/api/settings", body: { preferClaudeCodeForUnprefixedClaudeModels: false } },
    { method: "POST", url: "/api/resilience/reset", body: null },
  ]);
  passed += 1;

  // OmniRoute pausing Claude is said plainly, with the error that tripped it.
  managed["/api/monitoring/health"] = { ...fixtures["/api/monitoring/health"].body, circuitBreakers: { open: 1, halfOpen: 0, degraded: 0, closed: 1, total: 2 }, providerBreakers: [{ provider: "claude", state: "OPEN", failureCount: 8, retryAfterMs: 30000 }] };
  const pausedAccounts = await server.handleAccounts({ refresh: true });
  server.AccountsSchema.parse(pausedAccounts);
  assert.deepEqual(pausedAccounts.router.paused, [{ provider: "claude", retryAfterMs: 30000, lastError: "[400] messages.1.output_config: Extra inputs are not permitted" }]);
  const pausedStatus = await server.handleStatus({ refresh: true }, { paseo });
  assert.deepEqual(pausedStatus.health.paused, ["claude"], "the status call carries the open breaker from its own health read");
  assert.equal(pausedAccounts.router.breakers.text, "Claude paused");
  managed["/api/monitoring/health"] = fixtures["/api/monitoring/health"].body;
  passed += 1;

  // Saved settings win over env; status never carries a secret.
  process.env.AI_ROUTER_URL = DEAD;
  const status = await server.handleStatus({ refresh: true }, { paseo });
  assert.equal(status.connection.source, "saved");
  assert.equal(status.connection.endpoint, LIVE);
  assert.deepEqual(status.connection.apiKey, { present: true, last4: "abcd" });
  assert.equal(status.health.version, "3.8.50");
  assert.deepEqual([status.aiProvider.present, status.aiProvider.modelCount, status.aiProvider.legacyCodex], [true, 3, false]);
  assert.deepEqual(status.aiProvider.tests.map((t) => [t.model, t.ok]).sort(), [["cc/claude-opus-5-5", false], ["cx/gpt-5.6-sol", true]]);
  // Paseo validates every RPC answer against its contract on both sides.
  server.StatusSchema.parse(status);
  server.AccountsSchema.parse(await server.handleAccounts({ refresh: true }));
  server.UsageSchema.parse(await server.handleUsage({ refresh: true }));
  server.AccountsSchema.parse(await server.handleAccounts({ refresh: false }));
  assert.deepEqual(status.connection.manageKey, { present: true, last4: "89ab" });
  assert.equal(status.connection.router, "omniroute");
  assert.equal(status.aiProvider.summary, "Claude 2 · Codex 1");
  for (const secret of [KEY, TOKEN, MANAGE]) {
    for (const payload of [status, await server.handleSettings({ refresh: true }), await server.handleAccounts({ refresh: true }), await server.handleUsage({ refresh: true })]) {
      assert.equal(JSON.stringify(payload).includes(secret), false, "no secret reaches the client");
    }
  }
  passed += 1;

  // ------------------------------------------------ auto-sync on plugin start
  // Each scenario loads a fresh copy of the server code (a fresh plugin process) with its own PASEO_HOME.
  const entryUrl = pathToFileURL(join(plugin, "node_modules", ".cache", "server-test", "entry.mjs")).href;
  for (const name of ["AI_ROUTER_URL", "AI_ROUTER_KEY", "AI_ROUTER_TOKEN"]) delete process.env[name];
  const fresh = async (label, connection, state) => {
    const dir = mkdtempSync(join(tmpdir(), `ai-router-${label}-`));
    process.env.PASEO_HOME = dir;
    const settings = join(dir, "plugin-settings", "ai-router");
    mkdirSync(settings, { recursive: true });
    writeFileSync(join(settings, "connection.json"), JSON.stringify(connection));
    if (state) writeFileSync(join(settings, "sync-state.json"), JSON.stringify(state));
    const logs = [];
    const box = { providers: {}, profiles: [], patches: [] };
    const api = {
      config: {
        get: async () => ({ config: { providers: box.providers, agentProfiles: box.profiles } }),
        patch: async (patch) => {
          box.patches.push(patch);
          const next = { ...box.providers };
          for (const [id, entry] of Object.entries(patch.providers ?? {})) next[id] = { ...next[id], ...entry };
          for (const id of patch.removeProviders ?? []) delete next[id];
          box.providers = next;
          // Paseo takes agentProfiles as the whole list.
          if (patch.agentProfiles) box.profiles = patch.agentProfiles;
          return {};
        },
      },
      providers: { refresh: async () => ({}) },
    };
    const mod = await import(`${entryUrl}?${label}`);
    const original = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    return { mod, api, box, logs, dir, restore: () => (console.log = original) };
  };
  const full = { router: "omniroute", endpoint: LIVE, apiKey: KEY, token: TOKEN };

  {
    const t = await fresh("start-no-provider", full);
    t.mod.noteActivity(t.api); // the first RPC or hook after the plugin loads
    await t.mod.checkAutoSync(t.api); // wait for the background run
    t.mod.noteActivity(t.api);
    await t.mod.checkAutoSync(t.api);
    t.restore();
    assert.equal(t.box.patches.length, 1, "synced exactly once");
    assert.deepEqual(t.box.providers["ai-router"].models.map((m) => m.id), ["cc/claude-opus-5-5", "cc/claude-sonnet-5", "cx/gpt-5.6-sol"]);
    assert.deepEqual(t.logs, ["[ai-router] synced 3 models (Claude 2 · Codex 1)"]);
    const status = await t.mod.handleStatus({}, { paseo: t.api });
    assert.match(status.aiProvider.lastSync.message, /^Synced 3 models to Paseo/, "the panel shows the auto-sync");
    passed += 1;
  }
  {
    // Already what OmniRoute lists: left alone. One model more at OmniRoute: rewritten on the next check.
    const t = await fresh("start-current-provider", full);
    await t.mod.checkAutoSync(t.api);
    const before = t.box.patches.length;
    await t.mod.checkAutoSync(t.api);
    assert.equal(t.box.patches.length, before, "an entry that matches OmniRoute is not rewritten");
    t.box.providers["ai-router"] = { ...t.box.providers["ai-router"], models: t.box.providers["ai-router"].models.slice(1) };
    await t.mod.checkAutoSync(t.api);
    t.restore();
    assert.equal(t.box.patches.length, before + 1, "a model missing from the entry is added by itself");
    passed += 1;
  }
  {
    const t = await fresh("start-no-token", { ...full, token: null });
    t.mod.noteActivity(t.api);
    await t.mod.checkAutoSync(t.api);
    t.restore();
    assert.equal(t.box.patches.length, 1, "a key alone is enough to sync");
    assert.deepEqual(t.box.providers["ai-router"].models.map((m) => m.id), ["cc/claude-opus-5-5", "cc/claude-sonnet-5", "cx/gpt-5.6-sol"]);
    passed += 1;
  }
  {
    const t = await fresh("removed", full);
    t.box.providers = { "ai-router": { extends: "claude", env: { ANTHROPIC_BASE_URL: "http://old:20128" }, models: [] } };
    await t.mod.checkAutoSync(t.api);
    assert.equal(t.box.patches.length, 1, "an entry pointing elsewhere is corrected");
    assert.equal(t.box.providers["ai-router"].env.ANTHROPIC_BASE_URL, LIVE);
    const removed = await t.mod.handleAiProvider({ enabled: false }, { paseo: t.api });
    assert.equal(removed.ok, true);
    t.box.providers = {};
    await t.mod.checkAutoSync(t.api);
    t.restore();
    assert.equal(t.box.patches.length, 2, "a provider removed in the panel is not put back");
    assert.equal(t.mod.syncReason({ removed: false, present: false, changed: ["ai-router"] }), "provider missing");
    assert.equal(t.mod.syncReason({ removed: false, present: true, changed: ["ai-router"] }), "ai-router out of date");
    assert.equal(t.mod.syncReason({ removed: true, present: false, changed: ["ai-router"] }), null);
    passed += 1;
  }
  {
    // At plugin load there is no Paseo handle: the entry goes into config.json and `paseo daemon reload` makes it live.
    const t = await fresh("load-time-file", full);
    const bin = mkdtempSync(join(tmpdir(), "ai-router-bin-"));
    const calls = join(bin, "calls.txt");
    writeFileSync(join(bin, "paseo"), `#!/bin/sh\necho "$@" >> "${calls}"\n`, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const configPath = join(t.dir, "config.json");
    const userEntry = { extends: "acp", label: "Gemini", command: ["gemini", "--acp"], enabled: true };
    writeFileSync(configPath, JSON.stringify({ version: 1, daemon: { listen: "127.0.0.1:6767" }, agents: { providers: { gemini: userEntry, copilot: { enabled: false } } } }, null, 2), { mode: 0o600 });
    await t.mod.checkAutoSync(null);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    assert.deepEqual(written.agents.providers.gemini, userEntry, "a user-made entry is left exactly as it was");
    assert.deepEqual(written.agents.providers.copilot, { enabled: false });
    assert.deepEqual(written.daemon, { listen: "127.0.0.1:6767" });
    assert.deepEqual(written.agents.providers["ai-router"].models.map((m) => m.id), ["cc/claude-opus-5-5", "cc/claude-sonnet-5", "cx/gpt-5.6-sol"]);
    assert.equal(readFileSync(configPath, "utf8").includes(KEY), false, "the key never lands in config.json");
    assert.equal(statSync(configPath).mode & 0o777, 0o600, "the file keeps its mode");
    assert.equal(readFileSync(calls, "utf8").trim(), `daemon reload --home ${t.dir} --json`);
    await t.mod.checkAutoSync(null);
    assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 1, "nothing changed, so no second write or reload");
    writeFileSync(configPath, "{ not json");
    await t.mod.checkAutoSync(null);
    assert.equal(readFileSync(configPath, "utf8"), "{ not json", "a file it cannot read is never rewritten");
    process.env.PATH = path;
    t.restore();
    const status = await t.mod.handleStatus({}, { paseo: t.api });
    assert.equal(status.aiProvider.via, "config-file");
    assert.deepEqual(t.logs.filter((line) => /synced/.test(line)), ["[ai-router] synced 3 models (Claude 2 · Codex 1) at load: written to config.json and reloaded"]);
    rmSync(bin, { recursive: true, force: true });
    passed += 1;
  }

  const noSecrets = (payload) => {
    for (const secret of [KEY, TOKEN, MANAGE]) assert.equal(JSON.stringify(payload).includes(secret), false, "no secret reaches the client");
  };
  {
    // Basic tier: endpoint and key only. Routing, models and the key's own spend; nothing about other keys.
    const t = await fresh("tier-basic", { router: "omniroute", endpoint: LIVE, apiKey: KEY });
    t.restore();
    const status = await t.mod.handleStatus({}, { paseo: t.api });
    t.mod.StatusSchema.parse(status);
    assert.equal(status.tier, "basic");
    const mine = await t.mod.handleAccess({ refresh: true });
    t.mod.AccessSchema.parse(mine);
    assert.deepEqual([mine.state, mine.keyName, mine.spend.limitUsd, mine.tokens], ["ok", "daemon-a", 50, 1234567]);
    assert.equal((await t.mod.handleAccounts({ refresh: true })).state, "no-token", "fleet accounts need a read token");
    assert.equal((await t.mod.handleUsage({ refresh: true })).state, "no-token");
    const tunnelsBasic = await t.mod.handleTunnels({ refresh: true });
    t.mod.TunnelsSchema.parse(tunnelsBasic);
    assert.equal(tunnelsBasic.state, "no-manage-key");
    for (const answer of [await t.mod.handleAccountAction({ action: "test", id: "x", name: "Claude #1" }), await t.mod.handleAccountsCheckAll(), await t.mod.handleCompressionApply(), await t.mod.handleTunnelSet({ id: "cloudflared", on: true })]) {
      assert.deepEqual(answer, { ok: false, message: "Needs a manage key (Connection → Manage key)." }, "admin actions refuse without a manage key");
    }
    noSecrets([status, mine]);
    passed += 1;
  }
  {
    // Admin tier: a manage key alone also reads, and unlocks the actions, tunnels and compression.
    const t = await fresh("tier-admin", { router: "omniroute", endpoint: LIVE, apiKey: KEY, manageKey: MANAGE });
    t.restore();
    const accountsAdmin = await t.mod.handleAccounts({ refresh: true });
    t.mod.AccountsSchema.parse(accountsAdmin);
    assert.equal(accountsAdmin.canAct, true);
    const withHealth = accountsAdmin.accounts.find((a) => a.id === fixtures["/api/providers"].body.connections[0].id);
    assert.deepEqual(withHealth.health, { state: "healthy", successRatePct: 100, requests: 10, issueCount: 0, lastErrorAt: null, failingModels: [] });
    assert.deepEqual(await t.mod.handleAccountAction({ action: "test", id: accountsAdmin.accounts[0].id, name: "Claude #1" }), { ok: true, message: "Claude #1 answered in 812 ms." });
    assert.match((await t.mod.handleAccountAction({ action: "refresh", id: "codex-1", name: "Codex #1" })).message, /^Codex #1: Rotating-refresh provider/);
    assert.deepEqual(await t.mod.handleAccountsCheckAll(), { ok: false, message: "1 of 2 accounts answered. Failed: so…@example.com (401 token expired)." });
    const tunnelsAdmin = await t.mod.handleTunnels({ refresh: true });
    t.mod.TunnelsSchema.parse(tunnelsAdmin);
    assert.deepEqual(tunnelsAdmin.tunnels.map((x) => [x.id, x.installed, x.running]), [["cloudflared", true, false], ["ngrok", false, false], ["tailscale", true, false]]);
    assert.deepEqual(await t.mod.handleTunnelSet({ id: "cloudflared", on: true }), { ok: true, message: "Cloudflare tunnel started: https://quiet-river-demo.trycloudflare.com." });
    await t.mod.handleTunnels({ refresh: true });
    const status = await t.mod.handleStatus({}, { paseo: t.api });
    assert.equal(status.tier, "admin");
    assert.deepEqual(status.connection.tunnel, { label: "Cloudflare tunnel", dashboardUrl: "https://quiet-river-demo.trycloudflare.com/dashboard" }, "Open dashboard uses the running tunnel");
    const comp = await t.mod.handleCompression({ refresh: true });
    t.mod.CompressionSchema.parse(comp);
    assert.deepEqual([comp.mode, comp.engines, comp.recommended, comp.canEdit], ["off", [], false, true]);
    writes.length = 0;
    assert.deepEqual(await t.mod.handleCompressionApply(), { ok: true, message: "Compression set to Lite only, with Codex models (cx/*) excluded." });
    assert.deepEqual(writes, [{ method: "PUT", url: "/api/settings/compression", body: { enabled: true, engines: { lite: { enabled: true }, caveman: { enabled: false, level: "full" } }, exclusions: ["cx/*", "codex/*"] } }], "never more than asked: Lite on, the rest off, Codex excluded");
    noSecrets([status, accountsAdmin, tunnelsAdmin, comp]);
    tunnelStatus.cloudflared = { installed: true, running: false, publicUrl: null, phase: "stopped", lastError: null };
    passed += 1;
  }
  {
    // The router goes away: status still answers at once, tabs show their last good answer marked stale.
    const t = await fresh("router-down", full);
    t.restore();
    assert.equal((await t.mod.handleAccounts({ refresh: true })).state, "ok");
    const upStatus = await t.mod.handleStatus({ refresh: true }, { paseo: t.api });
    assert.equal(upStatus.health.up, true);
    routerDown = true;
    const started = Date.now();
    let down = await t.mod.handleStatus({ refresh: true }, { paseo: t.api });
    t.mod.StatusSchema.parse(down);
    assert.ok(Date.now() - started < 2_500, "status answers within the panel's budget");
    // A check that outlasts the budget comes back as the last answer, marked `checking`; the next poll has the result.
    for (let i = 0; down.checking && i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      down = await t.mod.handleStatus({ refresh: true }, { paseo: t.api }); // joins the check already running
    }
    assert.equal(down.checking, false);
    assert.equal(down.health?.up ?? false, false);
    assert.equal(down.lastSeenAt, upStatus.health.checkedAt, "last seen is when it last answered");
    const quick = Date.now();
    const stale = await t.mod.handleAccounts({ refresh: true });
    assert.ok(Date.now() - quick < 500, "a tab does not wait on a router known to be down");
    t.mod.AccountsSchema.parse(stale);
    assert.equal(stale.state, "ok");
    assert.match(stale.stale.reason, /^Accounts: the router is not answering/);
    assert.equal(stale.checkedAt, (await t.mod.handleAccounts({})).checkedAt, "it is the earlier answer, with its own time");
    const usageDown = await t.mod.handleUsage({ refresh: true });
    assert.equal(usageDown.state, "error", "no earlier answer: an error, not a spinner");
    assert.equal((await t.mod.handleAccess({ refresh: true })).state, "error");
    assert.equal((await t.mod.handleCompression({ refresh: true })).state, "error");
    routerDown = false;
    passed += 1;
  }
  {
    // A router that accepts the connection and never answers: the panel still opens within the budget.
    const hang = createServer(() => {});
    await new Promise((resolve) => hang.listen(0, "127.0.0.1", resolve));
    const HANG = `http://127.0.0.1:${hang.address().port}`;
    const t = await fresh("router-hangs", { router: "omniroute", endpoint: HANG, apiKey: KEY, token: TOKEN });
    t.restore();
    const started = Date.now();
    const slow = await t.mod.handleStatus({}, { paseo: t.api });
    assert.ok(Date.now() - started < 2_500, `status took ${Date.now() - started} ms`);
    assert.deepEqual([slow.checking, slow.health], [true, null], "still checking, and says so");
    await new Promise((resolve) => setTimeout(resolve, 4_500));
    const settled = await t.mod.handleStatus({}, { paseo: t.api });
    assert.equal(settled.health.up, false);
    assert.match(settled.health.error, /no answer from .* within 4s/);
    const quick = Date.now();
    assert.equal((await t.mod.handleSettings({ refresh: true })).state, "error");
    assert.ok(Date.now() - quick < 500, "the Settings tab answers at once once the router is known to be down");
    await new Promise((resolve) => hang.close(resolve));
    hang.closeAllConnections?.();
    passed += 1;
  }
  {
    // A broken connection.json: nothing crashes, the problem is named, and Test & save fixes it.
    const t = await fresh("misconfigured", { router: "omniroute", endpoint: "not a url", apiKey: KEY });
    t.restore();
    const status = await t.mod.handleStatus({}, { paseo: t.api });
    t.mod.StatusSchema.parse(status);
    assert.deepEqual([status.problem, status.tier, status.health], ["the saved endpoint in connection.json is not a usable http(s) URL", "none", null]);
    assert.equal((await t.mod.handleAccounts({ refresh: true })).message, "Set the endpoint URL first.");
    assert.match((await t.mod.handleAccess({ refresh: true })).message, /Set the endpoint URL and API key first/);
    const fixed = await t.mod.handleConnectionTest({ endpoint: LIVE, apiKey: KEY }, { paseo: t.api });
    assert.equal(fixed.saved, true);
    assert.equal((await t.mod.handleStatus({}, { paseo: t.api })).problem, null);
    passed += 1;
  }
  {
    // The Providers tab: every provider, and Tidy up only switches off Paseo's own that cannot run.
    const t = await fresh("providers", full);
    t.restore();
    const entries = [
      { provider: "claude", status: "ready", enabled: true, source: "builtin" },
      { provider: "codex", status: "unavailable", enabled: true, source: "builtin", error: "not logged in" },
      { provider: "copilot", status: "loading", enabled: true, source: "builtin" },
      { provider: "opencode", status: "unavailable", enabled: true, source: "builtin" },
      { provider: "pi", status: "loading", enabled: false, source: "builtin" },
      { provider: "gemini", status: "unavailable", enabled: true, source: "custom", label: "Gemini" },
      { provider: "ai-router", status: "ready", enabled: true, source: "custom", label: "AI Router" },
    ];
    t.box.providers = { gemini: { extends: "acp", label: "Gemini", command: ["gemini"] }, pi: { enabled: false }, "ai-router": { extends: "claude", label: "AI Router" } };
    t.api.providers = { refresh: async () => ({}), snapshot: async () => ({ entries }), waitForReady: async () => ({ entries }) };
    const list = await t.mod.handleProvidersList({}, { paseo: t.api });
    t.mod.ProvidersSchema.parse(list);
    assert.deepEqual(list.rows.map((r) => r.id), ["claude", "codex", "ai-router", "gemini", "copilot", "opencode", "pi"], "Paseo's two, then ours, then the rest by label");
    assert.deepEqual(list.rows.filter((r) => r.tidy).map((r) => [r.id, r.tidy]), [["copilot", "never finished loading"], ["opencode", "not installed on this daemon"]]);
    assert.deepEqual(list.rows.map((r) => [r.id, r.owner]).filter(([, owner]) => owner !== "paseo"), [["ai-router", "ai-router"], ["gemini", "user"]]);
    const before = t.box.patches.length;
    const tidied = await t.mod.handleProvidersTidy({ ids: ["copilot", "opencode", "claude", "gemini", "ai-router"] }, { paseo: t.api });
    assert.equal(tidied.ok, true);
    assert.match(tidied.message, /^Turned off GitHub Copilot, OpenCode\. .*Left alone: claude, gemini, ai-router\.$/);
    assert.deepEqual(t.box.patches.slice(before), [{ providers: { copilot: { enabled: false }, opencode: { enabled: false } } }], "only the two it would pick, whatever was asked");
    assert.deepEqual(await t.mod.handleProviderEnable({ id: "pi", enabled: true }, { paseo: t.api }), { ok: true, message: "Pi turned on." });
    assert.deepEqual(t.box.patches.at(-1), { providers: { pi: { enabled: true } } });
    t.api.providers.snapshot = () => Promise.reject(new Error("daemon busy"));
    const failed = await t.mod.handleProvidersList({}, { paseo: t.api });
    assert.equal(failed.state, "error");
    assert.match(failed.message, /daemon busy/);
    passed += 1;
  }
  {
    // Codex via OmniRoute: a Codex-derived provider with placeholders; the hook adds the real key at launch.
    const t = await fresh("codex-router", full);
    t.restore();
    const added = await t.mod.handleCodexRouter({ enabled: true }, { paseo: t.api });
    assert.match(added.message, /^Added "Codex via OmniRoute" with 1 model/);
    const entry = t.box.providers["codex-ai-router"];
    assert.deepEqual([entry.extends, entry.env, entry.models.map((m) => m.id)], ["codex", { OPENAI_BASE_URL: `${LIVE}/v1`, OPENAI_API_KEY: "set-at-launch-by-ai-router" }, ["cx/gpt-5.6-sol"]]);
    assert.equal(JSON.stringify(t.box.patches).includes(KEY), false, "the key never lands in Paseo's config");
    let hook;
    t.mod.registerRoutingHooks({ before: (name, handler) => { if (name === "agent.session_open") hook = handler; }, on() {} });
    const request = { agentId: "agent-2", workspaceId: null, provider: "codex-ai-router", cwd: "/tmp", reason: "create", purpose: "interactive", env: { KEEP: "1" } };
    const result = await hook({ request }, { paseo: t.api, signal: new AbortController().signal });
    assert.deepEqual(result.env, { KEEP: "1", OPENAI_API_KEY: KEY });
    t.box.providers["codex-ai-router"] = { ...entry, env: { ...entry.env, OPENAI_BASE_URL: "http://old:20128/v1" } };
    await assert.rejects(hook({ request }, { paseo: t.api, signal: new AbortController().signal }), /Codex via OmniRoute provider points at http:\/\/old:20128\/v1/);
    await t.mod.checkAutoSync(t.api);
    assert.equal(t.box.providers["codex-ai-router"].env.OPENAI_BASE_URL, `${LIVE}/v1`, "the auto-sync keeps it pointed at the router");
    const removed = await t.mod.handleCodexRouter({ enabled: false }, { paseo: t.api });
    assert.equal(removed.ok, true);
    assert.deepEqual(t.box.patches.at(-1), { removeProviders: ["codex-ai-router"] });
    passed += 1;
  }

  // ---------------------------------------------- combos as agent profiles
  withCombos = true;
  const routingDoc = (dir, values) => writeFileSync(join(dir, "plugin-settings", "ai-router", "routing.json"), JSON.stringify({ version: 1, values }));
  const userProfile = { id: "legacy_favorite:codex:gpt-5.6-sol", name: "gpt-5.6-sol", provider: "codex", model: "gpt-5.6-sol" };
  {
    // Through Paseo's API: one profile per combo, OmniRoute's words as notes, a person's profile untouched.
    const t = await fresh("profiles-api", full);
    t.box.profiles = [userProfile];
    await t.mod.checkAutoSync(t.api);
    assert.deepEqual(t.box.profiles.map((p) => p.id), ["legacy_favorite:codex:gpt-5.6-sol", "ai-router:auto", "ai-router:auto/coding", "ai-router:auto/fast", "ai-router:team-review"]);
    assert.equal(t.box.profiles[0], userProfile, "a person's profile is passed back exactly");
    const coding = t.box.profiles.find((p) => p.id === "ai-router:auto/coding");
    assert.deepEqual(coding, { id: "ai-router:auto/coding", name: "Auto · coding", icon: "code", color: "blue", provider: "ai-router", model: "auto/coding", notes: 'OmniRoute auto combo "auto/coding": Quality-first for code. Picks from Codex, Claude. Use it as the model on the AI Router provider; OmniRoute chooses the account and model per request.' });
    assert.match(t.box.profiles.at(-1).notes, /Opus 5\.5 first, GPT-6 Sol when Claude is busy\. 2 models, priority strategy\./);
    assert.deepEqual(t.box.providers["ai-router"].models.slice(0, 4).map((m) => m.id), ["auto", "auto/coding", "auto/fast", "team-review"], "combos also lead the model list");
    const listed = await t.mod.handleProfiles({}, { paseo: t.api });
    t.mod.ProfilesSchema.parse(listed);
    assert.deepEqual([listed.enabled, listed.profiles.length, listed.profiles[1].name], [true, 4, "Auto · coding"]);

    // Nothing changed: no write. A combo disappears: its profile goes; a person's tweak to ours stays.
    const patches = t.box.patches.length;
    await t.mod.checkAutoSync(t.api);
    assert.equal(t.box.patches.length, patches, "unchanged profiles are not rewritten");
    t.box.profiles = t.box.profiles.map((p) => (p.id === "ai-router:auto" ? { ...p, icon: "rocket", thinkingOptionId: "high" } : p));
    COMBO_ENTRIES.splice(2, 1); // auto/fast gone
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The model list is cached for a few minutes; the switch's "apply" path is what a person uses, and it asks again.
    await t.mod.handleAiProvider({ enabled: true }, { paseo: t.api });
    assert.deepEqual(t.box.profiles.map((p) => p.id), ["legacy_favorite:codex:gpt-5.6-sol", "ai-router:auto", "ai-router:auto/coding", "ai-router:team-review"]);
    const auto = t.box.profiles.find((p) => p.id === "ai-router:auto");
    assert.deepEqual([auto.icon, auto.thinkingOptionId], ["rocket", "high"], "an icon or effort a person set on ours survives");

    // The switch off: ours go, the person's stays; back on: they return.
    routingDoc(t.dir, { routeAgents: false, comboProfiles: false });
    const off = await t.mod.handleProfiles({ apply: true }, { paseo: t.api });
    assert.deepEqual([off.enabled, off.profiles], [false, []]);
    assert.deepEqual(t.box.profiles, [userProfile]);
    routingDoc(t.dir, { routeAgents: false, comboProfiles: true });
    const on = await t.mod.handleProfiles({ apply: true }, { paseo: t.api });
    assert.equal(on.profiles.length, 3);

    // Removing the AI Router provider takes its profiles with it, and the timer does not bring them back.
    await t.mod.handleAiProvider({ enabled: false }, { paseo: t.api });
    assert.deepEqual(t.box.profiles, [userProfile]);
    await t.mod.checkAutoSync(t.api);
    assert.deepEqual(t.box.profiles, [userProfile]);
    t.restore();
    COMBO_ENTRIES.splice(2, 0, { id: "auto/fast", owned_by: "combo", root: "auto/fast" });
    passed += 1;
  }
  {
    // At plugin load, through config.json: profiles under daemon.agentProfiles, a person's kept byte for byte.
    const t = await fresh("profiles-file", full);
    const bin = mkdtempSync(join(tmpdir(), "ai-router-bin-"));
    const calls = join(bin, "calls.txt");
    writeFileSync(join(bin, "paseo"), `#!/bin/sh\necho "$@" >> "${calls}"\n`, { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    const configPath = join(t.dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ version: 1, daemon: { listen: "127.0.0.1:6767", agentProfiles: [userProfile] }, agents: { providers: {} } }, null, 2), { mode: 0o600 });
    const before = readFileSync(configPath, "utf8");
    const userText = before.slice(before.indexOf("{", before.indexOf("agentProfiles")), before.indexOf("}", before.indexOf("agentProfiles")) + 1);
    await t.mod.checkAutoSync(null);
    const text = readFileSync(configPath, "utf8");
    const written = JSON.parse(text);
    assert.equal("agentProfiles" in written, false, "never top level");
    assert.deepEqual(written.daemon.agentProfiles.map((p) => p.id), ["legacy_favorite:codex:gpt-5.6-sol", "ai-router:auto", "ai-router:auto/coding", "ai-router:auto/fast", "ai-router:team-review"]);
    assert.ok(text.includes(userText), "the person's profile keeps its exact text");
    assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 1, "one write, one reload for providers and profiles together");
    process.env.PATH = path;
    t.restore();
    rmSync(bin, { recursive: true, force: true });
    passed += 1;
  }
  withCombos = false;

  console.log(`server: ${passed} scenarios passed`);
} finally {
  router.close();
  rmSync(home, { recursive: true, force: true });
}
