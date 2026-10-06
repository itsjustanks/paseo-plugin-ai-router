import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { z } from "zod";
import { accountReset, chatRoute, status, type Status } from "../shared/contracts";
import { resetLabel, resetQuestion } from "../shared/logic";
import { isOurs, matchRouterError, routerErrorWords } from "../shared/router-errors";
import { providerLabel } from "../shared/routers/omniroute/parsers";
import { Disclosure, HostIcon, Link, Note, RADIUS, Row, SPACE, TYPE, tint, toneColor } from "./ui";

/**
 * Router errors in a chat (0.19.0). Paseo's timeline transformers see each
 * chat item as it completes; ours swaps an item that is clearly one of
 * OmniRoute's errors for a small card: what happened in one line, whether
 * anything retries by itself, "Open AI Router" and, for a paused provider
 * with a manage key, "Resume now" (asks first). The original text stays under
 * "Details". Transformers don't know the chat, so the card asks the daemon
 * whether this chat went through the router and, if it didn't, shows the
 * original text as it was.
 */
export const ROUTER_ERROR_KIND = "router-error";
export const ROUTER_ERROR_VERSION = 1;
export const RouterErrorDataSchema = z.object({ message: z.string(), source: z.enum(["assistant", "error"]) });
type RouterErrorData = z.infer<typeof RouterErrorDataSchema>;
type Theme = Parameters<typeof toneColor>[0];
type ItemProps = { theme: Theme; agentId: string; item: { data: RouterErrorData }; timestamp: Date | string };
type TimelineItem = { type: string; text?: string; message?: string };
type TransformInput = { item: TimelineItem; phase: "streaming" | "complete" };

/** The transform for one item type: a plugin item for a router error, else nothing (Paseo shows it as usual). */
export function transformRouterError({ item, phase }: TransformInput) {
  // A streaming message is still growing; judge it once it is complete.
  if (phase !== "complete") return undefined;
  const source = item.type === "error" ? "error" : "assistant";
  const message = item.type === "error" ? item.message : item.text;
  if (typeof message !== "string" || !matchRouterError(message, source)) return undefined;
  const data: RouterErrorData = { message, source };
  return { items: [{ type: "plugin" as const, kind: ROUTER_ERROR_KIND, version: ROUTER_ERROR_VERSION, data }] };
}

type TimelineClient = {
  addTimelineTransformer?: (contribution: { id: string; query: { itemType: string }; transform(input: TransformInput): unknown }) => () => void;
  addTimelineRenderer?: (contribution: { kind: string; version: number; schema: unknown; Component: React.ComponentType<ItemProps> }) => () => void;
};

/**
 * Registers the renderer and the two transformers when the app has them
 * (both shipped together); otherwise nothing changes. `openRouter` opens AI
 * Router on its Accounts tab.
 */
export function registerRouterErrors(client: PluginClientContext, openRouter: () => void): Array<() => void> {
  const timeline = client as unknown as TimelineClient;
  if (typeof timeline.addTimelineTransformer !== "function" || typeof timeline.addTimelineRenderer !== "function") return [];
  const cleanups: Array<() => void> = [];
  try {
    cleanups.push(timeline.addTimelineRenderer({ kind: ROUTER_ERROR_KIND, version: ROUTER_ERROR_VERSION, schema: RouterErrorDataSchema, Component: makeRouterErrorCard(openRouter) }));
    // Claude Code's "API Error: …" and Paseo's "[System Error] …" are assistant messages; some providers send error items.
    for (const itemType of ["assistant_message", "error"]) {
      cleanups.push(timeline.addTimelineTransformer({ id: `router-error-${itemType.replace("_", "-")}`, query: { itemType }, transform: transformRouterError }));
    }
  } catch {
    // An app that refuses one keeps the native rendering; undo what did register.
    for (const cleanup of cleanups.splice(0)) cleanup();
  }
  return cleanups;
}

// ------------------------------------------------------------- shared reads

const STATUS_MAX_AGE_MS = 60_000;
let statusRead: { at: number; value: Promise<Status | null> } | null = null;
const routes = new Map<string, Promise<boolean | null>>();
/** Forget the shared reads (tests, and the preview, which switch fixtures). */
export function forgetRouterErrorReads(): void {
  statusRead = null;
  routes.clear();
}

/** One status read a minute, shared by every card in every chat. */
function useStatusOnce(): Status | null {
  const call = useRpc(status);
  const [value, setValue] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    if (!statusRead || Date.now() - statusRead.at > STATUS_MAX_AGE_MS) statusRead = { at: Date.now(), value: call({}).catch(() => null) };
    void statusRead.value.then((next) => { if (live) setValue(next); });
    return () => {
      live = false;
    };
  }, [call]);
  return value;
}

