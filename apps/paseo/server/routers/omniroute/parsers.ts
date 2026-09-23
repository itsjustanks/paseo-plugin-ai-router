/**
 * Pure readers for OmniRoute's management API: accounts, usage, router health
 * and the model catalogue. OmniRoute already counts everything; these only
 * pick fields out defensively. A missing or renamed field yields null or an
 * empty list so the panel hides that part instead of crashing. No imports.
 */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
/** Numbers, or numeric strings like "100.00". "<redacted>" and friends read as null. */
export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
const clampPct = (value: number) => Math.max(0, Math.min(100, value));
const epochMs = (value: unknown): number | null => {
  const n = num(value);
  if (n !== null) return n < 1e12 ? n * 1000 : n;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const PROVIDER_LABELS: Record<string, string> = { claude: "Claude", cc: "Claude", codex: "Codex", cx: "Codex", "claude code": "Claude", "openai codex": "Codex" };
export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id.toLowerCase()] ?? id.replace(/[-_]/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** `someone@example.com` → `so…@example.com`. Anything else is returned as is. */
export function maskLabel(label: string): string {
  const at = label.indexOf("@");
  if (at < 1 || at === label.length - 1) return label;
  return `${label.slice(0, Math.min(2, at))}…${label.slice(at)}`;
}

/** A management call that did not answer 200, in words: "401 — read token rejected". */
export function describeManagementStatus(status: number, body: unknown, path: string, credential = "read token"): string {
  const error = rec(body).error;
  const raw = str(rec(error).message) ?? str(error) ?? str(rec(body).message);
  const detail = raw ? `: ${raw.length > 160 ? `${raw.slice(0, 157)}…` : raw}` : "";
  if (status === 401) return `401 — ${credential} rejected${detail}`;
  if (status === 403) return `403 — ${credential} not allowed on ${path}${detail}`;
  if (status === 404) return `404 — ${path} not found; is OmniRoute older than 3.8?`;
  return `${status} — ${path} failed${detail}`;
}

// --------------------------------------------------------------- accounts

export type Quota = { name: string; remainingPct: number; resetAt: string | null };
export type Account = {
  id: string;
  provider: string;
  /** "Codex #2": provider plus its position, stable while priorities are. */
  shortName: string;
  label: string | null;
  state: "healthy" | "attention" | "disabled";
  /** Plain words: "re-login required", "error: invalid_grant". Null when healthy. */
  problem: string | null;
  /** Epoch ms when the latest cooldown or model lockout on this account ends. */
  coolingUntil: number | null;
  quotas: Quota[];
  /** "oauth", "apikey", …: only OAuth accounts take a manual token refresh. */
  authType: string | null;
  /** From `/api/providers/health-matrix`, last 24 hours. Null when not reported. */
  health: AccountHealth | null;
  /** From `/api/providers/expiration`. Null when OmniRoute tracks no expiry for it. */
  expiry: { status: "active" | "expiring_soon" | "expired" | "unknown"; expiresAt: string | null; note: string | null } | null;
};

export type AccountHealth = { state: string; successRatePct: number | null; requests: number; issueCount: number; lastErrorAt: string | null; failingModels: string[] };

/** One provider-limits quota entry → percent left. Claude reports `remainingPercentage`; Codex `used`/`total`. */
function quotaLeft(entry: Rec): number | null {
  if (entry.unlimited === true) return null;
  const pct = num(entry.remainingPercentage);
  if (pct !== null) return clampPct(pct);
  const total = num(entry.total);
  const remaining = num(entry.remaining);
  const used = num(entry.used);
  if (total && remaining !== null) return clampPct((remaining / total) * 100);
  if (total && used !== null) return clampPct(((total - used) / total) * 100);
  return null;
}

/** Quotas from `/api/usage/provider-limits` → `caches[connectionId].quotas`. */
export function parseQuotas(cacheEntry: unknown): Quota[] {
  const quotas: Quota[] = [];
  for (const [key, value] of Object.entries(rec(rec(cacheEntry).quotas))) {
    const entry = rec(value);
    const left = quotaLeft(entry);
    if (left === null) continue;
    quotas.push({ name: str(entry.displayName) ?? key.replace(/_/g, " "), remainingPct: Math.round(left), resetAt: str(entry.resetAt) });
  }
  return quotas;
}

/** Codex fallback: `/api/providers` → `codexAccountPool.children[].quota.windows` when OmniRoute has observed them. */
function codexPoolQuotas(pool: unknown): Quota[] {
  const quotas: Quota[] = [];
  for (const child of list(rec(pool).children)) {
    const scope = str(rec(rec(child).key).scope) ?? "codex";
    for (const [window, value] of Object.entries(rec(rec(rec(child).quota).windows))) {
      const used = num(rec(value).usedPercentage);
      if (used === null) continue;
      quotas.push({ name: `${scope === "codex" ? "" : `${scope} `}${window}`, remainingPct: Math.round(clampPct(100 - used)), resetAt: str(rec(value).resetAt) });
    }
  }
  return quotas;
}

function problemFor(connection: Rec): string | null {
  const status = str(connection.testStatus)?.toLowerCase() ?? null;
  const detail = str(connection.lastError);
  const withDetail = (text: string) => (detail ? `${text}: ${detail.length > 120 ? `${detail.slice(0, 117)}…` : detail}` : text);
  if (status === "expired" || str(connection.errorCode) === "token_expired") return "re-login required";
  if (status === "banned") return withDetail("banned by the provider");
  if (status === "credits_exhausted") return "out of credits";
  if (status === "quota") return "quota used up";
  if (status === "error" || status === "unavailable" || status === "degraded") return withDetail(status);
  const pool = str(rec(rec(connection.codexAccountPool).aggregate).status);
  if (pool === "fully_limited") return "every Codex quota is limited";
  const backoff = num(connection.backoffLevel) ?? 0;
  if (backoff > 0) return `backing off after errors (level ${backoff})`;
  return null;
}

/**
 * One row per connection in `/api/providers`, joined by connection id with
 * `/api/rate-limits` lockouts and `/api/usage/provider-limits` quotas.
 */
export function parseAccounts(input: { providers: unknown; rateLimits?: unknown; limits?: unknown; now: number }): Account[] {
  const caches = rec(rec(input.limits).caches);
  const lockouts = list(rec(input.rateLimits).lockouts).map(rec);
  const counts = new Map<string, number>();
  const connections = list(rec(input.providers).connections)
    .map(rec)
    .filter((c) => str(c.id))
    .sort((a, b) => String(a.provider).localeCompare(String(b.provider)) || (num(a.priority) ?? 0) - (num(b.priority) ?? 0));
  return connections.map((connection) => {
    const id = str(connection.id)!;
    const provider = str(connection.provider) ?? "unknown";
    const n = (counts.get(provider) ?? 0) + 1;
    counts.set(provider, n);
    const label = str(connection.displayName) ?? str(connection.name) ?? str(connection.email);
    const ends = [
      epochMs(connection.rateLimitedUntil),
      ...lockouts.filter((lock) => str(lock.connectionId) === id).map((lock) => epochMs(lock.until)),
      ...list(rec(connection.codexAccountPool).children).map((child) => {
        const cooldown = rec(rec(child).cooldown);
        return cooldown.active === true ? epochMs(cooldown.rateLimitedUntil) : null;
      }),
    ].filter((ms): ms is number => ms !== null && ms > input.now);
    const quotas = parseQuotas(caches[id]);
    const disabled = connection.isActive === false;
    const problem = disabled ? "disabled in OmniRoute" : problemFor(connection);
    return {
      id,
      provider,
      shortName: `${providerLabel(provider)} #${n}`,
      label: label ? maskLabel(label) : null,
      state: disabled ? "disabled" : problem || ends.length ? "attention" : "healthy",
      problem,
      coolingUntil: ends.length ? Math.max(...ends) : null,
      quotas: quotas.length ? quotas : codexPoolQuotas(connection.codexAccountPool),
      authType: str(connection.authType),
      health: null,
      expiry: null,
    };
  });
}

/**
 * `/api/providers/health-matrix` (read token): per account, the last 24 hours
 * of requests, success rate and failing models. Keyed by connection id; the
 * synthetic "Unattributed traffic" rows have none and are skipped.
 */
export function parseHealthMatrix(body: unknown): Map<string, AccountHealth> {
  const byId = new Map<string, AccountHealth>();
  for (const provider of list(rec(body).providers).map(rec)) {
    for (const account of list(provider.accounts).map(rec)) {
      const id = str(account.connectionId);
      if (!id || account.isSynthetic === true) continue;
      const models = list(account.models).map(rec);
      const requests = models.reduce((sum, model) => sum + (num(model.requests) ?? 0), 0);
      const successes = models.reduce((sum, model) => sum + (num(model.successes) ?? 0), 0);
      const lastErrors = models.map((model) => str(model.lastErrorAt)).filter((at): at is string => !!at).sort();
      byId.set(id, {
        state: str(account.state) ?? "unknown",
        successRatePct: requests ? Math.round((successes / requests) * 100) : null,
        requests,
        issueCount: num(account.issueCount) ?? 0,
        lastErrorAt: lastErrors.length ? lastErrors[lastErrors.length - 1] : null,
        failingModels: models.filter((model) => model.status === "error" || model.isLockedOut === true).map((model) => str(model.model)).filter((name): name is string => !!name),
      });
    }
  }
  return byId;
}

const EXPIRY_STATES = ["active", "expiring_soon", "expired", "unknown"] as const;
/** `/api/providers/expiration` (read token): `{ list: [{ connectionId, status, expiresAt, note }] }`. */
export function parseExpiration(body: unknown): Map<string, NonNullable<Account["expiry"]>> {
  const byId = new Map<string, NonNullable<Account["expiry"]>>();
  for (const entry of list(rec(body).list).map(rec)) {
    const id = str(entry.connectionId);
    const status = EXPIRY_STATES.find((state) => state === entry.status);
    if (id && status) byId.set(id, { status, expiresAt: str(entry.expiresAt), note: str(entry.note) });
  }
  return byId;
}

/** Health and expiry onto the account rows, by connection id. */
export function withAccountHealth(accounts: Account[], health: Map<string, AccountHealth>, expiry: Map<string, NonNullable<Account["expiry"]>>): Account[] {
  return accounts.map((account) => ({ ...account, health: health.get(account.id) ?? null, expiry: expiry.get(account.id) ?? null }));
}

/** One line for an account's last-24-hour health: "healthy · 96% of 28 requests answered". */
export function healthLine(health: AccountHealth): string {
  const rate = health.successRatePct === null ? "no requests in 24 h" : `${health.successRatePct}% of ${health.requests} request${health.requests === 1 ? "" : "s"} answered in 24 h`;
  const failing = health.failingModels.length ? ` · failing: ${health.failingModels.slice(0, 3).join(", ")}${health.failingModels.length > 3 ? "…" : ""}` : "";
  return `${health.state} · ${rate}${failing}`;
}

// --------------------------------------------------------- account actions

/** `POST /api/providers/{id}/test` → one line. `{ valid, error, latencyMs, refreshed }`. */
export function describeAccountTest(body: unknown, name: string): { ok: boolean; message: string } {
  const record = rec(body);
  if (record.valid === true) {
    const ms = num(record.latencyMs);
    return { ok: true, message: `${name} answered${ms ? ` in ${Math.round(ms)} ms` : ""}${record.refreshed === true ? " (token refreshed)" : ""}.` };
  }
  if (record.skipped === true) return { ok: false, message: `${name}: check deferred — ${str(record.error) ?? "busy"}.` };
  return { ok: false, message: `${name} failed its check: ${str(record.error) ?? "no reason given"}.` };
}

/** `POST /api/providers/test-batch` `{ mode: "all" }` → summary and the failures by name. */
export function describeBatchTest(body: unknown): { ok: boolean; message: string; failed: Array<{ id: string; name: string; error: string }> } {
  const summary = rec(rec(body).summary);
  const total = num(summary.total) ?? 0;
  const passed = num(summary.passed) ?? 0;
  const failed = list(rec(body).results)
    .map(rec)
    .filter((result) => result.valid !== true)
    .map((result) => ({ id: str(result.connectionId) ?? "?", name: maskLabel(str(result.connectionName) ?? str(result.provider) ?? "an account"), error: str(result.error) ?? "no reason given" }));
  if (!total) return { ok: true, message: "No active accounts to check.", failed };
  return { ok: failed.length === 0, message: failed.length ? `${passed} of ${total} accounts answered. Failed: ${failed.map((f) => `${f.name} (${f.error})`).join("; ")}.` : `All ${total} accounts answered.`, failed };
}

/** `POST /api/providers/{id}/refresh` → one line. Codex answers "skipped" on purpose. */
export function describeRefresh(body: unknown, name: string): { ok: boolean; message: string } {
  const record = rec(body);
  if (record.skipped === true) return { ok: true, message: `${name}: ${str(record.message) ?? "refresh skipped; it refreshes on the next request."}` };
  if (record.success === true) return { ok: true, message: `${name}: token refreshed${str(record.expiresAt) ? `, valid until ${record.expiresAt}` : ""}.` };
  return { ok: false, message: `${name}: ${str(rec(record.error).message) ?? str(record.error) ?? "refresh failed"}.` };
}

// ---------------------------------------------------------------- tunnels

export type TunnelId = "cloudflared" | "ngrok" | "tailscale";
export type Tunnel = { id: TunnelId; label: string; installed: boolean; running: boolean; url: string | null; phase: string; error: string | null };
export const TUNNEL_LABELS: Record<TunnelId, string> = { cloudflared: "Cloudflare tunnel", ngrok: "ngrok tunnel", tailscale: "Tailscale Funnel" };

/** `GET /api/tunnels/{id}` (manage key). Cloudflared and ngrok say `publicUrl`; Tailscale says `tunnelUrl`. */
export function parseTunnel(id: TunnelId, body: unknown): Tunnel {
  const record = rec(body);
  const url = str(record.publicUrl) ?? str(record.tunnelUrl);
  const running = record.running === true;
  return {
    id,
    label: TUNNEL_LABELS[id],
    installed: record.installed === true,
    running,
    url: running && url && /^https:\/\//.test(url) ? url : null,
    phase: str(record.phase) ?? (running ? "running" : "stopped"),
    error: str(record.lastError),
  };
}

/** The first running tunnel with an HTTPS address, which "Open dashboard" then uses. */
export function activeTunnel(tunnels: readonly Tunnel[]): Tunnel | null {
  return tunnels.find((tunnel) => tunnel.url) ?? null;
}


/** "3 accounts · 3 healthy", or the accounts that need attention by name. `time` formats epoch ms. */
export function accountsHeadline(
  accounts: readonly Account[],
  time: (ms: number) => string,
  paused: readonly Paused[] = [],
): { text: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (paused.length) return { text: paused.map(pausedLine).join("; "), tone: "danger" };
  if (accounts.length === 0) return { text: "OmniRoute has no connected accounts", tone: "warning" };
  const why = (account: Account) =>
    [account.problem, account.coolingUntil ? `cooling down until ${time(account.coolingUntil)}` : null].filter(Boolean).join(", ");
  const attention = accounts.filter((account) => account.state === "attention");
  const healthy = accounts.filter((account) => account.state === "healthy").length;
  if (attention.length === 0) {
    const off = accounts.length - healthy;
    return { text: `${accounts.length} account${accounts.length === 1 ? "" : "s"} · ${healthy} healthy${off ? ` · ${off} disabled` : ""}`, tone: "success" };
  }
  const named = attention.map((account) => `${account.shortName} ${why(account)}`).join("; ");
  return { text: `${attention.length} need${attention.length === 1 ? "s" : ""} attention: ${named}`, tone: "warning" };
}

// ------------------------------------------------------------------ usage

export type Totals = { requests: number; tokens: number | null; cost: number | null; successRatePct: number | null };
export type UsageRow = { label: string; requests: number; tokens: number | null; cost: number | null; thisDaemon?: boolean; failedPct?: number | null };
export type Day = { date: string; requests: number; tokens: number | null };

export function parseTotals(analytics: unknown): Totals | null {
  const summary = rec(rec(analytics).summary);
  const requests = num(summary.totalRequests);
  if (requests === null) return null;
  return { requests, tokens: num(summary.totalTokens), cost: num(summary.totalCost), successRatePct: num(summary.successRatePct) };
}

/** The last `days` UTC dates from `dailyTrend`, zero-filled. OmniRoute buckets by `DATE(timestamp)`, i.e. UTC. */
export function parseTrend(analytics: unknown, days: number, now: number): Day[] {
  const byDate = new Map(list(rec(analytics).dailyTrend).map(rec).map((row) => [str(row.date), row] as const));
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    out.push({ date, requests: num(row?.requests) ?? 0, tokens: row ? num(row.totalTokens) : 0 });
  }
  return out;
}

