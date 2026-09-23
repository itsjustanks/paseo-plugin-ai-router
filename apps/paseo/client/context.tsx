import React, { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginAgentPanelProps, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { badge, context, type ContextView } from "../shared/contracts";
import { badgeLabel, contextTone, formatTokens, usageOf, type ContextUsage } from "../shared/context";
import { routingSettings } from "../shared/settings";
import { HostIcon } from "./navigation";
import { errorText } from "./setup";
import { Banner, Button, Card, Chip, Link, Note, Row, toneColor, type Tone } from "./ui";

type Theme = PluginTheme;
export const CONTEXT_PANEL_ID = "ai-router-context";

// ------------------------------------------------------------------ store
//
// The chips read each agent's last reported context window from the agent
// updates the app already receives: no call per chip, per render or per
// keystroke. The panel asks the daemon for the breakdown only when opened.

export type BadgeStore = {
  subscribe(listener: () => void): () => void;
  usage(agentId: string): ContextUsage | null;
  /** From an agent update; true when the chip's number changed. */
  set(agentId: string, workspaceId: string, usage: ContextUsage | null): boolean;
  remove(agentId: string): void;
  agents(): Array<{ agentId: string; workspaceId: string; usage: ContextUsage | null }>;
};

export function createBadgeStore(): BadgeStore {
  const seen = new Map<string, { workspaceId: string; usage: ContextUsage | null }>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    usage: (agentId) => seen.get(agentId)?.usage ?? null,
    set(agentId, workspaceId, usage) {
      const before = seen.get(agentId);
      const same = before?.usage === usage || (!!before?.usage && !!usage && before.usage.used === usage.used && before.usage.max === usage.max);
      // Keep the old object when nothing changed, so a chip does not re-render.
      seen.set(agentId, { workspaceId, usage: same ? before?.usage ?? null : usage });
      if (!same) notify();
      return !same;
    },
    remove(agentId) {
      if (seen.delete(agentId)) notify();
    },
    agents: () => [...seen].map(([agentId, value]) => ({ agentId, ...value })),
  };
}

function useUsage(store: BadgeStore, agentId: string): ContextUsage | null {
  const read = () => store.usage(agentId);
  return useSyncExternalStore(store.subscribe, read, read);
}

const percent = (share: number) => (share >= 0.995 ? "100%" : share < 0.01 && share > 0 ? "<1%" : `${Math.round(share * 100)}%`);

// ------------------------------------------------------------------- chips

/** Every registry on this client re-reads the switch now: the Settings tab and the panel call this after saving it. */
const rechecks = new Set<() => void>();
export function recheckBadges(): void {
  for (const recheck of rechecks) recheck();
}

const BADGE_POLL_MS = 60_000;
const BADGE_POLL_CAP_MS = 15 * 60_000;

/**
 * One chip per chat that has reported its context window, while the switch is
 * on. The switch is read once a minute while there is a chat to put a chip on
 * (1, 2, 4 … 15 minutes while the daemon does not answer), and at once when
 * this client changes it. The same pattern as paseo-mcp's MCP chip.
 */
export function registerContextBadges(client: PluginClientContext, store: BadgeStore): () => void {
  const pills = new Map<string, () => void>();
  const ChipBody = makeContextChip(store);
  // Assume on until the daemon says otherwise: on is the default.
  let wanted = true;
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reconcile = () => {
    if (stopped) return;
    const live = new Set<string>();
    for (const { agentId, workspaceId, usage } of store.agents()) {
      if (!wanted || !usage) continue;
      live.add(agentId);
      if (pills.has(agentId)) continue;
      pills.set(
        agentId,
        client.addComposerPill({
          id: "context-badge",
          title: "Context used in this chat",
          workspaceId,
          agentId,
          Component: ChipBody,
          onPress() {
            client.openPanel(CONTEXT_PANEL_ID, { workspaceId, agentId });
          },
        }),
      );
    }
    for (const [agentId, remove] of pills) {
      if (live.has(agentId)) continue;
      remove();
      pills.delete(agentId);
    }
  };

  // One read at a time: a request for another while one is out queues exactly one more, so a
  // slow daemon and a switch press never start a second loop.
  let polling = false;
  let again = false;
  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const wait = failures ? Math.min(BADGE_POLL_CAP_MS, BADGE_POLL_MS * 2 ** Math.min(failures, 8)) : BADGE_POLL_MS;
    timer = setTimeout(() => void poll(), wait);
  };
  const poll = async () => {
    timer = null;
    if (stopped) return;
    if (polling) {
      again = true;
      return;
    }
    polling = true;
    if (store.agents().length > 0) {
      try {
        wanted = (await client.rpc(badge, {})).enabled;
        failures = 0;
      } catch {
        // The daemon did not answer: keep what the last read decided.
        failures += 1;
      }
      reconcile();
    }
    polling = false;
    if (stopped) return;
    if (again) {
      again = false;
      void poll();
      return;
    }
    schedule();
  };
  const pollNow = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = null;
    void poll();
  };
  rechecks.add(pollNow);

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") {
      store.remove(update.agentId);
      reconcile();
      return;
    }
    if (update.kind !== "upsert") return;
    const agent = update.agent;
    if (agent.archivedAt || !agent.workspaceId) {
      store.remove(agent.id);
      reconcile();
      return;
    }
    const first = store.agents().length === 0;
    const hadChip = pills.has(agent.id);
    store.set(agent.id, agent.workspaceId, usageOf(agent.lastUsage));
    if (!hadChip || !store.usage(agent.id)) reconcile();
    // The first chat to appear gets the switch read now, not a minute later.
    if (first) pollNow();
  });
  void poll();

  return () => {
    stopped = true;
    rechecks.delete(pollNow);
    if (timer) clearTimeout(timer);
    unsubscribe();
    for (const remove of pills.values()) remove();
    pills.clear();
  };
}

