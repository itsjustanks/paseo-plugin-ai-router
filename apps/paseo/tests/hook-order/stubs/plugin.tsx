/**
 * Node stand-in for @getpaseo/plugin and its client entries. RPC answers and
 * settings are held back until `setHostDataReady(true)`, so a test can render
 * every component with nothing loaded, then with data — the transition that
 * surfaces a hook called after an early return.
 */
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { parseSettings } from "../../../server/routers/omniroute/parsers";

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
    aiProvider: { present: true, modelCount: 7, legacyCodex: true, summary: "Claude 4 · Codex 3", models: SYNCED, lastSync: { at: now, ok: true, message: "Synced 7 models to Paseo (Claude 4 · Codex 3)." },
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
const usageFixtures: Record<string, unknown> = {
  ok: {
    ...insight, ownKey: "daemon-a",
    day: { requests: 0, tokens: 0, cost: 0, successRatePct: null },
    week: { requests: 13, tokens: 65341, cost: 0.02, successRatePct: 100 },
    trend: ["17", "18", "19", "20", "21", "22", "23"].map((d, i) => ({ date: `2026-09-${d}`, requests: i * 2, tokens: i * 1000 })),
    byAccount: [{ label: "so…@example.com", requests: 9, tokens: 1200, cost: 0 }],
    byDaemon: [{ label: "daemon-b", requests: 9, tokens: 1200, cost: 0.02 }, { label: "daemon-a", requests: 4, tokens: 64141, cost: 0, thisDaemon: true }],
    topModels: [{ label: "claude-sonnet-5", requests: 3, tokens: 64114, cost: 0, failedPct: 0 }, { label: "claude-opus-5-5", requests: 3, tokens: null, cost: null, failedPct: 100 }],
  },
  "no-token": { ...insight, state: "no-token", message: "Add a read-only access token (OmniRoute → Settings → Access Tokens, scope: read) to see accounts and usage.", day: null, week: null, trend: [], byAccount: [], byDaemon: [], topModels: [], ownKey: null },
};
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
  // connection.json names an endpoint that is not a URL: routing is blocked, and the panel opens on Connection.
  misconfigured: {
    connection: { source: "saved", endpoint: null, consoleUrl: null, dashboardUrl: null, sshTarget: null, router: "omniroute", apiKey: { present: true, last4: "abcd" }, token: { present: false, last4: null }, manageKey: { present: false, last4: null } },
    problem: "the saved endpoint in connection.json is not a usable http(s) URL", warnings: ["The saved dashboard URL is invalid; using the default."], health: null, routeAgents: true, lastSession: null,
    aiProvider: { present: true, modelCount: 7, legacyCodex: false, summary: "Claude 4 · Codex 3", models: SYNCED, lastSync: null, tests: [] }, settingsDir: "/root/.paseo/plugin-settings/ai-router",
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
  f.connection = { tunnel: null, ...f.connection };
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
Object.assign(usageFixtures, {
  empty: { ...insight, ownKey: "daemon-a", day: { requests: 0, tokens: 0, cost: 0, successRatePct: null }, week: { requests: 0, tokens: 0, cost: 0, successRatePct: null }, trend: ["17", "18", "19", "20", "21", "22", "23"].map((d) => ({ date: `2026-09-${d}`, requests: 0, tokens: 0 })), byAccount: [], byDaemon: [], topModels: [] },
});
/** Preview: pick every answer at once. */
export function setPreview(state: { status: string; accounts?: string; usage?: string; settings?: string; access?: string; compression?: string }) {
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
export function setStatusFixture(name: string, insights = "ok") { fixture = name; accountFixture = insights; usageFixture = insights in usageFixtures ? insights : "no-token"; settingsFixture = "ok"; accessFixture = "ok"; compressionFixture = "stacked"; }

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
      usage: () => usageFixtures[usageFixture],
      settings: () => { const answer = settingsFixtures[settingsFixture] as Record<string, unknown>; return { ...answer, canEdit: answer.canEdit === true || manage }; },
      access: () => accessFixtures[accessFixture],
      compression: () => ({ ...(compressionFixtures[compressionFixture] as object), canEdit: manage }),
      "providers.list": () => providersFixtures.ok,
      tunnels: () => (manage ? tunnelsFixtures.ok : { state: "no-manage-key", message: "OmniRoute only shows its tunnels to a manage key.", tunnels: [] }),
      "model.test": () => ({ ok: true, message: `${(input as { model: string }).model} answered in 640 ms` }),
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
  const base = { saving: false, saveError: null, save: async () => true, reset: async () => true, reload: async () => {} };
  const routeAgents = (fixtures[fixture] as { routeAgents?: boolean }).routeAgents !== false;
  return isReady ? { ...base, status: "ready", values: { routeAgents }, revision: "r1" } : { ...base, status: "loading" };
}

const passthrough = ({ children }: any) => <View>{children}</View>;
export const SettingsSection = passthrough, SettingsCard = passthrough;
export const SettingsSwitch = ({ label }: any) => <Text>{label}</Text>;
