/**
 * Pure decisions behind AI Router: URL handling, connection resolution,
 * health and key-test parsing, and the per-session routing rewrite. No
 * imports, so the tests load it without a daemon, a router or the SDK.
 */

export const DASHBOARD_PATH = "/dashboard";
export const ENDPOINT_EXAMPLES = ["http://127.0.0.1:20128", "http://10.0.0.5:20128"] as const;

/**
 * Routers AI Router can drive. Each has an adapter and its UI copy under
 * server/routers/<id>/; only the ids live here, so this file stays import-free.
 */
export const ROUTER_IDS = ["omniroute"] as const;
export type RouterId = (typeof ROUTER_IDS)[number];
const isRouterId = (value: unknown): value is RouterId => typeof value === "string" && (ROUTER_IDS as readonly string[]).includes(value);
/**
 * The "AI Router" Paseo provider: Claude Code pointed at OmniRoute with every
 * model of the connected accounts. Paseo provider ids match /^[a-z][a-z0-9-]*$/.
 */
export const AI_ROUTER_PROVIDER_ID = "ai-router";
/** The Codex-only provider 0.1.0 could add. No longer offered; syncing AI Router removes it. */
export const CODEX_PROVIDER_ID = "ai-router-codex";
/**
 * "Codex via OmniRoute": Paseo's Codex runtime pointed at OmniRoute's /v1. Paseo
 * turns an `extends: "codex"` entry with OPENAI_BASE_URL into a Codex
 * model_provider with wire_api "responses", and with OPENAI_API_KEY in the
 * entry it uses that key instead of a ChatGPT login.
 */
export const CODEX_ROUTER_PROVIDER_ID = "codex-ai-router";
/** Never disabled by Tidy up. */
export const PROTECTED_PROVIDER_IDS: readonly string[] = ["claude", "codex", "ai-router", CODEX_ROUTER_PROVIDER_ID];
/**
 * Written into provider entries instead of the real key; the session_open hook
 * puts the real key into the launch environment, which overrides the entry's
 * env. The secret never lands in Paseo's config.json.
 */
export const KEY_PLACEHOLDER = "set-at-launch-by-ai-router";
export const ROUTING_SETTINGS_VERSION = 1;

export const ENV_KEYS = {
  url: "AI_ROUTER_URL",
  key: "AI_ROUTER_KEY",
  token: "AI_ROUTER_TOKEN",
  console: "AI_ROUTER_CONSOLE_URL",
} as const;

export type Env = Record<string, string | undefined>;

export type Connection = {
  router: RouterId;
  /** What daemons call. Normalised: no trailing slash, no /v1. */
  endpoint: string | null;
  apiKey: string | null;
  /** Optional read-scoped access token for version and uptime. */
  token: string | null;
  /** What a person opens; null means endpoint + /dashboard. */
  consoleUrl: string | null;
  /** `user@host` that can reach the router, for the dashboard SSH forward. Not a secret. */
  sshTarget: string | null;
  /** Optional manage-scoped key that lets the panel change a few router settings. */
  manageKey: string | null;
  source: "saved" | "env" | "none";
};

export type ResolvedConnection = {
  connection: Connection;
  /** Set when a saved file or env var is present but unusable; routing stays off. */
  blocked: string | null;
  warnings: string[];
};

// ------------------------------------------------------------------ URLs

