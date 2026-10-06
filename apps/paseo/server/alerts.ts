import type { AlertsView } from "../shared/contracts";
import { chatAlerts } from "../shared/alerts";
import { connectionProblem } from "../shared/logic";
import { providerLabel } from "../shared/routers/omniroute/parsers";
import { adapterFor } from "./routers";
import { readConnection, readSessionLog } from "./store";

/** The chips ask once a minute; the router is pinged at most this often for them (the answer is shared). */
const ALERT_HEALTH_MAX_AGE_MS = 60_000;

/**
 * Which routed chats a router problem reaches: the only chip AI Router puts on
 * a chat. Local reads, plus the shared health check at most once a minute,
 * never waiting more than 1.5 s on a slow router.
 */
export async function handleAlerts(): Promise<AlertsView> {
  const resolved = await readConnection();
  if (connectionProblem(resolved)) return { alerts: [] };
  const { health } = await adapterFor(resolved.connection.router).healthForPanel(resolved.connection, ALERT_HEALTH_MAX_AGE_MS);
  if (!health) return { alerts: [] };
  const down = health.up ? null : health.error ?? "no answer";
  const sessions = closed.size ? readSessionLog().filter((session) => !closed.has(session.agentId)) : readSessionLog();
  return { alerts: chatAlerts({ down, paused: health.up ? health.paused : [], sessions, label: providerLabel }) };
}

/** Chats Paseo closed since they last opened: no chip alert sent. Bounded; the oldest go first. */
const closed = new Set<string>();
const CLOSED_KEEP = 500;

/** A chat closed (Paseo 0.11.0-beta.4+) or was archived: its chip alerts stop now. */
export function forgetAgent(agentId: string): void {
  closed.delete(agentId);
  closed.add(agentId);
  if (closed.size > CLOSED_KEEP) closed.delete(closed.values().next().value as string);
}

/** A chat opened again (session_open): its chip alerts come back. */
export function agentOpened(agentId: string): void {
  closed.delete(agentId);
}