/** The chip: "186k / 1M", tinted as it fills. The icon changes too at the red end, so colour is not the only signal. */
export function makeContextChip(store: BadgeStore) {
  return function ContextChip({ theme, agentId }: PluginComposerPillProps) {
    const usage = useUsage(store, agentId);
    if (!usage) return null;
    const tone = contextTone(usage.used, usage.max);
    const color = tone === "neutral" ? theme.colors.foregroundMuted : toneColor(theme, tone);
    return (
      <>
        {HostIcon ? <HostIcon name={tone === "danger" ? "TriangleAlert" : "Gauge"} size={14} color={color} /> : null}
        <Text numberOfLines={1} accessibilityLabel={`Context ${percent(usage.used / usage.max)} full: ${badgeLabel(usage.used, usage.max)} tokens`} style={{ color, flexShrink: 1 }}>
          {badgeLabel(usage.used, usage.max)}
        </Text>
      </>
    );
  };
}

// ------------------------------------------------------------------- panel

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "earlier");

function Meter({ theme, share, tone }: { theme: Theme; share: number; tone: Tone }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, height: 6, borderRadius: 3, backgroundColor: tone === "neutral" ? theme.colors.accent : toneColor(theme, tone) }} />
    </View>
  );
}

function Parts({ theme, data }: { theme: Theme; data: ContextView }) {
  return (
    <Card theme={theme} title="What's using it">
      <Note theme={theme}>Biggest first. ≈ means estimated from this chat's own history (about 4 characters per token). The line marked "the rest" is the exact total minus everything else listed.</Note>
      {data.parts.map((part) => (
        <View key={part.id} style={{ gap: 4, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 8 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}>{part.label}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`${part.kind === "measured" ? "" : "≈ "}${formatTokens(part.tokens)} · ${percent(part.share)}${part.kind === "rest" ? " · the rest" : part.kind === "measured" ? " · measured" : ""}`}</Text>
          </View>
          <Meter theme={theme} share={part.share} tone="neutral" />
          {part.note ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{part.note}</Text> : null}
          {part.top.length ? (
            <Text selectable numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {part.top.map((item) => `${item.name} ≈ ${formatTokens(item.tokens)}`).join(" · ")}
            </Text>
          ) : null}
        </View>
      ))}
      {data.hint ? <Note theme={theme}>{`Tip: ${data.hint}`}</Note> : null}
    </Card>
  );
}