function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Credentials never travel in a URL; they belong in the key and token fields.
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** The root daemons call. A pasted `/v1` URL is accepted and stripped. Null when unusable. */
export function normaliseEndpoint(raw: unknown): string | null {
  const url = parseHttpUrl(raw);
  if (!url || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Any http(s) page, kept as given minus trailing slashes. Null when unusable. */
export function normaliseConsoleUrl(raw: unknown): string | null {
  const url = parseHttpUrl(raw);
  return url ? url.toString().replace(/\/+$/, "") : null;
}

/**
 * The public address (custom domain) people and browsers outside the network
 * use, e.g. `https://ai-router.example.com`. Stored as `consoleUrl` for
 * compatibility; a saved dashboard URL (`…/dashboard`) reads as its origin.
 */
export function publicAddress(connection: Pick<Connection, "consoleUrl">): string | null {
  const url = parseHttpUrl(connection.consoleUrl);
  if (!url) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "").replace(/\/dashboard$/, "");
}

/** The dashboard on the private endpoint, which daemons reach directly. */
export function privateDashboardUrl(connection: Pick<Connection, "endpoint">): string | null {
  return connection.endpoint ? `${connection.endpoint}${DASHBOARD_PATH}` : null;
}

/** A page inside the router's dashboard, e.g. `/dashboard/compression`, on whatever host the dashboard is reached at. */
export function dashboardLink(dashboardUrl: string | null, path: string): string | null {
  return dashboardUrl ? `${dashboardUrl.replace(/\/dashboard$/, "")}${path}` : null;
}

/**
 * Loopback, RFC 1918, link-local, CGNAT/Tailscale, `.local`/`.internal` and
 * single-label names: a browser on another network cannot reach these.
 */
export function isPrivateUrl(raw: string): boolean {
  const host = parseHttpUrl(raw)?.hostname.toLowerCase() ?? "";
  if (!host) return false;
  if (host === "localhost" || host === "[::1]" || host === "0.0.0.0") return true;
  if (/^\[(fc|fd|fe8)/.test(host)) return true;
  const ip = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return !host.includes(".") || /\.(local|internal|lan|home\.arpa)$/.test(host);
}

const SSH_TARGET = /^([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$/;
/** Codex's ChatGPT sign-in callback port, which the dashboard's Codex login needs forwarded too. */
export const CODEX_LOGIN_PORT = 1455;

function portOf(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

/**
 * How to reach a dashboard on a private network: an SSH forward of the
 * router's loopback port (plus Codex's login callback), and the localhost URL
 * to open once it runs. The target is a setting; the command never guesses one.
 */
export function privateDashboardAccess(dashboardUrl: string, sshTarget: string | null): { command: string; localUrl: string; hostPort: string } | null {
  const url = parseHttpUrl(dashboardUrl);
  if (!url || !isPrivateUrl(dashboardUrl)) return null;
  const port = portOf(url);
  const target = sshTarget && SSH_TARGET.test(sshTarget) ? sshTarget : "root@<router-host>";
  return {
    command: `ssh -N -L ${port}:127.0.0.1:${port} -L ${CODEX_LOGIN_PORT}:127.0.0.1:${CODEX_LOGIN_PORT} ${target}`,
    localUrl: `http://localhost:${port}${url.pathname === "/" ? "" : url.pathname}${url.search}`,
    hostPort: `${url.hostname}:${port}`,
  };
}

export function isValidSshTarget(value: string): boolean {
  return SSH_TARGET.test(value);
}

export function maskSecret(value: string | null): { present: boolean; last4: string | null } {
  return value ? { present: true, last4: value.slice(-4) } : { present: false, last4: null };
}

// ------------------------------------------------------------- connection

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const EMPTY: Connection = { router: "omniroute", endpoint: null, apiKey: null, token: null, consoleUrl: null, sshTarget: null, manageKey: null, source: "none" };

/**
 * Saved plugin settings > environment > nothing, as a whole record: once a
 * connection is saved from the panel, the AI_ROUTER_* variables are ignored,
 * so a key can never pair with another source's endpoint. A saved file or env
 * URL that is present but broken blocks routing instead of falling through to
 * the next source. There is no default endpoint.
 */
export function resolveConnection(savedRaw: string | null, env: Env, savedName = "connection.json"): ResolvedConnection {
  const warnings: string[] = [];
  if (savedRaw !== null) {
    let saved: Record<string, unknown>;
    try {
      saved = JSON.parse(savedRaw) as Record<string, unknown>;
    } catch {
      return { connection: { ...EMPTY, source: "saved" }, blocked: `${savedName} is unreadable or not valid JSON`, warnings: [`${savedName} is unreadable or not valid JSON; fix it, or press Disconnect to remove it.`] };
    }
    const endpoint = normaliseEndpoint(saved?.endpoint);
    const consoleUrl = normaliseConsoleUrl(saved?.consoleUrl);
    if (text(saved?.consoleUrl) && !consoleUrl) warnings.push("The saved public address is not a usable http(s) URL; it is ignored.");
    const sshTarget = text(saved?.sshTarget);
    if (saved?.router !== undefined && !isRouterId(saved.router)) {
      return { connection: { ...EMPTY, source: "saved" }, blocked: `${savedName} names an unknown router "${String(saved.router)}"`, warnings };
    }
    const connection: Connection = {
      router: isRouterId(saved?.router) ? saved.router : "omniroute",
      endpoint,
      apiKey: text(saved?.apiKey),
      manageKey: text(saved?.manageKey),
      token: text(saved?.token),
      consoleUrl,
      sshTarget: sshTarget && isValidSshTarget(sshTarget) ? sshTarget : null,
      source: "saved",
    };
    return { connection, blocked: endpoint ? null : `the saved endpoint in ${savedName} is not a usable http(s) URL`, warnings };
  }
  const rawUrl = text(env[ENV_KEYS.url]);
  if (!rawUrl) {
    const stray = [ENV_KEYS.key, ENV_KEYS.token, ENV_KEYS.console].filter((name) => text(env[name]));
    if (stray.length) warnings.push(`${stray.join(", ")} set without ${ENV_KEYS.url}; ignored.`);
    return { connection: EMPTY, blocked: null, warnings };
  }
  const endpoint = normaliseEndpoint(rawUrl);
  const consoleUrl = normaliseConsoleUrl(env[ENV_KEYS.console]);
  if (text(env[ENV_KEYS.console]) && !consoleUrl) warnings.push(`${ENV_KEYS.console} (the public address) is not a valid URL; it is ignored.`);
  const connection: Connection = { ...EMPTY, endpoint, apiKey: text(env[ENV_KEYS.key]), token: text(env[ENV_KEYS.token]), consoleUrl, source: "env" };
  return { connection, blocked: endpoint ? null : `${ENV_KEYS.url} is not a usable http(s) URL`, warnings };
}

/** Why this connection cannot route, or null when it has an endpoint and a key. */
export function connectionProblem(resolved: Pick<ResolvedConnection, "connection" | "blocked">): string | null {
  if (resolved.blocked) return resolved.blocked;
  if (!resolved.connection.endpoint) return "no endpoint URL set";
  if (!resolved.connection.apiKey) return `no API key set for ${resolved.connection.endpoint}`;
  return null;
}

export type ConnectionPatch = {
  router?: string;
  endpoint: string;
  manageKey?: string | null;
  apiKey?: string | null;
  token?: string | null;
  consoleUrl?: string | null;
  sshTarget?: string | null;
};

/**
 * Merge a form submission over the effective connection. Secrets the client
 * never saw arrive as undefined or "" and mean "keep"; null means "clear".
 */
export function mergeConnection(
  current: Connection,
  patch: ConnectionPatch,
): { ok: true; value: Omit<Connection, "source"> } | { ok: false; error: string } {
  const router = patch.router ?? current.router;
  if (!isRouterId(router)) return { ok: false, error: `"${router}" is not a router AI Router knows. Choose ${ROUTER_IDS.join(" or ")}.` };
  const endpoint = normaliseEndpoint(patch.endpoint);
  if (!endpoint) return { ok: false, error: `"${patch.endpoint}" is not a usable http(s) URL. Try ${ENDPOINT_EXAMPLES.join(" or ")}.` };
  const secret = (next: string | null | undefined, kept: string | null) => (next === null ? null : text(next) ?? kept);
  const consoleText = text(patch.consoleUrl);
  const consoleUrl = consoleText ? publicAddress({ consoleUrl: normaliseConsoleUrl(consoleText) }) : null;
  if (consoleText && !consoleUrl) return { ok: false, error: `"${consoleText}" is not a usable public address. Try https://ai-router.example.com.` };
  const sshTarget = text(patch.sshTarget);
  if (sshTarget && !isValidSshTarget(sshTarget)) return { ok: false, error: `"${sshTarget}" is not an SSH target like root@router.example.com.` };
  return {
    ok: true,
    value: {
      router,
      endpoint,
      apiKey: secret(patch.apiKey, current.apiKey),
      token: secret(patch.token, current.token),
      manageKey: secret(patch.manageKey, current.manageKey),
      consoleUrl,
      sshTarget,
    },
  };
}

// --------------------------------------------------------------- settings

/**
 * `comboProfiles`: keep one Paseo agent profile per OmniRoute combo. `contextBadge`: the
 * context badge on each chat. `mcpCard`: the "Check out MCP" card on Overview. All three
 * are on unless a person turns them off. New switches get a default and keep the
 * version: a new version would read as "newer" everywhere and turn routing off.
 */
export type RoutingSettingsShape = { routeAgents: boolean; comboProfiles: boolean; contextBadge: boolean; mcpCard: boolean };
export const ROUTING_DEFAULTS: RoutingSettingsShape = { routeAgents: false, comboProfiles: true, contextBadge: true, mcpCard: true };

/** Decode the daemon's `{ version, values }` envelope. Missing, malformed or newer = routing off, the rest on. */
export function parseRoutingEnvelope(raw: string | null): RoutingSettingsShape {
  if (raw === null) return ROUTING_DEFAULTS;
  try {
    const envelope = JSON.parse(raw) as { version?: unknown; values?: { routeAgents?: unknown; comboProfiles?: unknown; contextBadge?: unknown; mcpCard?: unknown } };
    if (envelope.version !== ROUTING_SETTINGS_VERSION) return ROUTING_DEFAULTS;
    const values = envelope.values;
    return { routeAgents: values?.routeAgents === true, comboProfiles: values?.comboProfiles !== false, contextBadge: values?.contextBadge !== false, mcpCard: values?.mcpCard !== false };
  } catch {
    return ROUTING_DEFAULTS;
  }
}

// ----------------------------------------------------------------- health

export type HealthProbe = { up: boolean; error: string | null };

type Body = { status?: unknown; error?: unknown; message?: unknown; data?: unknown; version?: unknown; uptime?: unknown; providerBreakers?: unknown };
const asBody = (body: unknown): Body => (body && typeof body === "object" ? (body as Body) : {});
function errorDetail(body: Body): string {
  const raw = body.error && typeof body.error === "object" ? (body.error as { message?: unknown }).message : body.error ?? body.message;
  return typeof raw === "string" && raw.trim() ? `: ${raw.trim()}` : "";
}

/** `/api/health/ping` (or `/api/health`) answered with this status and body. */
export function describePingResponse(status: number, body: unknown, url: string): HealthProbe {
  const record = asBody(body);
  if (status === 200 && record.status === "ok") return { up: true, error: null };
  if (status === 503) return { up: false, error: `503 — database down at ${url}${errorDetail(record)}` };
  if (status === 404) return { up: false, error: `404 — no OmniRoute health route at ${url}; wrong port, or not OmniRoute?` };
  if (status === 401 || status === 403) return { up: false, error: `${status} — ${url} wants auth for its health route; is this OmniRoute?` };
  if (status === 200) return { up: false, error: `200 but not an OmniRoute health answer at ${url}` };
  return { up: false, error: `${status} — unexpected answer from ${url}` };
}

/** Node's fetch hides the reason in `cause.code`; turn it into something a person can act on. */
export function describeFetchError(error: unknown, url: string, timeoutMs: number): string {
  const err = (error ?? {}) as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = String(err.cause?.code ?? err.code ?? "");
  if (err.name === "AbortError" || err.name === "TimeoutError") return `no answer from ${url} within ${Math.round(timeoutMs / 1000)}s`;
  if (code === "ECONNREFUSED") return `connection refused at ${url}`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `host not found: ${parseHttpUrl(url)?.hostname ?? url}`;
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ETIMEDOUT") return `host unreachable at ${url} (${code})`;
  if (code === "ECONNRESET") return `connection reset by ${url}`;
  if (/CERT|SSL|TLS/i.test(code)) return `TLS error at ${url} (${code})`;
  return `${String(err.cause?.message ?? err.message ?? error)} at ${url}`;
}

// --------------------------------------------------------- public address

export type PublicCheck = { state: "ok" | "dns" | "tls" | "http" | "unreachable"; label: string; detail: string | null };

/**
 * `GET <public address>/api/health/ping`, in words, from its answer or from
 * the fetch error. DNS, TLS and HTTP failures read differently because each
 * has a different fix: point the DNS record, wait for the certificate, or
 * check what answers behind the proxy.
 */
export function classifyPublicCheck(input: { status: number; body: unknown } | { error: unknown }, url: string, timeoutMs = 4_000): PublicCheck {
  const parsed = parseHttpUrl(url);
  const host = parsed?.host ?? url;
  const secure = parsed?.protocol === "https:";
  if ("status" in input) {
    const body = asBody(input.body);
    if (input.status === 200 && body.status === "ok") {
      return secure ? { state: "ok", label: `HTTPS OK · ${host}`, detail: null } : { state: "ok", label: `HTTP OK · ${host}`, detail: "Answers, but without HTTPS: browsers will warn, and keys travel unencrypted." };
    }
    if (input.status === 502 || input.status === 503 || input.status === 504) return { state: "http", label: `${secure ? "HTTPS" : "HTTP"} works, but OmniRoute behind it is not answering (${input.status})`, detail: "The proxy is up; check that it forwards to OmniRoute's port and that OmniRoute is running." };
    if (input.status === 404) return { state: "http", label: "Answers, but not as OmniRoute (404 on /api/health/ping)", detail: "Something else is serving this address, or the proxy forwards to the wrong port." };
    if (input.status === 401 || input.status === 403) return { state: "http", label: `Answers, but asks for a login on its health route (${input.status})`, detail: "The health route should be public; check the proxy in front of OmniRoute." };
    if (input.status === 200) return { state: "http", label: "Answers, but not as OmniRoute", detail: "The page at /api/health/ping is not OmniRoute's health answer." };
    return { state: "http", label: `Answers with HTTP ${input.status}`, detail: null };
  }
  const err = (input.error ?? {}) as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = String(err.cause?.code ?? err.code ?? "");
  const message = String(err.cause?.message ?? err.message ?? "");
  if (err.name === "AbortError" || err.name === "TimeoutError") return { state: "unreachable", label: "Unreachable", detail: `No answer from ${host} within ${Math.round(timeoutMs / 1000)} s.` };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NODATA" || code === "EAI_NONAME") return { state: "dns", label: "DNS not pointing here yet", detail: `${parsed?.hostname ?? host} does not resolve (${code}). Add or fix its DNS record; changes can take a while to spread.` };
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return { state: "tls", label: "Certificate is for another name", detail: `The server at ${host} shows a certificate for a different name: the DNS record may still point at another server.` };
  if (code === "CERT_HAS_EXPIRED") return { state: "tls", label: "Certificate expired", detail: `Renew the certificate for ${host}.` };
  if (/WRONG_VERSION_NUMBER|PACKET_LENGTH_TOO_LONG|HTTP_REQUEST/.test(code)) return { state: "tls", label: "Not serving HTTPS on this address", detail: `${host} answers with plain HTTP where HTTPS was expected.` };
  if (/CERT|SSL|TLS|EPROTO/i.test(code) || (code === "ECONNRESET" && /TLS|secure/i.test(message))) return { state: "tls", label: "Certificate not issued yet", detail: `${host} is reachable but has no valid certificate yet (${code}). With Caddy's automatic HTTPS this clears once DNS points at the server.` };
  if (code === "ECONNREFUSED") return { state: "unreachable", label: "Unreachable", detail: `${host} refused the connection: nothing listens on that port.` };
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ETIMEDOUT" || code === "ECONNRESET") return { state: "unreachable", label: "Unreachable", detail: `${host}: ${code}.` };
  return { state: "unreachable", label: "Unreachable", detail: `${message || "no answer"}${code ? ` (${code})` : ""}.` };
}

/** Where the plugin can be installed from; the Share card's Paseo snippet. */
export const PLUGIN_GIT_SOURCE = "git:https://github.com/itsjustanks/paseo-plugin-ai-router.git:apps/paseo";

/**
 * Setup snippets for someone else using this router through its public
 * address. Never a real key: `<your key>` is theirs to fill in.
 */
export function shareSnippets(publicUrl: string): Array<{ id: "claude" | "codex" | "paseo"; title: string; why: string; text: string }> {
  const base = publicUrl.replace(/\/+$/, "");
  return [
    {
      id: "claude",
      title: "Claude Code",
      why: "The last two lines turn off Claude Code's experimental request features and Fast mode: the router rewrites the beta header they need, so requests using them would be refused.",
      text: [`export ANTHROPIC_BASE_URL=${base}`, "export ANTHROPIC_AUTH_TOKEN=<your key>", "export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1", "export CLAUDE_CODE_DISABLE_FAST_MODE=1"].join("\n"),
    },
    {
      id: "codex",
      title: "Codex and other OpenAI-compatible tools",
      why: `Base URL ${base}/v1, with your key as the API key. For Codex, add this to ~/.codex/config.toml and set OMNIROUTE_API_KEY.`,
      text: ['model_provider = "omniroute"', "", "[model_providers.omniroute]", 'name = "OmniRoute"', `base_url = "${base}/v1"`, 'env_key = "OMNIROUTE_API_KEY"', 'wire_api = "responses"'].join("\n"),
    },
    {
      id: "paseo",
      title: "Another Paseo daemon",
      why: "Install AI Router there, then enter this address as the endpoint and your key on its Connection tab (or set the two variables before the daemon starts).",
      text: [`paseo plugin install ${PLUGIN_GIT_SOURCE}`, `export AI_ROUTER_URL=${base}`, "export AI_ROUTER_KEY=<your key>"].join("\n"),
    },
  ];
}

export type KeyCheck = { accepted: boolean; models: number | null; error: string | null };

/** Authenticated `GET /v1/models`: the proof that the key works. */
export function parseModelsResponse(status: number, body: unknown): KeyCheck {
  const record = asBody(body);
  if (status === 200 && Array.isArray(record.data)) return { accepted: true, models: record.data.length, error: null };
  if (status === 401) return { accepted: false, models: null, error: `401 — key rejected${errorDetail(record)}` };
  if (status === 403) return { accepted: false, models: null, error: `403 — key not allowed${errorDetail(record)}` };
  if (status === 200) return { accepted: false, models: null, error: "200 but /v1/models returned no model list" };
  return { accepted: false, models: null, error: `${status} — /v1/models failed${errorDetail(record)}` };
}

/** One line for the panel after Test connection. `openWithoutKey` = a keyless request also got in. */
export function describeKeyCheck(check: KeyCheck, openWithoutKey: boolean): string {
  if (!check.accepted) return check.error ?? "key check failed";
  const models = `${check.models} model${check.models === 1 ? "" : "s"}`;
  return openWithoutKey
    ? `reachable, ${models} — but /v1/models also answers with no key here, so the key is unproven (OmniRoute may not check keys, or only on requests)`
    : `reachable, key accepted, ${models}`;
}

export type MonitoringInfo = {
  version: string | null;
  uptimeSeconds: number | null;
  error: string | null;
  /** Providers whose circuit breaker is OPEN: OmniRoute is refusing their traffic. */
  paused: string[];
};

/**
 * `/api/monitoring/health` with the read token. OmniRoute answers a caller it
 * does not accept with the public view — `{status}` only — so a 200 without a
 * version is a rejected token too.
 */
export function parseMonitoring(status: number, body: unknown): MonitoringInfo {
  const record = asBody(body);
  const fail = (error: string): MonitoringInfo => ({ version: null, uptimeSeconds: null, error, paused: [] });
  if (status === 401) return fail(`401 — token rejected${errorDetail(record)}`);
  if (status === 403) return fail(`403 — token lacks the read scope${errorDetail(record)}`);
  if (status !== 200) return fail(`${status} — monitoring health failed${errorDetail(record)}`);
  if (typeof record.version !== "string") return fail("token not accepted — OmniRoute returned only the public health view");
  const uptime = typeof record.uptime === "number" && record.uptime >= 0 ? record.uptime : null;
  const paused = (Array.isArray(record.providerBreakers) ? record.providerBreakers : [])
    .map((breaker) => (breaker && typeof breaker === "object" ? (breaker as { provider?: unknown; state?: unknown }) : {}))
    .filter((breaker) => typeof breaker.provider === "string" && String(breaker.state).toUpperCase() === "OPEN")
    .map((breaker) => breaker.provider as string);
  return { version: record.version, uptimeSeconds: uptime, error: null, paused };
}

/**
 * A skipped session's reason in plain words, for the panel. The raw reason
 * still goes to the plugin log.
 */
export function plainReason(reason: string): string {
  if (/^no API key set/.test(reason)) return "no API key set";
  if (reason === "no endpoint URL set") return "no router address set";
  if (/has not been health-checked$/.test(reason)) return "the router has not been checked yet";
  const down = reason.match(/ is down: (.*)$/);
  if (down) return `the router did not answer (${down[1].replace(/ at https?:\/\/\S+?(?=: |$)/, "")})`;
  if (/Codex( via OmniRoute)? provider points at/.test(reason)) return "the Codex provider points at another address";
  if (/^hook failed: /.test(reason)) return `AI Router hit an error: ${reason.slice("hook failed: ".length)}`;
  return reason;
}

/** "Last Claude agent (13:51): routed through OmniRoute" / "…: used its own sign-in — no API key set". */
export function lastAgentLine(last: { kind: "claude" | "provider" | "codex"; routed: boolean; reason: string | null }, router: string, time: string): string {
  const who = last.kind === "claude" ? "Claude agent" : last.kind === "provider" ? "AI Router agent" : "Codex via OmniRoute agent";
  if (last.routed) return `Last ${who} (${time}): routed through ${router}`;
  const why = last.reason ? ` — ${plainReason(last.reason)}` : "";
  return last.kind === "claude" ? `Last ${who} (${time}): used its own sign-in${why}` : `Last ${who} (${time}): did not start${why}`;
}

export function formatUptime(seconds: number | null): string | null {
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// ---------------------------------------------------------------- routing

export type SessionKind = "claude" | "provider" | "codex";

/**
 * `claude`: built-in Claude, rerouted only while the toggle is on.
 * `provider`: the AI Router provider, which only works through OmniRoute.
 * `codex`: Codex via OmniRoute (and the legacy 0.1.0 AI Router Codex provider).
 * Built-in Codex builds its model provider from config, not env, and is never touched.
 */
export function sessionKind(provider: string): SessionKind | null {
  if (provider === "claude") return "claude";
  if (provider === AI_ROUTER_PROVIDER_ID) return "provider";
  if (provider === CODEX_ROUTER_PROVIDER_ID || provider === CODEX_PROVIDER_ID) return "codex";
  return null;
}

/** OmniRoute's Codex guide: base_url is the root plus /v1. */
export function codexBaseUrl(endpoint: string): string {
  return `${endpoint}/v1`;
}

export type RouteInput = {
  provider: string;
  routeAgents: boolean;
  resolved: Pick<ResolvedConnection, "connection" | "blocked">;
  health: HealthProbe | null;
  /** OPENAI_BASE_URL in the requested Codex provider's entry, when known. */
  codexBaseUrl?: string | null;
};

export type RouteDecision =
  | { action: "ignore" }
  | { action: "skip"; kind: SessionKind; reason: string }
  | { action: "route"; kind: SessionKind; env: Record<string, string> };

/**
 * The session_open rewrite. Built-in Claude sessions are rewritten only while
 * routeAgents is on; sessions on the AI Router providers always are, because
 * picking one is the opt-in. Nothing is rewritten
 * unless the connection has an endpoint and a key and answered its health
 * check: a skipped Claude session keeps its normal sign-in rather than
 * launching at a dead or unkeyed endpoint.
 */
/**
 * Extra env for every Claude Code session that goes through the router.
 * OmniRoute swaps Claude Code's anthropic-beta header for its own pinned list.
 * - Claude Code 2.1.280 attaches `output_config` (per-turn effort) to a
 *   mid-conversation system message, which needs the newer per-turn-control
 *   beta; without it Anthropic answers 400 "messages.1.output_config: Extra
 *   inputs are not permitted" and OmniRoute opens its Claude breaker. Turning
 *   experimental betas off keeps effort at the top level, which works.
 * - Fast mode sends `speed: "fast"`, which needs the fast-mode beta OmniRoute
 *   neither sends nor forwards (3.8.51): Anthropic answers 400 "speed: Extra
 *   inputs are not permitted". CLAUDE_CODE_DISABLE_FAST_MODE makes Claude Code
 *   leave it out even when Paseo's Fast switch is on, mid-chat included.
 */
export const ROUTED_CLAUDE_ENV = { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1" } as const;

export function routeSession(input: RouteInput): RouteDecision {
  const kind = sessionKind(input.provider);
  if (!kind || (kind === "claude" && !input.routeAgents)) return { action: "ignore" };
  const problem = connectionProblem(input.resolved);
  const { endpoint, apiKey } = input.resolved.connection;
  if (problem || !endpoint || !apiKey) return { action: "skip", kind, reason: problem ?? "no endpoint URL set" };
  if (!input.health) return { action: "skip", kind, reason: `${endpoint} has not been health-checked` };
  if (!input.health.up) return { action: "skip", kind, reason: `${endpoint} is down: ${input.health.error ?? "no answer"}` };
  if (kind !== "codex") {
    // OmniRoute's Claude Code guide: ANTHROPIC_BASE_URL is the root with no /v1; the token goes out as a bearer.
    return { action: "route", kind, env: { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: apiKey, ...ROUTED_CLAUDE_ENV } };
  }
  const expected = codexBaseUrl(endpoint);
  if (input.codexBaseUrl !== expected) {
    const which = input.provider === CODEX_PROVIDER_ID ? "the old AI Router Codex provider" : "the Codex via OmniRoute provider";
    return { action: "skip", kind, reason: `${which} points at ${input.codexBaseUrl ?? "nothing"}, not ${expected}; turn it on again in the Providers tab` };
  }
  return { action: "route", kind, env: { OPENAI_API_KEY: apiKey } };
}

/**
 * The AI Router provider, following the 9router plugin's shape: a Claude-derived
 * provider that owns its whole model list. OmniRoute translates the Anthropic
 * Messages API to every provider it serves, so Claude Code can run `cx/…` GPT
 * models too. The key is added at launch, never written here.
 */
// ------------------------------------------------------------ thinking levels
//
// Paseo gives a model it doesn't recognise (every `cc/…` and `cx/…` id) the
// generic low/medium/high/max. The AI Router provider lists each model's own
// levels instead: OmniRoute's `effort_tiers` for it, else Paseo's own levels
// for the same upstream model. Only Claude Code effort levels that OmniRoute
// carries through are offered. Not "off": Paseo refuses it for gateway ids.
// Not "ultracode" or Codex's "ultra": not proven through OmniRoute yet.

/** Effort levels Paseo hands Claude Code as they are, and that OmniRoute passes on (low and max proven on cc/ and cx/). */
export const ROUTED_EFFORT_IDS = ["low", "medium", "high", "xhigh", "max"] as const;
const EFFORT_LABELS: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max" };

/** Paseo's own levels per model id (`claude-opus-5-5`, `gpt-6-sol`), from its provider model lists. */
export type NativeThinking = Record<string, { options: Array<{ id: string; label: string }>; defaultId: string | null }>;
export type ThinkingOption = { id: string; label: string; isDefault?: true };

/** Paseo's `providers.listModels` answers (claude, codex) as one map; a model without levels maps to none. */
export function nativeThinkingFrom(answers: readonly unknown[]): NativeThinking {
  const map: NativeThinking = {};
  for (const answer of answers) {
    const models = (answer as { models?: unknown } | null)?.models;
    for (const model of Array.isArray(models) ? models : []) {
      const row = model as { id?: unknown; thinkingOptions?: unknown; defaultThinkingOptionId?: unknown } | null;
      if (typeof row?.id !== "string" || map[row.id]) continue;
      const options = (Array.isArray(row.thinkingOptions) ? row.thinkingOptions : [])
        .map((option) => option as { id?: unknown; label?: unknown; isDefault?: unknown })
        .filter((option): option is { id: string; label?: unknown; isDefault?: unknown } => typeof option?.id === "string");
      const marked = options.find((option) => option.isDefault === true)?.id ?? null;
      map[row.id] = {
        options: options.map((option) => ({ id: option.id, label: typeof option.label === "string" ? option.label : option.id })),
        defaultId: typeof row.defaultThinkingOptionId === "string" ? row.defaultThinkingOptionId : marked,
      };
    }
  }
  return map;
}

/**
 * One model's levels on the AI Router provider. Undefined leaves Paseo's
 * generic set (combos, and models nothing is known about); an empty list
 * means none (a model Paseo itself gives no levels, such as Haiku).
 */
export function routedThinkingOptions(model: { provider: string; root: string | null; tiers: readonly string[] | null }, native: NativeThinking | null): ThinkingOption[] | undefined {
  if (model.provider === "combo") return undefined;
  const own = model.root && native ? native[model.root] : undefined;
  const source = model.tiers?.length ? model.tiers : own ? own.options.map((option) => option.id) : null;
  if (!source) return undefined;
  const ids: string[] = ROUTED_EFFORT_IDS.filter((id) => source.includes(id));
  const preferred = own?.defaultId && ids.includes(own.defaultId) ? own.defaultId : ids.includes("high") ? "high" : ids.includes("medium") ? "medium" : ids[0];
  return ids.map((id) => ({
    id,
    label: own?.options.find((option) => option.id === id)?.label ?? EFFORT_LABELS[id],
    ...(id === preferred ? { isDefault: true as const } : {}),
  }));
}

export function aiRouterProviderEntry(endpoint: string, models: ReadonlyArray<{ id: string; label: string; provider?: string; root?: string | null; tiers?: readonly string[] | null }>, native: NativeThinking | null = null) {
  const preferred = models.find((model) => /sonnet/i.test(model.id)) ?? models[0];
  return {
    extends: "claude",
    label: "AI Router",
    description: "Every model of your connected OmniRoute accounts",
    env: { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: KEY_PLACEHOLDER, ...ROUTED_CLAUDE_ENV },
    models: models.map((model) => {
      const thinkingOptions = routedThinkingOptions({ provider: model.provider ?? "", root: model.root ?? null, tiers: model.tiers ?? null }, native);
      return { id: model.id, label: model.label, ...(model === preferred ? { isDefault: true } : {}), ...(thinkingOptions ? { thinkingOptions } : {}) };
    }),
  };
}

/**
 * "Codex via OmniRoute": Paseo's Codex runtime with OmniRoute's /v1 as its
 * model provider (wire_api "responses", which Paseo sets for any Codex-derived
 * entry with OPENAI_BASE_URL). The OPENAI_API_KEY placeholder makes Paseo use
 * a key instead of a ChatGPT login; the real key is added at launch.
 */
export function codexRouterProviderEntry(endpoint: string, models: ReadonlyArray<{ id: string; label: string }>) {
  const preferred = models.find((model) => /gpt-6-sol$/.test(model.id)) ?? models.find((model) => /sol$/.test(model.id)) ?? models[0];
  return {
    extends: "codex",
    label: "Codex via OmniRoute",
    description: "Codex with your OmniRoute accounts; no Codex login needed on this daemon",
    env: { OPENAI_BASE_URL: codexBaseUrl(endpoint), OPENAI_API_KEY: KEY_PLACEHOLDER },
    models: models.map((model) => ({ id: model.id, label: model.label.replace(/^Codex · /, ""), ...(model === preferred ? { isDefault: true } : {}) })),
  };
}

/** The same entry, field by field: only these are ours to compare. */
export function sameProviderEntry(current: unknown, desired: { label: string; env: Record<string, string>; models: ReadonlyArray<{ id: string; label: string; isDefault?: boolean; thinkingOptions?: readonly ThinkingOption[] }> }): boolean {
  if (!current || typeof current !== "object") return false;
  const entry = current as { label?: unknown; env?: unknown; models?: unknown };
  const models = Array.isArray(entry.models) ? (entry.models as Array<{ id?: unknown; label?: unknown; isDefault?: unknown; thinkingOptions?: unknown }>) : [];
  const levels = (value: unknown) => JSON.stringify(value ?? null);
  const env = entry.env && typeof entry.env === "object" ? (entry.env as Record<string, unknown>) : {};
  return (
    entry.label === desired.label &&
    Object.entries(desired.env).every(([name, value]) => env[name] === value) &&
    models.length === desired.models.length &&
    desired.models.every((model, index) => models[index]?.id === model.id && models[index]?.label === model.label && (models[index]?.isDefault === true) === (model.isDefault === true) && levels(models[index]?.thinkingOptions) === levels(model.thinkingOptions))
  );
}

// ------------------------------------------------------- daemon config.json

/**
 * Put our provider entries and agent profiles into the text of Paseo's
 * config.json, leaving every other key as it is. Providers live at
 * `agents.providers`, profiles at `daemon.agentProfiles` (Paseo's own layout).
 * Refuses anything that does not look like a daemon config, so a surprise
 * never gets written back. A `null` provider entry removes it; `profiles`
 * (when given) is the full set of AI Router profiles, merged with
 * mergeAgentProfiles so a person's own profiles are kept exactly.
 */
export function withProviderEntries(raw: string, entries: Record<string, unknown | null>, profiles: readonly AgentProfile[] | null = null): { ok: true; text: string; changed: boolean } | { ok: false; error: string } {
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    return { ok: false, error: "config.json is not valid JSON" };
  }
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  // A fresh daemon's config may hold only some sections (e.g. pluginsEnabled, plugins, agents, features);
  // `version` and `daemon` appear once the app saves something. Any known section is enough.
  const PASEO_SECTIONS = ["version", "daemon", "app", "providers", "pluginsEnabled", "plugins", "agents", "features"];
  if (!isObject(config) || !PASEO_SECTIONS.some((key) => key in config)) return { ok: false, error: "config.json does not look like a Paseo daemon config" };
  if (config.agents !== undefined && !isObject(config.agents)) return { ok: false, error: "config.json has an unexpected agents section" };
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  if (agents.providers !== undefined && !isObject(agents.providers)) return { ok: false, error: "config.json has an unexpected agents.providers section" };
  if (config.daemon !== undefined && !isObject(config.daemon)) return { ok: false, error: "config.json has an unexpected daemon section" };
  const daemon = (config.daemon ?? {}) as Record<string, unknown>;
  if (daemon.agentProfiles !== undefined && !Array.isArray(daemon.agentProfiles)) return { ok: false, error: "config.json has an unexpected daemon.agentProfiles section" };
  const providers = { ...((agents.providers ?? {}) as Record<string, unknown>) };
  let providersChanged = false;
  for (const [id, entry] of Object.entries(entries)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) return { ok: false, error: `"${id}" is not a Paseo provider id` };
    if (entry === null) {
      if (id in providers) {
        delete providers[id];
        providersChanged = true;
      }
    } else if (JSON.stringify(providers[id]) !== JSON.stringify(entry)) {
      providers[id] = entry;
      providersChanged = true;
    }
  }
  const merged = profiles ? mergeAgentProfiles(daemon.agentProfiles, profiles) : null;
  const next: Record<string, unknown> = { ...config };
  if (providersChanged) next.agents = { ...agents, providers };
  if (merged?.changed) next.daemon = { ...daemon, agentProfiles: merged.next };
  const changed = providersChanged || !!merged?.changed;
  return { ok: true, text: `${JSON.stringify(changed ? next : config, null, 2)}\n`, changed };
}

// ------------------------------------------------------- combos as profiles

/** Every agent profile AI Router manages starts with this; nothing else is ever touched. */
export const PROFILE_PREFIX = "ai-router:";
export type AgentProfile = { id: string; name: string; provider: string; model?: string; notes?: string; icon?: string; color?: string; [field: string]: unknown };
/** What AI Router sets on its own profiles every time; anything else (icon, colour, effort a person picked) is kept. */
const PROFILE_OWNED_FIELDS = ["name", "provider", "model", "notes"] as const;

export const isOwnProfile = (entry: unknown): entry is AgentProfile =>
  !!entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as { id?: unknown }).id === "string" && (entry as { id: string }).id.startsWith(PROFILE_PREFIX);

/** One combo as a Paseo agent profile on the AI Router provider. */
export function comboProfile(combo: { id: string; name: string; notes: string; icon: string; color: string }): AgentProfile {
  return { id: `${PROFILE_PREFIX}${combo.id}`, name: combo.name, icon: combo.icon, color: combo.color, provider: AI_ROUTER_PROVIDER_ID, model: combo.id, notes: combo.notes };
}

/**
 * The profile list with AI Router's profiles brought up to date and nobody
 * else's touched: a person's profiles stay the same objects in the same
 * places; ours are updated where they are, new ones are added at the end,
 * and ones whose combo is gone are removed. On our profiles we set only
 * name, provider, model and notes, so an icon, colour or effort a person
 * chose in Paseo survives.
 */
export function mergeAgentProfiles(current: unknown, desired: readonly AgentProfile[]): { next: unknown[]; changed: boolean } {
  const existing = Array.isArray(current) ? current : [];
  const wanted = new Map(desired.map((profile) => [profile.id, profile]));
  const placed = new Set<string>();
  const next: unknown[] = [];
  for (const entry of existing) {
    if (!isOwnProfile(entry)) {
      next.push(entry);
      continue;
    }
    const want = wanted.get(entry.id);
    if (!want || placed.has(entry.id)) continue;
    placed.add(entry.id);
    const updated: AgentProfile = { ...entry };
    for (const field of PROFILE_OWNED_FIELDS) {
      if (want[field] === undefined) delete updated[field];
      else updated[field] = want[field];
    }
    next.push(updated);
  }
  for (const want of desired) if (!placed.has(want.id)) next.push(want);
  return { next, changed: JSON.stringify(next) !== JSON.stringify(existing) };
}

// --------------------------------------------------------- Paseo providers

export type ProviderStatus = "ready" | "loading" | "error" | "unavailable";
export type ProviderRowInput = {
  id: string;
  status: ProviderStatus;
  error: string | null;
  enabled: boolean;
  source: "builtin" | "custom";
  /** The config entry sets more than `enabled` or `order`: someone configured it. */
  configured: boolean;
};

const OUR_PROVIDER_IDS = [AI_ROUTER_PROVIDER_ID, CODEX_ROUTER_PROVIDER_ID, CODEX_PROVIDER_ID];

/** Whose entry this is: Paseo's own, ours, or one a person made. User-made entries are never tidied. */
export function providerOwner(row: Pick<ProviderRowInput, "id" | "source" | "configured">): "paseo" | "ai-router" | "user" {
  if (OUR_PROVIDER_IDS.includes(row.id)) return "ai-router";
  return row.source === "custom" || row.configured ? "user" : "paseo";
}

/** Why Tidy up would switch this provider off, or null to leave it. */
export function tidyReason(row: ProviderRowInput): string | null {
  if (!row.enabled || PROTECTED_PROVIDER_IDS.includes(row.id) || providerOwner(row) !== "paseo") return null;
  if (row.status === "unavailable") return row.error ? `not available: ${row.error}` : "not installed on this daemon";
  if (row.status === "error") return `fails to start${row.error ? `: ${row.error}` : ""}`;
  if (row.status === "loading") return "never finished loading";
  return null;
}

/** What "Through OmniRoute" offers for a provider. */
export function throughRouter(id: string): "claude-toggle" | "codex-provider" | "is-router" | "none" {
  if (id === "claude") return "claude-toggle";
  if (id === "codex") return "codex-provider";
  if (OUR_PROVIDER_IDS.includes(id)) return "is-router";
  return "none";
}

const PROVIDER_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode", pi: "Pi", omp: "OMP", [AI_ROUTER_PROVIDER_ID]: "AI Router", [CODEX_ROUTER_PROVIDER_ID]: "Codex via OmniRoute", [CODEX_PROVIDER_ID]: "AI Router Codex (old)" };
export function paseoProviderName(id: string, label: string | null | undefined): string {
  return label?.trim() || PROVIDER_NAMES[id] || id.replace(/-/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ------------------------------------------------------- dashboard access

/** A tunnel's public URL, as the dashboard address. */
export function tunnelDashboardUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, "")}${DASHBOARD_PATH}`;
}

/** The dashboard page for one provider's accounts: sign in again or add another there. */
export function providerDashboardPage(dashboardUrl: string | null, provider: string): string | null {
  return dashboardLink(dashboardUrl, `/dashboard/providers/${encodeURIComponent(provider)}`);
}

// ------------------------------------------------------------- access tiers

/**
 * What this daemon's credentials open up. Basic: endpoint and inference key
 * (what a shared user has). Operator: plus a read token. Admin: plus a
 * manage key. The panel shows only what the tier can use.
 */
export type AccessTier = "none" | "basic" | "operator" | "admin";
export function accessTier(connection: Pick<Connection, "endpoint" | "apiKey" | "token" | "manageKey">): AccessTier {
  if (!connection.endpoint || !connection.apiKey) return "none";
  if (connection.manageKey) return "admin";
  return connection.token ? "operator" : "basic";
}
export const TIER_LABELS: Record<AccessTier, string> = { none: "Not connected", basic: "Key only", operator: "Read token", admin: "Manage key" };

/** A dashboard address served by a tunnel, recognised by its host, so any user sees "via Cloudflare tunnel". */
export function tunnelKind(url: string | null): string | null {
  const host = url ? parseHttpUrl(url)?.hostname.toLowerCase() ?? "" : "";
  if (/\.trycloudflare\.com$|\.cfargotunnel\.com$/.test(host)) return "via Cloudflare tunnel";
  if (/\.ngrok(-free)?\.(app|dev|io)$/.test(host)) return "via ngrok tunnel";
  if (/\.ts\.net$/.test(host)) return "via Tailscale Funnel";
  return null;
}

// ------------------------------------------------------------ activity

/**
 * OmniRoute records this request header as the call log's `sessionTag` (its
 * conversation id; a client-supplied value wins outright). The hook sends
 * `paseo-<agent id>` through Claude Code's ANTHROPIC_CUSTOM_HEADERS, so a
 * request links to the Paseo agent that made it.
 */
export const SESSION_HEADER = "x-omniroute-session-id";
const SESSION_TAG_PREFIX = "paseo-";
export const sessionTagFor = (agentId: string) => `${SESSION_TAG_PREFIX}${agentId}`;
export function agentIdFromTag(tag: unknown): string | null {
  return typeof tag === "string" && tag.startsWith(SESSION_TAG_PREFIX) && tag.length > SESSION_TAG_PREFIX.length ? tag.slice(SESSION_TAG_PREFIX.length) : null;
}

/**
 * ANTHROPIC_CUSTOM_HEADERS with the session header added: `Name: value`
 * lines. A person's own headers are kept; one they set for this header wins.
 */
export function withSessionHeader(existing: string | undefined, agentId: string): string {
  const lines = (existing ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => line.toLowerCase().startsWith(`${SESSION_HEADER}:`))) return lines.join("\n");
  return [...lines, `${SESSION_HEADER}: ${sessionTagFor(agentId)}`].join("\n");
}

/** One routing decision from the session_open hook, for the Traffic tab. No secrets, no content. */
export type SessionEntry = { at: string; agentId: string; kind: "claude" | "provider" | "codex"; provider: string; reason: string | null; routed: boolean; tagged: boolean };
export const SESSION_LOG_SIZE = 200;

/** Newest last, at most `size` entries. */
export function pushSession(log: readonly SessionEntry[], entry: SessionEntry, size = SESSION_LOG_SIZE): SessionEntry[] {
  return [...log, entry].slice(-size);
}

/** The saved session log, keeping only well-formed entries; anything unreadable is an empty log. */
const SESSION_KINDS: ReadonlyArray<SessionEntry["kind"]> = ["claude", "provider", "codex"];
export function parseSessionLog(raw: string | null): SessionEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((e): e is SessionEntry => !!e && typeof e === "object" && typeof (e as SessionEntry).at === "string" && typeof (e as SessionEntry).agentId === "string" && typeof (e as SessionEntry).routed === "boolean" && SESSION_KINDS.includes((e as SessionEntry).kind))
      .map((e): SessionEntry => ({ at: e.at, agentId: e.agentId, kind: e.kind, provider: typeof e.provider === "string" ? e.provider : "claude", reason: typeof e.reason === "string" ? e.reason : null, routed: e.routed, tagged: e.tagged === true }))
      .slice(-SESSION_LOG_SIZE);
  } catch {
    return [];
  }
}
