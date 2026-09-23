import type { Access, Accounts, AnalyticsRangeId, Compression, RouterSettings, Tunnels, Usage } from "../../../shared/contracts";
import {
  activeTunnel,
  describeAccountTest,
  describeBatchTest,
  describeRefresh,
  parseExpiration,
  parseHealthMatrix,
  parseTunnel,
  withAccountHealth,
  TUNNEL_LABELS,
  type Tunnel,
  type TunnelId,
  activeProviders,
  buildModelList,
  compressionPayload,
  describeManagementStatus,
  lastCallError,
  parseSettings,
  preferClaudeCodePayload,
  type CatalogModel,
  findOwnKey,
  parseAccounts,
  parseByAccount,
  parseByDaemon,
  parseRouterStrip,
  parseTopModels,
  parseTotals,
  parseTrend,
  parseKeyStatus,
  parseAnalytics,
  describeCombos,
  type ComboInfo,
} from "../../../shared/routers/omniroute/parsers";
import { describeFetchError, type Connection } from "../../../shared/logic";
import { AUTO_COMBO_DEFAULT, AUTO_COMBO_KINDS, CUSTOM_COMBO_LOOK, RECOMMENDED_COMPRESSION } from "../../../shared/routers/omniroute/copy";
import { bearer, getJson, recentlyDown } from "./health";

const TIMEOUT_MS = 10_000;
/** The panel polls accounts every 30s and usage every 60s; answers younger than this are reused. */
const ACCOUNTS_MAX_AGE_MS = 25_000;
const USAGE_MAX_AGE_MS = 55_000;

type Got = { ok: true; body: unknown } | { ok: false; error: string };

/**
 * One management call: a GET with the read token (or the manage key, which
 * may read too), or a write or manage-only GET with the manage key.
 */
async function read(connection: Connection, path: string, write?: { method: string; body?: unknown; timeoutMs?: number }): Promise<Got> {
  const url = `${connection.endpoint}${path}`;
  const secret = write ? connection.manageKey : connection.token ?? connection.manageKey;
  const timeoutMs = write?.timeoutMs ?? TIMEOUT_MS;
  try {
    const headers = { ...bearer(secret ?? ""), ...(write?.body !== undefined ? { "content-type": "application/json" } : {}) };
    const init = write ? { method: write.method, ...(write.body !== undefined ? { body: JSON.stringify(write.body) } : {}) } : {};
    const { status, body } = await getJson(url, headers, timeoutMs, init);
    return status === 200 ? { ok: true, body } : { ok: false, error: describeManagementStatus(status, body, path, write || !connection.token ? "manage key" : "read token") };
  } catch (error) {
    return { ok: false, error: describeFetchError(error, url, timeoutMs) };
  }
}

// Answers are cached per endpoint + token in this process only; nothing is written to disk.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && maxAgeMs > 0 && Date.now() - hit.at <= maxAgeMs) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const base = { state: "ok" as const, message: null, checkedAt: null, notes: [] as string[], stale: null };

/**
 * The last good answer per kind of read. When the router stops answering, a
 * tab shows this, marked stale with the reason, instead of an error or a
 * spinner. Memory only.
 */
const lastGood = new Map<string, unknown>();
type Answer = { state: "ok" | "no-token" | "error"; message: string | null; stale: { reason: string } | null };
function keepOrFallBack<T extends Answer>(key: string, answer: T): T {
  if (answer.state === "ok") {
    lastGood.set(key, answer);
    return answer;
  }
  const good = lastGood.get(key) as T | undefined;
  return answer.state === "error" && good ? { ...good, stale: { reason: answer.message ?? "no answer" } } : answer;
}
/** Answer from memory at once while the router is known to be down, instead of waiting out a timeout per tab. */
function whileDown<T extends Answer>(connection: Connection, key: string, what: string, empty: Omit<T, keyof Answer | "checkedAt" | "notes">): T | null {
  const down = recentlyDown(connection);
  return down ? keepOrFallBack(key, { ...base, ...empty, state: "error", message: `${what}: ${down}`, checkedAt: new Date().toISOString() } as unknown as T) : null;
}
const NO_TOKEN = "Add a read-only access token (OmniRoute → Settings → Access Tokens, scope: read) to see accounts and usage.";

