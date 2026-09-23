/**
 * Node stand-in for @getpaseo/plugin and its client entries. RPC answers and
 * settings are held back until `setHostDataReady(true)`, so a test can render
 * every component with nothing loaded, then with data — the transition that
 * surfaces a hook called after an early return.
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { RANGE_DAYS, describeCombos, linkAgents, parseAnalytics, parseByAccount, parseByDaemon, parseCallLogs, parseRouteExplanation, parseSettings, type AnalyticsRange } from "../../../shared/routers/omniroute/parsers";
import { AUTO_COMBO_DEFAULT, AUTO_COMBO_KINDS, CUSTOM_COMBO_LOOK } from "../../../shared/routers/omniroute/copy";
import { agentIdFromTag, classifyPublicCheck, comboProfile } from "../../../shared/logic";
const PUBLIC = "https://ai-router.example.com";

export function defineRpc<T>(contract: T) { return contract; }
export function defineSettings<T>(definition: T) { return definition; }
export async function openExternalUrl(_url: string) {}

let ready = false;
const listeners = new Set<() => void>();
export function setHostDataReady(value: boolean) {
  ready = value;
  for (const listener of listeners) listener();
}

const now = new Date().toISOString();
/** What a sync writes into Paseo's AI Router provider: labels from the real formatter. */
const SYNCED = [
  ["auto", "Combo · auto"], ["auto/coding", "Combo · auto/coding"], ["auto/fast", "Combo · auto/fast"], ["auto/best-reasoning", "Combo · auto/best-reasoning"], ["team-review", "Combo · team-review"],
  ["cc/claude-opus-5-5", "Claude · Opus 5.5"], ["cc/claude-sonnet-5", "Claude · Sonnet 5"], ["cc/claude-haiku-4-5", "Claude · Haiku 4.5"], ["cc/claude-fable-5-1", "Claude · Fable 5.1"],
  ["cx/gpt-5.6-sol", "Codex · GPT-5.6 Sol"], ["cx/gpt-5.6-terra", "Codex · GPT-5.6 Terra"], ["cx/gpt-5.1-codex-mini", "Codex · GPT-5.1 Codex Mini"],
].map(([id, label]) => ({ id, label }));
const fixtures: Record<string, unknown> = {
  "not connected": {
    connection: { source: "none", endpoint: null, consoleUrl: null, dashboardUrl: null, sshTarget: null, router: "omniroute", apiKey: { present: false, last4: null }, token: { present: false, last4: null }, manageKey: { present: false, last4: null } },
    problem: "no endpoint URL set", warnings: [], health: null, routeAgents: false, lastSession: null,
    aiProvider: { present: false, modelCount: 0, legacyCodex: false, lastSync: null, tests: [], summary: null, models: [] }, settingsDir: "/root/.paseo/plugin-settings/ai-router",
  },
  "env, no key": {
    connection: { source: "env", endpoint: "http://127.0.0.1:20128", consoleUrl: null, dashboardUrl: "http://127.0.0.1:20128/dashboard", sshTarget: null, router: "omniroute", apiKey: { present: false, last4: null }, token: { present: false, last4: null }, manageKey: { present: false, last4: null } },
    problem: "no API key set for http://127.0.0.1:20128", warnings: ["AI_ROUTER_TOKEN set without AI_ROUTER_URL; ignored."],
    health: { checkedAt: now, up: false, latencyMs: null, error: "connection refused at http://127.0.0.1:20128/api/health/ping", version: null, uptimeSeconds: null, monitoringError: null, paused: [] },
    routeAgents: false, lastSession: null, aiProvider: { present: false, modelCount: 0, legacyCodex: false, lastSync: null, tests: [], summary: null, models: [] }, settingsDir: "/root/.paseo/plugin-settings/ai-router",
  },
  connected: {
    connection: { source: "saved", endpoint: "http://10.0.0.5:20128", consoleUrl: null, dashboardUrl: "http://10.0.0.5:20128/dashboard", sshTarget: "root@router.example.com", router: "omniroute", apiKey: { present: true, last4: "abcd" }, token: { present: true, last4: "wxyz" }, manageKey: { present: false, last4: null } },
    problem: null, warnings: [],
    health: { checkedAt: now, up: true, latencyMs: 12, error: null, version: "3.8.50", uptimeSeconds: 90061, monitoringError: null, paused: [] },
    routeAgents: true, lastSession: { at: now, agentId: "agent-1", kind: "claude", routed: false, message: "routing skipped for claude session agent-1 (create): http://10.0.0.5:20128 is down: connection refused at http://10.0.0.5:20128/api/health/ping", reason: "http://10.0.0.5:20128 is down: connection refused at http://10.0.0.5:20128/api/health/ping" },
    aiProvider: { present: true, modelCount: SYNCED.length, legacyCodex: true, summary: "Combo 5 · Claude 4 · Codex 3", models: SYNCED, lastSync: { at: now, ok: true, message: "Synced 12 models to Paseo (Combo 5 · Claude 4 · Codex 3)." },
      tests: [{ model: "cc/claude-opus-5-5", at: now, ok: false, message: "cc/claude-opus-5-5: 400 — /v1/messages failed: Claude Code version 2.1.280 or newer is required" }] },
    settingsDir: "/root/.paseo/plugin-settings/ai-router",
  },
};
const soon = Date.now() + 45 * 60_000;
const insight = { state: "ok", message: null, checkedAt: now, notes: [] as string[], stale: null };
const accountFixtures: Record<string, unknown> = {
  ok: {
    ...insight, notes: ["Quota bars unavailable: 404 — /api/usage/provider-limits not found; is OmniRoute older than 3.8?"],
    accounts: [
      { id: "a", provider: "claude", shortName: "Claude #1", label: "so…@example.com", state: "healthy", problem: null, coolingUntil: null, quotas: [{ name: "session (5h)", remainingPct: 60, resetAt: now }, { name: "weekly (7d)", remainingPct: 3, resetAt: null }] },
      { id: "b", provider: "codex", shortName: "Codex #1", label: null, state: "attention", problem: null, coolingUntil: soon, quotas: [] },
      { id: "c", provider: "codex", shortName: "Codex #2", label: "wo…@example.com", state: "attention", problem: "re-login required", coolingUntil: null, quotas: [] },
    ],
    router: { breakers: { text: "No provider paused", tone: "success" }, p95Ms: 4100, providers: [{ name: "Claude Code", requests: 16, errorPct: 0, avgLatencyMs: 781 }], failingModels: [{ model: "claude-opus-5-5", provider: "Claude Code", failed: 3, requests: 3 }], paused: [] },
  },
  paused: {
    ...insight, accounts: [{ id: "a", provider: "claude", shortName: "Claude #1", label: null, state: "healthy", problem: null, coolingUntil: null, quotas: [] }],
    router: { breakers: { text: "Claude paused", tone: "danger" }, p95Ms: null, providers: [], failingModels: [], paused: [{ provider: "claude", retryAfterMs: 30000, lastError: "[400] messages.1.output_config: Extra inputs are not permitted" }] },
  },
  "no-token": { ...insight, state: "no-token", message: "Add a read-only access token (OmniRoute → Settings → Access Tokens, scope: read) to see accounts and usage.", accounts: [], router: null },
  error: { ...insight, state: "error", message: "Accounts: 401 — read token rejected: Invalid or expired access token", accounts: [], router: null },
};
/**
 * A month of plausible router traffic in `/api/usage/analytics`'s own shape,
 * run through the real parsers, so the analytics view shows what people will
 * read. Deterministic: the same numbers every run.
 */
