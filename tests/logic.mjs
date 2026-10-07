import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "../apps/paseo/node_modules/typescript/lib/typescript.js";

// Local-day logic (the Usage tab's "today" and custom dates) is checked in one fixed time zone.
process.env.TZ = "Australia/Sydney";

// Pure decisions only: URLs, connection resolution, health parsing and the session_open rewrite.
const staging = mkdtempSync(join(tmpdir(), "ai-router-logic-"));
let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};
try {
  const source = readFileSync(new URL("../apps/paseo/shared/logic.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(staging, "logic.mjs"), compiled);
  const L = await import(join(staging, "logic.mjs"));

  const LOCAL = "http://127.0.0.1:20128";
  const REMOTE = "http://10.0.0.5:20128";

  // ------------------------------------------------------------ URLs
  check("endpoint normalisation", () => {
    assert.equal(L.normaliseEndpoint(`${REMOTE}/`), REMOTE);
    assert.equal(L.normaliseEndpoint(`${LOCAL}/v1`), LOCAL, "a pasted /v1 base is stripped");
    assert.equal(L.normaliseEndpoint(`${LOCAL}/v1/`), LOCAL);
    assert.equal(L.normaliseEndpoint("  https://router.example.com/omni/  "), "https://router.example.com/omni");
    assert.equal(L.normaliseEndpoint("10.0.0.5:20128"), null, "no scheme is rejected, not guessed");
    assert.equal(L.normaliseEndpoint("localhost:20128"), null);
    assert.equal(L.normaliseEndpoint("ftp://router"), null);
    assert.equal(L.normaliseEndpoint("http://admin:secret@router:20128"), null, "credentials never live in a URL");
    assert.equal(L.normaliseEndpoint(`${LOCAL}?key=sk-1`), null);
    assert.equal(L.normaliseEndpoint(""), null);
    assert.equal(L.normaliseEndpoint(undefined), null);
  });

  check("dashboard URL", () => {
    assert.equal(L.normaliseConsoleUrl("https://omni.example.com/dashboard/"), "https://omni.example.com/dashboard");
    assert.equal(L.normaliseConsoleUrl("not a url"), null);
    assert.equal(L.privateDashboardUrl({ endpoint: REMOTE }), `${REMOTE}/dashboard`);
    assert.equal(L.privateDashboardUrl({ endpoint: null }), null);
  });

  check("private network detection", () => {
    for (const url of [REMOTE, LOCAL, "http://localhost:20128", "http://172.16.0.4", "http://192.168.1.2", "http://100.100.1.1", "http://omniroute:20128", "http://router.local"]) {
      assert.equal(L.isPrivateUrl(url), true, url);
    }
    for (const url of ["https://omni.example.com", "http://172.32.0.1", "http://8.8.8.8", "http://100.128.0.1"]) {
      assert.equal(L.isPrivateUrl(url), false, url);
    }
  });

  check("private dashboard forward", () => {
    const access = L.privateDashboardAccess(`${REMOTE}/dashboard`, null);
    assert.equal(access.command, "ssh -N -L 20128:127.0.0.1:20128 -L 1455:127.0.0.1:1455 root@<router-host>", "no router host is guessed");
    assert.equal(access.localUrl, "http://localhost:20128/dashboard");
    assert.equal(access.hostPort, "10.0.0.5:20128");
    assert.equal(L.privateDashboardAccess(`${REMOTE}/dashboard`, "root@bastion.example.com").command.endsWith(" root@bastion.example.com"), true);
    assert.equal(L.privateDashboardAccess(`${REMOTE}/dashboard`, "root@x; rm -rf /").command.endsWith(" root@<router-host>"), true, "an unsafe target never reaches the command");
    assert.equal(L.privateDashboardAccess("https://omni.example.com/dashboard", "root@x"), null, "public dashboards open directly");
  });

  check("masking", () => {
    assert.deepEqual(L.maskSecret("sk-live-abcd1234"), { present: true, last4: "1234" });
    assert.deepEqual(L.maskSecret(null), { present: false, last4: null });
  });

  // ------------------------------------------------------ connection
  const env = (values) => values;
  check("fresh install: nothing configured, nothing routed", () => {
    const resolved = L.resolveConnection(null, env({}));
    assert.equal(resolved.connection.source, "none");
    assert.equal(resolved.connection.endpoint, null, "there is no default endpoint to fall back to");
    assert.equal(L.connectionProblem(resolved), "no endpoint URL set");
  });

  check("env seeds the connection", () => {
    const resolved = L.resolveConnection(null, env({ AI_ROUTER_URL: `${REMOTE}/v1`, AI_ROUTER_KEY: "sk-env", AI_ROUTER_TOKEN: "oma_live_env", AI_ROUTER_CONSOLE_URL: "https://omni.example.com" }));
    assert.equal(resolved.connection.source, "env");
    assert.equal(resolved.connection.endpoint, REMOTE);
    assert.equal(resolved.connection.apiKey, "sk-env");
    assert.equal(resolved.connection.token, "oma_live_env");
    assert.equal(resolved.connection.consoleUrl, "https://omni.example.com");
    assert.equal(L.connectionProblem(resolved), null);
  });

  check("env without a key reads as not configured", () => {
    const resolved = L.resolveConnection(null, env({ AI_ROUTER_URL: LOCAL }));
    assert.equal(L.connectionProblem(resolved), `no API key set for ${LOCAL}`);
  });

  check("a broken env URL blocks instead of falling back", () => {
    const resolved = L.resolveConnection(null, env({ AI_ROUTER_URL: "10.0.0.5:20128", AI_ROUTER_KEY: "sk-env" }));
    assert.equal(resolved.connection.endpoint, null);
    assert.equal(L.connectionProblem(resolved), "AI_ROUTER_URL is not a usable http(s) URL");
  });

  check("stray env vars without a URL are reported", () => {
    const resolved = L.resolveConnection(null, env({ AI_ROUTER_KEY: "sk-env" }));
    assert.equal(resolved.connection.apiKey, null);
    assert.match(resolved.warnings[0], /AI_ROUTER_KEY set without AI_ROUTER_URL/);
  });

  check("saved settings beat env as a whole record", () => {
    const saved = JSON.stringify({ endpoint: LOCAL, apiKey: "sk-saved", token: null, consoleUrl: null, sshTarget: "root@router.example.com" });
    const resolved = L.resolveConnection(saved, env({ AI_ROUTER_URL: REMOTE, AI_ROUTER_KEY: "sk-env" }));
    assert.equal(resolved.connection.source, "saved");
    assert.equal(resolved.connection.endpoint, LOCAL);
    assert.equal(resolved.connection.apiKey, "sk-saved");
    assert.equal(resolved.connection.sshTarget, "root@router.example.com");
    const keyless = L.resolveConnection(JSON.stringify({ endpoint: LOCAL }), env({ AI_ROUTER_URL: REMOTE, AI_ROUTER_KEY: "sk-env" }));
    assert.equal(keyless.connection.apiKey, null, "an env key never pairs with a saved endpoint");
    assert.equal(L.connectionProblem(keyless), `no API key set for ${LOCAL}`);
  });

  check("a broken saved file blocks instead of falling back to env", () => {
    const resolved = L.resolveConnection("{not json", env({ AI_ROUTER_URL: REMOTE, AI_ROUTER_KEY: "sk-env" }));
    assert.equal(resolved.connection.endpoint, null);
    assert.equal(L.connectionProblem(resolved), "connection.json is unreadable or not valid JSON");
    const badEndpoint = L.resolveConnection(JSON.stringify({ endpoint: "nope", apiKey: "sk" }), env({}));
    assert.match(L.connectionProblem(badEndpoint), /saved endpoint .* not a usable/);
  });

  check("router type and manage key", () => {
    assert.deepEqual(L.ROUTER_IDS, ["omniroute"]);
    assert.equal(L.resolveConnection(null, {}).connection.router, "omniroute");
    const saved = L.resolveConnection(JSON.stringify({ router: "omniroute", endpoint: REMOTE, apiKey: "sk-a", manageKey: "sk-manage" }), {});
    assert.equal(saved.connection.manageKey, "sk-manage");
    const legacy = L.resolveConnection(JSON.stringify({ endpoint: REMOTE, apiKey: "sk-a" }), {});
    assert.equal(legacy.connection.router, "omniroute", "a 0.1/0.2 file without a router is OmniRoute");
    const unknown = L.resolveConnection(JSON.stringify({ router: "litellm", endpoint: REMOTE, apiKey: "sk-a" }), {});
    assert.equal(L.connectionProblem(unknown), 'connection.json names an unknown router "litellm"', "an unknown router never routes");
    assert.equal(L.resolveConnection(null, { AI_ROUTER_URL: REMOTE, AI_ROUTER_KEY: "sk-env" }).connection.manageKey, null, "the environment never supplies a manage key");
    const current = saved.connection;
    assert.equal(L.mergeConnection(current, { endpoint: REMOTE, manageKey: "" }).value.manageKey, "sk-manage", "blank keeps");
    assert.equal(L.mergeConnection(current, { endpoint: REMOTE, manageKey: null }).value.manageKey, null, "null clears");
    assert.match(L.mergeConnection(current, { router: "litellm", endpoint: REMOTE }).error, /not a router AI Router knows/);
  });

  check("dashboard deep links", () => {
    assert.equal(L.dashboardLink(`${REMOTE}/dashboard`, "/dashboard/compression"), `${REMOTE}/dashboard/compression`);
    assert.equal(L.dashboardLink("https://omni.example.com", "/dashboard/settings/resilience"), "https://omni.example.com/dashboard/settings/resilience");
    assert.equal(L.dashboardLink(null, "/dashboard/compression"), null);
  });

  check("form merge keeps, sets and clears secrets", () => {
    const current = { router: "omniroute", endpoint: LOCAL, apiKey: "sk-old", token: "oma_live_old", manageKey: null, consoleUrl: null, sshTarget: null, source: "saved" };
    const kept = L.mergeConnection(current, { endpoint: `${REMOTE}/`, apiKey: "", token: undefined });
    assert.deepEqual(kept, { ok: true, value: { router: "omniroute", endpoint: REMOTE, apiKey: "sk-old", token: "oma_live_old", manageKey: null, consoleUrl: null, sshTarget: null } });
    const replaced = L.mergeConnection(current, { endpoint: LOCAL, apiKey: " sk-new ", token: null, sshTarget: "root@router" });
    assert.equal(replaced.value.apiKey, "sk-new");
    assert.equal(replaced.value.token, null, "null clears the token");
    assert.equal(replaced.value.sshTarget, "root@router");
    const bad = L.mergeConnection(current, { endpoint: "10.0.0.5" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /http:\/\/127\.0\.0\.1:20128 or http:\/\/10\.0\.0\.5:20128/, "the error shows both examples");
    assert.equal(L.mergeConnection(current, { endpoint: LOCAL, sshTarget: "root@x; rm -rf /" }).ok, false);
    assert.equal(L.mergeConnection(current, { endpoint: LOCAL, consoleUrl: "nope" }).ok, false);
  });

  // -------------------------------------------------------- settings
  check("routing settings: off unless a known document says on", () => {
    assert.equal(L.parseRoutingEnvelope(null).routeAgents, false, "a fresh install routes nothing");
    assert.equal(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: true } })).routeAgents, true);
    assert.equal(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: {} })).routeAgents, false);
    assert.equal(L.parseRoutingEnvelope(JSON.stringify({ version: 2, values: { routeAgents: true } })).routeAgents, false, "a newer schema never routes");
    assert.equal(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: "yes" } })).routeAgents, false);
    assert.equal(L.parseRoutingEnvelope("\u0000unreadable").routeAgents, false);
  });

  // ---------------------------------------------------------- health
  check("ping parsing", () => {
    const url = `${REMOTE}/api/health/ping`;
    assert.deepEqual(L.describePingResponse(200, { status: "ok", timestamp: "t", latencyMs: 1 }, url), { up: true, error: null });
    assert.deepEqual(L.describePingResponse(503, { status: "error", error: "db_query_failed" }, url), { up: false, error: `503 — database down at ${url}: db_query_failed` });
    assert.match(L.describePingResponse(404, null, url).error, /^404 — no OmniRoute health route/);
    assert.match(L.describePingResponse(401, null, url).error, /^401 — .* wants auth/);
    assert.match(L.describePingResponse(200, "<html>", url).error, /not an OmniRoute health answer/);
    assert.equal(L.describePingResponse(502, null, url).error, `502 — unexpected answer from ${url}`);
  });

  check("network errors are named", () => {
    const url = `${REMOTE}/api/health/ping`;
    const failed = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
    assert.equal(L.describeFetchError(failed("ECONNREFUSED"), url, 4000), `connection refused at ${url}`);
    assert.equal(L.describeFetchError(failed("ENOTFOUND"), "http://nope.invalid:20128/api/health/ping", 4000), "host not found: nope.invalid");
    assert.equal(L.describeFetchError(failed("EHOSTUNREACH"), url, 4000), `host unreachable at ${url} (EHOSTUNREACH)`);
    assert.equal(L.describeFetchError(Object.assign(new Error("aborted"), { name: "AbortError" }), url, 4000), `no answer from ${url} within 4s`);
    assert.equal(L.describeFetchError(failed("ERR_TLS_CERT_ALTNAME_INVALID"), url, 4000), `TLS error at ${url} (ERR_TLS_CERT_ALTNAME_INVALID)`);
  });

  check("key test parsing", () => {
    const models = { object: "list", data: Array.from({ length: 640 }, (_, i) => ({ id: `cc/m${i}` })) };
    const ok = L.parseModelsResponse(200, models);
    assert.deepEqual(ok, { accepted: true, models: 640, error: null });
    assert.equal(L.describeKeyCheck(ok, false), "reachable, key accepted, 640 models");
    assert.match(L.describeKeyCheck(ok, true), /key is unproven/);
    const rejected = L.parseModelsResponse(401, { error: { message: "Invalid API key", type: "invalid_request_error" } });
    assert.equal(rejected.error, "401 — key rejected: Invalid API key");
    assert.equal(L.describeKeyCheck(rejected, false), "401 — key rejected: Invalid API key");
    assert.equal(L.parseModelsResponse(403, { error: "Forbidden" }).error, "403 — key not allowed: Forbidden");
    assert.equal(L.parseModelsResponse(200, {}).accepted, false);
  });

  check("paused providers and the plain last-agent line", () => {
    const health = { status: "healthy", version: "3.8.51", uptime: 60, providerBreakers: [{ provider: "claude", state: "OPEN" }, { provider: "codex", state: "HALF_OPEN" }, { provider: "glm", state: "CLOSED" }] };
    assert.deepEqual(L.parseMonitoring(200, health).paused, ["claude"], "only OPEN pauses traffic");
    assert.deepEqual(L.parseMonitoring(200, { version: "3.8.51" }).paused, []);
    assert.deepEqual(L.parseMonitoring(401, {}).paused, []);
    assert.equal(L.plainReason("no API key set for http://10.0.0.5:20128"), "no API key set");
    assert.equal(L.plainReason("no endpoint URL set"), "no router address set");
    assert.equal(L.plainReason(`${REMOTE} is down: connection refused at ${REMOTE}/api/health/ping`), "the router did not answer (connection refused)");
    assert.equal(L.plainReason(`${REMOTE} is down: 503 — database down at ${REMOTE}/api/health/ping: db_query_failed`), "the router did not answer (503 — database down: db_query_failed)");
    assert.equal(L.plainReason("hook failed: boom"), "AI Router hit an error: boom");
    assert.equal(L.plainReason("AI_ROUTER_URL is not a usable http(s) URL"), "AI_ROUTER_URL is not a usable http(s) URL");
    assert.equal(L.lastAgentLine({ kind: "claude", routed: true, reason: null }, "OmniRoute", "13:51"), "Last Claude agent (13:51): routed through OmniRoute");
    assert.equal(L.lastAgentLine({ kind: "claude", routed: false, reason: `no API key set for ${REMOTE}` }, "OmniRoute", "13:51"), "Last Claude agent (13:51): used its own sign-in — no API key set");
    assert.equal(L.lastAgentLine({ kind: "provider", routed: false, reason: "no endpoint URL set" }, "OmniRoute", "09:05"), "Last AI Router agent (09:05): did not start — no router address set");
  });

  check("monitoring parsing", () => {
    assert.deepEqual(L.parseMonitoring(200, { status: "healthy", version: "3.8.50", uptime: 90061 }), { version: "3.8.50", uptimeSeconds: 90061, error: null, paused: [] });
    assert.equal(L.parseMonitoring(200, { status: "healthy" }).error, "token not accepted — OmniRoute returned only the public health view");
    assert.equal(L.parseMonitoring(401, { error: "Invalid or expired access token" }).error, "401 — token rejected: Invalid or expired access token");
    assert.equal(L.parseMonitoring(403, { error: "Access token scope 'none' is insufficient; 'read' required." }).error, "403 — token lacks the read scope: Access token scope 'none' is insufficient; 'read' required.");
    assert.equal(L.formatUptime(90061), "1d 1h");
    assert.equal(L.formatUptime(3700), "1h 1m");
    assert.equal(L.formatUptime(59), "0m");
    assert.equal(L.formatUptime(null), null);
  });

  // --------------------------------------------------------- routing
  const up = { up: true, error: null };
  const down = { up: false, error: `connection refused at ${REMOTE}/api/health/ping` };
  const configured = (endpoint, apiKey = "sk-test") => L.resolveConnection(null, env({ AI_ROUTER_URL: endpoint, ...(apiKey ? { AI_ROUTER_KEY: apiKey } : {}) }));

  check("routing on: Claude gets the endpoint (no /v1) and key", () => {
    const decision = L.routeSession({ provider: "claude", routeAgents: true, resolved: configured(`${REMOTE}/v1`), health: up });
    assert.deepEqual(decision, { action: "route", kind: "claude", env: { ANTHROPIC_BASE_URL: REMOTE, ANTHROPIC_AUTH_TOKEN: "sk-test", CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1" } });
  });

  check("routing off: nothing is touched, even with env configured", () => {
    assert.deepEqual(L.routeSession({ provider: "claude", routeAgents: false, resolved: configured(REMOTE), health: up }), { action: "ignore" });
  });

  check("other providers are never touched", () => {
    for (const provider of ["codex", "opencode", "ninerouter", "copilot"]) {
      assert.deepEqual(L.routeSession({ provider, routeAgents: true, resolved: configured(REMOTE), health: up }), { action: "ignore" }, provider);
    }
  });

  check("routing skipped: no API key", () => {
    const decision = L.routeSession({ provider: "claude", routeAgents: true, resolved: configured(LOCAL, null), health: up });
    assert.deepEqual(decision, { action: "skip", kind: "claude", reason: `no API key set for ${LOCAL}` });
  });

  check("routing skipped: no endpoint, broken env, broken file", () => {
    assert.equal(L.routeSession({ provider: "claude", routeAgents: true, resolved: L.resolveConnection(null, {}), health: null }).reason, "no endpoint URL set");
    assert.equal(L.routeSession({ provider: "claude", routeAgents: true, resolved: configured("10.0.0.5:20128"), health: up }).reason, "AI_ROUTER_URL is not a usable http(s) URL");
    assert.equal(L.routeSession({ provider: "claude", routeAgents: true, resolved: L.resolveConnection("{", {}), health: up }).reason, "connection.json is unreadable or not valid JSON");
  });

  check("routing skipped: failed or missing health check", () => {
    assert.deepEqual(L.routeSession({ provider: "claude", routeAgents: true, resolved: configured(REMOTE), health: down }), { action: "skip", kind: "claude", reason: `${REMOTE} is down: connection refused at ${REMOTE}/api/health/ping` });
    assert.equal(L.routeSession({ provider: "claude", routeAgents: true, resolved: configured(REMOTE), health: null }).action, "skip");
  });

  check("switching the connection switches the rewrite", () => {
    const first = L.routeSession({ provider: "claude", routeAgents: true, resolved: configured(LOCAL, "sk-a"), health: up });
    const second = L.routeSession({ provider: "claude", routeAgents: true, resolved: configured(REMOTE, "sk-b"), health: up });
    assert.equal(first.env.ANTHROPIC_BASE_URL, LOCAL);
    assert.equal(second.env.ANTHROPIC_BASE_URL, REMOTE);
    assert.equal(second.env.ANTHROPIC_AUTH_TOKEN, "sk-b");
  });

  check("AI Router provider: endpoint and key at launch, whatever the toggle says", () => {
    const resolved = configured(`${REMOTE}/`);
    for (const routeAgents of [false, true]) {
      const routed = L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents, resolved, health: up });
      assert.deepEqual(routed, { action: "route", kind: "provider", env: { ANTHROPIC_BASE_URL: REMOTE, ANTHROPIC_AUTH_TOKEN: "sk-test", CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1" } }, "choosing the provider is the opt-in");
    }
    assert.deepEqual(L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents: true, resolved: configured(REMOTE, null), health: up }), { action: "skip", kind: "provider", reason: `no API key set for ${REMOTE}` });
    assert.equal(L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents: true, resolved, health: down }).reason, `${REMOTE} is down: connection refused at ${REMOTE}/api/health/ping`);
    assert.equal(L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents: true, resolved: L.resolveConnection(null, {}), health: null }).reason, "no endpoint URL set");
  });

  check("AI Router provider entry: every model, a Sonnet default, never the real key", () => {
    const models = [{ id: "cc/claude-opus-5-5", label: "Claude · Opus 5.5" }, { id: "cc/claude-sonnet-5", label: "Claude · Sonnet 5" }, { id: "cx/gpt-5.6-sol", label: "Codex · GPT-5.6 Sol" }];
    const entry = L.aiRouterProviderEntry(REMOTE, models);
    assert.equal(entry.extends, "claude");
    assert.deepEqual(entry.env, { ANTHROPIC_BASE_URL: REMOTE, ANTHROPIC_AUTH_TOKEN: L.KEY_PLACEHOLDER, CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1" });
    // Claude Code 2.1.280 + OmniRoute: per-turn output_config needs a beta OmniRoute strips, so routed sessions turn experimental betas off.
    assert.equal(L.ROUTED_CLAUDE_ENV.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, "1");
    // OmniRoute neither sends nor forwards the fast-mode beta, so `speed: "fast"` is refused: routed Claude Code never sends it.
    assert.equal(L.ROUTED_CLAUDE_ENV.CLAUDE_CODE_DISABLE_FAST_MODE, "1");
    assert.deepEqual(entry.models, [
      { id: "cc/claude-opus-5-5", label: "Claude · Opus 5.5" },
      { id: "cc/claude-sonnet-5", label: "Claude · Sonnet 5", isDefault: true },
      { id: "cx/gpt-5.6-sol", label: "Codex · GPT-5.6 Sol" },
    ]);
    assert.equal(L.aiRouterProviderEntry(REMOTE, [models[2]]).models[0].isDefault, true, "no Sonnet: the first model is the default");
    for (const id of [L.AI_ROUTER_PROVIDER_ID, L.CODEX_PROVIDER_ID]) assert.match(id, /^[a-z][a-z0-9-]*$/, "a valid Paseo provider id");
  });

  check("legacy AI Router Codex provider: key only while its entry matches", () => {
    const resolved = configured(REMOTE);
    const routed = L.routeSession({ provider: L.CODEX_PROVIDER_ID, routeAgents: false, resolved, health: up, codexBaseUrl: `${REMOTE}/v1` });
    assert.deepEqual(routed, { action: "route", kind: "codex", env: { OPENAI_API_KEY: "sk-test" } });
    const stale = L.routeSession({ provider: L.CODEX_PROVIDER_ID, routeAgents: true, resolved, health: up, codexBaseUrl: `${LOCAL}/v1` });
    assert.equal(stale.action, "skip");
    assert.match(stale.reason, /points at http:\/\/127\.0\.0\.1:20128\/v1, not http:\/\/10\.0\.0\.5:20128\/v1/);
    assert.equal(L.routeSession({ provider: L.CODEX_PROVIDER_ID, routeAgents: true, resolved: configured(REMOTE, null), health: up, codexBaseUrl: `${REMOTE}/v1` }).action, "skip");
  });

  check("Codex via OmniRoute: a Codex-derived entry with placeholders, the real key only at launch", () => {
    const codex = [{ id: "cx/gpt-5.6-sol", label: "Codex · GPT-5.6 Sol" }, { id: "cx/gpt-6-sol", label: "Codex · GPT-6 Sol" }];
    const entry = L.codexRouterProviderEntry(REMOTE, codex);
    assert.equal(entry.extends, "codex");
    assert.deepEqual(entry.env, { OPENAI_BASE_URL: `${REMOTE}/v1`, OPENAI_API_KEY: "set-at-launch-by-ai-router" }, "Paseo needs OPENAI_API_KEY in the entry to skip ChatGPT login; it is a placeholder");
    assert.deepEqual(entry.models.map((m) => [m.label, m.isDefault === true]), [["GPT-5.6 Sol", false], ["GPT-6 Sol", true]], "GPT-6 Sol is the default");
    assert.equal(L.sessionKind(L.CODEX_ROUTER_PROVIDER_ID), "codex");
    assert.match(L.CODEX_ROUTER_PROVIDER_ID, /^[a-z][a-z0-9-]*$/);
    const resolved = configured(REMOTE);
    assert.deepEqual(L.routeSession({ provider: L.CODEX_ROUTER_PROVIDER_ID, routeAgents: false, resolved, health: up, codexBaseUrl: `${REMOTE}/v1` }), { action: "route", kind: "codex", env: { OPENAI_API_KEY: "sk-test" } });
    const moved = L.routeSession({ provider: L.CODEX_ROUTER_PROVIDER_ID, routeAgents: false, resolved, health: up, codexBaseUrl: `${LOCAL}/v1` });
    assert.match(moved.reason, /the Codex via OmniRoute provider points at/);
    assert.equal(L.plainReason(moved.reason), "the Codex provider points at another address");
    assert.equal(L.routeSession({ provider: "codex", routeAgents: true, resolved, health: up }).action, "ignore", "built-in Codex is never touched");
  });

  check("sameProviderEntry compares only what AI Router owns", () => {
    const desired = L.aiRouterProviderEntry(REMOTE, [{ id: "cc/claude-sonnet-5", label: "Claude · Sonnet 5" }]);
    assert.equal(L.sameProviderEntry(JSON.parse(JSON.stringify(desired)), desired), true);
    assert.equal(L.sameProviderEntry({ ...desired, order: 3, enabled: false }, desired), true, "a person's enabled or order stays theirs");
    assert.equal(L.sameProviderEntry({ ...desired, models: [] }, desired), false, "a new model is a change");
    assert.equal(L.sameProviderEntry({ ...desired, env: { ...desired.env, ANTHROPIC_BASE_URL: LOCAL } }, desired), false, "a moved endpoint is a change");
    assert.equal(L.sameProviderEntry(undefined, desired), false);
  });

  check("withProviderEntries edits only our entries in config.json, and refuses a surprise", () => {
    const config = { version: 1, daemon: { listen: "127.0.0.1:6767" }, agents: { providers: { gemini: { extends: "acp", label: "Gemini", command: ["gemini"] }, "ai-router-codex": { extends: "codex" } } } };
    const entry = L.aiRouterProviderEntry(REMOTE, [{ id: "cc/claude-sonnet-5", label: "Claude · Sonnet 5" }]);
    const next = L.withProviderEntries(JSON.stringify(config), { "ai-router": entry, "ai-router-codex": null });
    assert.equal(next.ok, true);
    assert.equal(next.changed, true);
    const written = JSON.parse(next.text);
    assert.deepEqual(written.daemon, config.daemon, "the rest of the file is kept");
    assert.deepEqual(written.agents.providers.gemini, config.agents.providers.gemini, "a user-made entry is never touched");
    assert.deepEqual(written.agents.providers["ai-router"], entry);
    assert.equal("ai-router-codex" in written.agents.providers, false);
    assert.ok(next.text.endsWith("\n"));
    assert.equal(L.withProviderEntries(next.text, { "ai-router": entry }).changed, false, "an unchanged entry is not rewritten");
    assert.equal(L.withProviderEntries(JSON.stringify({ version: 1 }), { "ai-router": entry }).ok, true, "no agents section yet is fine");
    for (const bad of ["{", "[]", JSON.stringify({ unrelated: true }), JSON.stringify({ version: 1, agents: [] }), JSON.stringify({ version: 1, agents: { providers: [] } })]) {
      assert.equal(L.withProviderEntries(bad, { "ai-router": entry }).ok, false, `refuses ${bad}`);
    }
    assert.equal(L.withProviderEntries(JSON.stringify({ version: 1 }), { "Bad Id": {} }).ok, false);
    // Paseo 0.11.0-beta.4+ reads `options` on a provider entry: a person's own, on ours, survive a sync like Paseo's config.patch keeps them.
    const own = { ...config, agents: { providers: { "ai-router": { ...entry, label: "Old", models: [], options: { sandbox: { enabled: true } }, enabled: false, order: 2 } } } };
    const kept = JSON.parse(L.withProviderEntries(JSON.stringify(own), { "ai-router": entry }).text).agents.providers["ai-router"];
    assert.deepEqual(kept, { ...entry, options: { sandbox: { enabled: true } }, enabled: false, order: 2 }, "our fields are rewritten; theirs are kept");
    assert.equal(L.withProviderEntries(JSON.stringify({ ...own, agents: { providers: { "ai-router": kept } } }), { "ai-router": entry }).changed, false, "and kept again without a rewrite");
    // A fresh daemon's real config has no version/daemon keys yet; it must still sync.
    const minimal = { pluginsEnabled: true, plugins: { "ai-router": { source: "directory", path: "/x" } }, agents: { providers: { copilot: { enabled: false } } }, features: {} };
    const synced = L.withProviderEntries(JSON.stringify(minimal), { "ai-router": entry });
    assert.equal(synced.ok, true, "minimal fresh-daemon config is accepted");
    const after = JSON.parse(synced.text);
    assert.deepEqual(after.agents.providers.copilot, { enabled: false }, "other providers untouched");
    assert.deepEqual(after.plugins, minimal.plugins, "other sections untouched");
  });

  check("Tidy up: only Paseo's own providers that cannot run, never the protected ones or a person's", () => {
    const row = (id, status, extra = {}) => ({ id, status, error: null, enabled: true, source: "builtin", configured: false, ...extra });
    assert.equal(L.tidyReason(row("copilot", "loading")), "never finished loading");
    assert.equal(L.tidyReason(row("opencode", "unavailable")), "not installed on this daemon");
    assert.match(L.tidyReason(row("pi", "error", { error: "spawn pi ENOENT" })), /fails to start: spawn pi ENOENT/);
    assert.equal(L.tidyReason(row("copilot", "ready")), null, "a working provider stays");
    assert.equal(L.tidyReason(row("copilot", "loading", { enabled: false })), null, "already off");
    for (const id of ["claude", "codex", "ai-router", "codex-ai-router", "ai-router-codex"]) assert.equal(L.tidyReason(row(id, "unavailable")), null, `${id} is never tidied`);
    assert.equal(L.tidyReason(row("gemini", "unavailable", { source: "custom" })), null, "a user-made entry stays");
    assert.equal(L.tidyReason(row("opencode", "unavailable", { configured: true })), null, "a configured built-in stays");
    assert.equal(L.providerOwner(row("gemini", "ready", { source: "custom" })), "user");
    assert.deepEqual(["claude", "codex", "ai-router", "codex-ai-router", "copilot"].map(L.throughRouter), ["claude-toggle", "codex-toggle", "is-router", "is-router", "none"]);
  });

  check("access tiers follow the saved credentials; a tunnel is recognised by its host", () => {
    const c = (apiKey, token, manageKey) => ({ endpoint: REMOTE, apiKey, token, manageKey });
    assert.equal(L.accessTier(c(null, null, null)), "none");
    assert.equal(L.accessTier({ ...c("sk", null, null), endpoint: null }), "none");
    assert.equal(L.accessTier(c("sk", null, null)), "basic");
    assert.equal(L.accessTier(c("sk", "oma", null)), "operator");
    assert.equal(L.accessTier(c("sk", null, "sk-m")), "admin");
    assert.equal(L.tunnelKind("https://quiet-river-demo.trycloudflare.com/dashboard"), "via Cloudflare tunnel");
    assert.equal(L.tunnelKind("https://abc.ngrok-free.app/dashboard"), "via ngrok tunnel");
    assert.equal(L.tunnelKind("https://router.tail1234.ts.net/dashboard"), "via Tailscale Funnel");
    assert.equal(L.tunnelKind(`${REMOTE}/dashboard`), null);
    assert.equal(L.tunnelDashboardUrl("https://x.trycloudflare.com/"), "https://x.trycloudflare.com/dashboard");
    assert.equal(L.providerDashboardPage(`${REMOTE}/dashboard`, "codex"), `${REMOTE}/dashboard/providers/codex`);
  });

  check("no dashboard password anywhere: not read from env, not kept from a saved file", () => {
    assert.equal("password" in L.ENV_KEYS, false);
    const saved = L.resolveConnection(JSON.stringify({ endpoint: REMOTE, apiKey: "sk", dashboardPassword: "hunter2" }), {});
    assert.equal(JSON.stringify(saved).includes("hunter2"), false);
    const merged = L.mergeConnection(saved.connection, { endpoint: REMOTE, dashboardPassword: "hunter2" });
    assert.equal(JSON.stringify(merged).includes("hunter2"), false);
  });

  check("combo profiles: only ai-router: profiles are added, updated or removed; a person's stay exactly", () => {
    const mine = { id: "legacy_favorite:codex:gpt-5.6-sol", name: "gpt-5.6-sol", provider: "codex", model: "gpt-5.6-sol" };
    const other = { id: "review", name: "Reviewer", icon: "eye", provider: "claude", model: "claude-opus-5-5", notes: "mine", extra: { keep: true } };
    const combo = (id, name, notes = `notes for ${id}`) => L.comboProfile({ id, name, notes, icon: "sparkles", color: "violet" });
    assert.deepEqual(combo("auto/coding", "Auto · coding"), { id: "ai-router:auto/coding", name: "Auto · coding", icon: "sparkles", color: "violet", provider: "ai-router", model: "auto/coding", notes: "notes for auto/coding" });

    const first = L.mergeAgentProfiles([mine, other], [combo("auto", "Auto"), combo("auto/coding", "Auto · coding")]);
    assert.equal(first.changed, true);
    assert.deepEqual(first.next.map((p) => p.id), ["legacy_favorite:codex:gpt-5.6-sol", "review", "ai-router:auto", "ai-router:auto/coding"], "new ones go at the end");
    assert.equal(first.next[0], mine, "a person's profile is the same object");
    assert.equal(first.next[1], other);

    // A person moved ours and gave one an icon and an effort: kept. A combo went away: its profile goes.
    const tweaked = [first.next[3], mine, { ...first.next[2], icon: "rocket", thinkingOptionId: "high" }, other];
    const second = L.mergeAgentProfiles(tweaked, [combo("auto", "Auto", "new words"), combo("auto/fast", "Auto · fast")]);
    assert.deepEqual(second.next.map((p) => p.id), ["legacy_favorite:codex:gpt-5.6-sol", "ai-router:auto", "review", "ai-router:auto/fast"]);
    assert.deepEqual(second.next[1], { id: "ai-router:auto", name: "Auto", icon: "rocket", color: "violet", provider: "ai-router", model: "auto", notes: "new words", thinkingOptionId: "high" }, "we set name, provider, model and notes; the rest is theirs");
    assert.equal(L.mergeAgentProfiles(second.next, [combo("auto", "Auto", "new words"), combo("auto/fast", "Auto · fast")]).changed, false, "nothing to do: unchanged");

    // Switch off: all of ours go, nobody else's.
    const off = L.mergeAgentProfiles(second.next, []);
    assert.deepEqual(off.next, [mine, other]);
    assert.equal(L.mergeAgentProfiles(undefined, []).changed, false, "no profiles at all is fine");
    assert.deepEqual(L.mergeAgentProfiles([{ id: "ai-router:x" }, { id: "ai-router:x" }], [combo("x", "X")]).next.length, 1, "a duplicate of ours is dropped");
    assert.equal(L.isOwnProfile({ id: "ai-routerx" }), false, "the prefix includes the colon");
  });

  check("config.json: combo profiles go to daemon.agentProfiles, a person's profiles byte for byte", () => {
    const mine = { id: "legacy_favorite:cursor:grok-4.5", name: "grok-4.5", provider: "cursor", model: "grok-4.5" };
    const config = { version: 1, daemon: { listen: "127.0.0.1:6767", agentProfiles: [mine] }, agents: { providers: { gemini: { extends: "acp", label: "Gemini", command: ["gemini"] } } } };
    const raw = JSON.stringify(config, null, 2);
    const profile = L.comboProfile({ id: "auto", name: "Auto", notes: "n", icon: "sparkles", color: "violet" });
    const next = L.withProviderEntries(raw, {}, [profile]);
    assert.equal(next.ok, true);
    assert.equal(next.changed, true);
    const written = JSON.parse(next.text);
    assert.deepEqual(written.daemon.agentProfiles, [mine, profile]);
    assert.equal("agentProfiles" in written, false, "never at the top level: Paseo's file schema is strict and keeps them under daemon");
    assert.deepEqual(written.agents, config.agents, "providers untouched when only profiles change");
    assert.ok(next.text.includes(JSON.stringify(mine, null, 2).split("\n").map((line, i) => (i ? `      ${line}` : line)).join("\n")), "the person's profile keeps its exact text");
    assert.equal(L.withProviderEntries(next.text, {}, [profile]).changed, false, "an unchanged set is not rewritten");
    const removed = JSON.parse(L.withProviderEntries(next.text, {}, []).text);
    assert.deepEqual(removed.daemon.agentProfiles, [mine], "switched off: ours removed, theirs kept");
    // A fresh daemon has no daemon section yet: one is made just for the profiles.
    const fresh = JSON.parse(L.withProviderEntries(JSON.stringify({ pluginsEnabled: true }), {}, [profile]).text);
    assert.deepEqual(fresh, { pluginsEnabled: true, daemon: { agentProfiles: [profile] } });
    assert.equal(L.withProviderEntries(JSON.stringify({ pluginsEnabled: true }), {}, []).changed, false, "nothing to remove: no daemon section is added");
    assert.equal(L.withProviderEntries(JSON.stringify({ version: 1, daemon: [] }), {}, [profile]).ok, false);
    assert.equal(L.withProviderEntries(JSON.stringify({ version: 1, daemon: { agentProfiles: {} } }), {}, [profile]).ok, false);
  });

  check("the switches default on and survive old settings documents; routing stays as saved", () => {
    const on = { mcpCard: true };
    assert.deepEqual(L.parseRoutingEnvelope(null), { routeAgents: false, comboProfiles: true, ...on });
    assert.deepEqual(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: true } })), { routeAgents: true, comboProfiles: true, ...on }, "a 0.7 document keeps routing on and gains the new switches");
    assert.deepEqual(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: false, comboProfiles: false } })), { routeAgents: false, comboProfiles: false, ...on });
    assert.deepEqual(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: true, contextBadge: false, mcpCard: false } })), { routeAgents: true, comboProfiles: true, mcpCard: false }, "0.18.0: the old Breakdown switch is read past");
    assert.equal(L.ROUTING_SETTINGS_VERSION, 1, "a new version would read every saved document as newer and turn routing off");
  });

  check("thinking levels: OmniRoute's effort tiers, else Paseo's own for the same model; only levels OmniRoute carries", () => {
    // Paseo's own levels, as `paseo provider models claude|codex` lists them.
    const opt = (ids, def) => ({ thinkingOptions: ids.map((id) => ({ id, label: { xhigh: "Extra High", max: "Max", off: "Off", ultracode: "Ultracode", ultra: "Ultra" }[id] ?? id[0].toUpperCase() + id.slice(1), ...(id === def ? { isDefault: true } : {}) })) });
    const native = L.nativeThinkingFrom([
      { provider: "claude", models: [
        { id: "claude-opus-5-5", ...opt(["low", "medium", "high", "xhigh", "max", "ultracode"], "medium"), defaultThinkingOptionId: "medium" },
        { id: "claude-sonnet-5", ...opt(["off", "low", "medium", "high", "xhigh", "max", "ultracode"], "high") },
        { id: "claude-haiku-4-5" },
      ] },
      { provider: "codex", models: [{ id: "gpt-6-sol", ...opt(["low", "medium", "high", "xhigh", "max", "ultra"], "xhigh"), defaultThinkingOptionId: "xhigh" }] },
      null,
    ]);
    assert.deepEqual(native["claude-haiku-4-5"], { options: [], defaultId: null });
    assert.equal(native["claude-sonnet-5"].defaultId, "high", "the default read from the marked option when no id is given");
    const ids = (levels) => levels?.map((o) => `${o.id}${o.isDefault ? "*" : ""}`);
    // cc/claude-opus-5-5: OmniRoute's tiers; "none" dropped (Paseo refuses "off" for gateway ids), Paseo's default kept.
    assert.deepEqual(ids(L.routedThinkingOptions({ provider: "claude", root: "claude-opus-5-5", tiers: ["none", "low", "medium", "high", "xhigh", "max"] }, native)), ["low", "medium*", "high", "xhigh", "max"]);
    assert.equal(L.routedThinkingOptions({ provider: "claude", root: "claude-opus-5-5", tiers: ["low", "xhigh"] }, native).find((o) => o.id === "xhigh").label, "Extra High", "Paseo's own label");
    // cx/gpt-6-sol: no tiers, so Paseo's Codex levels; "ultra" is not a Claude Code level and not proven, so left out.
    assert.deepEqual(ids(L.routedThinkingOptions({ provider: "codex", root: "gpt-6-sol", tiers: null }, native)), ["low", "medium", "high", "xhigh*", "max"]);
    // ultracode never, even when Paseo lists it and OmniRoute has no tiers.
    assert.deepEqual(ids(L.routedThinkingOptions({ provider: "claude", root: "claude-sonnet-5", tiers: null }, native)), ["low", "medium", "high*", "xhigh", "max"]);
    // Haiku: no levels in Paseo, none from OmniRoute: explicitly none, so no effort is sent.
    assert.deepEqual(L.routedThinkingOptions({ provider: "claude", root: "claude-haiku-4-5", tiers: null }, native), []);
    // Nothing known: Paseo's generic set (undefined), as before. Combos: always the generic set.
    assert.equal(L.routedThinkingOptions({ provider: "glm", root: "glm-5.2", tiers: null }, native), undefined);
    assert.equal(L.routedThinkingOptions({ provider: "combo", root: null, tiers: null }, native), undefined);
    assert.deepEqual(ids(L.routedThinkingOptions({ provider: "claude", root: "claude-opus-5-5", tiers: ["low", "high", "max"] }, null)), ["low", "high*", "max"], "no Paseo levels known yet: OmniRoute's tiers, default high");
    assert.deepEqual(L.ROUTED_EFFORT_IDS, ["low", "medium", "high", "xhigh", "max"]);

    const entry = L.aiRouterProviderEntry(REMOTE, [
      { id: "auto", label: "Combo · auto", provider: "combo", root: null, tiers: null },
      { id: "cc/claude-opus-5-5", label: "Claude · Opus 5.5", provider: "claude", root: "claude-opus-5-5", tiers: ["none", "low", "medium", "high", "xhigh", "max"] },
      { id: "cx/gpt-6-sol", label: "Codex · GPT-6 Sol", provider: "codex", root: "gpt-6-sol", tiers: null },
    ], native);
    assert.equal("thinkingOptions" in entry.models[0], false, "combos keep Paseo's generic levels");
    assert.deepEqual(ids(entry.models[1].thinkingOptions), ["low", "medium*", "high", "xhigh", "max"]);
    assert.deepEqual(ids(entry.models[2].thinkingOptions), ["low", "medium", "high", "xhigh*", "max"]);
    // A change of levels alone is a change to write; the same levels are not.
    const bare = L.aiRouterProviderEntry(REMOTE, [{ id: "cc/claude-opus-5-5", label: "Claude · Opus 5.5", provider: "claude", root: "claude-opus-5-5", tiers: null }], null);
    assert.equal(L.sameProviderEntry(bare, entry), false);
    assert.equal(L.sameProviderEntry(JSON.parse(JSON.stringify(entry)), entry), true);
  });

  check("public address: stored as consoleUrl, read as its origin, dashboard beneath it", () => {
    assert.equal(L.publicAddress({ consoleUrl: "https://ai-router.example.com" }), "https://ai-router.example.com");
    assert.equal(L.publicAddress({ consoleUrl: "https://ai-router.example.com/dashboard/" }), "https://ai-router.example.com", "an old saved dashboard URL still works");
    assert.equal(L.publicAddress({ consoleUrl: null }), null);
    assert.equal(L.privateDashboardUrl({ endpoint: REMOTE }), `${REMOTE}/dashboard`);
    const merged = L.mergeConnection(L.resolveConnection(null, {}).connection, { endpoint: REMOTE, consoleUrl: "https://ai-router.example.com/dashboard" });
    assert.equal(merged.value.consoleUrl, "https://ai-router.example.com", "saved as the bare address");
    assert.match(L.mergeConnection(merged.value, { endpoint: REMOTE, consoleUrl: "not a url" }).error, /not a usable public address/);
    const env = L.resolveConnection(null, { AI_ROUTER_URL: REMOTE, AI_ROUTER_KEY: "sk", AI_ROUTER_CONSOLE_URL: "https://ai-router.example.com" });
    assert.equal(L.publicAddress(env.connection), "https://ai-router.example.com", "seeded from AI_ROUTER_CONSOLE_URL");
    const saved = L.resolveConnection(JSON.stringify({ endpoint: REMOTE, apiKey: "sk", consoleUrl: "https://mine.example.com" }), { AI_ROUTER_URL: LOCAL, AI_ROUTER_CONSOLE_URL: "https://env.example.com" });
    assert.equal(L.publicAddress(saved.connection), "https://mine.example.com", "same precedence: saved wins");
  });

  check("public address status: DNS, TLS, HTTP and network failures each say what to fix", () => {
    const url = "https://ai-router.example.com";
    const failing = (code, message = "fetch failed") => ({ error: Object.assign(new TypeError("fetch failed"), { cause: { code, message } }) });
    const state = (input) => { const c = L.classifyPublicCheck(input, url); return [c.state, c.label]; };
    assert.deepEqual(state({ status: 200, body: { status: "ok" } }), ["ok", "HTTPS OK · ai-router.example.com"]);
    assert.deepEqual(L.classifyPublicCheck({ status: 200, body: { status: "ok" } }, "http://ai-router.example.com").label, "HTTP OK · ai-router.example.com");
    assert.match(L.classifyPublicCheck({ status: 200, body: { status: "ok" } }, "http://ai-router.example.com").detail, /without HTTPS/);
    assert.deepEqual(state(failing("ENOTFOUND")), ["dns", "DNS not pointing here yet"]);
    assert.deepEqual(state(failing("EAI_AGAIN")), ["dns", "DNS not pointing here yet"]);
    assert.deepEqual(state(failing("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR")), ["tls", "Certificate not issued yet"], "Caddy before its certificate");
    assert.deepEqual(state(failing("ECONNRESET", "Client network socket disconnected before secure TLS connection was established")), ["tls", "Certificate not issued yet"], "a TLS server with no certificate for the name (measured with Node's fetch)");
    assert.deepEqual(state(failing("DEPTH_ZERO_SELF_SIGNED_CERT")), ["tls", "Certificate not issued yet"]);
    assert.deepEqual(state(failing("ERR_TLS_CERT_ALTNAME_INVALID")), ["tls", "Certificate is for another name"]);
    assert.deepEqual(state(failing("CERT_HAS_EXPIRED")), ["tls", "Certificate expired"]);
    assert.deepEqual(state(failing("ERR_SSL_PACKET_LENGTH_TOO_LONG")), ["tls", "Not serving HTTPS on this address"]);
    assert.deepEqual(state(failing("ECONNREFUSED")), ["unreachable", "Unreachable"]);
    assert.deepEqual(state(failing("ECONNRESET", "socket hang up")), ["unreachable", "Unreachable"]);
    assert.deepEqual(state({ error: Object.assign(new Error("aborted"), { name: "AbortError" }) }), ["unreachable", "Unreachable"]);
    assert.deepEqual(state({ status: 502, body: null }), ["http", "HTTPS works, but OmniRoute behind it is not answering (502)"]);
    assert.deepEqual(state({ status: 404, body: null })[0], "http");
    assert.deepEqual(state({ status: 200, body: "<html>" }), ["http", "Answers, but not as OmniRoute"]);
    assert.match(L.classifyPublicCheck(failing("ENOTFOUND"), url).detail, /ai-router\.example\.com does not resolve \(ENOTFOUND\)/);
  });

  check("share snippets: the public address, a placeholder key, never a real one", () => {
    const snippets = L.shareSnippets("https://ai-router.example.com/");
    assert.deepEqual(snippets.map((s) => s.id), ["claude", "codex", "paseo"]);
    assert.equal(snippets[0].text, "export ANTHROPIC_BASE_URL=https://ai-router.example.com\nexport ANTHROPIC_AUTH_TOKEN=<your key>\nexport CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1\nexport CLAUDE_CODE_DISABLE_FAST_MODE=1");
    assert.equal(snippets[0].text.includes("/v1"), false, "Claude Code takes the root");
    assert.match(snippets[0].why, /beta header/);
    assert.match(snippets[1].text, /base_url = "https:\/\/ai-router\.example\.com\/v1"/);
    assert.match(snippets[1].text, /wire_api = "responses"/);
    assert.ok(snippets[1].text.indexOf('model_provider = "omniroute"') < snippets[1].text.indexOf("[model_providers"), "TOML: the top-level key before the table");
    assert.match(snippets[2].text, /paseo plugin install git:https:\/\/github\.com\/itsjustanks\/paseo-plugin-ai-router\.git:apps\/paseo/);
    assert.match(snippets[2].text, /AI_ROUTER_URL=https:\/\/ai-router\.example\.com\n/);
    for (const s of snippets) assert.equal(/sk-[A-Za-z0-9]|oma_live_/.test(s.text), false, "no key-shaped text");
  });

  // ------------------------------------------------------------ activity
  check("session header", () => {
    assert.equal(L.SESSION_HEADER, "x-omniroute-session-id");
    assert.equal(L.withSessionHeader(undefined, "agent-1"), "x-omniroute-session-id: paseo-agent-1");
    assert.equal(L.withSessionHeader("", "agent-1"), "x-omniroute-session-id: paseo-agent-1");
    assert.equal(L.withSessionHeader("X-Team: blue\nX-Cost-Centre: 42", "agent-1"), "X-Team: blue\nX-Cost-Centre: 42\nx-omniroute-session-id: paseo-agent-1", "the person's headers first, untouched");
    assert.equal(L.withSessionHeader("X-Omniroute-Session-Id: mine", "agent-1"), "X-Omniroute-Session-Id: mine", "a session id the person set wins");
    assert.equal(L.agentIdFromTag("paseo-agent-1"), "agent-1");
    assert.equal(L.agentIdFromTag("paseo-"), null);
    assert.equal(L.agentIdFromTag("someone-else"), null, "only tags this plugin sends");
    assert.equal(L.agentIdFromTag(null), null);
    assert.equal(L.agentIdFromTag(L.sessionTagFor("3f2a-77")), "3f2a-77", "round trip");
  });

  check("session log ring buffer", () => {
    const entry = (i) => ({ at: new Date(Date.UTC(2026, 8, 23, 0, 0, i)).toISOString(), agentId: `agent-${i}`, kind: "claude", provider: "claude", reason: null, routed: true, tagged: true });
    let log = [];
    for (let i = 0; i < 205; i += 1) log = L.pushSession(log, entry(i));
    assert.equal(log.length, L.SESSION_LOG_SIZE);
    assert.deepEqual([log[0].agentId, log.at(-1).agentId], ["agent-5", "agent-204"], "newest last, oldest dropped");
    assert.deepEqual(L.pushSession([entry(1)], entry(2), 1).map((e) => e.agentId), ["agent-2"]);
    assert.deepEqual(L.parseSessionLog(JSON.stringify(log)), log, "round trip through the file");
    assert.deepEqual(L.parseSessionLog(null), []);
    assert.deepEqual(L.parseSessionLog("{ not json"), [], "a damaged file reads as empty, not a crash");
    assert.deepEqual(L.parseSessionLog(JSON.stringify({ entries: [] })), []);
    const mixed = [entry(1), { agentId: 7 }, { ...entry(2), kind: "gemini" }, { ...entry(3), reason: "no API key set", routed: false }, "junk"];
    assert.deepEqual(L.parseSessionLog(JSON.stringify(mixed)).map((e) => [e.agentId, e.routed, e.reason]), [["agent-1", true, null], ["agent-3", false, "no API key set"]], "only well-formed entries are kept");
    const big = Array.from({ length: 250 }, (_, i) => entry(i));
    assert.equal(L.parseSessionLog(JSON.stringify(big)).length, 200, "a longer file is cut to the last 200");
  });

  // ------------------------------------------------------ chat alerts and tabs
  const alertsSource = readFileSync(new URL("../apps/paseo/shared/alerts.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "alerts.mjs"), ts.transpileModule(alertsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const X = await import(join(staging, "alerts.mjs"));
  const tabsSource = readFileSync(new URL("../apps/paseo/shared/tabs.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "tabs.mjs"), ts.transpileModule(tabsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const T = await import(join(staging, "tabs.mjs"));
  const reSource = readFileSync(new URL("../apps/paseo/shared/router-errors.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "router-errors.mjs"), ts.transpileModule(reSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const RE = await import(join(staging, "router-errors.mjs"));
  const ERRORS = JSON.parse(readFileSync(new URL("./fixtures/router-errors.json", import.meta.url), "utf8"));
  const pluginsSource = readFileSync(new URL("../apps/paseo/shared/plugins.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "plugins.mjs"), ts.transpileModule(pluginsSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const P = await import(join(staging, "plugins.mjs"));

  const hostSource = readFileSync(new URL("../apps/paseo/shared/host-features.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "host-features.mjs"), ts.transpileModule(hostSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const HF = await import(join(staging, "host-features.mjs"));

  check("router errors: real OmniRoute errors from chats are recognised; nothing else is", () => {
    assert.ok(ERRORS.length >= 30, "the fixture holds the real strings");
    for (const e of ERRORS) {
      const m = RE.matchRouterError(e.text, e.source);
      assert.equal(m?.kind ?? null, e.kind, `${e.kind ?? "not a router error"}: ${e.text.slice(0, 90)}`);
      if (e.provider) assert.equal(m.provider, e.provider, e.text.slice(0, 60));
    }
    const kinds = new Set(ERRORS.map((e) => e.kind).filter(Boolean));
    for (const kind of ["paused", "cooling", "no-account", "signed-out", "outdated", "unsupported", "unavailable", "other"]) assert.ok(kinds.has(kind), `a ${kind} example`);
    // A reply that merely talks about the router is never touched; only error-shaped items are.
    assert.equal(RE.matchRouterError("The router said: [claude/claude-opus-5-5] [429]: rate limited (reset after 1m)", "assistant"), null);
    assert.equal(RE.matchRouterError("API Error: 529 Overloaded", "assistant"), null, "Anthropic's own error, no router mark");
    assert.equal(RE.matchRouterError(`API Error: 503 ${"x".repeat(7000)} check your inference gateway (h:1)`, "assistant"), null, "too long to be an error line");
    const cooling = RE.matchRouterError(ERRORS.find((e) => e.kind === "cooling").text, "assistant");
    assert.ok(cooling.resetSeconds > 0 && cooling.gateway, "reset time and gateway are read");
  });

  check("router errors: the reset time, the plain words, and whose chat it is", () => {
    assert.deepEqual(["(reset after 1m 9s)", "(reset after 29s)", "(reset after 2h 5m)", "(reset after 0s)", "no reset"].map(RE.resetSecondsOf), [69, 29, 7500, 0, null]);
    assert.deepEqual([69, 29, 7500, 0].map(RE.waitWords), ["1m 9s", "29s", "2h 5m", "0s"]);
    const label = (id) => ({ claude: "Claude", codex: "Codex" })[id] ?? id;
    const at = new Date(2026, 9, 6, 16, 40, 0);
    const cool = RE.routerErrorWords({ kind: "cooling", provider: "claude", model: "claude-fable-5-1", status: 429, resetSeconds: 300, gateway: null }, at, label);
    assert.match(cool.title, /^Claude accounts are cooling down until \d{1,2}:45/, "until = when it happened + the reset");
    assert.match(cool.retry, /This chat won't retry/);
    const paused = RE.routerErrorWords({ kind: "paused", provider: "claude", model: null, status: 503, resetSeconds: null, gateway: null }, at, label);
    assert.equal(paused.title, "Claude is paused on the router after repeated errors");
    assert.match(paused.retry, /OmniRoute tries Claude again by itself/);
    for (const kind of ["paused", "cooling", "no-account", "signed-out", "outdated", "unsupported", "unavailable", "router-down", "other"]) {
      const words = RE.routerErrorWords({ kind, provider: null, model: null, status: null, resetSeconds: null, gateway: null }, at, label);
      assert.ok(words.title && words.retry && words.icon, kind);
      assert.ok(!/undefined|null/.test(words.title + words.retry), `${kind}: no holes in the words`);
    }
    assert.equal(RE.endpointHost("http://10.0.0.5:20128"), "10.0.0.5:20128");
    assert.equal(RE.endpointHost("https://ai-router.example.com"), "ai-router.example.com:443");
    assert.equal(RE.endpointHost("not a url"), null);
    const viaGateway = { kind: "cooling", provider: "claude", model: null, status: 429, resetSeconds: 60, gateway: "10.0.0.5:20128" };
    const otherGateway = { ...viaGateway, gateway: "proxy.example.com:8080" };
    const noGateway = { ...viaGateway, gateway: null };
    assert.equal(RE.isOurs(viaGateway, false, "http://10.0.0.5:20128"), true, "Claude Code names this router: ours, whatever the log says");
    assert.equal(RE.isOurs(otherGateway, true, "http://10.0.0.5:20128"), true, "the log says this router routed it");
    assert.equal(RE.isOurs(otherGateway, false, "http://10.0.0.5:20128"), false, "its own sign-in: never touched");
    assert.equal(RE.isOurs(otherGateway, null, "http://10.0.0.5:20128"), false, "someone else's gateway: never touched");
    assert.equal(RE.isOurs(noGateway, null, "http://10.0.0.5:20128"), true, "OmniRoute's own marks, no other gateway named");
    assert.equal(RE.isOurs(noGateway, false, null), false);
  });

  check("chip face: only a router problem gives a chat a chip (0.18.0)", () => {
    assert.equal(X.alertChipFace(null), null, "a calm chat: no chip");
    const down = X.alertChipFace({ text: "Router down" });
    assert.deepEqual(down, { label: "Router down", icon: "TriangleAlert", spoken: "Router down: open AI Router" }, "the icon carries the warning, not colour alone");
    assert.equal(X.alertChipFace({ text: "Claude paused" })?.label, "Claude paused");
    // What Paseo's validateButton asks of a button: a non-empty title and label, a Lucide name.
    assert.ok(down.label.trim().length > 0);
    assert.ok(/^[A-Z][A-Za-z]+$/.test(down.icon));
    assert.ok(/^[a-z][a-z0-9-]*$/.test("router-alert"), "the chip id passes the app's id rule");
  });

  check("tabs: four, and every old tab id lands on its new tab with its fold-outs open", () => {
    assert.deepEqual([...T.TAB_IDS], ["overview", "accounts", "models", "help"]);
    assert.equal(T.TAB_IDS.length <= 4, true, "four tabs at most");
    assert.deepEqual([...T.LEGACY_TAB_IDS], ["overview", "activity", "models", "providers", "accounts", "usage", "settings", "connection", "tips"]);
    const where = Object.fromEntries(T.LEGACY_TAB_IDS.map((id) => [id, T.resolveTarget(id).tab]));
    assert.deepEqual(where, { overview: "overview", activity: "overview", models: "models", providers: "models", accounts: "accounts", usage: "accounts", settings: "help", connection: "help", tips: "help" });
    assert.deepEqual(T.resolveTarget("activity").open, ["traffic"]);
    assert.deepEqual(T.resolveTarget("connection").open, ["connection", "keys", "share", "dashboard"]);
    assert.deepEqual(T.resolveTarget("settings").open, ["in-paseo", "compression", "router-settings", "more"]);
    assert.deepEqual(T.resolveTarget("tips").open, ["tips"]);
    assert.ok(T.resolveTarget("usage").open.includes("usage-days"));
    assert.deepEqual(T.resolveTarget("providers").open, ["codex-extras", "tidy", "agent-apps"]);
    for (const id of T.TAB_IDS) assert.deepEqual(T.resolveTarget(id).tab, id, `${id} is its own tab`);
    // 0.20.0: the window title follows the tab; Overview, unknown and missing ids read just "AI Router".
    assert.deepEqual(T.TAB_IDS.map((id) => T.screenTitle({ tab: id })), ["AI Router", "AI Router · Accounts", "AI Router · Models", "AI Router · Help"]);
    assert.equal(T.screenTitle({}), "AI Router");
    assert.equal(T.screenTitle(undefined), "AI Router");
    assert.equal(T.screenTitle({ tab: "nonsense" }), "AI Router");
    assert.equal(T.screenTitle({ tab: "connection", open: "keys" }), "AI Router · Help", "an old tab id titles its new home");
    // 0.21.0: the host, when known.
    assert.equal(T.screenTitle({}, "team-server"), "AI Router · team-server");
    assert.equal(T.screenTitle({ tab: "accounts" }, "team-server"), "AI Router · team-server · Accounts");
    assert.equal(T.screenTitle({ tab: "models" }, null), "AI Router · Models");
    assert.deepEqual(T.resolveTarget(" Connection "), T.resolveTarget("connection"), "case and spaces from a URL don't matter");
    assert.deepEqual(T.resolveTarget("nowhere"), { tab: "overview", open: [] }, "an unknown id lands on Overview");
    assert.deepEqual(T.resolveTarget(null), { tab: "overview", open: [] });
    assert.deepEqual(T.resolveTarget("help", "tips, keys"), { tab: "help", open: ["tips", "keys"] }, "a screen's open param adds fold-outs");
    assert.deepEqual(T.resolveTarget("tips", "tips,more"), { tab: "help", open: ["tips", "more"] }, "without repeats");
  });

  check("host features: buttons from 0.8.0 stable (addHeaderButton); agent observations from 0.9 (observeEvents)", () => {
    assert.equal(HF.supportsButtonPills({ addComposerPill() {}, addHeaderButton() {} }), true);
    assert.equal(HF.supportsButtonPills({ addComposerPill() {} }), false, "the 0.8.0-beta.1 shape");
    assert.equal(HF.supportsButtonPills({ addHeaderButton: "yes" }), false, "only a function counts");
    assert.equal(HF.supportsButtonPills(null), false);
    assert.equal(HF.supportsButtonPills(undefined), false);
    assert.equal(HF.canObserveAgents({ observeEvents() {}, agents: {} }), true);
    assert.equal(HF.canObserveAgents({ agents: {} }), false, "a 0.8 app: never send subscribe");
    assert.equal(HF.canObserveAgents(null), false);
  });

  check("router alerts reach the routed chats they affect, by each chat's latest open", () => {
    const label = (id) => ({ claude: "Claude", codex: "Codex" })[id] ?? id;
    const sessions = [
      { agentId: "c1", kind: "claude", routed: true },
      { agentId: "c2", kind: "claude", routed: false },
      { agentId: "x1", kind: "codex", routed: true },
      { agentId: "p1", kind: "provider", routed: true },
      { agentId: "c3", kind: "claude", routed: true },
      { agentId: "c3", kind: "claude", routed: false },
    ];
    assert.deepEqual(X.chatAlerts({ down: null, paused: [], sessions, label }), [], "all well: nothing");
    const down = X.chatAlerts({ down: "connection refused", paused: [], sessions, label });
    assert.deepEqual(down.map((a) => [a.agentId, a.text]), [["c1", "Router down"], ["x1", "Router down"], ["p1", "Router down"]], "every routed chat; a chat whose latest open was not routed is left alone");
    assert.match(down[0].detail, /isn't answering \(connection refused\).*own sign-in/);
    assert.match(down[2].detail, /AI Router chat can't reopen/);
    const paused = X.chatAlerts({ down: null, paused: ["claude"], sessions, label });
    assert.deepEqual(paused.map((a) => [a.agentId, a.text]), [["c1", "Claude paused"], ["p1", "Claude paused"]], "Codex chats are not reached by a Claude pause");
    assert.match(paused[1].detail, /^OmniRoute has paused Claude after repeated failures\. If this chat's model runs there/);
  });

  check("recommended plugins: Paseo Cafe ids, one install command each", () => {
    const ids = P.RECOMMENDED_PLUGINS.map((p) => p.id);
    assert.deepEqual(ids, ["paseo-mcp", "remote-editor", "tell-agent"], "Shared Browser, Advanced Markdown and (0.18.0) Activity are no longer recommended");
    assert.equal(new Set(ids).size, ids.length);
    for (const plugin of P.RECOMMENDED_PLUGINS) assert.match(plugin.install, /^paseo plugin add \S+/, plugin.id);
    assert.equal(P.paseoCafeUrl("tell-agent"), "https://paseo.cafe/plugins/tell-agent/");
  });


  // ------------------------------------------------- built-in Codex re-route
  check("Codex: the switch's mapping is truthful", () => {
    assert.deepEqual(["claude", "codex", "ai-router", "codex-ai-router", "copilot", "cursor"].map(L.throughRouter), ["claude-toggle", "codex-toggle", "is-router", "is-router", "none", "none"], "built-in Codex has its own switch; only the rest are 'not switched here'");
  });

  check("Codex: the launch command carries OmniRoute, never the key", () => {
    const command = L.codexRerouteCommand(REMOTE);
    assert.deepEqual(command, ["codex", "-c", "model_provider=ai-router", "-c", `model_providers.ai-router={name="AI Router",base_url="${REMOTE}/v1",env_key="AI_ROUTER_API_KEY",wire_api="responses"}`]);
    assert.ok(!command.join(" ").includes("sk-"), "only the name of the key's variable");
    assert.equal(L.codexRerouteCommand('http://evil"host'), null, "nothing that could break out of the TOML string");
    assert.equal(L.codexRerouteCommand("http://a b"), null);
  });

  check("Codex: reading the entry tells ours, someone else's and none apart", () => {
    assert.deepEqual(L.codexRerouteState(undefined), { state: "off", baseUrl: null });
    assert.deepEqual(L.codexRerouteState({ enabled: true }), { state: "off", baseUrl: null });
    assert.deepEqual(L.codexRerouteState({ command: L.codexRerouteCommand(REMOTE) }), { state: "on", baseUrl: `${REMOTE}/v1` });
    assert.deepEqual(L.codexRerouteState({ command: ["/opt/bin/codex", "--profile", "work"] }), { state: "foreign", baseUrl: null }, "a person's own command is never ours");
    assert.deepEqual(L.codexRerouteState({ command: ["codex", "-c", "model_provider=ai-router"] }), { state: "foreign", baseUrl: null }, "half of ours is not ours");
  });

  check("Codex: session_open adds the key only for our command, at our address", () => {
    const resolved = configured(REMOTE);
    const on = { state: "on", baseUrl: `${REMOTE}/v1` };
    assert.deepEqual(L.routeBuiltinCodex({ reroute: { state: "off", baseUrl: null }, resolved }), { action: "ignore" });
    assert.deepEqual(L.routeBuiltinCodex({ reroute: { state: "foreign", baseUrl: null }, resolved }), { action: "ignore" });
    assert.deepEqual(L.routeBuiltinCodex({ reroute: on, resolved }), { action: "route", kind: "codex", env: { AI_ROUTER_API_KEY: "sk-test" } });
    const moved = L.routeBuiltinCodex({ reroute: { state: "on", baseUrl: "http://old:20128/v1" }, resolved });
    assert.equal(moved.action, "skip", "the key never goes to an address other than the saved endpoint");
    assert.match(moved.reason, /points at http:\/\/old:20128\/v1, not http:\/\/10\.0\.0\.5:20128\/v1; the next model sync updates it/);
    const keyless = L.routeBuiltinCodex({ reroute: on, resolved: configured(REMOTE, null) });
    assert.equal(keyless.action, "skip");
  });

  // --------------------------------------------------------- agent apps
  const clisSource = readFileSync(new URL("../apps/paseo/shared/clis.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "clis.mjs"), ts.transpileModule(clisSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const C = await import(join(staging, "clis.mjs"));

  check("agent apps: how each copy was installed, from where it really lives", () => {
    assert.deepEqual(C.detectInstall("codex", "/opt/npm-global/lib/node_modules/@openai/codex/bin/codex.js"), { kind: "npm", prefix: "/opt/npm-global" }, "fleet container");
    assert.deepEqual(C.detectInstall("claude", "/opt/npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe"), { kind: "npm", prefix: "/opt/npm-global" });
    assert.deepEqual(C.detectInstall("codex", "/Users/me/.npm-global/lib/node_modules/@openai/codex/bin/codex.js"), { kind: "npm", prefix: "/Users/me/.npm-global" }, "Mac npm");
    assert.deepEqual(C.detectInstall("claude", "/Users/me/.local/share/claude/versions/2.1.289"), { kind: "claude-native", root: "/Users/me/.local/share/claude" }, "Claude's own installer");
    assert.deepEqual(C.detectInstall("codex", "/opt/homebrew/Caskroom/codex/0.160.0/codex"), { kind: "homebrew" });
    assert.deepEqual(C.detectInstall("claude", "/usr/local/Caskroom/claude-code/2.1.289/claude"), { kind: "homebrew" });
    assert.deepEqual(C.detectInstall("codex", "/opt/agent-home/.codex/packages/standalone/releases/0.156.1-x86_64-unknown-linux-musl/bin/codex"), { kind: "codex-standalone" });
    assert.deepEqual(C.detectInstall("claude", "/opt/claude-code/claude"), { kind: "unknown" }, "a copy baked into an image");
    assert.deepEqual(C.detectInstall("codex", "/opt/npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe"), { kind: "unknown" }, "the other app's package is not this one");
  });

  check("agent apps: the install folder is split off so the panel can fold it (0.20.0)", () => {
    assert.deepEqual(C.installPlace("npm, in /opt/npm-global"), { how: "npm", where: "/opt/npm-global" });
    assert.deepEqual(C.installPlace("Claude Code's own installer"), { how: "Claude Code's own installer", where: null });
    assert.deepEqual(C.installPlace("not known"), { how: "some other way", where: null });
    assert.deepEqual(C.installPlace("Homebrew"), { how: "Homebrew", where: null });
  });

  check("agent apps: a button only when the method is known and writable; otherwise the exact command", () => {
    const npm = C.updatePlan("codex", { kind: "npm", prefix: "/opt/npm-global" }, { binPath: "/opt/npm-global/bin/codex", writable: true, npm: "/usr/local/bin/npm" });
    assert.deepEqual(npm, { method: "npm, in /opt/npm-global", command: "npm install -g @openai/codex@latest --prefix /opt/npm-global", run: { file: "/usr/local/bin/npm", args: ["install", "-g", "@openai/codex@latest", "--prefix", "/opt/npm-global"] }, why: null });
    const locked = C.updatePlan("codex", { kind: "npm", prefix: "/usr/lib" }, { binPath: "/usr/bin/codex", writable: false, npm: "/usr/bin/npm" });
    assert.equal(locked.run, null);
    assert.equal(locked.command, "npm install -g @openai/codex@latest --prefix /usr/lib");
    assert.match(locked.why, /can't write to \/usr\/lib/);
    assert.equal(C.updatePlan("codex", { kind: "npm", prefix: "/p" }, { binPath: "/p/bin/codex", writable: true, npm: null }).run, null, "no npm, no button");
    assert.deepEqual(C.updatePlan("claude", { kind: "claude-native", root: "/h/.local/share/claude" }, { binPath: "/h/.local/bin/claude", writable: true, npm: null }).run, { file: "/h/.local/bin/claude", args: ["update"] });
    const brew = C.updatePlan("claude", { kind: "homebrew" }, { binPath: "/opt/homebrew/bin/claude", writable: true, npm: "/opt/homebrew/bin/npm" });
    assert.deepEqual([brew.command, brew.run], ["brew upgrade --cask claude-code", null]);
    assert.deepEqual([C.updatePlan("codex", { kind: "codex-standalone" }, { binPath: "x", writable: true, npm: "npm" }).command, C.updatePlan("codex", { kind: "codex-standalone" }, { binPath: "x", writable: true, npm: "npm" }).run], [null, null]);
    const unknown = C.updatePlan("claude", { kind: "unknown" }, { binPath: "/opt/claude-code/claude", writable: true, npm: "npm" });
    assert.equal(unknown.run, null);
    assert.match(unknown.why, /can't tell how \/opt\/claude-code\/claude was installed/);
  });

  check("agent apps: versions", () => {
    assert.equal(C.parseVersion("2.1.289 (Claude Code)"), "2.1.289");
    assert.equal(C.parseVersion("codex-cli 0.160.0"), "0.160.0");
    assert.equal(C.parseVersion("nothing"), null);
    assert.ok(C.compareVersions("0.156.1", "0.160.0") < 0);
    assert.ok(C.compareVersions("2.1.289", "2.1.289") === 0);
    assert.ok(C.compareVersions("0.161.0-alpha.1", "0.161.0") < 0, "a pre-release sorts before its release");
    assert.ok(C.compareVersions("1.10.0", "1.9.9") > 0, "numbers, not strings");
    assert.deepEqual([C.versionState("0.156.1", "0.160.0", true), C.versionState("2.1.289", "2.1.289", true), C.versionState("0.161.0", "0.160.0", true), C.versionState("0.160.0", null, true), C.versionState(null, "0.160.0", false)], ["behind", "current", "ahead", "unknown", "missing"]);
    assert.deepEqual(C.tailLines(["a"], "\u001b[32madded 1 package\u001b[0m\r\nok\n\n", 2), ["added 1 package", "ok"], "colour codes go, the last lines stay");
  });

  // ------------------------------------------------------------ 0.16.0
  // updates.ts imports compareVersions from ./clis; point it at the staged copy.
  const updatesSource = readFileSync(new URL("../apps/paseo/shared/updates.ts", import.meta.url), "utf8");
  writeFileSync(join(staging, "updates.mjs"), ts.transpileModule(updatesSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('from "./clis"', 'from "./clis.mjs"'));
  const U = await import(join(staging, "updates.mjs"));

  check("updates: plugin version matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../apps/paseo/package.json", import.meta.url), "utf8"));
    assert.equal(U.PLUGIN_VERSION, pkg.version);
  });

  check("updates: versions, states and the newest real release", () => {
    assert.deepEqual([U.versionOf("v3.8.51"), U.versionOf("0.16.0-rc.1"), U.versionOf("radar-export-latest"), U.versionOf(null)], ["3.8.51", "0.16.0-rc.1", null, null]);
    assert.deepEqual([U.updateState("3.8.51", "3.8.52"), U.updateState("3.8.51", "3.8.51"), U.updateState("0.16.0", "0.15.1"), U.updateState(null, "3.8.51"), U.updateState("3.8.51", null), U.updateState("custom", "3.8.51")], ["behind", "current", "ahead", "unknown", "unknown", "unknown"]);
    assert.equal(U.updateState("3.8.51-toolcap", "3.8.51"), "behind", "a pre-release suffix sorts before its release");
    const releases = [
      { tag_name: "radar-export-latest", published_at: "2026-10-01T00:00:00Z", body: "not a version" },
      { tag_name: "v3.8.53-rc.1", prerelease: true, body: "- **pre**" },
      { tag_name: "v3.8.52", draft: true, body: "- **draft**" },
      { tag_name: "v3.8.50", published_at: "2026-08-26T19:30:30Z", html_url: "https://github.com/o/r/releases/tag/v3.8.50", body: "- old" },
      { tag_name: "v3.8.51", published_at: "2026-09-30T01:41:50Z", html_url: "https://github.com/o/r/releases/tag/v3.8.51", body: "# OmniRoute v3.8.51\n\n**2,022 documented changes**.\n\n| a | b |\n\n## Highlights\n\n- **Providers and catalogs** (42 provider features): new gateways, [GPT-6](https://x) in `cx`.\n- **Routing and resilience**: hierarchical concurrency admission,\n  adaptive reasoning effort.\n- **Proxies**: pools stop re-serving.\n- **Fourth**: dropped.\n\n## Other\n\n- not a highlight" },
    ];
    const latest = U.pickLatestRelease(releases);
    assert.deepEqual([latest.version, latest.tag, latest.publishedAt, latest.url], ["3.8.51", "v3.8.51", "2026-09-30T01:41:50Z", "https://github.com/o/r/releases/tag/v3.8.51"]);
    assert.deepEqual(latest.highlights, ["Providers and catalogs (42 provider features): new gateways, GPT-6 in cx.", "Routing and resilience: hierarchical concurrency admission, adaptive reasoning effort.", "Proxies: pools stop re-serving."], "three highlight bullets, wrapped lines joined, markdown gone");
    assert.equal(U.pickLatestRelease([{ tag_name: "nightly" }]), null);
    assert.equal(U.pickLatestRelease({ message: "API rate limit exceeded" }), null, "GitHub's error object is no release");
  });

  check("updates: highlights from any release body, never the whole body", () => {
    assert.deepEqual(U.releaseHighlights("A hotfix: the chip shows again.\n\n- **The chip is a button on Paseo 0.8.0 stable and later.** Those apps take chips as buttons.\n- **Agents are followed on Paseo 0.9 and later.** Since 0.9…\n- Found by the paseo-mcp agent."), ["The chip is a button on Paseo 0.8.0 stable and later.", "Agents are followed on Paseo 0.9 and later.", "Found by the paseo-mcp agent."], "a bold sentence stands alone");
    assert.deepEqual(U.releaseHighlights("# Title\n\n📄 Complete notes attached.\n\nJust one plain paragraph about the release."), ["Just one plain paragraph about the release."]);
    assert.deepEqual(U.releaseHighlights(null), []);
    const long = U.releaseHighlights(`- ${"word ".repeat(80)}`)[0];
    assert.ok(long.length <= 140 && long.endsWith("…"), "long lines are clipped at a word");
  });

  check("updates: the Overview's Versions line and each product's sentence", () => {
    const product = (label, running, latest, state, error = null) => ({ label, running, latest: latest ? { version: latest, tag: `v${latest}`, publishedAt: null, url: "", highlights: [] } : null, state, changelogUrl: "", error });
    const router = product("OmniRoute", "3.8.51", "3.8.51", "current");
    const plugin = product("AI Router", "0.16.0", "0.16.0", "current");
    assert.deepEqual(U.versionsLine(router, plugin), { value: "Up to date", tone: "success", hint: "OmniRoute 3.8.51 · AI Router 0.16.0" });
    assert.deepEqual(U.versionsLine(product("OmniRoute", "3.8.51", "3.8.52", "behind"), plugin), { value: "OmniRoute 3.8.52 available", tone: "warning", hint: "OmniRoute 3.8.51 · AI Router 0.16.0" });
    assert.equal(U.versionsLine(product("OmniRoute", "3.8.51", "3.8.52", "behind"), product("AI Router", "0.15.1", "0.16.0", "behind")).value, "2 updates available");
    assert.deepEqual(U.versionsLine(product("OmniRoute", null, "3.8.51", "unknown"), plugin), { value: "AI Router up to date", tone: "success", hint: "OmniRoute version needs a read token · AI Router 0.16.0" }, "a key-only daemon can't see the router's version");
    assert.equal(U.versionsLine(product("OmniRoute", null, null, "unknown"), product("AI Router", "0.16.0", null, "unknown")).value, "Not checked yet");
    assert.equal(U.updateLine(product("OmniRoute", "3.8.51", "3.8.52", "behind")), "3.8.52 is out; you run 3.8.51.");
    assert.equal(U.updateLine(router), "You run 3.8.51, the newest release.");
    assert.match(U.updateLine(product("AI Router", "0.16.0", "0.15.1", "ahead")), /newer than the latest release \(0\.15\.1\): a preview or custom build/);
    assert.equal(U.updateLine(product("OmniRoute", "3.8.51", null, "unknown", "GitHub's rate limit")), "Couldn't check for OmniRoute releases (GitHub's rate limit).");
  });

  check("Codex row: say what OmniRoute has first", () => {
    assert.deepEqual(L.codexRowState({ accounts: 4, models: 30, synced: true }), { state: "connected", text: "4 Codex accounts connected in OmniRoute; their 30 models are in the AI Router provider.", tone: "success" });
    assert.equal(L.codexRowState({ accounts: 1, models: 0, synced: false }).text, "1 Codex account connected in OmniRoute; sync the models (Models tab) to put them in the AI Router provider.");
    assert.equal(L.codexRowState({ accounts: 2, models: 0, synced: true }).state, "unsynced");
    assert.deepEqual(L.codexRowState({ accounts: 0, models: 0, synced: true }), { state: "none", text: "OmniRoute has no Codex account yet. Add one in its dashboard, then sync.", tone: "warning" });
    assert.equal(L.codexRowState({ accounts: null, models: 3, synced: true }).text, "Codex is in the AI Router provider: 3 models.");
    assert.equal(L.codexRowState({ accounts: null, models: 0, synced: false }).state, "unknown");
  });

  check("resets: labels and the ask-first wording", () => {
    assert.deepEqual(L.RESET_KINDS, ["cooldown", "error", "lockout", "codex-cooldown", "credit"]);
    assert.deepEqual(["cooldown", "error", "codex-cooldown", "credit", "breaker"].map((k) => L.resetLabel(k)), ["Clear cooldown", "Clear old error", "Release cooldown", "Use a reset credit", "Resume now"]);
    assert.equal(L.resetLabel("lockout", "gpt-6-sol"), "Unlock gpt-6-sol");
    assert.equal(L.resetQuestion("credit", { name: "Codex #2", provider: "Codex", credits: 2 }), "Spends 1 of its 2 reset credits to reset Codex #2's used-up limit now. If no limit is used up, the provider says so.");
    assert.match(L.resetQuestion("credit", { name: "Codex #1", provider: "Codex", credits: 1 }), /^Spends its only reset credit/);
    assert.match(L.resetQuestion("cooldown", { name: "Claude #1", provider: "Claude" }), /^Claude #1 goes back into rotation now, before its cooldown ends\./);
    assert.match(L.resetQuestion("breaker", { name: "Claude", provider: "Claude" }), /^OmniRoute sends Claude requests again now/);
    for (const kind of [...L.RESET_KINDS, "breaker"]) assert.ok(L.resetQuestion(kind, { name: "A", provider: "B", model: "m", credits: 3 }).length < 220, `${kind}: one or two sentences`);
  });

  check("money: cents, thousands and tiny amounts", () => {
    assert.deepEqual([L.formatUsd(0), L.formatUsd(0.004), L.formatUsd(12.345), L.formatUsd(999.99), L.formatUsd(7200.18), L.formatUsd(1234567)], ["$0.00", "<$0.01", "$12.35", "$999.99", "$7,200", "$1,234,567"]);
  });

  check("usage request: the viewer's own days", () => {
    // TZ is set to Australia/Sydney for this file (see the top), so midnight is 13:00 or 14:00 UTC the day before.
    const now = new Date("2026-10-05T04:00:00.000Z");
    assert.equal(L.localYmd(now), "2026-10-05");
    assert.deepEqual(L.usageRequest("7d", null, now), { range: "7d" });
    assert.deepEqual(L.usageRequest("today", null, now), { range: "today", start: "2026-10-04T13:00:00.000Z" });
    assert.deepEqual(L.usageRequest("custom", { from: "2026-10-01", to: "2026-10-03" }, now), { range: "custom", start: "2026-09-30T14:00:00.000Z", end: "2026-10-03T13:59:59.999Z" }, "both days are before Sydney's daylight saving (from 2026-10-04): UTC+10");
    assert.deepEqual(L.usageRequest("custom", { from: "2026-10-03", to: "2026-10-01" }, now), { error: "The end date is before the start date." });
    assert.deepEqual(L.usageRequest("custom", { from: "2026-02-30", to: "2026-03-01" }, now), { error: "Write both dates as YYYY-MM-DD." }, "no 30 February");
    assert.deepEqual(L.usageRequest("custom", { from: "1/10/2026", to: "" }, now), { error: "Write both dates as YYYY-MM-DD." });
  });

  // ------------------------------------------- 0.21.0: routing switches, own sign-in, host
  const load = async (name) => {
    const code = ts.transpileModule(readFileSync(new URL(`../apps/paseo/shared/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    writeFileSync(join(staging, `${name}.mjs`), code);
    return import(join(staging, `${name}.mjs`));
  };
  const R = await load("routing");
  const Ho = await load("host");
  const NOW = Date.parse("2026-10-07T00:00:00Z");
  const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;

  check("switch words: what on and off mean", () => {
    assert.deepEqual(R.switchWords("claude", true), { title: "Claude · through the router", state: "On", meaning: "Uses your team's accounts on the router" });
    assert.deepEqual(R.switchWords("codex", false), { title: "Codex · through the router", state: "Off", meaning: "Uses this computer's own sign-in" });
  });

  check("own sign-in: Claude", () => {
    const at = (oauth) => R.claudeSignIn({ file: { claudeAiOauth: oauth }, keychain: false, env: {}, now: NOW });
    // The main server, 2026-10-07: expiresAt 0 and a refresh token that lapsed 19 days earlier.
    assert.equal(at({ accessToken: "a", refreshToken: "r", expiresAt: 0, refreshTokenExpiresAt: NOW - 455 * 3_600_000 }).state, "expired");
    assert.equal(at({ accessToken: "a", refreshToken: "r", expiresAt: NOW - 1, refreshTokenExpiresAt: NOW + 86_400_000 }).state, "ok", "an expired access token renews by itself");
    assert.equal(at({ accessToken: "a", refreshToken: "r" }).state, "ok", "no expiry given: trust it");
    assert.equal(at({ accessToken: "a", expiresAt: NOW - 1 }).state, "expired", "no refresh token and run out");
    assert.equal(R.claudeSignIn({ file: null, keychain: false, env: {}, now: NOW }).state, "missing");
    assert.equal(R.claudeSignIn({ file: null, keychain: true, env: {}, now: NOW }).state, "ok", "a Mac keeps it in the keychain");
    assert.equal(R.claudeSignIn({ file: null, keychain: false, env: { ANTHROPIC_API_KEY: "k" }, now: NOW }).state, "ok");
    assert.equal(R.claudeSignIn({ file: null, keychain: false, env: { CLAUDE_CODE_OAUTH_TOKEN: "t" }, now: NOW }).state, "ok");
    const said = JSON.stringify(at({ accessToken: "sk-ant-secret", refreshToken: "sk-ant-secret" }));
    assert.equal(said.includes("sk-ant-secret"), false, "never repeats a secret");
  });

  check("own sign-in: Codex", () => {
    assert.equal(R.codexSignIn({ file: { tokens: { access_token: jwt(NOW / 1000 - 60), refresh_token: "r" } }, now: NOW }).state, "ok", "a ChatGPT login it can renew");
    assert.equal(R.codexSignIn({ file: { OPENAI_API_KEY: "sk-x" }, now: NOW }).state, "ok");
    assert.equal(R.codexSignIn({ file: { OPENAI_API_KEY: null, tokens: { access_token: jwt(NOW / 1000 - 60) } }, now: NOW }).state, "expired");
    assert.equal(R.codexSignIn({ file: { tokens: { access_token: jwt(NOW / 1000 + 600) } }, now: NOW }).state, "ok");
    assert.equal(R.codexSignIn({ file: null, now: NOW }).state, "missing");
    assert.equal(R.codexSignIn({ file: { tokens: {} }, now: NOW }).state, "missing");
  });

  check("router trouble: what to offer", () => {
    const ok = { state: "ok", detail: "Codex's own ChatGPT login" };
    const missing = { state: "missing", detail: "Codex isn't signed in on this computer" };
    const expired = { state: "expired", detail: "x" };
    const healthy = { up: true, paused: [] };
    const down = { up: false, paused: [] };
    const paused = { up: true, paused: ["codex"] };
    const offer = (input) => R.routingOffer({ app: "codex", routed: true, health: healthy, signIn: ok, switchedAway: false, ...input });
    // Router down / paused, own sign-in present: one press, asked first.
    const own = offer({ health: down });
    assert.equal(own.kind, "use-own");
    assert.equal(own.label, "Use this computer's own sign-in for Codex");
    assert.equal(own.problem, "The router isn't answering");
    assert.match(own.question, /Codex's own ChatGPT login/);
    assert.match(own.question, /Nothing switches back by itself/);
    assert.equal(offer({ health: paused }).kind, "use-own");
    assert.equal(offer({ health: paused }).problem, "The router has paused Codex");
    assert.equal(R.routingOffer({ app: "claude", routed: true, health: paused, signIn: ok, switchedAway: false }).kind, "none", "Codex paused doesn't touch Claude");
    // No usable sign-in here: say so, never offer a switch that would break chats.
    assert.equal(offer({ health: down, signIn: missing }).kind, "no-own");
    assert.match(offer({ health: down, signIn: missing }).text, /^The router isn't answering, and this computer has no Codex sign-in of its own/);
    assert.match(offer({ health: paused, signIn: expired }).text, /Codex's own sign-in on this computer has expired/);
    assert.equal(offer({ health: down, signIn: null }).kind, "none", "sign-in not known yet: nothing rather than a guess");
    // Healthy: nothing, unless it was switched away for trouble.
    assert.equal(offer({}).kind, "none");
    assert.equal(offer({ routed: false }).kind, "none", "off by choice: no nagging");
    const back = offer({ routed: false, switchedAway: true });
    assert.equal(back.kind, "back");
    assert.equal(back.label, "Switch back to the router");
    assert.equal(offer({ routed: false, switchedAway: true, health: down }).kind, "none", "not while it's still down");
    assert.equal(offer({ routed: false, switchedAway: true, health: paused }).kind, "none", "not while Codex is still paused");
    assert.equal(offer({ routed: false, switchedAway: true, health: null }).kind, "none", "not before a health check");
    assert.equal(offer({ health: null }).kind, "none", "unknown health is not a problem");
  });

  check("host naming", () => {
    assert.equal(Ho.hostName("team-server", { name: "box-1" }), "team-server", "Paseo's name for the host first");
    assert.equal(Ho.hostName("  ", { name: "box-1" }), "box-1");
    assert.equal(Ho.hostName(undefined, null), null);
    assert.equal(Ho.withHost("AI Router", "team-server"), "AI Router · team-server");
    assert.equal(Ho.withHost("AI Router", null), "AI Router");
    assert.match(Ho.notConnectedLine({ mac: true }), /^This Mac isn't connected to a router yet\. Each computer has its own connection/);
    assert.match(Ho.notConnectedLine({ mac: false }), /^This computer isn't connected to a router yet\./);
    assert.match(Ho.notConnectedLine(null), /^This computer isn't/);
  });

  console.log(`logic: ${passed} checks passed`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
