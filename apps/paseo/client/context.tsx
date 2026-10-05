import React, { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginAgentPanelProps, type PluginClientContext, type PluginComposerPillProps } from "@getpaseo/plugin/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { badge, context, type ContextView } from "../shared/contracts";
import { contextChipFace, contextTone, formatTokens, usageOf, type ChatAlert, type ContextChipFace, type ContextUsage } from "../shared/context";
import { supportsButtonPills } from "../shared/host-features";
import { routingSettings } from "../shared/settings";
import { followAgents, type FollowedAgent } from "./agents";
import { errorText } from "./setup";
import { Banner, Button, Card, Chip, HostIcon, ItemTitle, Link, Meta, Note, Row, TYPE, toneColor, type Tone, SPACE } from "./ui";

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
  /** A router problem reaching this chat, from the last switch read. */
  alert(agentId: string): ChatAlert | null;
  setAlerts(alerts: readonly ChatAlert[]): void;
};

export function createBadgeStore(): BadgeStore {
  const seen = new Map<string, { workspaceId: string; usage: ContextUsage | null }>();
  let alerts = new Map<string, ChatAlert>();
  let alertsKey = "[]";
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
    alert: (agentId) => alerts.get(agentId) ?? null,
    setAlerts(next) {
      const key = JSON.stringify(next);
      if (key === alertsKey) return;
      alertsKey = key;
      alerts = new Map(next.map((alert) => [alert.agentId, alert]));
      notify();
    },
  };
}

