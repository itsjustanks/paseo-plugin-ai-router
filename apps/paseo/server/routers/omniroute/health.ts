import type { Status } from "../../../shared/contracts";
import { describeConsoleLock, isBasicAuthChallenge } from "../../../shared/routers/omniroute/parsers";
import { readLastSeen, writeLastSeen } from "../../store";
import {
  classifyPublicCheck,
  describeFetchError,
  describeKeyCheck,
  describePingResponse,
  parseModelsResponse,
  parseMonitoring,
  type Connection,
  type HealthProbe,
  type MonitoringInfo,
  type PublicCheck,
} from "../../../shared/logic";

type Health = NonNullable<Status["health"]>;

const TIMEOUT_MS = 4_000;

/** One request. Throws on network failure so the caller can name the reason; a non-JSON body reads as null. */
export async function getJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = TIMEOUT_MS,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; body: unknown; challenge: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    const body = await response.json().catch(() => null);
    return { status: response.status, body, challenge: response.headers.get("www-authenticate") };
  } finally {
    clearTimeout(timer);
  }
}

export const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

/** `/api/health/ping`, falling back to `/api/health` on builds that predate it. */
export async function ping(endpoint: string): Promise<HealthProbe & { latencyMs: number | null }> {
  for (const path of ["/api/health/ping", "/api/health"]) {
    const url = `${endpoint}${path}`;
    const started = Date.now();
    try {
      const { status, body } = await getJson(url);
      if (status === 404 && path === "/api/health/ping") continue;
      const probe = describePingResponse(status, body, url);
      return { ...probe, latencyMs: probe.up ? Date.now() - started : null };
    } catch (error) {
      return { up: false, error: describeFetchError(error, url, TIMEOUT_MS), latencyMs: null };
    }
  }
  return { up: false, error: `no OmniRoute health route at ${endpoint}`, latencyMs: null };
}

async function monitoring(endpoint: string, token: string): Promise<MonitoringInfo> {
  const url = `${endpoint}/api/monitoring/health`;
  try {
    const { status, body, challenge } = await getJson(url, bearer(token));
    if (status === 401 && isBasicAuthChallenge(challenge)) return { version: null, uptimeSeconds: null, error: describeConsoleLock(url, "/api/monitoring/health"), paused: [] };
    return parseMonitoring(status, body);
  } catch (error) {
    return { version: null, uptimeSeconds: null, error: describeFetchError(error, url, TIMEOUT_MS), paused: [] };
  }
}

async function check(endpoint: string, token: string | null): Promise<Health> {
  const probe = await ping(endpoint);
  const info = probe.up && token ? await monitoring(endpoint, token) : null;
  return {
    checkedAt: new Date().toISOString(),
    up: probe.up,
    latencyMs: probe.latencyMs,
    error: probe.error,
    version: info?.version ?? null,
    uptimeSeconds: info?.uptimeSeconds ?? null,
    monitoringError: info?.error ?? null,
    paused: info?.paused ?? [],
  };
}

// One cached answer for the one connection. The key includes the token so a
// changed token is re-checked; it lives only in this process's memory.
let cache: { key: string; at: number; value: Health } | null = null;
let inflight: { key: string; promise: Promise<Health> } | null = null;
const keyOf = (connection: Pick<Connection, "endpoint" | "token">) => `${connection.endpoint}\n${connection.token ?? ""}`;

/** The last check if younger than `maxAgeMs`, otherwise a fresh one. Concurrent callers share a request. */
export async function currentHealth(connection: Pick<Connection, "endpoint" | "token">, maxAgeMs: number): Promise<Health | null> {
  if (!connection.endpoint) return null;
  const key = keyOf(connection);
  // maxAgeMs 0 means "ask again": never served from a cache written in the same millisecond.
  if (maxAgeMs > 0 && cache?.key === key && Date.now() - cache.at <= maxAgeMs) return cache.value;
  if (inflight?.key === key) return inflight.promise;
  const promise = check(connection.endpoint, connection.token).then((value) => {
    cache = { key, at: Date.now(), value };
    if (value.up) rememberSeen(connection.endpoint!, value.checkedAt);
    return value;
  });
  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

/** When the router last answered, kept on disk so "last seen" survives a plugin restart. Written at most once a minute. */
let seen: { endpoint: string; at: string } | null = null;
function rememberSeen(endpoint: string, at: string): void {
  const previous = seen ?? readLastSeen();
  seen = { endpoint, at };
  if (previous?.endpoint === endpoint && Date.parse(at) - Date.parse(previous.at) < 60_000) return;
  try {
    writeLastSeen(seen);
  } catch {
    // memory is enough until the next write
  }
}
export function lastSeenAt(endpoint: string | null): string | null {
  const known = seen ?? readLastSeen();
  return endpoint && known?.endpoint === endpoint ? known.at : null;
}

/** The last answer for this connection, however old, without asking again. */
export function peekHealth(connection: Pick<Connection, "endpoint" | "token">): { value: Health; ageMs: number } | null {
  return connection.endpoint && cache?.key === keyOf(connection) ? { value: cache.value, ageMs: Date.now() - cache.at } : null;
}

/** Set when a check younger than `maxAgeMs` found the router down: callers answer at once instead of waiting on a dead host. */
export function recentlyDown(connection: Pick<Connection, "endpoint" | "token">, maxAgeMs = 30_000): string | null {
  const last = peekHealth(connection);
  return last && !last.value.up && last.ageMs <= maxAgeMs ? `the router is not answering (${last.value.error ?? "no answer"})` : null;
}

/**
 * For the panel: a fresh check if it finishes within `waitMs`, otherwise the
 * previous answer (or none) and `checking`, so the panel never waits on a
 * dead or slow router. The check keeps running and the next poll picks it up.
 */
export async function healthForPanel(connection: Pick<Connection, "endpoint" | "token">, maxAgeMs: number, waitMs = 1_500): Promise<{ health: Health | null; checking: boolean }> {
  if (!connection.endpoint) return { health: null, checking: false };
  const running = currentHealth(connection, maxAgeMs).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), waitMs)));
  const first = await Promise.race([running, late]);
  clearTimeout(timer);
  if (first !== "late") return { health: first, checking: false };
  return { health: peekHealth(connection)?.value ?? null, checking: true };
}