function rows(value: unknown, label: (row: Rec) => string | null): UsageRow[] {
  return list(value)
    .map(rec)
    .map((row) => ({ row, label: label(row), requests: num(row.requests) }))
    .filter((entry): entry is { row: Rec; label: string; requests: number } => entry.label !== null && entry.requests !== null)
    .map(({ row, label: text, requests }) => ({ label: text, requests, tokens: num(row.totalTokens), cost: num(row.cost) }))
    .sort((a, b) => b.requests - a.requests);
}

export function parseByAccount(analytics: unknown): UsageRow[] {
  return rows(rec(analytics).byAccount, (row) => {
    const account = str(row.account);
    return account ? maskLabel(account) : null;
  });
}

export function parseTopModels(analytics: unknown, limit = 5): UsageRow[] {
  const byName = new Map(list(rec(analytics).byModel).map(rec).map((row) => [str(row.model), row] as const));
  return rows(rec(analytics).byModel, (row) => str(row.model))
    .slice(0, limit)
    .map((entry) => {
      const success = num(byName.get(entry.label)?.successRatePct);
      return { ...entry, failedPct: success === null ? null : Math.round((100 - success) * 10) / 10 };
    });
}

export type KeyIdentity = { id: string | null; name: string | null };

/**
 * Find this daemon's inference key in `GET /api/keys`, which returns keys
 * masked as `first8 + "****" + last4`. Runs on the daemon only; the key
 * never leaves it.
 */
