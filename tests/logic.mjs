import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "../apps/paseo/node_modules/typescript/lib/typescript.js";

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
    assert.equal(L.consoleUrlFor({ endpoint: REMOTE, consoleUrl: null }), `${REMOTE}/dashboard`);
    assert.equal(L.consoleUrlFor({ endpoint: REMOTE, consoleUrl: "https://omni.example.com" }), "https://omni.example.com");
    assert.equal(L.consoleUrlFor({ endpoint: null, consoleUrl: null }), null);
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
    assert.deepEqual(decision, { action: "route", kind: "claude", env: { ANTHROPIC_BASE_URL: REMOTE, ANTHROPIC_AUTH_TOKEN: "sk-test", CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1" } });
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
      assert.deepEqual(routed, { action: "route", kind: "provider", env: { ANTHROPIC_BASE_URL: REMOTE, ANTHROPIC_AUTH_TOKEN: "sk-test", CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1" } }, "choosing the provider is the opt-in");
    }
    assert.deepEqual(L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents: true, resolved: configured(REMOTE, null), health: up }), { action: "skip", kind: "provider", reason: `no API key set for ${REMOTE}` });
    assert.equal(L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents: true, resolved, health: down }).reason, `${REMOTE} is down: connection refused at ${REMOTE}/api/health/ping`);
    assert.equal(L.routeSession({ provider: L.AI_ROUTER_PROVIDER_ID, routeAgents: true, resolved: L.resolveConnection(null, {}), health: null }).reason, "no endpoint URL set");
  });

  check("AI Router provider entry: every model, a Sonnet default, never the real key", () => {
    const models = [{ id: "cc/claude-opus-5-5", label: "Claude · Opus 5.5" }, { id: "cc/claude-sonnet-5", label: "Claude · Sonnet 5" }, { id: "cx/gpt-5.6-sol", label: "Codex · GPT-5.6 Sol" }];
    const entry = L.aiRouterProviderEntry(REMOTE, models);
    assert.equal(entry.extends, "claude");
    assert.deepEqual(entry.env, { ANTHROPIC_BASE_URL: REMOTE, ANTHROPIC_AUTH_TOKEN: L.KEY_PLACEHOLDER, CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1" });
    // Claude Code 2.1.280 + OmniRoute: per-turn output_config needs a beta OmniRoute strips, so routed sessions turn experimental betas off.
    assert.equal(L.ROUTED_CLAUDE_ENV.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, "1");
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
    assert.deepEqual(["claude", "codex", "ai-router", "codex-ai-router", "copilot"].map(L.throughRouter), ["claude-toggle", "codex-provider", "is-router", "is-router", "none"]);
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

  check("the combo profiles switch defaults on and survives old settings documents", () => {
    assert.deepEqual(L.parseRoutingEnvelope(null), { routeAgents: false, comboProfiles: true });
    assert.deepEqual(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: true } })), { routeAgents: true, comboProfiles: true });
    assert.deepEqual(L.parseRoutingEnvelope(JSON.stringify({ version: 1, values: { routeAgents: false, comboProfiles: false } })), { routeAgents: false, comboProfiles: false });
  });

  console.log(`logic: ${passed} checks passed`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
