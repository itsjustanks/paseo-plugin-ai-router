import React, { useEffect, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { aiProvider, status, type Status } from "../shared/contracts";
import { ROUTERS } from "../shared/routers/copy";
import { providerLabel } from "../shared/routers/omniroute/parsers";
import { dashboardTarget } from "./dashboard";
import { openInBrowser } from "./links";
import { hostName, withHost } from "../shared/host";
import { currentHost, noteHost } from "./host";
import { OfferBoundary, RoutingOffers } from "./routing";
import { Button, Dot, Meta, Note, SPACE, TYPE, type Tone } from "./ui";

/**
 * Paseo 0.11's sidebar row can carry a trailing element and open a popover.
 * AI Router uses them for a status dot and three quick actions (open the
 * panel, open the router's dashboard, sync the models), so the common jobs
 * need no trip into the panel. Older apps never render these.
 */
export type PopoverProps = { theme: PluginTheme; host?: { id: string; label: string }; close(): void; openScreen(input: { screenId: string }): void };
export type TrailingProps = { theme: PluginTheme; openPopover?: (Content: ComponentType<PopoverProps>) => void };

const POLL_MS = 60_000;

/** The status answer, read now and every minute while mounted, plus a way to read it again now. No query client needed. */
export function useStatus(): [Status | null, () => void] {
  const call = useRpc(status);
  const [data, setData] = useState<Status | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () => void call({}).then((next) => { if (live) setData(next); }).catch(() => undefined);
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [call, round]);
  return [data, () => setRound((n) => n + 1)];
}

/** The connection in a word and a tone: what the dot shows. */
export function quickState(data: Status | null): { tone: Tone; text: string } {
  if (!data) return { tone: "neutral", text: "Checking…" };
  const name = ROUTERS[data.connection.router].label;
  if (data.problem) return { tone: "neutral", text: "Not connected yet" };
  if (data.health?.up === false) return { tone: "danger", text: `${name} unreachable` };
  if (data.health?.up && data.health.paused.length) return { tone: "warning", text: `Working, ${data.health.paused.map(providerLabel).join(", ")} paused` };
  if (!data.health) return { tone: "neutral", text: "Checking…" };
  return data.aiProvider.present ? { tone: "success", text: `Working · ${data.aiProvider.modelCount} models` } : { tone: "neutral", text: "Connected: sync the models" };
}

function dotColor(theme: PluginTheme, tone: Tone): string {
  return tone === "success" ? theme.colors.statusSuccess : tone === "warning" ? theme.colors.statusWarning : tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted;
}

export function makeQuickActions(screenId: string): ComponentType<PopoverProps> {
  return function AiRouterQuickActions({ theme, host, close, openScreen }: PopoverProps) {
    noteHost(host);
    const [data, reread] = useStatus();
    const name = hostName(host?.label ?? currentHost(), data?.computer);
    const sync = useRpc(aiProvider);
    const [busy, setBusy] = useState(false);
    const [reply, setReply] = useState<{ text: string; tone: Tone } | null>(null);
    const state = quickState(data);
    const dashboard = data ? dashboardTarget(data).url : null;
    const runSync = () => {
      setBusy(true);
      void sync({ enabled: true })
        .then((result) => setReply({ text: result.message, tone: result.ok ? "success" : "danger" }))
        .catch((error) => setReply({ text: error instanceof Error ? error.message : String(error), tone: "danger" }))
        .finally(() => setBusy(false));
    };
    return (
      <View style={{ padding: SPACE.md, gap: SPACE.row, minWidth: 260 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
          <Dot color={dotColor(theme, state.tone)} />
          <Text style={{ ...TYPE.item, color: theme.colors.foreground, flexShrink: 1 }}>{withHost("AI Router", name)}</Text>
        </View>
        <Meta theme={theme}>{state.text}</Meta>
        {data && !data.problem ? (
          <OfferBoundary>
            <RoutingOffers theme={theme} data={data} onChanged={reread} compact />
          </OfferBoundary>
        ) : null}
        {reply ? <Note theme={theme} tone={reply.tone}>{reply.text}</Note> : null}
        <Button theme={theme} label="Open AI Router" icon="Route" primary onPress={() => { openScreen({ screenId }); close(); }} />
        {dashboard ? <Button theme={theme} label="Open dashboard" icon="ExternalLink" onPress={() => void openInBrowser(dashboard)} /> : null}
        <Button theme={theme} label="Sync models" icon="RefreshCw" busy={busy} disabled={!data || data.problem !== null || data.health?.up === false} onPress={runSync} />
        {data?.aiProvider.check?.at ? <Meta theme={theme}>{`Models last checked ${new Date(data.aiProvider.check.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</Meta> : null}
      </View>
    );
  };
}

/** The status dot at the end of the sidebar row; pressing it opens the quick actions when the app can show a popover. */
export function makeStatusTrailing(Quick: ComponentType<PopoverProps>): ComponentType<TrailingProps> {
  return function AiRouterStatusDot({ theme, openPopover }: TrailingProps) {
    const state = quickState(useStatus()[0]);
    const dot = <Dot color={dotColor(theme, state.tone)} />;
    if (!openPopover) return dot;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`AI Router: ${state.text}. Quick actions`} hitSlop={SPACE.sm} onPress={() => openPopover(Quick)} style={{ padding: SPACE.xs }}>
        {dot}
      </Pressable>
    );
  };
}