export function findOwnKey(keysBody: unknown, apiKey: string | null): KeyIdentity | null {
  if (!apiKey || apiKey.length < 12) return null;
  const masked = `${apiKey.slice(0, 8)}****${apiKey.slice(-4)}`;
  const match = list(rec(keysBody).keys).map(rec).find((row) => str(row.key) === masked);
  return match ? { id: str(match.id), name: str(match.name) } : null;
}

/** `byApiKey`: one row per inference key, which on this fleet is one row per daemon. */
export function parseByDaemon(analytics: unknown, own: KeyIdentity | null): UsageRow[] {
  const name = (row: Rec) => str(row.apiKeyName) ?? str(row.apiKey);
  const byKey = list(rec(analytics).byApiKey).map(rec);
  return rows(byKey, name).map((entry) => {
    const row = byKey.find((candidate) => name(candidate) === entry.label);
    const mine = !!own && ((own.id !== null && str(row?.apiKeyId) === own.id) || (own.name !== null && entry.label === own.name));
    return mine ? { ...entry, thisDaemon: true } : entry;
  });
}

// ------------------------------------------------------------ router strip

export type ProviderStat = { name: string; requests: number; errorPct: number | null; avgLatencyMs: number | null };
export type RouterStrip = {
  breakers: { text: string; tone: "success" | "warning" | "danger" } | null;
  providers: ProviderStat[];
  p95Ms: number | null;
  /** Models whose requests failed in OmniRoute's own stats. */
  failingModels: Array<{ model: string; provider: string; failed: number; requests: number }>;
  /** Providers whose breaker is OPEN: OmniRoute is refusing their traffic. `lastError` is filled from call logs. */
  paused: Paused[];
};
export type Paused = { provider: string; retryAfterMs: number | null; lastError: string | null };

