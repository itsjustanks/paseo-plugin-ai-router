import React, { useSyncExternalStore, type ComponentType } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin/client";
import { alerts as alertsRpc } from "../shared/contracts";
import { alertChipFace, type AlertChipFace, type ChatAlert } from "../shared/alerts";
import { supportsButtonPills } from "../shared/host-features";
import { followAgents, type FollowedAgent } from "./agents";
import { useStatus } from "./quick";
import { OfferBoundary, RoutingOffers } from "./routing";
import { Button, HostIcon, SPACE, TYPE, toneColor } from "./ui";

// ------------------------------------------------------------------ store
//
// 0.18.0: AI Router puts a chip on a chat only while the router can't serve
// it ("Router down", "Claude paused"), and takes it away once that clears.
// Paseo's own context meter and hover card show the rest. The store knows
// each open chat's workspace (from the agent updates the app already
// receives) and the last alerts the daemon reported.

export type AlertStore = {
  subscribe(listener: () => void): () => void;
  /** An open chat and its workspace; archived or workspace-less chats are removed instead. */
  set(agentId: string, workspaceId: string): void;
  remove(agentId: string): void;
  agents(): Array<{ agentId: string; workspaceId: string }>;
  /** A router problem reaching this chat, from the last read. */
  alert(agentId: string): ChatAlert | null;
  setAlerts(alerts: readonly ChatAlert[]): void;
};

export function createAlertStore(): AlertStore {
  const seen = new Map<string, string>();
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
    set(agentId, workspaceId) {
      if (seen.get(agentId) === workspaceId) return;
      seen.set(agentId, workspaceId);
      notify();
    },
    remove(agentId) {
      if (seen.delete(agentId)) notify();
    },
    agents: () => [...seen].map(([agentId, workspaceId]) => ({ agentId, workspaceId })),
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

function useAlert(store: AlertStore, agentId: string): ChatAlert | null {
  const read = () => store.alert(agentId);
  return useSyncExternalStore(store.subscribe, read, read);
}

// ------------------------------------------------------------------- chips

const ALERT_POLL_MS = 60_000;
const ALERT_POLL_CAP_MS = 15 * 60_000;

/**
 * Paseo 0.8.0 stable and later take a chip as a button whose label the plugin
 * pushes; 0.8.0-beta.1 takes a React component. Chosen at runtime (0.15.1).
 */
type ChipContentProps = { theme: PluginTheme; agentId?: string; close(): void };
type ChipBehavior = { kind: "action"; onPress(): void } | { kind: "popover"; Content: ComponentType<ChipContentProps> };
type ChipButtonsClient = {
  addComposerPill(contribution: {
    id: string;
    workspaceId: string;
    agentId: string;
    button: { title: string; icon: string; label?: string; behavior: ChipBehavior };
  }): { update(patch: { label?: string; icon?: string }): void; remove(): void };
  addScreen?: unknown;
};
type ChipHandle = { face: string; update(face: AlertChipFace): void; remove(): void };

const CHIP_ID = "router-alert";
const CHIP_TITLE = "AI Router can't serve this chat right now";
const faceKey = (face: AlertChipFace) => `${face.icon}:${face.label}`;

/**
 * One chip per open chat a router problem reaches. The daemon is asked once a
 * minute while any chat is open (1, 2, 4 … 15 minutes while it does not
 * answer). Pressing the chip opens AI Router, where the status card says what
 * is wrong and what to do. `timing` is for tests.
 */
export function registerRouterAlerts(client: PluginClientContext, store: AlertStore, openRouter: () => void, timing = { pollMs: ALERT_POLL_MS, capMs: ALERT_POLL_CAP_MS }): () => void {
  const pills = new Map<string, ChipHandle>();
  const buttons = supportsButtonPills(client);
  const ChipBody = buttons ? null : makeAlertChip(store);
  // 0.21.0, on Paseo 0.11 apps (button popovers, found by `addScreen`): pressing the chip opens a small
  // popover with what's wrong, the one-press way to this computer's own sign-in, and "Open AI Router".
  const Popover = buttons && typeof (client as unknown as ChipButtonsClient).addScreen === "function" ? makeAlertPopover(store, openRouter) : null;
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const addChip = (agentId: string, workspaceId: string, face: AlertChipFace): ChipHandle => {
    if (buttons) {
      const registration = (client as unknown as ChipButtonsClient).addComposerPill({
        id: CHIP_ID,
        workspaceId,
        agentId,
        button: { title: CHIP_TITLE, icon: face.icon, label: face.label, behavior: Popover ? { kind: "popover", Content: Popover } : { kind: "action", onPress: openRouter } },
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
    const remove = client.addComposerPill({ id: CHIP_ID, title: CHIP_TITLE, workspaceId, agentId, Component: ChipBody!, onPress: openRouter });
    return { face: faceKey(face), update: () => undefined, remove };
  };

  const reconcile = () => {
    if (stopped) return;
    const live = new Set<string>();
    for (const { agentId, workspaceId } of store.agents()) {
      const face = alertChipFace(store.alert(agentId));
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

  // One read at a time: a request for another while one is out queues exactly one more.
  let polling = false;
  let again = false;
  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const wait = failures ? Math.min(timing.capMs, timing.pollMs * 2 ** Math.min(failures, 8)) : timing.pollMs;
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
        const answer = await client.rpc(alertsRpc, {});
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

  const take = (agent: FollowedAgent) => {
    if (agent.archivedAt || !agent.workspaceId) store.remove(agent.id);
    else store.set(agent.id, agent.workspaceId);
  };
  const stopFollowing = followAgents(client, {
    upsert(agent) {
      if (stopped) return;
      const first = store.agents().length === 0;
      take(agent);
      reconcile();
      // The first chat to appear gets the alerts read now, not a minute later.
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
export function makeAlertChip(store: AlertStore) {
  return function RouterAlertChip({ theme, agentId }: PluginComposerPillProps) {
    const face = alertChipFace(useAlert(store, agentId));
    if (!face) return null;
    const color = toneColor(theme, "danger");
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

/** The chip's popover (0.21.0): the problem in a sentence, the switch-back offer when there is one, and "Open AI Router". */
export function makeAlertPopover(store: AlertStore, openRouter: () => void) {
  return function RouterAlertPopover({ theme, agentId, close }: ChipContentProps) {
    const alert = useAlert(store, agentId ?? "");
    const [data, reread] = useStatus();
    return (
      <View style={{ padding: SPACE.md, gap: SPACE.row, maxWidth: 380 }}>
        <Text style={{ ...TYPE.item, color: theme.colors.foreground }}>{alert?.text ?? "AI Router"}</Text>
        {alert ? <Text style={{ ...TYPE.secondary, color: theme.colors.foreground }}>{alert.detail}</Text> : null}
        {data && !data.problem ? (
          <OfferBoundary>
            <RoutingOffers theme={theme} data={data} onChanged={reread} compact />
          </OfferBoundary>
        ) : null}
        <Button theme={theme} label="Open AI Router" icon="Route" onPress={() => { close(); openRouter(); }} />
      </View>
    );
  };
}
