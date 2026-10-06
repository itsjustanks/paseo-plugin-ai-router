import type { PluginClientContext } from "@getpaseo/plugin/client";
import { canObserveAgents } from "../shared/host-features";

/**
 * Following the host's agents, on every Paseo the plugin supports (0.15.1).
 *
 * Paseo 0.8: `agents.subscribe()` hears the app's own agent subscription.
 * Paseo 0.9 and later: it hears only an observation the plugin opened itself,
 * so without one the chat chips (0.18.0: router alerts only) never heard of a
 * chat. There the plugin keeps one open for its lifetime: the snapshot
 * replaces what is known (first, and after every reconnect), updates apply in
 * between, and an observation the app drops is reopened with backoff. On 0.8
 * it never opens one (that would replace the app's own). The same approach as
 * paseo-mcp 0.18.1 and @gpambrozio/paseo-skills' followAgents.
 */
export type FollowedAgent = { id: string; workspaceId?: string | null; archivedAt?: string | null; lastUsage?: unknown };
export type AgentFollower = {
  /** A full list (the observation's snapshot): it replaces what was known. */
  replaceAll(agents: FollowedAgent[]): void;
  upsert(agent: FollowedAgent): void;
  remove(agentId: string): void;
};

type AgentListLike = { entries?: Array<{ agent?: FollowedAgent | null }> };
type AgentUpdateLike = { kind?: string; agentId?: string; agent?: FollowedAgent | null };
type AgentObservation = {
  subscribe(observer: { snapshot(list: AgentListLike): void; update(message: { type: string; payload?: unknown }): void; error?(error: unknown): void }): () => void;
  release(): Promise<void>;
};
type ObservingAgents = { list(options: { subscribe: object; signal: AbortSignal }): Promise<AgentListLike & { subscription?: AgentObservation }> };

export const OBSERVE_RETRY_MIN_MS = 2_000;
export const OBSERVE_RETRY_MAX_MS = 60_000;

const fromList = (list: AgentListLike | null | undefined): FollowedAgent[] =>
  (list?.entries ?? []).map((entry) => entry?.agent).filter((agent): agent is FollowedAgent => !!agent && typeof agent.id === "string");

function applyUpdate(follower: AgentFollower, update: AgentUpdateLike | null | undefined): void {
  if (update?.kind === "remove" && update.agentId) follower.remove(update.agentId);
  else if (update?.kind === "upsert" && update.agent?.id) follower.upsert(update.agent);
}

export function followAgents(client: PluginClientContext, follower: AgentFollower, retry = { minMs: OBSERVE_RETRY_MIN_MS, maxMs: OBSERVE_RETRY_MAX_MS }): () => void {
  if (!canObserveAgents(client.paseo)) return client.paseo.agents.subscribe((update) => applyUpdate(follower, update as unknown as AgentUpdateLike));

  const lifetime = new AbortController();
  let observation: AgentObservation | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = retry.minMs;

  const reopen = () => {
    observation = null;
    if (lifetime.signal.aborted || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
    delay = Math.min(delay * 2, retry.maxMs);
  };
  const open = () => {
    let opened: Promise<AgentListLike & { subscription?: AgentObservation }>;
    try {
      opened = (client.paseo.agents as unknown as ObservingAgents).list({ subscribe: {}, signal: lifetime.signal });
    } catch (error) {
      opened = Promise.reject(error);
    }
    opened
      .then((result) => {
        if (lifetime.signal.aborted) {
          void result.subscription?.release().catch(() => undefined);
          return;
        }
        const subscription = result.subscription;
        if (!subscription) throw new Error("the app returned no agent observation");
        follower.replaceAll(fromList(result));
        observation = subscription;
        subscription.subscribe({
          snapshot(list) {
            delay = retry.minMs;
            follower.replaceAll(fromList(list));
          },
          update(message) {
            if (message.type === "agent_update") applyUpdate(follower, message.payload as AgentUpdateLike);
          },
          error: reopen,
        });
      })
      .catch(reopen);
  };
  open();

  return () => {
    lifetime.abort();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    void observation?.release().catch(() => undefined);
    observation = null;
  };
}