function useAlert(store: BadgeStore, agentId: string): ChatAlert | null {
  const read = () => store.alert(agentId);
  return useSyncExternalStore(store.subscribe, read, read);
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
 *
 * 0.15.1: Paseo 0.8.0 stable and later take a chip as a button whose label the
 * plugin pushes; the old component shape threw on add there, so the chip never
 * showed on 0.9 or 0.11 apps and the loop stopped. And since 0.9 the agents are
 * followed through the plugin's own observation (client/agents.ts). Both are
 * chosen at runtime; a 0.8.0-beta.1 app keeps the component and the listener.
 * Found by the paseo-mcp agent, after @hteo1337's report (itsjustanks/paseo-mcp#1).
 */
type ChipButtonsClient = {
  addComposerPill(contribution: {
    id: string;
    workspaceId: string;
    agentId: string;
    button: { title: string; icon: string; label?: string; behavior: { kind: "action"; onPress(): void } };
  }): { update(patch: { label?: string; icon?: string }): void; remove(): void };
};
type ChipHandle = { face: string; update(face: ContextChipFace): void; remove(): void };

const CHIP_ID = "context-badge";
const CHIP_TITLE = "What fills this chat's context";
const faceKey = (face: ContextChipFace) => `${face.icon}:${face.label}`;

export function registerContextBadges(client: PluginClientContext, store: BadgeStore): () => void {
  const pills = new Map<string, ChipHandle>();
  const buttons = supportsButtonPills(client);
  const ChipBody = buttons ? null : makeContextChip(store);
  // Assume on until the daemon says otherwise: on is the default.
  let wanted = true;
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const addChip = (agentId: string, workspaceId: string, face: ContextChipFace): ChipHandle => {
    const onPress = () => client.openPanel(CONTEXT_PANEL_ID, { workspaceId, agentId });
    if (buttons) {
      const registration = (client as unknown as ChipButtonsClient).addComposerPill({
        id: CHIP_ID,
        workspaceId,
        agentId,
        button: { title: CHIP_TITLE, icon: face.icon, label: face.label, behavior: { kind: "action", onPress } },
      });
      const handle: ChipHandle = {
        face: faceKey(face),
        update(next) {
          registration.update({ label: next.label, icon: next.icon });
          handle.face = faceKey(next);
        },
        remove: () => registration.remove(),
      };
      return handle;
    }
    // The 0.8.0-beta.1 shape: the component reads the store and draws its own label.
    const remove = client.addComposerPill({ id: CHIP_ID, title: CHIP_TITLE, workspaceId, agentId, Component: ChipBody!, onPress });
    return { face: faceKey(face), update: () => undefined, remove };
  };

  const reconcile = () => {
    if (stopped) return;
    const live = new Set<string>();
    for (const { agentId, workspaceId, usage } of store.agents()) {
      // A chip for a chat that reported its window, or one a router problem reaches.
      const face = wanted ? contextChipFace(usage, store.alert(agentId)) : null;
      if (!face) continue;
      live.add(agentId);
      const pill = pills.get(agentId);
      // An app that refuses one chip never stops the others; it gets another try on the next pass.
      try {
        if (!pill) pills.set(agentId, addChip(agentId, workspaceId, face));
        else if (pill.face !== faceKey(face)) pill.update(face);
      } catch {
        // Nothing to do until the next pass.
      }
    }
    for (const [agentId, pill] of pills) {
      if (live.has(agentId)) continue;
      try {
        pill.remove();
      } catch {
        // Already gone on the app's side.
      }
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
        const answer = await client.rpc(badge, {});
        wanted = answer.enabled;
        store.setAlerts(answer.alerts);
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

  /** One agent into the store; true when it needs a reconcile (a chip may appear or go). */
  const take = (agent: FollowedAgent): boolean => {
    if (agent.archivedAt || !agent.workspaceId) {
      store.remove(agent.id);
      return true;
    }
    const hadChip = pills.has(agent.id);
    store.set(agent.id, agent.workspaceId, usageOf(agent.lastUsage));
    return !hadChip || !store.usage(agent.id);
  };
  const stopFollowing = followAgents(client, {
    upsert(agent) {
      if (stopped) return;
      const first = store.agents().length === 0;
      if (take(agent)) reconcile();
      // The first chat to appear gets the switch read now, not a minute later.
      if (first && store.agents().length > 0) pollNow();
    },
    remove(agentId) {
      store.remove(agentId);
      reconcile();
    },
    replaceAll(list) {
      if (stopped) return;
      const first = store.agents().length === 0;
      const listed = new Set(list.map((agent) => agent.id));
      for (const { agentId } of store.agents()) if (!listed.has(agentId)) store.remove(agentId);
      for (const agent of list) take(agent);
      reconcile();
      if (first && store.agents().length > 0) pollNow();
    },
  });
  void poll();

  return () => {
    stopped = true;
    rechecks.delete(pollNow);
    if (timer) clearTimeout(timer);
    stopFollowing();
    for (const pill of pills.values()) {
      try {
        pill.remove();
      } catch {
        // Already gone.
      }
    }
    pills.clear();
  };
}

/** The chip body for apps on the old component shape (0.8.0-beta.1): the same face, drawn here. */
export function makeContextChip(store: BadgeStore) {
  return function ContextChip({ theme, agentId }: PluginComposerPillProps) {
    const usage = useUsage(store, agentId);
    const alert = useAlert(store, agentId);
    const face = contextChipFace(usage, alert);
    if (!face) return null;
    const color = face.alert ? toneColor(theme, "danger") : theme.colors.foregroundMuted;
    return (
      <>
        {HostIcon ? <HostIcon name={face.icon} size={14} color={color} /> : null}
        <Text numberOfLines={1} accessibilityLabel={face.spoken} style={{ color, flexShrink: 1 }}>
          {face.label}
        </Text>
      </>
    );
  };
}

// ------------------------------------------------------------------- panel

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "earlier");

function Meter({ theme, share, tone }: { theme: Theme; share: number; tone: Tone }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, height: 8, borderRadius: 4, backgroundColor: tone === "neutral" ? theme.colors.accent : toneColor(theme, tone) }} />
    </View>
  );
}