/**
 * Test connection: reachable, then an authenticated `/v1/models` to prove the
 * key, then the same call with no key to catch an OmniRoute that is not
 * checking keys at all. The optional token is checked last and never blocks.
 */
export async function testConnection(candidate: Pick<Connection, "endpoint" | "apiKey" | "token">): Promise<{ ok: boolean; message: string }> {
  const endpoint = candidate.endpoint;
  if (!endpoint) return { ok: false, message: "Enter the endpoint URL first." };
  const probe = await ping(endpoint);
  if (!probe.up) return { ok: false, message: probe.error ?? `no answer from ${endpoint}` };
  if (!candidate.apiKey) return { ok: false, message: `reachable, but no API key entered for ${endpoint}` };
  const url = `${endpoint}/v1/models`;
  let keyed;
  try {
    const { status, body } = await getJson(url, bearer(candidate.apiKey));
    keyed = parseModelsResponse(status, body);
  } catch (error) {
    return { ok: false, message: describeFetchError(error, url, TIMEOUT_MS) };
  }
  let open = false;
  if (keyed.accepted) {
    open = await getJson(url).then(({ status }) => status === 200, () => false);
  }
  const parts = [describeKeyCheck(keyed, open)];
  let tokenOk = true;
  if (keyed.accepted && candidate.token) {
    const info = await monitoring(endpoint, candidate.token);
    tokenOk = !info.error;
    parts.push(info.error ? `read token: ${info.error}` : `OmniRoute ${info.version}`);
  }
  // An optional credential that is rejected is not saved: the panel would claim access it does not have.
  return { ok: keyed.accepted && tokenOk, message: parts.join(" · ") };
}

// ---------------------------------------------------------- public address

/** `<public address>/api/health/ping`: OmniRoute's public health route, no credentials sent. */
const PUBLIC_TIMEOUT_MS = 4_000;
const PUBLIC_MAX_AGE_MS = 60_000;
type PublicAnswer = PublicCheck & { checkedAt: string };
let publicCache: { url: string; at: number; value: PublicAnswer } | null = null;
let publicInflight: { url: string; promise: Promise<PublicAnswer> } | null = null;

export async function checkPublic(publicUrl: string): Promise<PublicAnswer> {
  const url = `${publicUrl}/api/health/ping`;
  let check: PublicCheck;
  try {
    const { status, body } = await getJson(url, {}, PUBLIC_TIMEOUT_MS);
    check = classifyPublicCheck({ status, body }, publicUrl, PUBLIC_TIMEOUT_MS);
  } catch (error) {
    check = classifyPublicCheck({ error }, publicUrl, PUBLIC_TIMEOUT_MS);
  }
  return { ...check, checkedAt: new Date().toISOString() };
}

/** The last check if under a minute old, else a fresh one; callers of the same address share it. */
function currentPublic(publicUrl: string, maxAgeMs: number): Promise<PublicAnswer> {
  if (maxAgeMs > 0 && publicCache?.url === publicUrl && Date.now() - publicCache.at <= maxAgeMs) return Promise.resolve(publicCache.value);
  if (publicInflight?.url === publicUrl) return publicInflight.promise;
  const promise = checkPublic(publicUrl).then((value) => {
    publicCache = { url: publicUrl, at: Date.now(), value };
    return value;
  });
  publicInflight = { url: publicUrl, promise };
  void promise.finally(() => {
    if (publicInflight?.promise === promise) publicInflight = null;
  });
  return promise;
}

/** For the panel: never waits longer than `waitMs`; until the first answer the state is `checking`. */
export async function publicForPanel(publicUrl: string | null, refresh: boolean, waitMs = 1_500): Promise<(PublicAnswer | { state: "checking"; label: string; detail: null; checkedAt: null }) | null> {
  if (!publicUrl) return null;
  const running = currentPublic(publicUrl, refresh ? 0 : PUBLIC_MAX_AGE_MS).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), waitMs)));
  const first = await Promise.race([running, late]);
  clearTimeout(timer);
  if (first && first !== "late") return first;
  return publicCache?.url === publicUrl ? publicCache.value : { state: "checking", label: "Checking…", detail: null, checkedAt: null };
}