function precheck(connection: Connection): { state: "no-token" | "error"; message: string } | null {
  if (!connection.endpoint) return { state: "error", message: "Set the endpoint URL first." };
  if (!connection.token && !connection.manageKey) return { state: "no-token", message: NO_TOKEN };
  return null;
}
/** The key the reads go out with, for cache keys. */
const readKey = (connection: Connection) => connection.token ?? connection.manageKey;

export async function getAccounts(connection: Connection, refresh: boolean): Promise<Accounts> {
  const canAct = !!connection.manageKey;
  const stop = precheck(connection);
  if (stop) return { ...base, ...stop, accounts: [], router: null, canAct };
  const key = `accounts\n${connection.endpoint}\n${readKey(connection)}`;
  const down = whileDown<Accounts>(connection, key, "Accounts", { accounts: [], router: null, canAct });
  if (down) return { ...down, canAct };
  return cached(key, refresh ? 0 : ACCOUNTS_MAX_AGE_MS, async () => keepOrFallBack(key, { ...(await loadAccounts(connection)), canAct }));
}

async function loadAccounts(connection: Connection): Promise<Omit<Accounts, "canAct">> {
  {
    const [providers, rateLimits, limits, health, stats, matrix, expiration] = await Promise.all(
      ["/api/providers", "/api/rate-limits", "/api/usage/provider-limits", "/api/monitoring/health", "/api/provider-stats", "/api/providers/health-matrix", "/api/providers/expiration"].map((path) => read(connection, path)),
    );
    const notes: string[] = [];
    const note = (got: Got, what: string) => (got.ok ? got.body : (notes.push(`${what} unavailable: ${got.error}`), null));
    const router = health.ok || stats.ok ? parseRouterStrip(note(health, "Circuit breakers"), note(stats, "Provider stats")) : null;
    // A paused provider is the one thing worth an extra call: its newest error says why.
    for (const paused of router?.paused ?? []) {
      const logs = await read(connection, `/api/usage/call-logs?status=error&limit=1&provider=${encodeURIComponent(paused.provider)}`);
      paused.lastError = logs.ok ? lastCallError(logs.body) : `unavailable (${logs.error})`;
    }
    if (!providers.ok) return { ...base, state: "error", message: `Accounts: ${providers.error}`, checkedAt: new Date().toISOString(), notes, accounts: [], router };
    const accountsList = parseAccounts({ providers: providers.body, rateLimits: note(rateLimits, "Cooldowns"), limits: note(limits, "Quota bars"), now: Date.now() });
    const withHealth = withAccountHealth(accountsList, parseHealthMatrix(note(matrix, "24-hour health")), parseExpiration(note(expiration, "Expiry dates")));
    return { ...base, checkedAt: new Date().toISOString(), notes, accounts: withHealth, router };
  }
}

export async function getUsage(connection: Connection, refresh: boolean, range: AnalyticsRangeId = "7d"): Promise<Usage> {
  const empty = { range, totals: null, trend: [], providerTrend: { providers: [], days: [] }, byModel: [], byProvider: [], byAccount: [], byDaemon: [], errors: [], activity: [], busiestWeekday: null, ownKey: null };
  const stop = precheck(connection);
  if (stop) return { ...base, ...stop, ...empty };
  const key = `usage\n${range}\n${connection.endpoint}\n${readKey(connection)}`;
  const down = whileDown<Usage>(connection, key, "Usage", empty);
  if (down) return down;
  return cached(key, refresh ? 0 : USAGE_MAX_AGE_MS, async () => keepOrFallBack(key, await loadUsage(connection, range, empty)));
}