/** A breaker in plain words: OPEN → "Claude paused", HALF_OPEN → "Claude testing again". */
function breakerWords(breaker: Rec): string {
  const state = (str(breaker.state) ?? "").toUpperCase();
  const word = state === "OPEN" ? "paused" : state === "HALF_OPEN" ? "testing again" : state === "DEGRADED" ? "degraded" : state.toLowerCase();
  return `${providerLabel(str(breaker.provider) ?? "?")} ${word}`;
}

export function parseRouterStrip(health: unknown, providerStats: unknown): RouterStrip {
  const counts = rec(rec(health).circuitBreakers);
  const open = list(rec(health).providerBreakers)
    .map(rec)
    .filter((breaker) => (str(breaker.state) ?? "CLOSED").toUpperCase() !== "CLOSED")
    .map((breaker) => breakerWords(breaker));
  const breakers =
    num(counts.total) === null && !open.length
      ? null
      : open.length
        ? { text: open.join(", "), tone: (num(counts.open) ?? 0) > 0 ? ("danger" as const) : ("warning" as const) }
        : { text: "No provider paused", tone: "success" as const };
  const stats = rec(providerStats);
  const providers = list(stats.providers).map(rec).flatMap((row) => {
    const requests = num(row.totalRequests);
    const ok = num(row.successfulRequests);
    const name = str(row.provider);
    if (!name || requests === null) return [];
    return [{ name, requests, errorPct: requests > 0 && ok !== null ? Math.round(((requests - ok) / requests) * 1000) / 10 : null, avgLatencyMs: num(row.avgLatencyMs) }];
  });
  const telemetry = rec(stats.telemetry);
  const p95 = (num(telemetry.count) ?? 0) > 0 ? num(telemetry.p95) : null;
  const failingModels = list(stats.models).map(rec).flatMap((row) => {
    const requests = num(row.requests);
    const ok = num(row.successfulRequests);
    const model = str(row.model);
    if (!model || requests === null || ok === null || ok >= requests) return [];
    return [{ model, provider: str(row.provider) ?? "", failed: requests - ok, requests }];
  });
  const paused = list(rec(health).providerBreakers)
    .map(rec)
    .filter((breaker) => str(breaker.state)?.toUpperCase() === "OPEN" && str(breaker.provider))
    .map((breaker) => ({ provider: str(breaker.provider)!, retryAfterMs: num(breaker.retryAfterMs), lastError: null }));
  return { breakers, providers, p95Ms: p95, failingModels, paused };
}