/** Whether this chat went through the router; asked once per chat. Undefined while asking. */
function useRouted(agentId: string): boolean | null | undefined {
  const call = useRpc(chatRoute);
  const [value, setValue] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!routes.has(agentId)) routes.set(agentId, call({ agentId }).then((answer) => answer.routed, () => null));
    void routes.get(agentId)!.then((next) => { if (live) setValue(next); });
    return () => {
      live = false;
    };
  }, [agentId, call]);
  return value;
}

// ----------------------------------------------------------------- the card

/** The original text, as the chat would have shown it. */
function Original({ theme, message }: { theme: Theme; message: string }) {
  return <Text selectable style={{ ...TYPE.body, color: theme.colors.foreground }}>{message}</Text>;
}

export function makeRouterErrorCard(openRouter: () => void) {
  return function RouterErrorCard({ theme, agentId, item, timestamp }: ItemProps) {
    const { message, source } = item.data;
    const data = useStatusOnce();
    const routed = useRouted(agentId);
    const reset = useRpc(accountReset);
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reply, setReply] = useState<{ text: string; ok: boolean } | null>(null);
    const error = matchRouterError(message, source);
    // Until the daemon says whose chat this is, and for chats that aren't ours, the text as it was.
    if (!error || routed === undefined || !isOurs(error, routed, data?.connection.endpoint ?? null)) return <Original theme={theme} message={message} />;
    const at = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const words = routerErrorWords(error, Number.isNaN(at.getTime()) ? new Date() : at, providerLabel);
    const color = toneColor(theme, words.tone);
    const provider = error.provider;
    const name = provider ? providerLabel(provider) : "";
    const stillPaused = !!provider && !!data?.health?.up && data.health.paused.includes(provider);
    const canResume = error.kind === "paused" && stillPaused && data?.tier === "admin";
    const resume = () => {
      if (!provider) return;
      setBusy(true);
      void reset({ kind: "breaker", provider, model: null, name, confirm: true })
        .then((result) => setReply({ text: result.message, ok: result.ok }), (failure: unknown) => setReply({ text: failure instanceof Error ? failure.message : String(failure), ok: false }))
        .finally(() => {
          setBusy(false);
          setAsking(false);
        });
    };
    return (
      <View
        accessibilityRole="alert"
        style={{ gap: SPACE.sm, padding: SPACE.row, marginVertical: SPACE.xs, borderRadius: RADIUS.control, borderWidth: 1, borderLeftWidth: 3, borderColor: tint(color, 0.4) ?? theme.colors.border, borderLeftColor: color, backgroundColor: tint(color, 0.06) ?? theme.colors.surface1 }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
          {HostIcon ? <View style={{ paddingTop: SPACE.hair }}><HostIcon name={words.icon} size={18} color={color} /></View> : null}
          <Text style={{ ...TYPE.item, color: theme.colors.foreground, flex: 1 }}>{words.title}</Text>
        </View>
        <Text style={{ ...TYPE.secondary, color: theme.colors.foreground }}>{words.retry}</Text>
        {error.kind === "paused" && provider && data?.health?.up && !stillPaused ? <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{`OmniRoute has resumed ${name} since.`}</Text> : null}
        {asking && provider ? (
          <View style={{ gap: SPACE.sm }}>
            <Note theme={theme} tone="warning">{resetQuestion("breaker", { name, provider: name })}</Note>
            <Row>
              <Link theme={theme} label={busy ? "Resuming…" : `Yes, ${resetLabel("breaker").toLowerCase()}`} onPress={() => { if (!busy) resume(); }} />
              <Link theme={theme} label="Cancel" onPress={() => setAsking(false)} />
            </Row>
          </View>
        ) : (
          <Row>
            <Link theme={theme} label="Open AI Router" accessibilityLabel="Open AI Router's Accounts tab" onPress={openRouter} />
            {canResume && !reply?.ok ? <Link theme={theme} label={resetLabel("breaker")} accessibilityLabel={`${resetLabel("breaker")}: ${name}`} onPress={() => setAsking(true)} /> : null}
          </Row>
        )}
        {reply ? <Note theme={theme} tone={reply.ok ? "success" : "danger"}>{reply.text}</Note> : null}
        <Disclosure theme={theme} quiet label="Details" openLabel="Hide details">
          <Text selectable style={{ ...TYPE.mono, color: theme.colors.foregroundMuted }}>{message}</Text>
        </Disclosure>
      </View>
    );
  };
}