const MODELS = [
  { model: "claude-sonnet-5", provider: "claude", share: 0.34, latency: 3900, ok: "99.20" },
  { model: "gpt-6-sol", provider: "codex", share: 0.24, latency: 2700, ok: "98.70" },
  { model: "claude-opus-5-5", provider: "claude", share: 0.18, latency: 6100, ok: "96.40" },
  { model: "gpt-5.6-sol", provider: "codex", share: 0.12, latency: 2400, ok: "100.00" },
  { model: "claude-haiku-4-5", provider: "claude", share: 0.07, latency: 1300, ok: "100.00" },
  { model: "glm-5.2", provider: "glm", share: 0.05, latency: 3300, ok: "88.00" },
];
const PROVIDER_NAMES: Record<string, string> = { claude: "Claude Code", codex: "OpenAI Codex", glm: "GLM" };
function analyticsBody(days: number): Record<string, unknown> {
  const DAY = 86_400_000;
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * DAY).toISOString().slice(0, 10));
  const perDay = dates.map((date, i) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const requests = weekday === 0 || weekday === 6 ? 6 + (i % 4) : 22 + ((i * 7) % 17);
    return { date, requests, tokens: requests * (38_000 + ((i * 5_311) % 21_000)) };
  });
  const requests = perDay.reduce((sum, d) => sum + d.requests, 0);
  const tokens = perDay.reduce((sum, d) => sum + d.tokens, 0);
  const cost = Math.round(tokens * 0.0000011 * 100) / 100;
  const byModel = MODELS.map((m) => ({ model: m.model, provider: m.provider, requests: Math.round(requests * m.share), totalTokens: Math.round(tokens * m.share), avgLatencyMs: m.latency, successRatePct: m.ok, cost: Math.round(cost * m.share * 100) / 100 }));
  const providers = ["claude", "codex", "glm"].map((id) => {
    const rows = byModel.filter((m) => m.provider === id);
    const n = rows.reduce((sum, r) => sum + r.requests, 0);
    return { provider: PROVIDER_NAMES[id], requests: n, totalTokens: rows.reduce((sum, r) => sum + r.totalTokens, 0), avgLatencyMs: id === "claude" ? 4300 : id === "codex" ? 2600 : 3300, successRatePct: id === "glm" ? "88.00" : id === "claude" ? "98.60" : "99.30", cost: Math.round(rows.reduce((sum, r) => sum + r.cost, 0) * 100) / 100 };
  });
  const activityMap: Record<string, number> = {};
  for (let i = 0; i < 365; i += 1) {
    const date = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (i > 150 || (weekday === 0 && i % 3 === 0)) continue;
    activityMap[date] = (weekday === 6 ? 90_000 : 400_000) + ((i * 9_973) % 900_000);
  }
  return {
    summary: { totalRequests: requests, promptTokens: Math.round(tokens * 0.93), completionTokens: Math.round(tokens * 0.07), totalTokens: tokens, totalCost: cost, successRatePct: 98.4, avgLatencyMs: 3820, fallbackRatePct: 1.6, streak: 12 },
    dailyTrend: perDay.map((d) => ({ date: d.date, requests: d.requests, totalTokens: d.tokens, cost: Math.round(d.tokens * 0.0000011 * 100) / 100 })),
    dailyByModel: perDay.map((d, i) => Object.fromEntries([["date", d.date], ...MODELS.map((m, j) => [m.model, Math.round(d.tokens * m.share * (1 + (((i + j) % 5) - 2) / 10))])])),
    byModel,
    byProvider: providers,
    byApiKey: [
      { apiKeyId: "k2", apiKeyName: "daemon-b", requests: Math.round(requests * 0.46), totalTokens: Math.round(tokens * 0.46), cost: Math.round(cost * 0.46 * 100) / 100 },
      { apiKeyId: "k1", apiKeyName: "daemon-a", requests: Math.round(requests * 0.38), totalTokens: Math.round(tokens * 0.38), cost: Math.round(cost * 0.38 * 100) / 100 },
      { apiKeyId: "k3", apiKeyName: "daemon-c", requests: Math.round(requests * 0.16), totalTokens: Math.round(tokens * 0.16), cost: Math.round(cost * 0.16 * 100) / 100 },
    ],
    byAccount: [
      { account: "someone@example.com", requests: Math.round(requests * 0.44), totalTokens: Math.round(tokens * 0.44), cost: 0 },
      { account: "worker@example.com", requests: Math.round(requests * 0.36), totalTokens: Math.round(tokens * 0.36), cost: 0 },
      { account: "tester@example.com", requests: Math.round(requests * 0.2), totalTokens: Math.round(tokens * 0.2), cost: 0 },
    ],
    errorBreakdown: [{ errorType: "rate_limit", count: 9 }, { errorType: "upstream_5xx", count: 4 }, { errorType: "timeout", count: 2 }],
    weeklyPattern: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => ({ day, avgTokens: [120_000, 900_000, 1_300_000, 1_100_000, 980_000, 860_000, 150_000][i] })),
    activityMap,
  };
}
function usageAnswer(kind: string, range: AnalyticsRange): unknown {
  if (kind === "no-token") return { ...insight, state: "no-token", message: "Add a read-only access token (OmniRoute → Settings → Access Tokens, scope: read) to see accounts and usage.", range, totals: null, trend: [], providerTrend: { providers: [], days: [] }, byModel: [], byProvider: [], byAccount: [], byDaemon: [], errors: [], activity: [], busiestWeekday: null, ownKey: null };
  const body = kind === "empty" ? { summary: { totalRequests: 0, totalTokens: 0, totalCost: 0, successRatePct: null }, dailyTrend: [], activityMap: {} } : analyticsBody(RANGE_DAYS[range]);
  const answer = { ...insight, range, ...parseAnalytics(body, range, Date.now()), byAccount: parseByAccount(body), byDaemon: parseByDaemon(body, { id: "k1", name: "daemon-a" }), ownKey: "daemon-a" };
  return kind === "stale" ? { ...answer, checkedAt: new Date(Date.now() - 38 * 60_000).toISOString(), stale: { reason: "Usage: the router is not answering (connection refused at http://10.0.0.5:20128/api/health/ping)" } } : answer;
}
const usageFixtures: Record<string, true> = { ok: true, empty: true, stale: true, "no-token": true };