/** The newest error in `/api/usage/call-logs?status=error&provider=…`: OmniRoute's `error` text, else the status. */
export function lastCallError(callLogs: unknown): string | null {
  const row = rec(list(callLogs)[0]);
  const error = row.error;
  const text = str(error) ?? str(rec(error).message) ?? str(row.errorSummary);
  const status = num(row.status);
  const found = text ?? (status && status >= 400 ? `HTTP ${status}` : null);
  return found && found.length > 200 ? `${found.slice(0, 197)}…` : found;
}

/** "Claude traffic paused by OmniRoute's circuit breaker — last error: …". */
export function pausedLine(paused: Paused): string {
  const retry = paused.retryAfterMs ? ` (retrying in ${Math.ceil(paused.retryAfterMs / 1000)} s)` : "";
  return `${providerLabel(paused.provider)} traffic paused by OmniRoute's circuit breaker${retry} — last error: ${paused.lastError ?? "not recorded"}`;
}

// ----------------------------------------------------------------- models

/** Providers with at least one active connection, by OmniRoute provider id ("claude", "codex"). */
export function activeProviders(providersBody: unknown): Set<string> {
  return new Set(
    list(rec(providersBody).connections)
      .map(rec)
      .filter((c) => c.isActive !== false)
      .map((c) => str(c.provider))
      .filter((p): p is string => p !== null),
  );
}

