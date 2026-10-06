// A router problem reaching a chat ("Router down", "Claude paused"): the only
// thing AI Router puts on a chat's composer since 0.18.0. Paseo's own context
// meter and hover card cover the rest.

export type ChatAlert = { agentId: string; text: string; detail: string };
type SessionLike = { agentId: string; kind: "claude" | "provider" | "codex"; routed: boolean };

/**
 * Which routed chats a router problem reaches, from the hook's session log
 * (each chat's latest open). Down reaches every routed chat. A paused provider
 * reaches Claude chats (claude) and Codex via OmniRoute chats (codex); an AI
 * Router chat can use either, so it is told "if".
 */
export function chatAlerts(input: { down: string | null; paused: readonly string[]; sessions: readonly SessionLike[]; label: (provider: string) => string }): ChatAlert[] {
  const { down, paused, label } = input;
  if (!down && !paused.length) return [];
  const latest = new Map<string, SessionLike>();
  for (const session of input.sessions) latest.set(session.agentId, session);
  const reopen: Record<SessionLike["kind"], string> = {
    claude: "Reopened, it uses its own sign-in until the router is back.",
    provider: "An AI Router chat can't reopen until the router is back.",
    codex: "Codex via OmniRoute can't reopen until the router is back.",
  };
  const alerts: ChatAlert[] = [];
  for (const session of latest.values()) {
    if (!session.routed) continue;
    if (down) {
      alerts.push({ agentId: session.agentId, text: "Router down", detail: `OmniRoute isn't answering (${down}). This chat's requests go through it, so they fail until it's back. ${reopen[session.kind]}` });
      continue;
    }
    const own = session.kind === "claude" ? "claude" : session.kind === "codex" ? "codex" : null;
    if (own && paused.includes(own)) {
      alerts.push({ agentId: session.agentId, text: `${label(own)} paused`, detail: `OmniRoute has paused ${label(own)} after repeated failures. This chat's requests fail until OmniRoute retries it, unless its combos or fallbacks send them elsewhere.` });
    } else if (session.kind === "provider") {
      const names = paused.map(label).join(" and ");
      alerts.push({ agentId: session.agentId, text: `${names} paused`, detail: `OmniRoute has paused ${names} after repeated failures. If this chat's model runs there, its requests fail until OmniRoute retries it, unless its combos or fallbacks send them elsewhere.` });
    }
  }
  return alerts;
}


/** The chip on a chat the router can't serve right now: the problem in two words, with a warning icon so colour is not the only signal. */
export type AlertChipFace = { label: string; icon: "TriangleAlert"; spoken: string };
export function alertChipFace(alert: { text: string } | null): AlertChipFace | null {
  return alert ? { label: alert.text, icon: "TriangleAlert", spoken: `${alert.text}: open AI Router` } : null;
}
