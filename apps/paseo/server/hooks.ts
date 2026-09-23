// The session_open rewrite is adapted from the 9Router Agent Link plugin's server/hooks.ts (MIT); see THIRD-PARTY-NOTICES.md.
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { Status } from "../shared/contracts";
import { CODEX_ROUTER_PROVIDER_ID, connectionProblem, routeSession, sessionKind, type SessionKind } from "../shared/logic";
import { noteActivity } from "./provider";
import { adapterFor } from "./routers";
import { readConnection, readProviderEntries, readRoutingSettings } from "./store";

/** A launch re-uses a check this recent; otherwise it pings first (4s timeout). */
const LAUNCH_HEALTH_MAX_AGE_MS = 30_000;

let lastSession: Status["lastSession"] = null;
export const getLastSession = () => lastSession;

/** Every decision is logged once per session open; nothing here ever prints a key. */
function record(agentId: string, kind: SessionKind, routed: boolean, message: string, reason: string | null = null): void {
  lastSession = { at: new Date().toISOString(), agentId, kind, routed, message, reason };
  (routed ? console.log : console.warn)(`[ai-router] ${message}`);
}

/**
 * Puts the connection's URL and key into the environment of built-in Claude
 * sessions (while routing is on) and of sessions on the AI Router provider and
 * Codex via OmniRoute (whose entries carry only placeholders for the key).
 * Anything short of a keyed, healthy endpoint leaves a Claude session exactly
 * as Paseo built it. An AI Router session has no other way to work, so an
 * interactive one fails to open with the reason instead of reaching
 * OmniRoute without a key.
 */
export function registerRoutingHooks(server: PluginServerContext): void {
  // Any agent activity is also the first chance after start to check the model sync.
  server.on("agent.turn_started", (_event, context) => noteActivity(context.paseo));
  server.before("agent.session_open", async ({ request }, context) => {
    noteActivity(context.paseo);
    const kind = sessionKind(request.provider);
    if (!kind) return request;
    const refuse = kind !== "claude" && request.purpose === "interactive";
    let skipped: string;
    try {
      const settings = await readRoutingSettings();
      if (kind === "claude" && !settings.routeAgents) return request;
      const resolved = await readConnection();
      // No point pinging an endpoint that cannot route anyway; routeSession names the problem.
      const health = connectionProblem(resolved) ? null : await adapterFor(resolved.connection.router).health(resolved.connection, LAUNCH_HEALTH_MAX_AGE_MS);
      const entries = kind === "codex" ? await readProviderEntries(context.paseo) : null;
      const codex = entries ? (request.provider === CODEX_ROUTER_PROVIDER_ID ? entries.codexRouter.baseUrl : entries.codex.baseUrl) : undefined;
      const decision = routeSession({ provider: request.provider, routeAgents: settings.routeAgents, resolved, health, codexBaseUrl: codex });
      if (decision.action === "ignore") return request;
      if (decision.action === "route") {
        record(request.agentId, kind, true, `${kind} session ${request.agentId} (${request.reason}) routed through ${resolved.connection.endpoint}`);
        return { ...request, env: { ...request.env, ...decision.env } };
      }
      skipped = decision.reason;
    } catch (error) {
      skipped = `hook failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    record(request.agentId, kind, false, `routing skipped for ${kind} session ${request.agentId} (${request.reason}): ${skipped}`, skipped);
    if (refuse) throw new Error(`AI Router cannot start this agent: ${skipped}. Fix it in the AI Router panel, or pick another provider.`);
    return request;
  });
}