// OmniRoute's combos as Paseo agent profiles, described by the real parser.
const COMBO_MODELS = { data: [
  { id: "auto", owned_by: "combo" }, { id: "auto/coding", owned_by: "combo" }, { id: "auto/fast", owned_by: "combo" }, { id: "auto/best-reasoning", owned_by: "combo" },
  { id: "team-review", owned_by: "combo", display_name: "Team review", description: "Opus 5.5 first, GPT-6 Sol when Claude is busy" },
] };
const COMBO_AUTO = { combos: [{ id: "auto", candidatePool: ["codex", "claude"] }, { id: "auto/coding", candidatePool: ["codex", "claude"] }, { id: "auto/fast", candidatePool: ["codex", "claude"] }, { id: "auto/best-reasoning", candidatePool: ["claude", "codex"] }] };
const COMBO_CUSTOM = { combos: [{ name: "team-review", models: [{}, {}], strategy: "priority" }] };
const comboList = describeCombos(COMBO_MODELS.data.map((m) => m.id), COMBO_MODELS, COMBO_AUTO, COMBO_CUSTOM, { auto: AUTO_COMBO_KINDS, fallback: AUTO_COMBO_DEFAULT, custom: CUSTOM_COMBO_LOOK })
  .map(comboProfile)
  .map((p) => ({ id: p.id, name: p.name, model: p.model ?? null, notes: p.notes ?? null, icon: p.icon ?? null, color: p.color ?? null }));
const profilesFixtures: Record<string, unknown> = {
  ok: { enabled: true, profiles: comboList, message: null },
  off: { enabled: false, profiles: [], message: null },
};
let profilesFixture = "ok";
/** What the switch was last saved as, so the next profiles answer follows it. */
let savedComboProfiles: boolean | null = null;
export function setProfilesFixture(name: string) { profilesFixture = name; savedComboProfiles = null; }