/** One `/api/usage/analytics` call for the range, plus `/api/keys` to find this daemon's row. */
async function loadUsage(connection: Connection, range: AnalyticsRangeId, empty: Omit<Usage, keyof typeof base | "state">): Promise<Usage> {
  const [analytics, keys] = await Promise.all([`/api/usage/analytics?range=${range}`, "/api/keys"].map((path) => read(connection, path)));
  const checkedAt = new Date().toISOString();
  if (!analytics.ok) return { ...base, state: "error", message: `Usage: ${analytics.error}`, checkedAt, ...empty };
  const notes: string[] = [];
  const own = keys.ok ? findOwnKey(keys.body, connection.apiKey) : null;
  if (!keys.ok) notes.push(`Could not tell which key is this daemon's: ${keys.error}`);
  else if (!own) notes.push("This daemon's API key is not in OmniRoute's key list, so its row is not highlighted.");
  return {
    ...base,
    checkedAt,
    notes,
    range,
    ...parseAnalytics(analytics.body, range, Date.now()),
    byAccount: parseByAccount(analytics.body),
    byDaemon: parseByDaemon(analytics.body, own),
    ownKey: own?.name ?? null,
  };
}

// ------------------------------------------------------------------ models

/**
 * The combos the dashboard shows, in its order: auto combos, then custom ones.
 * Read-token calls; null (fall back to the core auto combos) if either fails.
 * The bodies come back too, for the combo descriptions on agent profiles.
 */
