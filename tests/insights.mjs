import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "../apps/paseo/node_modules/typescript/lib/typescript.js";

// Accounts, usage, router-health and model-list parsers, driven by real OmniRoute 3.8.50 responses.
const staging = mkdtempSync(join(tmpdir(), "ai-router-insights-"));
let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
try {
  const source = readFileSync(new URL("../apps/paseo/server/routers/omniroute/parsers.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "insights.mjs"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const I = await import(join(staging, "insights.mjs"));
  const R = JSON.parse(readFileSync(new URL("./fixtures/omniroute-3.8.50.json", import.meta.url), "utf8")).responses;
  const body = (path) => clone(R[path].body);
  const NOW = Date.parse("2026-09-23T02:00:00.000Z");
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
  const [CODEX1, CLAUDE, CODEX2] = body("/api/providers").connections.map((c) => c.id);

  // ------------------------------------------------------------ accounts
  check("live fixture: three healthy accounts", () => {
    const accounts = I.parseAccounts({ providers: body("/api/providers"), rateLimits: body("/api/rate-limits"), now: NOW });
    assert.deepEqual(accounts.map((a) => a.shortName), ["Claude #1", "Codex #1", "Codex #2"], "grouped by provider, numbered by priority");
    assert.deepEqual(accounts.map((a) => a.id), [CLAUDE, CODEX1, CODEX2]);
    assert.ok(accounts.every((a) => a.state === "healthy" && a.problem === null && a.coolingUntil === null));
    assert.equal(accounts[0].label, "<email>");
    assert.deepEqual(accounts[1].quotas, [], "codex pool windows are null until OmniRoute observes them");
    assert.deepEqual(I.accountsHeadline(accounts, hhmm), { text: "3 accounts · 3 healthy", tone: "success" });
  });

  check("re-login required, cooldown and a disabled account", () => {
    const providers = body("/api/providers");
    providers.connections[2].testStatus = "expired";
    providers.connections[1].isActive = false;
    const rateLimits = body("/api/rate-limits");
    rateLimits.lockouts = [
      { provider: "claude", connectionId: CODEX1, model: "gpt-5.6-sol", reason: "rate_limited", until: NOW + 15 * 60_000 },
      { provider: "codex", connectionId: CODEX1, model: "gpt-5.6-terra", reason: "rate_limited", until: NOW + 45 * 60_000 },
      { provider: "codex", connectionId: CODEX1, model: "old", until: NOW - 60_000 },
    ];
    const accounts = I.parseAccounts({ providers, rateLimits, now: NOW });
    const [claude, codex1, codex2] = accounts;
    assert.equal(claude.state, "disabled");
    assert.equal(claude.problem, "disabled in OmniRoute");
    assert.equal(codex1.state, "attention", "a cooldown alone needs attention");
    assert.equal(codex1.coolingUntil, NOW + 45 * 60_000, "the latest lockout wins; expired ones are ignored");
    assert.equal(codex2.problem, "re-login required");
    assert.deepEqual(I.accountsHeadline(accounts, hhmm), {
      text: "2 need attention: Codex #1 cooling down until 02:45; Codex #2 re-login required",
      tone: "warning",
    });
  });

  check("error states carry OmniRoute's own words", () => {
    const providers = body("/api/providers");
    Object.assign(providers.connections[1], { testStatus: "error", lastError: "invalid_grant: refresh token revoked" });
    Object.assign(providers.connections[0], { testStatus: "active", backoffLevel: 3 });
    providers.connections[2].codexAccountPool.aggregate.status = "fully_limited";
    const [claude, codex1, codex2] = I.parseAccounts({ providers, now: NOW });
    assert.equal(claude.problem, "error: invalid_grant: refresh token revoked");
    assert.equal(codex1.problem, "backing off after errors (level 3)");
    assert.equal(codex2.problem, "every Codex quota is limited");
    assert.equal(I.accountsHeadline([claude], hhmm).text, "1 needs attention: Claude #1 error: invalid_grant: refresh token revoked");
  });

  check("quota bars from provider-limits, Codex pool windows as fallback", () => {
    const limits = {
      caches: {
        [CLAUDE]: { quotas: { "session (5h)": { used: 40, total: 100, remaining: 60, remainingPercentage: 60, resetAt: "2026-09-23T05:00:00.000Z" }, "weekly (7d)": { used: 97.4, total: 100, remainingPercentage: 2.6, resetAt: null } } },
        [CODEX1]: { quotas: { session: { used: 25, total: 100, remaining: 75, resetAt: null, unlimited: false }, weekly: { used: 90, total: 100, resetAt: null }, free: { unlimited: true } } },
      },
    };
    const providers = body("/api/providers");
    providers.connections[2].codexAccountPool.children[0].quota.windows = { "5h": { usedPercentage: 30, resetAt: "2026-09-23T04:00:00.000Z" }, "7d": null };
    providers.connections[2].codexAccountPool.children[1].quota.windows = { "5h": { usedPercentage: 100, resetAt: null } };
    const [claude, codex1, codex2] = I.parseAccounts({ providers, limits, now: NOW });
    assert.deepEqual(claude.quotas, [
      { name: "session (5h)", remainingPct: 60, resetAt: "2026-09-23T05:00:00.000Z" },
      { name: "weekly (7d)", remainingPct: 3, resetAt: null },
    ]);
    assert.deepEqual(codex1.quotas.map((q) => [q.name, q.remainingPct]), [["session", 75], ["weekly", 10]], "unlimited windows are skipped");
    assert.deepEqual(codex2.quotas.map((q) => [q.name, q.remainingPct]), [["5h", 70], ["spark 5h", 0]]);
  });

  check("masking and labels", () => {
    assert.equal(I.maskLabel("someone@example.com"), "so…@example.com");
    assert.equal(I.maskLabel("a@b.co"), "a…@b.co");
    assert.equal(I.maskLabel("Work account"), "Work account");
    assert.equal(I.providerLabel("OpenAI Codex"), "Codex");
    assert.equal(I.providerLabel("claude"), "Claude");
    assert.equal(I.providerLabel("github-copilot"), "Github Copilot");
  });

  check("no accounts is said plainly", () => {
    assert.deepEqual(I.accountsHeadline([], hhmm), { text: "OmniRoute has no connected accounts", tone: "warning" });
  });

  // --------------------------------------------------------------- usage
  const week = body("/api/usage/analytics?range=7d");
  check("usage totals tolerate redacted token counts", () => {
    assert.deepEqual(I.parseTotals(week), { requests: 4, tokens: null, cost: 0.00013, successRatePct: 100 });
    assert.equal(I.parseTotals({}), null);
    assert.equal(I.num("100.00"), 100);
    assert.equal(I.num("<redacted>"), null);
  });

  check("seven-day trend is zero-filled UTC days", () => {
    const trend = I.parseTrend(week, 7, NOW);
    assert.equal(trend.length, 7);
    assert.equal(trend[0].date, "2026-09-17");
    assert.deepEqual(trend[6], { date: "2026-09-23", requests: 4, tokens: null });
    assert.ok(trend.slice(0, 6).every((day) => day.requests === 0 && day.tokens === 0));
  });

  check("by account and top models", () => {
    assert.deepEqual(I.parseByAccount(week).map((r) => [r.label, r.requests, r.cost]), [["<email>", 3, 0], ["<email>", 1, 0.00013]]);
    const top = I.parseTopModels(week);
    assert.deepEqual(top.map((r) => [r.label, r.requests, r.failedPct]), [["claude-sonnet-5", 3, 0], ["gpt-5.6-terra", 1, 0]]);
    const failing = clone(week);
    failing.byModel[0].successRatePct = "62.50";
    assert.equal(I.parseTopModels(failing)[0].failedPct, 37.5);
  });

  check("by daemon: this daemon's key is found by its masked form", () => {
    assert.deepEqual(I.parseByDaemon(week, null), [], "the capture redacted byApiKey; a non-list reads as empty");
    const analytics = clone(week);
    analytics.byApiKey = [
      { apiKey: "daemon-a (k1)", apiKeyId: "k1", apiKeyName: "daemon-a", requests: 3, totalTokens: 64114, cost: 0 },
      { apiKey: "daemon-b (k2)", apiKeyId: "k2", apiKeyName: "daemon-b", requests: 9, totalTokens: 1200, cost: 0.02 },
    ];
    const keys = { keys: [{ id: "k1", name: "daemon-a", key: "sk-abcde****wxyz" }, { id: "k2", name: "daemon-b", key: "sk-zzzzz****0000" }] };
    const own = I.findOwnKey(keys, "sk-abcdefghijklmnopwxyz");
    assert.deepEqual(own, { id: "k1", name: "daemon-a" });
    assert.equal(I.findOwnKey(keys, "sk-other-key-1234"), null);
    assert.equal(I.findOwnKey(keys, null), null);
    const rows = I.parseByDaemon(analytics, own);
    assert.deepEqual(rows.map((r) => [r.label, r.requests, !!r.thisDaemon]), [["daemon-b", 9, false], ["daemon-a", 3, true]]);
  });

  // ------------------------------------------------------- router health
  check("router strip from the live fixtures", () => {
    const strip = I.parseRouterStrip(body("/api/monitoring/health"), body("/api/provider-stats"));
    assert.deepEqual(strip.breakers, { text: "No provider paused", tone: "success" });
    assert.deepEqual(strip.providers, [
      { name: "OpenAI Codex", requests: 16, errorPct: 0, avgLatencyMs: 728 },
      { name: "Claude Code", requests: 16, errorPct: 0, avgLatencyMs: 781 },
    ]);
    assert.equal(strip.p95Ms, null, "telemetry.count is 0, so p95 is not claimed");
    assert.deepEqual(strip.failingModels, []);
  });

  check("open breakers, p95 and failing models", () => {
    const health = body("/api/monitoring/health");
    health.circuitBreakers.open = 1;
    health.providerBreakers = [{ provider: "claude", state: "OPEN", failureCount: 5 }, { provider: "codex", state: "CLOSED" }];
    const stats = body("/api/provider-stats");
    stats.telemetry = { count: 20, p95: 4100 };
    stats.models.push({ provider: "Claude Code", model: "claude-opus-5-5", requests: 3, successfulRequests: 0 });
    stats.providers[1].successfulRequests = 12;
    const strip = I.parseRouterStrip(health, stats);
    assert.deepEqual(strip.breakers, { text: "Claude paused", tone: "danger" });
    assert.equal(strip.p95Ms, 4100);
    assert.equal(strip.providers[1].errorPct, 25);
    assert.deepEqual(strip.failingModels, [{ model: "claude-opus-5-5", provider: "Claude Code", failed: 3, requests: 3 }]);
  });

  check("management errors are specific", () => {
    assert.equal(I.describeManagementStatus(401, { error: "Invalid or expired access token" }, "/api/providers"), "401 — read token rejected: Invalid or expired access token");
    assert.equal(I.describeManagementStatus(403, { error: "Access token scope 'read' is insufficient; 'write' required." }, "/api/keys"), "403 — read token not allowed on /api/keys: Access token scope 'read' is insufficient; 'write' required.");
    assert.equal(I.describeManagementStatus(404, null, "/api/usage/provider-limits"), "404 — /api/usage/provider-limits not found; is OmniRoute older than 3.8?");
    assert.equal(I.describeManagementStatus(401, { error: { message: "Invalid API key" } }, "/v1/models", "API key"), "401 — API key rejected: Invalid API key");
    assert.equal(
      I.describeManagementStatus(400, { type: "error", error: { type: "invalid_request_error", message: "Claude Code version 2.1.251 or newer is required for this model" } }, "/v1/messages", "API key"),
      "400 — /v1/messages failed: Claude Code version 2.1.251 or newer is required for this model",
    );
  });

  // -------------------------------------------------------------- models
  check("model names", () => {
    assert.equal(I.prettyModel("claude-opus-5-5"), "Opus 5.5");
    assert.equal(I.prettyModel("claude-sonnet-5"), "Sonnet 5");
    assert.equal(I.prettyModel("claude-haiku-4-5-20251001"), "Haiku 4.5 20251001");
    assert.equal(I.prettyModel("gpt-5.6-sol"), "GPT-5.6 Sol");
    assert.equal(I.prettyModel("gpt-5.1-codex-mini"), "GPT-5.1 Codex Mini");
  });

  check("model list: connected providers only, canonical twins dropped", () => {
    const active = I.activeProviders(body("/api/providers"));
    assert.deepEqual([...active].sort(), ["claude", "codex"]);
    const catalogue = {
      object: "list",
      data: [
        { id: "cc/claude-opus-5-5", owned_by: "claude", root: "claude-opus-5-5", parent: null },
        { id: "claude/claude-opus-5-5", owned_by: "claude", root: "claude-opus-5-5", parent: "cc/claude-opus-5-5" },
        { id: "cc/claude-sonnet-5", owned_by: "claude", root: "claude-sonnet-5", parent: null },
        { id: "cx/gpt-5.6-sol", owned_by: "codex", root: "gpt-5.6-sol", parent: null },
        { id: "glm/glm-5.2", owned_by: "glm", root: "glm-5.2", parent: null },
        { id: "auto/best", owned_by: "combo", root: "best", parent: null },
        { id: "cx/gpt-5.6-sol", owned_by: "codex", root: "gpt-5.6-sol", parent: null },
        { owned_by: "codex" },
      ],
    };
    assert.deepEqual(I.buildModelList(catalogue, active), [
      { id: "cc/claude-opus-5-5", provider: "claude", label: "Claude · Opus 5.5" },
      { id: "cc/claude-sonnet-5", provider: "claude", label: "Claude · Sonnet 5" },
      { id: "cx/gpt-5.6-sol", provider: "codex", label: "Codex · GPT-5.6 Sol" },
    ]);
    const inactive = body("/api/providers");
    inactive.connections.forEach((c) => (c.isActive = c.provider !== "codex"));
    assert.deepEqual([...I.activeProviders(inactive)], ["claude"], "an inactive provider's models are left out");
  });

  check("every parser survives junk", () => {
    for (const junk of [null, undefined, "<redacted>", 42, [], {}, { connections: "x", data: {}, summary: [] }]) {
      assert.deepEqual(I.parseAccounts({ providers: junk, rateLimits: junk, limits: junk, now: NOW }), []);
      assert.equal(I.parseTotals(junk), null);
      assert.equal(I.parseTrend(junk, 7, NOW).length, 7);
      assert.deepEqual(I.parseByAccount(junk), []);
      assert.deepEqual(I.parseTopModels(junk), []);
      assert.deepEqual(I.parseByDaemon(junk, { id: "k1", name: "x" }), []);
      assert.deepEqual(I.parseRouterStrip(junk, junk), { breakers: null, providers: [], p95Ms: null, failingModels: [], paused: [] });
      assert.deepEqual(I.buildModelList(junk, new Set(["claude"])), []);
      assert.deepEqual(I.parseQuotas(junk), []);
      assert.equal(I.findOwnKey(junk, "sk-abcdefghijklmnop"), null);
    }
  });

  // ------------------------------------------------------ router settings
  const S = JSON.parse(readFileSync(new URL("./fixtures/omniroute-3.8.51-settings.json", import.meta.url), "utf8")).responses;
  const sbody = (path) => clone(S[path].body);
  const live = {
    settings: sbody("/api/settings"),
    compressionPlan: sbody("/api/context/combos/default"),
    compressionStats: sbody("/api/analytics/compression"),
    resilience: sbody("/api/resilience"),
    cooldowns: sbody("/api/resilience/model-cooldowns"),
    autoCombos: sbody("/api/combos/auto"),
    health: body("/api/monitoring/health"),
  };

  check("settings from the live 3.8.51 fixtures", () => {
    const items = I.parseSettings(live);
    assert.deepEqual(items.map((i) => [i.id, i.value, i.toggle, i.dashboardPath]), [
      ["compression", "Off", false, "/dashboard/compression"],
      ["breakers", "None paused", null, "/dashboard/settings/resilience"],
      ["preferClaudeCode", "On", true, "/dashboard/providers/claude"],
      ["routing", "fallback", null, "/dashboard/settings/routing"],
    ]);
    const [compression, breakers, , routing] = items;
    assert.equal(compression.detail, "Nothing compressed yet.");
    assert.equal(breakers.detail, "Opens after 8 failures, retries after 60 s.");
    assert.equal(breakers.action, "Reset circuit breakers and model cooldowns");
    assert.equal(routing.detail, "Auto models: auto, auto/coding, auto/fast · choosing from codex, claude, opencode");
    assert.ok(items.every((i) => i.why.length > 20), "every setting says what it does");
  });

  check("compression on, savings, an open breaker and cooldowns", () => {
    const items = I.parseSettings({
      ...live,
      compressionPlan: { mode: "stacked", pipeline: [{ engine: "lite" }, { engine: "caveman", intensity: "full" }], derived: true },
      compressionStats: { ...live.compressionStats, totalRequests: 40, totalTokensSaved: 12345, avgSavingsPct: 18.4, realUsage: { estimatedUsdSaved: 0.42 } },
      health: { ...live.health, providerBreakers: [{ provider: "claude", state: "OPEN", failureCount: 8, retryAfterMs: 42000 }] },
      cooldowns: { items: [{ provider: "claude", model: "claude-opus-5-5", remainingMs: 150000, reason: "rate_limited" }] },
    });
    const [compression, breakers] = items;
    assert.equal(compression.value, "On · lite → caveman (full)");
    assert.equal(compression.detail, "12.3k tokens saved on 40 requests (avg 18%) · about $0.42");
    assert.equal(I.parseSettings({ compressionPlan: { mode: "lite", pipeline: [] } })[0].value, "On · lite");
    assert.equal(breakers.value, "Claude paused");
    assert.equal(breakers.tone, "danger");
    assert.equal(breakers.detail, "Opens after 8 failures, retries after 60 s. 1 model cooldown: claude-opus-5-5 (Claude, 3 min)");
  });

  check("settings parts vanish when their source is missing", () => {
    assert.deepEqual(I.parseSettings({}), []);
    assert.deepEqual(I.parseSettings({ settings: { comboStrategy: "fallback" } }).map((i) => i.id), ["routing"]);
    assert.deepEqual(I.parseSettings({ settings: { preferClaudeCodeForUnprefixedClaudeModels: "<redacted>" } }), []);
    for (const junk of [null, "<redacted>", 7, []]) assert.deepEqual(I.parseSettings({ settings: junk, compressionPlan: junk, compressionStats: junk, resilience: junk, cooldowns: junk, autoCombos: junk, health: junk }), []);
  });

  check("write payloads", () => {
    assert.deepEqual(I.compressionPayload({ enabled: true, engines: { lite: { enabled: true } } }, false), { enabled: false });
    assert.deepEqual(I.compressionPayload({ enabled: false, engines: { lite: { enabled: false }, caveman: { enabled: true, level: "full" } } }, true), { enabled: true }, "an engine is already on: only the master switch");
    assert.deepEqual(
      I.compressionPayload({ enabled: false, engines: { lite: { enabled: false }, caveman: { enabled: false, level: "ultra" }, aggressive: { enabled: false, junk: 1 } } }, true),
      { enabled: true, engines: { lite: { enabled: true }, caveman: { enabled: false, level: "ultra" }, aggressive: { enabled: false } } },
      "no engine on: Lite goes on and every other engine is sent back unchanged (the map is replaced whole)",
    );
    assert.deepEqual(I.compressionPayload({}, true), { enabled: true, engines: { lite: { enabled: true } } });
    assert.deepEqual(I.preferClaudeCodePayload(false), { preferClaudeCodeForUnprefixedClaudeModels: false });
  });

  check("a paused provider leads the Accounts headline", () => {
    const strip = I.parseRouterStrip({ ...body("/api/monitoring/health"), providerBreakers: [{ provider: "claude", state: "OPEN", retryAfterMs: 41200 }, { provider: "codex", state: "HALF_OPEN" }] }, null);
    assert.deepEqual(strip.paused, [{ provider: "claude", retryAfterMs: 41200, lastError: null }], "only OPEN pauses traffic");
    strip.paused[0].lastError = I.lastCallError([{ status: 400, provider: "claude", error: "[400] messages.1.output_config: Extra inputs are not permitted" }]);
    const head = I.accountsHeadline(I.parseAccounts({ providers: body("/api/providers"), now: NOW }), hhmm, strip.paused);
    assert.deepEqual(head, { text: "Claude traffic paused by OmniRoute's circuit breaker (retrying in 42 s) — last error: [400] messages.1.output_config: Extra inputs are not permitted", tone: "danger" });
    assert.equal(I.lastCallError([{ status: 503, error: { message: "Provider claude circuit breaker is open" } }]), "Provider claude circuit breaker is open");
    assert.equal(I.lastCallError([{ status: 502 }]), "HTTP 502");
    assert.equal(I.lastCallError([]), null);
    assert.equal(I.pausedLine({ provider: "codex", retryAfterMs: null, lastError: null }), "Codex traffic paused by OmniRoute's circuit breaker — last error: not recorded");
  });

  // Shapes from OmniRoute 3.8.51's source (health-matrix, expiration, the account actions, tunnels, /v1/me/status).
  check("health-matrix: per-account 24-hour health, synthetic rows skipped", () => {
    const matrix = { providers: [{ provider: "claude", accounts: [
      { connectionId: null, isSynthetic: true, state: "degraded", models: [{ model: "claude-opus-5-5", status: "error", requests: 6, successes: 0 }] },
      { connectionId: "conn-1", isSynthetic: false, state: "degraded", issueCount: 2, models: [
        { model: "claude-fable-5", status: "healthy", requests: 4, successes: 4, lastErrorAt: null },
        { model: "claude-opus-5-5", status: "degraded", requests: 28, successes: 5, lastErrorAt: "2026-09-23T02:35:05.736Z", isLockedOut: true },
      ] },
    ] }] };
    const health = I.parseHealthMatrix(matrix);
    assert.deepEqual([...health.keys()], ["conn-1"]);
    assert.deepEqual(health.get("conn-1"), { state: "degraded", successRatePct: 28, requests: 32, issueCount: 2, lastErrorAt: "2026-09-23T02:35:05.736Z", failingModels: ["claude-opus-5-5"] });
    assert.equal(I.healthLine(health.get("conn-1")), "degraded · 28% of 32 requests answered in 24 h · failing: claude-opus-5-5");
    assert.equal(I.parseHealthMatrix(null).size, 0);
  });

  check("expiration: status by connection, unknown statuses dropped", () => {
    const expiry = I.parseExpiration({ list: [{ connectionId: "conn-1", status: "expiring_soon", expiresAt: "2026-10-01T00:00:00.000Z", note: null }, { connectionId: "conn-2", status: "weird" }] });
    assert.deepEqual([...expiry.entries()], [["conn-1", { status: "expiring_soon", expiresAt: "2026-10-01T00:00:00.000Z", note: null }]]);
    const accounts = I.withAccountHealth(I.parseAccounts({ providers: { connections: [{ id: "conn-1", provider: "claude", authType: "oauth" }] }, now: NOW }), new Map(), expiry);
    assert.deepEqual([accounts[0].authType, accounts[0].expiry?.status, accounts[0].health], ["oauth", "expiring_soon", null]);
  });

  check("account actions in words: test, batch test, refresh (Codex skips on purpose)", () => {
    assert.deepEqual(I.describeAccountTest({ valid: true, latencyMs: 812.4, refreshed: true }, "Claude #1"), { ok: true, message: "Claude #1 answered in 812 ms (token refreshed)." });
    assert.deepEqual(I.describeAccountTest({ valid: false, error: "Token expired" }, "Codex #2"), { ok: false, message: "Codex #2 failed its check: Token expired." });
    const batch = I.describeBatchTest({ summary: { total: 3, passed: 2, failed: 1 }, results: [{ connectionId: "a", connectionName: "someone@example.com", valid: false, error: "401" }, { valid: true }, { valid: true }] });
    assert.deepEqual([batch.ok, batch.message], [false, "2 of 3 accounts answered. Failed: so…@example.com (401)."]);
    assert.equal(I.describeBatchTest({ summary: { total: 0 }, results: [] }).message, "No active accounts to check.");
    assert.match(I.describeRefresh({ success: true, skipped: true, message: "Rotating-refresh provider: the token refreshes automatically on the next request." }, "Codex #1").message, /^Codex #1: Rotating-refresh provider/);
    assert.deepEqual(I.describeRefresh({ error: "Only OAuth connections support manual token refresh" }, "GLM #1"), { ok: false, message: "GLM #1: Only OAuth connections support manual token refresh." });
  });

  check("tunnels: only a running HTTPS address counts", () => {
    const cf = I.parseTunnel("cloudflared", { installed: true, running: true, publicUrl: "https://quiet-river-demo.trycloudflare.com", phase: "running", lastError: null });
    assert.deepEqual([cf.label, cf.url, cf.phase], ["Cloudflare tunnel", "https://quiet-river-demo.trycloudflare.com", "running"]);
    const ts = I.parseTunnel("tailscale", { installed: true, running: true, tunnelUrl: "https://router.tail1234.ts.net", enabled: true, phase: "running" });
    assert.equal(ts.url, "https://router.tail1234.ts.net", "Tailscale says tunnelUrl");
    assert.equal(I.parseTunnel("ngrok", { installed: true, running: false, publicUrl: "https://old.ngrok-free.app" }).url, null, "a stopped tunnel has no address");
    assert.equal(I.parseTunnel("cloudflared", { running: true, publicUrl: "http://127.0.0.1:20128" }).url, null, "plain http is not a tunnel address");
    assert.equal(I.activeTunnel([I.parseTunnel("ngrok", {}), cf])?.id, "cloudflared");
  });

  check("/v1/me/status: this key's own spend, limit and account quotas", () => {
    const mine = I.parseKeyStatus({
      apiKey: { id: "k1", name: "daemon-a" },
      usage: { cost: { period: "monthly", currency: "USD", usedUsd: 3.42, limitUsd: 50, remainingUsd: 46.58, usedPercent: 6.84, resetAt: "2026-10-01T00:00:00.000Z" }, tokens: { totalTokens: 1234567 } },
      accountQuotas: [{ provider: "claude", shared: true, quotas: { "5h": { usedPercentage: 36, remainingPercentage: 64, resetAt: null } } }, { provider: "codex", shared: true, available: false, reason: "not_supported" }],
    });
    assert.deepEqual(mine, {
      keyName: "daemon-a",
      spend: { usedUsd: 3.42, limitUsd: 50, remainingUsd: 46.58, usedPercent: 6.84, period: "monthly", resetAt: "2026-10-01T00:00:00.000Z" },
      tokens: 1234567,
      quotas: [{ provider: "Claude", text: "5h: 64% left" }, { provider: "Codex", text: "not reported for this provider" }],
    });
    assert.equal(I.parseKeyStatus({ usage: { cost: { usedUsd: 1, limitUsd: null } } }).spend.limitUsd, null, "no budget: no limit");
  });

  check("model list from ?configuredOnly=true: OmniRoute filtered it, twins still dropped", () => {
    const list = I.buildModelList({ data: [
      { id: "cc/claude-sonnet-5", owned_by: "claude", root: "claude-sonnet-5" },
      { id: "claude/claude-sonnet-5", owned_by: "claude", root: "claude-sonnet-5", parent: "cc/claude-sonnet-5" },
      { id: "cx/gpt-6-sol", owned_by: "codex", root: "gpt-6-sol" },
      { id: "auto", owned_by: null },
    ] }, null);
    assert.deepEqual(list.map((m) => m.label), ["Claude · Sonnet 5", "Codex · GPT-6 Sol"]);
  });

  console.log(`insights: ${passed} checks passed`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