/** `claude-opus-5-5` → `Opus 5.5`, `gpt-5.6-sol` → `GPT-5.6 Sol`. */
export function prettyModel(root: string): string {
  const parts = root.replace(/^claude-/i, "").split("-").filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const previous = out[out.length - 1];
    if (/^\d{1,2}$/.test(part) && previous && /\d$/.test(previous) && !/^\d{6,}$/.test(part)) out[out.length - 1] = `${previous}.${part}`;
    else if (/^gpt$/i.test(part)) out.push("GPT");
    else if (previous === "GPT" && /^\d/.test(part)) out[out.length - 1] = `GPT-${part}`;
    else out.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return out.join(" ");
}

export type CatalogModel = { id: string; label: string; provider: string };

/**
 * `/v1/models` limited to connected, active providers by `owned_by`. When
 * OmniRoute lists both `cc/x` and its canonical twin `claude/x`, the twin
 * names the first in `parent` and is dropped. `active: null` means OmniRoute
 * already did the filtering (`?configuredOnly=true`, what a plain key can ask).
 */
export function buildModelList(modelsBody: unknown, active: ReadonlySet<string> | null): CatalogModel[] {
  const entries = list(rec(modelsBody).data).map(rec);
  const ids = new Set(entries.map((entry) => str(entry.id)));
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const entry of entries) {
    const id = str(entry.id);
    const owner = str(entry.owned_by);
    if (!id || !owner || (active && !active.has(owner)) || seen.has(id)) continue;
    const parent = str(entry.parent);
    if (parent && ids.has(parent)) continue;
    seen.add(id);
    const root = str(entry.root) ?? id.slice(id.indexOf("/") + 1);
    models.push({ id, provider: owner, label: `${providerLabel(owner)} · ${prettyModel(root)}` });
  }
  return models.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------- router settings

export const compactNumber = (n: number | null) =>
  n === null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

export type SettingItem = {
  id: "compression" | "breakers" | "preferClaudeCode" | "routing";
  label: string;
  /** One line on what it does, in plain words. */
  why: string;
  value: string;
  detail: string | null;
  tone: "success" | "warning" | "danger" | "neutral";
  /** Current on/off when a manage key may switch it; null when it is not a switch. */
  toggle: boolean | null;
  /** Button label for a one-shot action; null when there is none. */
  action: string | null;
  /** Page in OmniRoute's dashboard for everything else. */
  dashboardPath: string;
};