function Parts({ theme, data }: { theme: Theme; data: ContextView }) {
  return (
    <Card theme={theme} title="What's using it" icon="ChartPie">
      <Note theme={theme}>Biggest first. ≈ means estimated from this chat's own history (about 4 characters per token). The line marked "the rest" is the exact total minus everything else listed.</Note>
      {data.parts.map((part) => (
        <View key={part.id} style={{ gap: SPACE.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.sm }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: SPACE.sm }}>
            <ItemTitle theme={theme}>{part.label}</ItemTitle>
            <Meta theme={theme}>{`${part.kind === "measured" ? "" : "≈ "}${formatTokens(part.tokens)} · ${percent(part.share)}${part.kind === "rest" ? " · the rest" : part.kind === "measured" ? " · measured" : ""}`}</Meta>
          </View>
          <Meter theme={theme} share={part.share} tone="neutral" />
          {part.note ? <Text style={{ ...TYPE.secondary, color: theme.colors.foreground }}>{part.note}</Text> : null}
          {part.top.length ? (
            <Text selectable numberOfLines={2} style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>
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
    <Card theme={theme} title="Measured by OmniRoute" icon="Route">
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
      {onHide ? <Link theme={theme} label="Hide the Breakdown chip" onPress={onHide} /> : null}
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
          <Text style={{ ...TYPE.tabTitle, color: theme.colors.foreground }}>{`${data.usedTokens.toLocaleString()} of ${data.maxTokens.toLocaleString()} tokens`}</Text>
          <Chip theme={theme} label={`${percent(share)} full`} tone={tone} />
        </Row>
        <Meter theme={theme} share={share} tone={tone} />
        <Meta theme={theme}>Exact: as the agent reported it after its last turn.</Meta>
        {data.urgent ? <Note theme={theme} tone="danger">{data.urgent}</Note> : null}
      </Card>
      {data.parts.length ? <Parts theme={theme} data={data} /> : null}
      <RouterCard theme={theme} router={data.router} />
      <View style={{ gap: SPACE.xs, marginBottom: SPACE.row }}>
        {counted.compactedAt ? <Note theme={theme}>{`Counted since the chat was last compacted (${hhmm(counted.compactedAt)}).`}</Note> : null}
        {counted.capped ? <Note theme={theme}>{`A long chat: only its newest ${counted.items.toLocaleString()} history entries were counted, so the older ones sit in "the rest".`}</Note> : null}
        {counted.overshoot ? <Note theme={theme} tone="warning">The estimates add up to more than the reported total, so treat them as rough here.</Note> : null}
        <Note theme={theme}>Thinking isn't counted, and images and attachments aren't in the chat's history, so they end up in the rest. Worked out on this daemon: only these numbers and names reach the app, never the chat's text.</Note>
      </View>
      {actions}
    </>
  );
}

/** The agent panel the chip opens: a router problem reaching the chat first, then its context, biggest parts first. */
export function makeContextPanel(store: BadgeStore, openSurface: ((id: string) => void) | null = null) {
  return function ContextPanel({ theme, agentId, layout }: PluginAgentPanelProps) {
    const alert = useAlert(store, agentId);
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
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? SPACE.row : SPACE.md, paddingBottom: SPACE.section + SPACE.sm }}>
        <View style={{ gap: SPACE.xs, marginBottom: SPACE.row }}>
          <Text accessibilityRole="header" style={{ ...TYPE.tabTitle, color: theme.colors.foreground }}>Context</Text>
          <Note theme={theme}>{data?.agent?.title ?? "What this chat is carrying, and what uses the most of it."}</Note>
        </View>
        {alert ? (
          <Banner theme={theme} tone="danger" title={alert.text}>
            <Note theme={theme}>{alert.detail}</Note>
            {openSurface ? <Link theme={theme} label="Open AI Router" onPress={() => openSurface("ai-router")} /> : null}
          </Banner>
        ) : null}
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
        {hidden ? <Note theme={theme}>Breakdown chip off for this daemon. AI Router → Settings → In Paseo turns it back on.</Note> : null}
      </ScrollView>
    );
  };
}