function RouterCard({ theme, router }: { theme: Theme; router: ContextView["router"] }) {
  if (router.state === "not-routed") return null;
  return (
    <Card theme={theme} title="Measured by OmniRoute">
      {router.state !== "ok" ? (
        <Note theme={theme} tone={router.state === "error" ? "warning" : "neutral"}>{router.message ?? "Not available."}</Note>
      ) : router.requests === 0 ? (
        <Note theme={theme}>None of this daemon's last 200 requests through the router came from this chat.</Note>
      ) : (
        <>
          {router.message ? <Note theme={theme} tone="warning">{router.message}</Note> : null}
          {router.latest ? <Note theme={theme}>{`Latest request: ${router.latest.tokensIn.toLocaleString()} tokens in (${router.latest.model ?? "model unknown"}, ${hhmm(router.latest.at)}).`}</Note> : null}
          {router.first ? (
            <Note theme={theme}>
              {router.complete
                ? `First request: ${router.first.tokensIn.toLocaleString()} tokens in (${hhmm(router.first.at)}): the system prompt, tools and instructions, plus the first message.`
                : `Earliest request found: ${router.first.tokensIn.toLocaleString()} tokens in (${hhmm(router.first.at)}). Older requests of this chat are past this daemon's last 200, so the chat's starting size isn't known.`}
            </Note>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** The breakdown itself, shared by the panel and the preview. */
export function ContextBody({ theme, data, onRefresh, refreshing, onHide }: { theme: Theme; data: ContextView; onRefresh: () => void; refreshing: boolean; onHide: (() => void) | null }) {
  const actions = (
    <Row>
      <Button theme={theme} label="Refresh" busy={refreshing} onPress={onRefresh} />
      {onHide ? <Link theme={theme} label="Hide the context badge" onPress={onHide} /> : null}
    </Row>
  );
  if (data.state !== "ok" || data.usedTokens === null || data.maxTokens === null) {
    return (
      <>
        <Banner theme={theme} tone={data.state === "error" ? "danger" : "neutral"} title={data.state === "error" ? "Couldn't read this chat's context" : "No context size yet"}>
          <Note theme={theme}>{data.message ?? "No answer."}</Note>
        </Banner>
        {actions}
      </>
    );
  }
  const share = data.usedTokens / data.maxTokens;
  const tone: Tone = contextTone(data.usedTokens, data.maxTokens);
  const { counted } = data;
  return (
    <>
      <Card theme={theme}>
        <Row>
          <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "700" }}>{`${data.usedTokens.toLocaleString()} of ${data.maxTokens.toLocaleString()} tokens`}</Text>
          <Chip theme={theme} label={`${percent(share)} full`} tone={tone} />
        </Row>
        <Meter theme={theme} share={share} tone={tone} />
        <Note theme={theme}>Exact: as the agent reported it after its last turn.</Note>
        {data.urgent ? <Note theme={theme} tone="danger">{data.urgent}</Note> : null}
      </Card>
      {data.parts.length ? <Parts theme={theme} data={data} /> : null}
      <RouterCard theme={theme} router={data.router} />
      <View style={{ gap: 4, marginBottom: 12 }}>
        {counted.compactedAt ? <Note theme={theme}>{`Counted since the chat was last compacted (${hhmm(counted.compactedAt)}).`}</Note> : null}
        {counted.capped ? <Note theme={theme}>{`A long chat: only its newest ${counted.items.toLocaleString()} history entries were counted, so the older ones sit in "the rest".`}</Note> : null}
        {counted.overshoot ? <Note theme={theme} tone="warning">The estimates add up to more than the reported total, so treat them as rough here.</Note> : null}
        <Note theme={theme}>Thinking isn't counted, and images and attachments aren't in the chat's history, so they end up in the rest. Worked out on this daemon: only these numbers and names reach the app, never the chat's text.</Note>
      </View>
      {actions}
    </>
  );
}

/** The agent panel the chip opens: one chat's context, biggest parts first. */
export function makeContextPanel(store: BadgeStore) {
  return function ContextPanel({ theme, agentId, layout }: PluginAgentPanelProps) {
    const call = useRpc(context);
    const queryClient = useQueryClient();
    const settings = useSettings(routingSettings);
    const usage = useUsage(store, agentId);
    // A new total (the chat moved on) is a new question; until then the daemon's answer is reused.
    const key = ["ai-router", "context", agentId, usage?.used ?? null] as const;
    const query = useQuery({ queryKey: key, queryFn: () => call({ agentId }), placeholderData: keepPreviousData, staleTime: 30_000, retry: false });
    const refresh = useMutation({ mutationFn: () => call({ agentId, refresh: true }), onSuccess: (next) => queryClient.setQueryData(key, next) });
    const [hidden, setHidden] = useState(false);
    const hide = () => {
      if (settings.status !== "ready") return;
      void settings.save({ ...settings.values, contextBadge: false }, settings.revision).then((saved) => {
        if (saved) setHidden(true);
        recheckBadges();
      });
    };
    const data = query.data;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 12 : 16, paddingBottom: 32 }}>
        <View style={{ gap: 2, marginBottom: 12 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "700" }}>Context</Text>
          <Note theme={theme}>{data?.agent?.title ?? "What this chat is carrying, and what uses the most of it."}</Note>
        </View>
        {data ? (
          <ContextBody theme={theme} data={data} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} onHide={settings.status === "ready" ? hide : null} />
        ) : query.error ? (
          <>
            <Note theme={theme} tone="danger">{errorText(query.error)}</Note>
            <Row><Button theme={theme} label="Try again" busy={query.isFetching} onPress={() => void query.refetch()} /></Row>
          </>
        ) : (
          <ActivityIndicator color={theme.colors.accent} />
        )}
        {refresh.error ? <Note theme={theme} tone="danger">{errorText(refresh.error)}</Note> : null}
        {hidden ? <Note theme={theme}>Context badge off for this daemon. AI Router → Settings → In Paseo turns it back on.</Note> : null}
      </ScrollView>
    );
  };
}