// The real parser builds the rows, so the preview shows the copy people will read.
const withoutCompression = (items: ReturnType<typeof parseSettings>) => items.filter((item) => item.id !== "compression");
const settingItems = withoutCompression(parseSettings({
  compressionPlan: { mode: "lite", pipeline: [] },
  compressionStats: { totalRequests: 40, totalTokensSaved: 12345, avgSavingsPct: 18 },
  health: { circuitBreakers: { open: 1, total: 2 }, providerBreakers: [{ provider: "claude", state: "OPEN" }] },
  resilience: { providerBreaker: { oauth: { failureThreshold: 8, resetTimeoutMs: 60000 } } },
  settings: { preferClaudeCodeForUnprefixedClaudeModels: true, comboStrategy: "fallback" },
  autoCombos: { combos: [{ id: "auto", candidatePool: ["codex", "claude"] }] },
}));
// The same rows with every breaker closed, for the healthy preview states.
const calmItems = withoutCompression(parseSettings({
  compressionPlan: { mode: "lite", pipeline: [] },
  compressionStats: { totalRequests: 40, totalTokensSaved: 12345, avgSavingsPct: 18 },
  health: { circuitBreakers: { open: 0, total: 2 }, providerBreakers: [{ provider: "claude", state: "CLOSED" }] },
  resilience: { providerBreaker: { oauth: { failureThreshold: 8, resetTimeoutMs: 60000 } } },
  settings: { preferClaudeCodeForUnprefixedClaudeModels: true, comboStrategy: "fallback" },
  autoCombos: { combos: [{ id: "auto", candidatePool: ["codex", "claude"] }] },
}));
const settingsFixtures: Record<string, unknown> = {
  calm: { state: "ok", message: null, checkedAt: now, notes: [], stale: null, canEdit: false, items: calmItems },
  ok: { ...insight, canEdit: false, items: settingItems },
  editable: { ...insight, canEdit: true, items: settingItems },
  "no-token": { ...insight, state: "no-token", message: "Add a read token to see the router's settings.", canEdit: false, items: [] },
};
// Preview-only states, built on the ones above.
const connected = fixtures.connected as Record<string, any>;
Object.assign(fixtures, {
  "routing off": { ...connected, routeAgents: false, lastSession: null, aiProvider: { present: false, modelCount: 0, legacyCodex: false, lastSync: null, tests: [], summary: null, models: [] } },
  "routing on": {
    ...connected,
    lastSession: { at: now, agentId: "agent-7", kind: "claude", routed: true, message: "claude session agent-7 (create) routed through http://10.0.0.5:20128", reason: null },
    aiProvider: { ...connected.aiProvider, legacyCodex: false, tests: [
      { model: "cx/gpt-5.6-sol", at: now, ok: true, message: "cx/gpt-5.6-sol answered in 812 ms" },
      { model: "cc/claude-opus-5-5", at: now, ok: false, message: "cc/claude-opus-5-5: 400 — /v1/messages failed: Claude Code version 2.1.280 or newer is required" },
    ] },
  },
  "no token": { ...connected, routeAgents: false, lastSession: null, connection: { ...connected.connection, token: { present: false, last4: null } }, aiProvider: { present: false, modelCount: 0, legacyCodex: false, lastSync: { at: now, ok: false, message: "Add a read token first: it limits the list to your connected accounts (OmniRoute lists hundreds of models)." }, tests: [], summary: null, models: [] } },
  "claude paused": { ...connected, connection: { ...connected.connection, manageKey: { present: true, last4: "89ab" } }, health: { ...connected.health, paused: ["claude"] }, lastSession: { at: now, agentId: "agent-9", kind: "provider", routed: false, message: "", reason: "no API key set for http://10.0.0.5:20128" } },
  "router down": {
    ...connected,
    connection: { ...connected.connection, manageKey: { present: true, last4: "89ab" } },
    health: { ...connected.health, up: false, latencyMs: null, error: "connection refused at http://10.0.0.5:20128/api/health/ping", version: null, uptimeSeconds: null, paused: [] },
    lastSeenAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    lastSession: { at: now, agentId: "agent-4", kind: "claude", routed: false, message: "", reason: "http://10.0.0.5:20128 is down: connection refused at http://10.0.0.5:20128/api/health/ping" },
  },
  // A public address (custom domain) that answers as OmniRoute over HTTPS, and one whose DNS is not set up yet.
  "public ok": {
    ...connected,
    connection: { ...connected.connection, manageKey: { present: true, last4: "89ab" }, consoleUrl: PUBLIC, publicUrl: PUBLIC, publicCheck: { ...classifyPublicCheck({ status: 200, body: { status: "ok" } }, PUBLIC), checkedAt: now }, dashboardUrl: `${PUBLIC}/dashboard` },
    lastSession: { at: now, agentId: "agent-7", kind: "claude", routed: true, message: "", reason: null },
    aiProvider: { ...connected.aiProvider, legacyCodex: false, tests: [] },
  },
  "public pending": {
    ...connected,
    connection: { ...connected.connection, consoleUrl: PUBLIC, publicUrl: PUBLIC, publicCheck: { ...classifyPublicCheck({ error: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND ai-router.example.com" } }) }, PUBLIC), checkedAt: now } },
    aiProvider: { ...connected.aiProvider, legacyCodex: false, tests: [] },
  },
  // connection.json names an endpoint that is not a URL: routing is blocked, and the panel opens on Connection.
  misconfigured: {
    connection: { source: "saved", endpoint: null, consoleUrl: null, dashboardUrl: null, sshTarget: null, router: "omniroute", apiKey: { present: true, last4: "abcd" }, token: { present: false, last4: null }, manageKey: { present: false, last4: null } },
    problem: "the saved endpoint in connection.json is not a usable http(s) URL", warnings: ["The saved public address is not a usable http(s) URL; it is ignored."], health: null, routeAgents: true, lastSession: null,
    aiProvider: { present: true, modelCount: SYNCED.length, legacyCodex: false, summary: "Combo 5 · Claude 4 · Codex 3", models: SYNCED, lastSync: null, tests: [] }, settingsDir: "/root/.paseo/plugin-settings/ai-router",
  },
  // A shared user: endpoint and inference key only.
  basic: {
    ...connected,
    connection: { ...connected.connection, token: { present: false, last4: null }, manageKey: { present: false, last4: null } },
    lastSession: { at: now, agentId: "agent-3", kind: "provider", routed: true, message: "", reason: null },
    aiProvider: { ...connected.aiProvider, legacyCodex: false, tests: [] },
  },
  // The router's admin: manage key, a Cloudflare tunnel running, Codex via OmniRoute added.
  admin: {
    ...connected,
    connection: { ...connected.connection, manageKey: { present: true, last4: "89ab" }, tunnel: { label: "Cloudflare tunnel", dashboardUrl: "https://quiet-river-demo.trycloudflare.com/dashboard" } },
    lastSession: { at: now, agentId: "agent-7", kind: "claude", routed: true, message: "", reason: null },
    aiProvider: { ...connected.aiProvider, legacyCodex: false, tests: [] },
    codexRouter: { present: true, modelCount: 3 },
  },
  "manage key": { ...connected, connection: { ...connected.connection, manageKey: { present: true, last4: "89ab" } }, aiProvider: { ...connected.aiProvider, legacyCodex: false, tests: [] } },
});
Object.assign(accountFixtures, {
  healthy: {
    ...insight,
    accounts: [
      { id: "a", provider: "claude", shortName: "Claude #1", label: "so…@example.com", state: "healthy", problem: null, coolingUntil: null, quotas: [{ name: "session (5h)", remainingPct: 64, resetAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }, { name: "weekly (7d)", remainingPct: 81, resetAt: null }] },
      { id: "b", provider: "codex", shortName: "Codex #1", label: "wo…@example.com", state: "healthy", problem: null, coolingUntil: null, quotas: [{ name: "5h", remainingPct: 92, resetAt: null }, { name: "7d", remainingPct: 38, resetAt: null }] },
      { id: "c", provider: "codex", shortName: "Codex #2", label: "te…@example.com", state: "healthy", problem: null, coolingUntil: null, quotas: [{ name: "5h", remainingPct: 100, resetAt: null }, { name: "7d", remainingPct: 7, resetAt: null }] },
    ],
    router: { breakers: { text: "No provider paused", tone: "success" }, p95Ms: 3900, providers: [{ name: "Claude Code", requests: 128, errorPct: 0, avgLatencyMs: 781 }, { name: "OpenAI Codex", requests: 96, errorPct: 2.1, avgLatencyMs: 728 }], failingModels: [], paused: [] },
  },
});
// Fill in what every status carries, the way the server computes it.
const tierOf = (c: any) => (!c.endpoint || !c.apiKey.present ? "none" : c.manageKey.present ? "admin" : c.token.present ? "operator" : "basic");
for (const value of Object.values(fixtures)) {
  const f = value as Record<string, any>;
  f.connection = { tunnel: null, publicUrl: null, publicCheck: null, ...f.connection };
  f.tier ??= tierOf(f.connection);
  f.checking ??= false;
  f.lastSeenAt ??= f.health?.up ? f.health.checkedAt : null;
  f.aiProvider = { via: f.aiProvider.present && f.aiProvider.lastSync ? "api" : null, ...f.aiProvider };
  f.codexRouter ??= { present: false, modelCount: 0 };
}
// What 0.5.0 adds to each account: auth type, 24-hour health, expiry.
const HEALTH = { a: { state: "healthy", successRatePct: 96, requests: 128, issueCount: 0, lastErrorAt: null, failingModels: [] }, c: { state: "degraded", successRatePct: 40, requests: 10, issueCount: 3, lastErrorAt: now, failingModels: ["gpt-5.6-sol"] } } as Record<string, unknown>;
for (const value of Object.values(accountFixtures)) {
  const a = value as Record<string, any>;
  a.accounts = a.accounts.map((account: any) => {
    const relogin = account.problem === "re-login required";
    return { authType: "oauth", health: relogin ? HEALTH.c : account.state === "healthy" ? HEALTH.a : null, expiry: relogin ? { status: "expired", expiresAt: "2026-09-20T00:00:00.000Z", note: null } : null, ...account };
  });
}
const accessFixtures: Record<string, unknown> = {
  ok: { state: "ok", message: null, checkedAt: now, keyName: "daemon-a", spend: { usedUsd: 3.42, limitUsd: 50, remainingUsd: 46.58, usedPercent: 6.84, period: "monthly", resetAt: "2026-10-01T00:00:00.000Z" }, tokens: 1234567, quotas: [{ provider: "Claude", text: "5h: 64% left · 7d: 81% left" }] },
  hidden: { state: "hidden", message: "OmniRoute does not share this key's spend or limits with it (the key lacks the self:usage scope).", checkedAt: now, keyName: null, spend: null, tokens: null, quotas: [] },
};
const compressionFixtures: Record<string, unknown> = {
  stacked: { state: "ok", message: null, mode: "stacked", engines: ["rtk", "caveman"], savings: "12.3k tokens saved on 40 requests (avg 18%)", recommended: false },
  lite: { state: "ok", message: null, mode: "lite", engines: ["lite"], savings: "12.3k tokens saved on 40 requests (avg 18%)", recommended: true },
  "no-token": { state: "no-token", message: "Add a read token to see how the router compresses prompts.", mode: null, engines: [], savings: null, recommended: false },
};
const providerRow = (id: string, label: string, status: string, owner: string, through: string, tidy: string | null = null, error: string | null = null) => ({ id, label, status, error, enabled: true, owner, through, tidy });
const providersFixtures: Record<string, unknown> = {
  ok: {
    state: "ok", message: null, checkedAt: now,
    rows: [
      providerRow("claude", "Claude", "ready", "paseo", "claude-toggle"),
      providerRow("codex", "Codex", "unavailable", "paseo", "codex-provider", null, "not logged in"),
      providerRow("ai-router", "AI Router", "ready", "ai-router", "is-router"),
      providerRow("copilot", "GitHub Copilot", "loading", "paseo", "none", "never finished loading"),
      providerRow("gemini", "Gemini", "ready", "user", "none"),
      providerRow("opencode", "OpenCode", "unavailable", "paseo", "none", "not installed on this daemon"),
      providerRow("pi", "Pi", "loading", "paseo", "none", "never finished loading"),
    ],
  },
};
const tunnelsFixtures: Record<string, unknown> = {
  ok: { state: "ok", message: null, tunnels: [
    { id: "cloudflared", label: "Cloudflare tunnel", installed: true, running: true, url: "https://quiet-river-demo.trycloudflare.com", phase: "running", error: null },
    { id: "ngrok", label: "ngrok tunnel", installed: false, running: false, url: null, phase: "not_installed", error: null },
    { id: "tailscale", label: "Tailscale Funnel", installed: true, running: false, url: null, phase: "stopped", error: null },
  ] },
};

// ---------------------------------------------------------------- activity
// Built with the real parsers from OmniRoute-shaped rows, the way the server answers.
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const SESSIONS = [
  { at: ago(2 * MIN), agentId: "agent-7", kind: "claude", provider: "claude", routed: true, reason: null, tagged: true },
  { at: ago(6 * MIN), agentId: "agent-3", kind: "codex", provider: "codex-ai-router", routed: true, reason: null, tagged: false },
  { at: ago(14 * MIN), agentId: "agent-5", kind: "provider", provider: "ai-router", routed: true, reason: null, tagged: true },
  { at: ago(38 * MIN), agentId: "agent-4", kind: "claude", provider: "claude", routed: false, reason: "http://10.0.0.5:20128 is down: connection refused at http://10.0.0.5:20128/api/health/ping", tagged: false },
  { at: ago(55 * MIN), agentId: "agent-2", kind: "provider", provider: "ai-router", routed: false, reason: "no API key set for http://10.0.0.5:20128", tagged: false },
  ...Array.from({ length: 6 }, (_, i) => ({ at: ago((70 + i * 20) * MIN), agentId: `agent-1${i}`, kind: "claude", provider: "claude", routed: true, reason: null, tagged: true })),
].reverse() as Array<{ at: string; agentId: string; kind: "claude" | "provider" | "codex"; provider: string; routed: boolean; reason: string | null; tagged: boolean }>;
const AGENTS = new Map<string, { title: string | null; model: string | null }>([
  ["agent-7", { title: "Fix the login bug", model: "cc/claude-sonnet-5" }],
  ["agent-3", { title: "Review the parser", model: "cx/gpt-5.6-sol" }],
  ["agent-5", { title: "Draft release notes", model: "cc/claude-opus-5-5" }],
  ["agent-4", { title: "Tidy the docs", model: "cc/claude-sonnet-5" }],
  ["agent-11", { title: "Rename the settings keys", model: "cc/claude-sonnet-5" }],
]);
const OWN_KEY = { id: "k1", name: "daemon-a" };
const logRow = (secondsAgo: number, over: Record<string, unknown>) => ({
  id: `r-${secondsAgo}`, timestamp: ago(secondsAgo * 1000), method: "POST", path: "/v1/messages", status: 200,
  model: "claude-sonnet-5", requestedModel: "cc/claude-sonnet-5", provider: "claude", providerDisplay: null, account: "someone@example.com",
  duration: 1800, tokens: { in: 12400, out: 820 }, apiKeyId: "k1", apiKeyName: "daemon-a", comboName: null, error: null, sessionTag: null, ...over,
});
const CALL_LOG = [
  logRow(40, { sessionTag: "paseo-agent-7" }),
  logRow(95, { model: "gpt-5.6-sol", requestedModel: "cx/gpt-5.6-sol", provider: "codex", account: "worker@example.com", duration: 2300, tokens: { in: 9000, out: 1500 } }),
  logRow(180, { model: "gpt-5.6-sol", requestedModel: "auto/coding", provider: "codex", account: "worker@example.com", comboName: "auto/coding", apiKeyId: "k2", apiKeyName: "daemon-b", duration: 2100, tokens: { in: 5100, out: 410 } }),
  logRow(300, { model: "glm-5.2", requestedModel: "cc/claude-opus-5-5", provider: "glm", account: "team@example.com", duration: 950, tokens: { in: 3000, out: 220 }, sessionTag: "paseo-agent-5" }),
  logRow(420, { status: 429, error: "[429] Rate limited: the 5-hour limit resets at 16:00", duration: 130, tokens: { in: 0, out: 0 }, sessionTag: "paseo-agent-7" }),
  logRow(540, { model: "claude-haiku-4-5", requestedModel: "cc/claude-haiku-4-5", apiKeyId: "k2", apiKeyName: "daemon-b", duration: 640, tokens: { in: 800, out: 90 } }),
  logRow(720, { status: 502, model: "gpt-5.6-terra", requestedModel: "cx/gpt-5.6-terra", provider: "codex", account: "worker@example.com", error: "[502] upstream closed the connection", apiKeyId: "k2", apiKeyName: "daemon-b", duration: 30000, tokens: { in: 0, out: 0 } }),
  logRow(900, { requestedModel: "claude-sonnet-5", duration: 4100, tokens: { in: 48200, out: 2100 }, sessionTag: "paseo-agent-11" }),
];
/** Forty of this daemon's requests: one page and then some, for "Show older". */
const MANY = Array.from({ length: 40 }, (_, i) => logRow(60 + i * 60, i < 25 ? {} : { model: "claude-haiku-4-5", requestedModel: "cc/claude-haiku-4-5" }));
const DECISIONS: Record<string, unknown> = {
  "r-300": {
    routeType: "direct", confidence: "medium", summary: "Direct request served by glm/glm-5.2 after claude answered 503.", comboUsed: null, providerSelected: "glm", modelUsed: "glm-5.2",
    decision: {
      factors: [
        { name: "Direct routing", value: "Direct provider request", status: "neutral", details: "No combo matched cc/claude-opus-5-5." },
        { name: "Recent health", value: "40%", status: "negative", details: "Claude answered 2 of the last 5 requests." },
      ],
      fallbacksTriggered: [{ provider: "claude", model: "claude-opus-5-5", status: 503, reason: "upstream unavailable", timestamp: ago(301_000) }],
    },
    selectedTarget: { provider: "glm", model: "glm-5.2", account: "team@example.com" },
    limitations: ["Detailed request pipeline payloads were not persisted for this log entry."],
  },
  "r-180": {
    routeType: "combo", confidence: "high", summary: "Combo auto/coding picked codex/gpt-5.6-sol at step 1.", comboUsed: "auto/coding", providerSelected: "codex", modelUsed: "gpt-5.6-sol",
    decision: { factors: [{ name: "Combo routing", value: "auto/coding", status: "positive", details: "Request matched combo auto/coding at step 1." }, { name: "Quota headroom", value: "92%", status: "positive", details: "Codex #1 had the most left." }], fallbacksTriggered: [] },
    selectedTarget: { provider: "codex", model: "gpt-5.6-sol", account: "worker@example.com" }, limitations: [],
  },
};
const directDecision = (row: ReturnType<typeof logRow>) => ({
  routeType: "direct", confidence: "medium", summary: `Direct request served by ${row.provider}/${row.model}.`, comboUsed: null, providerSelected: row.provider, modelUsed: row.model,
  decision: { factors: [{ name: "Direct routing", value: "Direct provider request", status: "neutral", details: null }, { name: "Recent health", value: row.status === 200 ? "96%" : "40%", status: row.status === 200 ? "positive" : "negative", details: null }], fallbacksTriggered: [] },
  selectedTarget: { provider: row.provider, model: row.model, account: row.account }, limitations: [],
});
let activityFixture = "ok";
export function setActivityFixture(name: string) { activityFixture = name; }
type ActivityInput = { scope?: "daemon" | "all"; errorsOnly?: boolean; model?: string | null; provider?: string | null; limit?: number };
function activityAnswer(status: Record<string, any>, input: ActivityInput) {
  const sessions = SESSIONS.slice().reverse().map((entry) => ({ ...entry, agentTitle: AGENTS.get(entry.agentId)?.title ?? null }));
  const none = { rows: [], hasMore: false, ownKey: null };
  if (status.tier !== "operator" && status.tier !== "admin") return { sessions, requests: { ...insight, state: "no-token", message: "Add a read token to see every request the router served.", checkedAt: null, ...none } };
  const has = (value: unknown, wanted: string) => String(value ?? "").toLowerCase().includes(wanted.toLowerCase());
  let raw = (activityFixture === "many" ? MANY : activityFixture === "empty" ? [] : CALL_LOG) as Array<ReturnType<typeof logRow>>;
  if ((input.scope ?? "daemon") === "daemon") raw = raw.filter((r) => r.apiKeyId === OWN_KEY.id);
  if (input.errorsOnly) raw = raw.filter((r) => r.status >= 400 || r.error);
  if (input.model) raw = raw.filter((r) => has(r.model, input.model!) || has(r.requestedModel, input.model!));
  if (input.provider) raw = raw.filter((r) => has(r.provider, input.provider!));
  const limit = input.limit ?? 25;
  const { rows, hasMore } = parseCallLogs(raw.slice(0, limit + 1), OWN_KEY, limit);
  const links = linkAgents(rows, SESSIONS, AGENTS, agentIdFromTag);
  const down = status.health?.up === false;
  return {
    sessions,
    requests: {
      ...insight,
      checkedAt: down ? ago(40 * MIN) : now,
      stale: down ? { reason: "Requests: the router is not answering (connection refused)." } : null,
      rows: rows.map(({ sessionTag: _tag, ...row }) => ({ ...row, agent: links.get(row.id) ?? null })),
      hasMore,
      ownKey: OWN_KEY.name,
    },
  };
}
function activityDetailAnswer(id: string) {
  const row = [...CALL_LOG, ...MANY].find((r) => r.id === id);
  return { state: "ok", message: null, ...parseRouteExplanation(DECISIONS[id] ?? (row ? directDecision(row) : null)) };
}

/** Preview: pick every answer at once. */
export function setPreview(state: { status: string; accounts?: string; usage?: string; settings?: string; access?: string; compression?: string; profiles?: string; activity?: string }) {
  profilesFixture = state.profiles ?? "ok";
  activityFixture = state.activity ?? "ok";
  savedComboProfiles = null;
  fixture = state.status;
  accountFixture = state.accounts ?? "ok";
  usageFixture = state.usage ?? "ok";
  settingsFixture = state.settings ?? "ok";
  accessFixture = state.access ?? "ok";
  compressionFixture = state.compression ?? "stacked";
  setHostDataReady(true);
}
let accessFixture = "ok";
let compressionFixture = "stacked";
export function setAccessFixture(name: string) { accessFixture = name; }
export function setCompressionFixture(name: string) { compressionFixture = name; }
/** The icon the Paseo app draws; a host element here, so tests can see which. */
export const Icon = ({ name }: { name: string }) => React.createElement("Icon", { name });
let fixture = "connected";
let settingsFixture = "ok";
export function setSettingsFixture(name: string) { settingsFixture = name; }
export function setUsageFixture(name: string) { usageFixture = name; }
let accountFixture = "ok";
let usageFixture = "ok";
export function setStatusFixture(name: string, insights = "ok") { fixture = name; accountFixture = insights; usageFixture = insights in usageFixtures ? insights : "no-token"; settingsFixture = "ok"; accessFixture = "ok"; compressionFixture = "stacked"; profilesFixture = "ok"; activityFixture = "ok"; savedComboProfiles = null; }

const pendingRpc = new Set<() => void>();
export function releaseRpc() { for (const release of pendingRpc) release(); pendingRpc.clear(); }
export function useRpc(contract: any) {
  return React.useCallback(async (input: unknown) => {
    if (!ready) await new Promise<void>((resolve) => pendingRpc.add(resolve));
    const name = contract.name.replace("ai-router.", "");
    const status = fixtures[fixture] as Record<string, any>;
    const manage = status.connection.manageKey.present === true;
    const answers: Record<string, () => unknown> = {
      status: () => status,
      accounts: () => ({ ...(accountFixtures[accountFixture] as object), canAct: manage }),
      usage: () => usageAnswer(usageFixture, ((input as { range?: AnalyticsRange })?.range ?? "7d") as AnalyticsRange),
      profiles: () => profilesFixtures[savedComboProfiles === false ? "off" : savedComboProfiles === true ? "ok" : profilesFixture],
      settings: () => { const answer = settingsFixtures[settingsFixture] as Record<string, unknown>; return { ...answer, canEdit: answer.canEdit === true || manage }; },
      access: () => accessFixtures[accessFixture],
      compression: () => ({ ...(compressionFixtures[compressionFixture] as object), canEdit: manage }),
      "providers.list": () => providersFixtures.ok,
      tunnels: () => (manage ? tunnelsFixtures.ok : { state: "no-manage-key", message: "OmniRoute only shows its tunnels to a manage key.", tunnels: [] }),
      "model.test": () => ({ ok: true, message: `${(input as { model: string }).model} answered in 640 ms` }),
      activity: () => activityAnswer(status, (input ?? {}) as ActivityInput),
      "activity.detail": () => activityDetailAnswer((input as { id: string }).id),
      ensure: () => ({ ok: true }),
    };
    const answer = answers[name]?.() ?? { ok: true, saved: true, message: "ok" };
    return contract.output.parse(answer);
  }, [contract]);
}

export function useSettings(_definition: any) {
  const [isReady, setReady] = useState(ready);
  useEffect(() => {
    const listener = () => setReady(ready);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  const base = { saving: false, saveError: null, save: async (values: { comboProfiles?: boolean }) => { if (typeof values?.comboProfiles === "boolean") savedComboProfiles = values.comboProfiles; return true; }, reset: async () => true, reload: async () => {} };
  const routeAgents = (fixtures[fixture] as { routeAgents?: boolean }).routeAgents !== false;
  return isReady ? { ...base, status: "ready", values: { routeAgents, comboProfiles: profilesFixture !== "off" }, revision: "r1" } : { ...base, status: "loading" };
}

const passthrough = ({ children }: any) => <View>{children}</View>;
export const SettingsSection = passthrough, SettingsCard = passthrough;
export const SettingsSwitch = ({ label }: any) => <Text>{label}</Text>;