async function dashboardCombos(connection: Connection): Promise<{ ids: string[] | null; auto: unknown; custom: unknown }> {
  const names = (body: unknown): string[] => {
    const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const items = Array.isArray(body) ? body : Array.isArray(root.combos) ? root.combos : Array.isArray(root.data) ? root.data : [];
    return items.map((item) => (item && typeof item === "object" ? ((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name) : item))
      .filter((value): value is string => typeof value === "string" && value.length > 0);
  };
  const [auto, custom] = await Promise.all([read(connection, "/api/combos/auto"), read(connection, "/api/combos")]);
  const autoBody = auto.ok ? auto.body : null;
  const customBody = custom.ok ? custom.body : null;
  if (!auto.ok) return { ids: null, auto: autoBody, custom: customBody };
  return { ids: [...names(auto.body), ...(custom.ok ? names(custom.body) : [])], auto: autoBody, custom: customBody };
}

/** More than this after `?configuredOnly=true` means the router ignored the filter (an older OmniRoute). */
const UNFILTERED_MODELS = 300;

/**
 * The AI Router provider's model list, limited to connected accounts. With a
 * read token (or manage key): `/v1/models` filtered by the active accounts in
 * `/api/providers`. With only the inference key: `/v1/models?configuredOnly=true`,
 * which OmniRoute filters itself and also limits to the key's allowed models.
 */
export async function catalogue(connection: Connection): Promise<{ ok: true; list: CatalogModel[]; combos: ComboInfo[] } | { ok: false; error: string }> {
  if (!connection.endpoint || !connection.apiKey) return { ok: false, error: "Set the endpoint URL and API key first." };
  const down = recentlyDown(connection);
  if (down) return { ok: false, error: `Models: ${down}` };
  const operator = !!(connection.token || connection.manageKey);
  const path = operator ? "/v1/models" : "/v1/models?configuredOnly=true";
  const url = `${connection.endpoint}${path}`;
  let models: { status: number; body: unknown };
  try {
    models = await getJson(url, bearer(connection.apiKey), TIMEOUT_MS);
  } catch (error) {
    return { ok: false, error: describeFetchError(error, url, TIMEOUT_MS) };
  }
  if (models.status !== 200) return { ok: false, error: describeManagementStatus(models.status, models.body, "/v1/models", "API key") };
  let active: Set<string> | null = null;
  if (operator) {
    const providers = await read(connection, "/api/providers");
    if (!providers.ok) return { ok: false, error: `Connected accounts: ${providers.error}` };
    active = activeProviders(providers.body);
  }
  const dashboard = operator ? await dashboardCombos(connection) : { ids: null, auto: null, custom: null };
  const list = buildModelList(models.body, active, dashboard.ids);
  if (!list.length) return { ok: false, error: active ? `OmniRoute lists no models for the active accounts (${[...active].join(", ") || "none"}).` : "OmniRoute lists no models this key can use on connected accounts." };
  if (!active && list.length > UNFILTERED_MODELS) {
    return { ok: false, error: `OmniRoute listed ${list.length} models without narrowing them to connected accounts; this version may not support that for a plain key. Add a read token on the Connection tab, or update OmniRoute.` };
  }
  const comboIds = list.filter((model) => model.provider === "combo").map((model) => model.id);
  const combos = describeCombos(comboIds, models.body, dashboard.auto, dashboard.custom, { auto: AUTO_COMBO_KINDS, fallback: AUTO_COMBO_DEFAULT, custom: CUSTOM_COMBO_LOOK });
  return { ok: true, list, combos };
}

// ------------------------------------------------------------- your access

const ACCESS_MAX_AGE_MS = 55_000;

/** `/v1/me/status` with the inference key: only this key's own name, spend, limit and account quotas. */
export async function getAccess(connection: Connection, refresh: boolean): Promise<Access> {
  const empty = { keyName: null, spend: null, tokens: null, quotas: [] };
  if (!connection.endpoint || !connection.apiKey) return { state: "error", message: "Set the endpoint URL and API key first.", checkedAt: null, ...empty };
  const down = recentlyDown(connection);
  if (down) return { state: "error", message: `Your access: ${down}`, checkedAt: null, ...empty };
  return cached(`access\n${connection.endpoint}\n${connection.apiKey}`, refresh ? 0 : ACCESS_MAX_AGE_MS, async () => {
    const url = `${connection.endpoint}/v1/me/status`;
    const checkedAt = new Date().toISOString();
    try {
      const { status, body } = await getJson(url, bearer(connection.apiKey!), TIMEOUT_MS);
      if (status === 200) return { state: "ok" as const, message: null, checkedAt, ...parseKeyStatus(body) };
      if (status === 403) return { state: "hidden" as const, message: "OmniRoute does not share this key's spend or limits with it (the key lacks the self:usage scope).", checkedAt, ...empty };
      if (status === 404) return { state: "hidden" as const, message: "This OmniRoute cannot tell a key about itself (no /v1/me/status).", checkedAt, ...empty };
      return { state: "error" as const, message: describeManagementStatus(status, body, "/v1/me/status", "API key"), checkedAt, ...empty };
    } catch (error) {
      return { state: "error" as const, message: describeFetchError(error, url, TIMEOUT_MS), checkedAt, ...empty };
    }
  });
}

/** A one-token request through OmniRoute, as Claude Code would send it. */
export async function testModel(connection: Connection, model: string): Promise<{ ok: boolean; message: string }> {
  if (!connection.endpoint || !connection.apiKey) return { ok: false, message: "Set the endpoint URL and API key first." };
  const url = `${connection.endpoint}/v1/messages`;
  const started = Date.now();
  let outcome: { ok: boolean; message: string };
  try {
    const { status, body } = await getJson(url, { ...bearer(connection.apiKey), "content-type": "application/json", "anthropic-version": "2023-06-01" }, 60_000, {
      method: "POST",
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
    });
    outcome =
      status === 200
        ? { ok: true, message: `${model} answered in ${Date.now() - started} ms` }
        : { ok: false, message: `${model}: ${describeManagementStatus(status, body, "/v1/messages", "API key")}` };
  } catch (error) {
    outcome = { ok: false, message: `${model}: ${describeFetchError(error, url, 60_000)}` };
  }
  return outcome;
}

// ---------------------------------------------------------------- settings

const SETTINGS_MAX_AGE_MS = 25_000;

export async function getSettings(connection: Connection, refresh: boolean): Promise<RouterSettings> {
  const canEdit = !!connection.manageKey;
  const stop = precheck(connection);
  if (stop) return { ...base, ...stop, message: stop.state === "no-token" ? "Add a read token to see the router's settings." : stop.message, items: [], canEdit };
  const key = `settings\n${connection.endpoint}\n${readKey(connection)}`;
  const down = whileDown<RouterSettings>(connection, key, "Settings", { items: [], canEdit });
  if (down) return { ...down, canEdit };
  return cached(key, refresh ? 0 : SETTINGS_MAX_AGE_MS, async () => ({ ...keepOrFallBack(key, await loadSettings(connection)), canEdit }));
}

async function loadSettings(connection: Connection): Promise<RouterSettings> {
  const canEdit = !!connection.manageKey;
  {
    const paths = ["/api/settings", "/api/context/combos/default", "/api/analytics/compression", "/api/resilience", "/api/resilience/model-cooldowns", "/api/combos/auto", "/api/monitoring/health"];
    const [settings, compressionPlan, compressionStats, resilience, cooldowns, autoCombos, health] = await Promise.all(paths.map((path) => read(connection, path)));
    const notes: string[] = [];
    const body = (got: Got, what: string) => (got.ok ? got.body : (notes.push(`${what} unavailable: ${got.error}`), undefined));
    // Compression has its own card on the Settings tab; the rest are listed here.
    const items = parseSettings({
      settings: body(settings, "Settings"),
      compressionPlan: body(compressionPlan, "Compression"),
      compressionStats: body(compressionStats, "Compression savings"),
      resilience: body(resilience, "Breaker thresholds"),
      cooldowns: body(cooldowns, "Model cooldowns"),
      autoCombos: body(autoCombos, "Auto combos"),
      health: body(health, "Breaker state"),
    }).filter((item) => item.id !== "compression");
    const failed = !settings.ok && !compressionPlan.ok && !health.ok;
    return { ...base, state: failed ? "error" : "ok", message: failed ? `Settings: ${settings.ok ? "" : settings.error}` : null, checkedAt: new Date().toISOString(), notes, items, canEdit };
  }
}

/** One change through the manage key, then fresh reads everywhere. */
export async function applySetting(connection: Connection, id: string, on: boolean | undefined): Promise<{ ok: boolean; message: string }> {
  if (!connection.manageKey) return { ok: false, message: "Add a manage key first, or change this in OmniRoute's dashboard." };
  let got: Got;
  if (id === "compression" && on !== undefined) {
    const current = await read(connection, "/api/settings/compression", { method: "GET" });
    if (!current.ok) return { ok: false, message: `Compression: ${current.error}` };
    got = await read(connection, "/api/settings/compression", { method: "PUT", body: compressionPayload(current.body, on) });
  } else if (id === "preferClaudeCode" && on !== undefined) {
    got = await read(connection, "/api/settings", { method: "PATCH", body: preferClaudeCodePayload(on) });
  } else if (id === "breakers") {
    got = await read(connection, "/api/resilience/reset", { method: "POST" });
  } else {
    return { ok: false, message: `"${id}" cannot be changed from here.` };
  }
  cache.clear();
  if (!got.ok) return { ok: false, message: got.error };
  const said = (got.body as { message?: unknown } | null)?.message;
  const name = id === "compression" ? "Compression" : "Prefer Claude Code for bare Claude names";
  return { ok: true, message: typeof said === "string" ? said : `${name} turned ${on ? "on" : "off"}.` };
}

/** Test & save's check of the optional manage key: a management GET it must be allowed to make. */
export async function checkManageKey(connection: Connection): Promise<string> {
  const got = await read(connection, "/api/settings", { method: "GET" });
  return got.ok ? "manage key accepted" : `manage key: ${got.error}`;
}

// ------------------------------------------------------------ account actions

const NEEDS_MANAGE = "Needs a manage key (Connection → Manage key).";

/** Check now (`/test`) or Refresh token (`/refresh`, OAuth accounts) on one account, with the manage key. */
export async function accountAction(connection: Connection, action: "test" | "refresh", id: string, name: string): Promise<{ ok: boolean; message: string }> {
  if (!connection.manageKey) return { ok: false, message: NEEDS_MANAGE };
  const down = recentlyDown(connection);
  if (down) return { ok: false, message: `${name}: ${down}.` };
  const path = `/api/providers/${encodeURIComponent(id)}/${action === "test" ? "test" : "refresh"}`;
  const got = await read(connection, path, { method: "POST", body: {}, timeoutMs: 60_000 });
  cache.clear();
  if (!got.ok) return { ok: false, message: `${name}: ${got.error}` };
  return action === "test" ? describeAccountTest(got.body, name) : describeRefresh(got.body, name);
}

/** Check all: OmniRoute's own batch test of every active account (five at a time, 30 s each at most). */
export async function checkAllAccounts(connection: Connection): Promise<{ ok: boolean; message: string }> {
  if (!connection.manageKey) return { ok: false, message: NEEDS_MANAGE };
  const down = recentlyDown(connection);
  if (down) return { ok: false, message: `Check all: ${down}.` };
  const got = await read(connection, "/api/providers/test-batch", { method: "POST", body: { mode: "all" }, timeoutMs: 180_000 });
  cache.clear();
  if (!got.ok) return { ok: false, message: `Check all: ${got.error}` };
  const { ok, message } = describeBatchTest(got.body);
  return { ok, message };
}

// ---------------------------------------------------------------- tunnels

const TUNNEL_IDS: TunnelId[] = ["cloudflared", "ngrok", "tailscale"];
const TUNNELS_MAX_AGE_MS = 30_000;
let tunnelsSeen: { key: string; at: number; tunnels: Tunnel[] } | null = null;

/** OmniRoute's own tunnels, read with the manage key (they refuse read tokens). */
export async function getTunnels(connection: Connection, refresh: boolean): Promise<Tunnels> {
  if (!connection.endpoint) return { state: "error", message: "Set the endpoint URL first.", tunnels: [] };
  if (!connection.manageKey) return { state: "no-manage-key", message: `OmniRoute only shows its tunnels to a manage key. ${NEEDS_MANAGE}`, tunnels: [] };
  const down = recentlyDown(connection);
  const key = `tunnels\n${connection.endpoint}\n${connection.manageKey}`;
  if (down) return { state: "error", message: `Tunnels: ${down}`, tunnels: tunnelsSeen?.key === key ? tunnelsSeen.tunnels : [] };
  return cached(key, refresh ? 0 : TUNNELS_MAX_AGE_MS, async () => {
    const got = await Promise.all(TUNNEL_IDS.map((id) => read(connection, `/api/tunnels/${id}`, { method: "GET" })));
    const failed = got.find((answer): answer is { ok: false; error: string } => !answer.ok);
    const tunnels = got.flatMap((answer, index) => (answer.ok ? [parseTunnel(TUNNEL_IDS[index], answer.body)] : []));
    tunnelsSeen = { key, at: Date.now(), tunnels };
    if (!tunnels.length && failed) return { state: "error" as const, message: `Tunnels: ${failed.error}`, tunnels };
    return { state: "ok" as const, message: failed ? `Some tunnels unavailable: ${failed.error}` : null, tunnels };
  });
}

/**
 * The running tunnel "Open dashboard" should use, from the last read only:
 * the status call never waits on this. A read older than a minute is
 * refreshed in the background for the next poll.
 */
export function knownTunnel(connection: Connection): Tunnel | null {
  if (!connection.endpoint || !connection.manageKey) return null;
  const key = `tunnels\n${connection.endpoint}\n${connection.manageKey}`;
  if (!tunnelsSeen || tunnelsSeen.key !== key || Date.now() - tunnelsSeen.at > 60_000) void getTunnels(connection, false).catch(() => null);
  return tunnelsSeen?.key === key ? activeTunnel(tunnelsSeen.tunnels) : null;
}

/** Start or stop one of OmniRoute's tunnels. Tailscale may need a login or Funnel turned on; its link is passed on. */
export async function setTunnel(connection: Connection, id: TunnelId, on: boolean): Promise<{ ok: boolean; message: string }> {
  if (!connection.manageKey) return { ok: false, message: NEEDS_MANAGE };
  const path = id === "tailscale" ? `/api/tunnels/tailscale/${on ? "enable" : "disable"}` : `/api/tunnels/${id}`;
  const body = id === "tailscale" ? {} : { action: on ? "enable" : "disable" };
  const got = await read(connection, path, { method: "POST", body, timeoutMs: 90_000 });
  cache.clear();
  tunnelsSeen = null;
  const label = TUNNEL_LABELS[id];
  if (!got.ok) return { ok: false, message: `${label}: ${got.error}` };
  const answer = (got.body ?? {}) as { success?: unknown; needsLogin?: unknown; authUrl?: unknown; funnelNotEnabled?: unknown; enableUrl?: unknown; status?: unknown };
  if (answer.needsLogin === true) return { ok: false, message: `${label} needs a Tailscale login first: ${String(answer.authUrl ?? "see the dashboard's Endpoint page")}` };
  if (answer.funnelNotEnabled === true) return { ok: false, message: `${label}: Funnel is not enabled for this tailnet${answer.enableUrl ? `; enable it at ${String(answer.enableUrl)}` : ""}.` };
  if (answer.success === false) return { ok: false, message: `${label} did not ${on ? "start" : "stop"}.` };
  const tunnel = parseTunnel(id, answer.status ?? {});
  return { ok: true, message: on ? `${label} started${tunnel.url ? `: ${tunnel.url}` : "; its address appears in a moment"}.` : `${label} stopped.` };
}

// ------------------------------------------------------------- compression

/** What runs now, from `/api/context/combos/default` (read token); savings from `/api/analytics/compression`. */
export async function getCompression(connection: Connection, refresh: boolean): Promise<Compression> {
  const canEdit = !!connection.manageKey;
  const empty = { mode: null, engines: [], savings: null, recommended: false, canEdit };
  const stop = precheck(connection);
  if (stop) return { ...empty, ...stop, message: stop.state === "no-token" ? "Add a read token to see how the router compresses prompts." : stop.message };
  const down = recentlyDown(connection);
  if (down) return { ...empty, state: "error", message: `Compression: ${down}` };
  return cached(`compression\n${connection.endpoint}\n${readKey(connection)}`, refresh ? 0 : SETTINGS_MAX_AGE_MS, async () => {
    const [plan, stats] = await Promise.all([read(connection, "/api/context/combos/default"), read(connection, "/api/analytics/compression")]);
    if (!plan.ok) return { ...empty, state: "error" as const, message: `Compression: ${plan.error}` };
    const body = (plan.body ?? {}) as { mode?: unknown; pipeline?: unknown };
    const mode = typeof body.mode === "string" ? body.mode : null;
    const engines = mode === "off" ? [] : mode === "stacked" && Array.isArray(body.pipeline) ? body.pipeline.map((step) => String((step as { engine?: unknown })?.engine ?? "")).filter(Boolean) : mode ? [mode === "standard" ? "caveman" : mode] : [];
    const item = parseSettings({ compressionPlan: plan.body, compressionStats: stats.ok ? stats.body : undefined }).find((entry) => entry.id === "compression");
    const recommended = engines.length === RECOMMENDED_COMPRESSION.engines.length && engines.every((engine, index) => engine === RECOMMENDED_COMPRESSION.engines[index]);
    return { state: "ok" as const, message: null, mode, engines, savings: item?.detail ?? null, recommended, canEdit };
  });
}

/**
 * Lite on, every other engine off, and, where this OmniRoute supports
 * exclusions, Codex models excluded. Sent back whole, as OmniRoute's strict
 * schema expects; `exclusions` only when the router already reports the field.
 */
export async function applyRecommendedCompression(connection: Connection): Promise<{ ok: boolean; message: string }> {
  if (!connection.manageKey) return { ok: false, message: NEEDS_MANAGE };
  const current = await read(connection, "/api/settings/compression", { method: "GET" });
  if (!current.ok) return { ok: false, message: `Compression: ${current.error}` };
  const settings = (current.body ?? {}) as { engines?: Record<string, { enabled?: unknown; level?: unknown }>; exclusions?: unknown };
  const engines = Object.fromEntries(
    Object.entries(settings.engines ?? {}).map(([id, engine]) => [id, { enabled: (RECOMMENDED_COMPRESSION.engines as readonly string[]).includes(id), ...(typeof engine?.level === "string" ? { level: engine.level } : {}) }]),
  );
  for (const id of RECOMMENDED_COMPRESSION.engines) engines[id] = { ...engines[id], enabled: true };
  const canExclude = Array.isArray(settings.exclusions);
  const exclusions = canExclude ? [...new Set([...(settings.exclusions as string[]), ...RECOMMENDED_COMPRESSION.exclusions])] : undefined;
  const got = await read(connection, "/api/settings/compression", { method: "PUT", body: { enabled: true, engines, ...(exclusions ? { exclusions } : {}) } });
  cache.clear();
  if (!got.ok) return { ok: false, message: `Compression: ${got.error}` };
  return {
    ok: true,
    message: canExclude
      ? "Compression set to Lite only, with Codex models (cx/*) excluded."
      : "Compression set to Lite only. This OmniRoute cannot exclude models, so Codex shell output over 2,000 characters may be shortened; turn compression off if Codex matters more.",
  };
}