export type SettingsInput = {
  settings?: unknown;
  /** `/api/context/combos/default`: the derived compression plan. */
  compressionPlan?: unknown;
  /** `/api/analytics/compression`. */
  compressionStats?: unknown;
  resilience?: unknown;
  cooldowns?: unknown;
  autoCombos?: unknown;
  health?: unknown;
};

function compressionItem(plan: unknown, stats: unknown): SettingItem | null {
  const mode = str(rec(plan).mode);
  if (!mode) return null;
  const steps = list(rec(plan).pipeline).map(rec).map((step) => {
    const engine = str(step.engine) ?? "?";
    return str(step.intensity) ? `${engine} (${str(step.intensity)})` : engine;
  });
  const requests = num(rec(stats).totalRequests);
  const saved = num(rec(stats).totalTokensSaved);
  const avg = num(rec(stats).avgSavingsPct);
  const usd = num(rec(rec(stats).realUsage).estimatedUsdSaved);
  const detail =
    requests === null
      ? null
      : requests === 0
        ? "Nothing compressed yet."
        : `${saved === null ? "Tokens" : `${compactNumber(saved)} tokens`} saved on ${requests} requests${avg !== null ? ` (avg ${Math.round(avg)}%)` : ""}${usd ? ` · about $${usd.toFixed(2)}` : ""}`;
  const on = mode !== "off";
  return {
    id: "compression",
    label: "Context compression",
    why: "Shrinks long prompts and tool output before they reach the model, to save tokens and quota.",
    value: on ? `On · ${mode === "stacked" ? steps.join(" → ") : mode}` : "Off",
    detail,
    tone: on ? "success" : "neutral",
    toggle: on,
    action: null,
    dashboardPath: "/dashboard/compression",
  };
}

function breakersItem(health: unknown, resilience: unknown, cooldowns: unknown): SettingItem | null {
  const breakers = list(rec(health).providerBreakers).map(rec);
  const profile = rec(rec(rec(resilience).providerBreaker).oauth);
  if (!breakers.length && num(rec(rec(health).circuitBreakers).total) === null && num(profile.failureThreshold) === null) return null;
  const notClosed = breakers.filter((b) => (str(b.state) ?? "CLOSED").toUpperCase() !== "CLOSED");
  const threshold = num(profile.failureThreshold);
  const reset = num(profile.resetTimeoutMs);
  const models = list(rec(cooldowns).items).map(rec);
  const parts = [
    threshold !== null ? `Opens after ${threshold} failures${reset !== null ? `, retries after ${Math.round(reset / 1000)} s` : ""}.` : null,
    models.length
      ? `${models.length} model cooldown${models.length === 1 ? "" : "s"}: ${models
          .slice(0, 3)
          .map((m) => `${str(m.model) ?? "?"} (${providerLabel(str(m.provider) ?? "?")}, ${Math.ceil((num(m.remainingMs) ?? 0) / 60_000)} min)`)
          .join(", ")}`
      : null,
  ].filter(Boolean);
  const open = notClosed.some((b) => str(b.state)?.toUpperCase() === "OPEN");
  return {
    id: "breakers",
    label: "Circuit breakers",
    why: "When a provider keeps failing, OmniRoute pauses its traffic for a while instead of failing every request.",
    value: notClosed.length ? notClosed.map(breakerWords).join(", ") : "None paused",
    detail: parts.join(" ") || null,
    tone: open ? "danger" : notClosed.length || models.length ? "warning" : "success",
    toggle: null,
    action: "Reset circuit breakers and model cooldowns",
    dashboardPath: "/dashboard/settings/resilience",
  };
}

function preferItem(settings: unknown): SettingItem | null {
  const value = rec(settings).preferClaudeCodeForUnprefixedClaudeModels;
  if (typeof value !== "boolean") return null;
  return {
    id: "preferClaudeCode",
    label: "Prefer Claude Code for bare Claude model names",
    why: "Paseo's built-in Claude sends names like claude-sonnet-5. With Claude Code and Claude both connected, this sends them to Claude Code instead of failing as ambiguous.",
    value: value ? "On" : "Off",
    detail: null,
    tone: "neutral",
    toggle: value,
    action: null,
    dashboardPath: "/dashboard/providers/claude",
  };
}

function routingItem(settings: unknown, autoCombos: unknown): SettingItem | null {
  const strategy = str(rec(settings).comboStrategy);
  if (!strategy) return null;
  const combos = list(rec(autoCombos).combos).map(rec).filter((c) => c.isHidden !== true && str(c.id));
  const pool = list(rec(combos[0]).candidatePool).map(str).filter(Boolean);
  return {
    id: "routing",
    label: "Routing strategy",
    why: "How OmniRoute picks between models and accounts when a request names a combo instead of one model.",
    value: strategy,
    detail: combos.length ? `Auto models: ${combos.map((c) => str(c.id)).join(", ")}${pool.length ? ` · choosing from ${pool.join(", ")}` : ""}` : null,
    tone: "neutral",
    toggle: null,
    action: null,
    dashboardPath: "/dashboard/settings/routing",
  };
}

/** The few router settings worth a line in the panel. Each is hidden when its source did not answer. */
export function parseSettings(input: SettingsInput): SettingItem[] {
  return [
    compressionItem(input.compressionPlan, input.compressionStats),
    breakersItem(input.health, input.resilience, input.cooldowns),
    preferItem(input.settings),
    routingItem(input.settings, input.autoCombos),
  ].filter((item): item is SettingItem => item !== null);
}

/**
 * `PUT /api/settings/compression` body. Off is `{enabled:false}`. On sets the
 * master switch and, when no engine is on (which would still derive "off"),
 * also turns on Lite, the fast whitespace/tool-result engine. The `engines`
 * map is replaced whole on write, so every current engine is sent back.
 */
export function compressionPayload(current: unknown, on: boolean): Record<string, unknown> {
  if (!on) return { enabled: false };
  const engines = rec(rec(current).engines);
  const anyOn = Object.values(engines).some((engine) => rec(engine).enabled === true);
  if (anyOn) return { enabled: true };
  const toggles = Object.fromEntries(Object.entries(engines).map(([id, engine]) => [id, { enabled: rec(engine).enabled === true, ...(str(rec(engine).level) ? { level: str(rec(engine).level) } : {}) }]));
  return { enabled: true, engines: { ...toggles, lite: { ...rec(toggles.lite), enabled: true } } };
}

/** `PATCH /api/settings` body for the one settings switch the panel offers. */
export function preferClaudeCodePayload(on: boolean): Record<string, unknown> {
  return { preferClaudeCodeForUnprefixedClaudeModels: on };
}

// ------------------------------------------------------------- your access

export type KeyStatus = {
  keyName: string | null;
  spend: { usedUsd: number; limitUsd: number | null; remainingUsd: number | null; usedPercent: number | null; period: string; resetAt: string | null } | null;
  tokens: number | null;
  quotas: Array<{ provider: string; text: string }>;
};

const QUOTA_REASONS: Record<string, string> = { not_supported: "not reported for this provider", not_available: "not reported yet", fetch_failed: "could not be read", connection_lookup_failed: "account not found" };

/**
 * `GET /v1/me/status` with the inference key (OmniRoute gives new keys the
 * `self:usage` scope): this key's name, its spend this period against its
 * budget, and, with `self:account-quota`, the quota of the accounts it may use.
 */
export function parseKeyStatus(body: unknown): KeyStatus {
  const record = rec(body);
  const cost = rec(rec(record.usage).cost);
  const used = num(cost.usedUsd);
  const quotas = list(record.accountQuotas).map(rec).map((quota) => {
    const provider = providerLabel(str(quota.provider) ?? "account");
    if (quota.available === false) return { provider, text: QUOTA_REASONS[str(quota.reason) ?? ""] ?? "not available" };
    const windows = Object.entries(rec(quota.quotas)).map(([name, window]) => {
      const left = num(rec(window).remainingPercentage);
      return left === null ? null : `${name}: ${Math.round(left)}% left`;
    }).filter((text): text is string => !!text);
    return { provider, text: windows.length ? windows.join(" · ") : str(quota.plan) ?? "no quota reported" };
  });
  return {
    keyName: str(rec(record.apiKey).name),
    spend: used === null ? null : { usedUsd: used, limitUsd: num(cost.limitUsd), remainingUsd: num(cost.remainingUsd), usedPercent: num(cost.usedPercent), period: str(cost.period) ?? "monthly", resetAt: str(cost.resetAt) },
    tokens: num(rec(rec(record.usage).tokens).totalTokens),
    quotas,
  };
}
