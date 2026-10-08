import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { codexReroute, switchedAway, type Status } from "../shared/contracts";
import { APP_NAMES, routingOffer, switchWords, type RoutedApp } from "../shared/routing";
import { routingSettings } from "../shared/settings";
import { Confirm, hasDialog } from "./feedback";
import { Button, Meta, Note, Row, SPACE, TYPE, Toggle } from "./ui";

// Built-in Claude and Codex: through the router, or this computer's own
// sign-in (0.21.0). One switch for each, the same on Overview and Models.
// Each asks first (0.22.0: in Paseo's dialog on the AI Router screen; in
// place in a popover or chat card, or on older apps), shows "Switching…"
// while it works, and says what happened right under it (never only at the
// top of the page). Before a router is
// connected, a switch that is off says why it can't be turned on.
// The switch-back offer for router trouble lives here too: Overview, the
// sidebar popover, the chat chip and the chat card all show the same one.

type Theme = PluginTheme;
export type Outcome = { ok: boolean; text: string };
type RoutingControl = {
  on: boolean;
  /** Settings or status not read yet. */
  ready: boolean;
  busy: boolean;
  /** Turn it on or off; `fallback`: because the router can't serve it (so "Switch back" is offered later). */
  set(next: boolean, fallback?: boolean): Promise<Outcome>;
};

const failure = (error: unknown): Outcome => ({ ok: false, text: `Not switched: ${error instanceof Error ? error.message : String(error)}` });

/** Built-in Claude: the routing setting, saved through Paseo's settings. */
export function useClaudeRouting(onChanged?: () => void): RoutingControl {
  const settings = useSettings(routingSettings);
  const note = useRpc(switchedAway);
  const latest = useRef(settings);
  latest.current = settings;
  const [busy, setBusy] = useState(false);
  const ready = settings.status === "ready";
  return {
    on: ready ? settings.values.routeAgents : false,
    ready,
    busy: busy || settings.saving,
    async set(next, fallback = false) {
      const now = latest.current;
      if (now.status !== "ready") return { ok: false, text: "Not switched: the routing setting hasn't loaded yet. Try again in a moment." };
      setBusy(true);
      try {
        const saved = await now.save({ ...now.values, routeAgents: next }, now.revision);
        if (!saved) return { ok: false, text: `Not switched: ${latest.current.saveError ?? "the setting changed somewhere else just now. Try again."}` };
        // Only the reason is remembered here; a failure to note it never undoes the switch.
        await note({ app: "claude", away: !next && fallback }).catch(() => undefined);
        onChanged?.();
        return { ok: true, text: next ? "Done: Claude now goes through the router, so new Claude chats use your team's accounts. Open chats switch when reopened." : "Done: Claude now uses this computer's own sign-in for new chats. Open chats switch when reopened." };
      } catch (error) {
        return failure(error);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Built-in Codex: its launch command in Paseo's config, changed on the daemon. */
export function useCodexRouting(data: Status | null, onChanged?: () => void): RoutingControl & { foreign: boolean } {
  const call = useRpc(codexReroute);
  const [busy, setBusy] = useState(false);
  const state = data?.codexReroute?.state;
  return {
    on: state === "on",
    ready: !!data,
    foreign: state === "foreign",
    busy,
    async set(next, fallback = false) {
      setBusy(true);
      try {
        const result = await call({ enabled: next, ...(fallback ? { fallback: true } : {}) });
        if (result.ok) onChanged?.();
        return { ok: result.ok, text: result.message };
      } catch (error) {
        return failure(error);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** What each way round means, asked before anything changes. */
const QUESTIONS: Record<RoutedApp, Record<"on" | "off", string>> = {
  claude: {
    on: "New Claude chats here will use your team's accounts on the router, not this computer's own sign-in. Open chats switch when reopened. A chat that starts while the router is down uses this computer's own sign-in. Fast mode stays off for them: the router can't pass it on yet.",
    off: "New Claude chats here will use this computer's own sign-in. Without one they won't answer; the AI Router provider still reaches Claude through the router.",
  },
  codex: {
    on: "New Codex chats here will use your team's accounts on the router, not this computer's own sign-in. Open chats switch when restarted; ~/.codex isn't changed. While the router is down, these chats won't answer until you switch back.",
    off: "New Codex chats here will use this computer's own sign-in. Without one they won't answer; the AI Router provider still has Codex's models.",
  },
};

/**
 * One switch: "Claude · through the router [on/off]", what that means in
 * words, the ask-first step, progress and the outcome. `blocked` says why it
 * can't be turned on (no router yet); it can always be turned off.
 */
export function RoutingSwitch({ theme, app, control, blocked, note }: { theme: Theme; app: RoutedApp; control: RoutingControl; blocked?: string | null; note?: string | null }) {
  const [asking, setAsking] = useState<boolean | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // While it works, the switch already shows where it's going; a failure puts it back.
  const shown = pending ?? control.on;
  const words = switchWords(app, shown);
  const cannotTurnOn = !!blocked && !control.on;
  const confirm = () => {
    if (asking === null) return;
    const next = asking;
    setAsking(null);
    setPending(next);
    setOutcome(null);
    void control.set(next).then((result) => {
      setOutcome(result);
      setPending(null);
    });
  };
  return (
    <View style={{ gap: SPACE.sm, flexShrink: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.row }}>
        <Toggle
          theme={theme}
          label={words.title}
          value={shown}
          busy={pending !== null || control.busy}
          disabled={!control.ready || asking !== null || cannotTurnOn}
          onChange={(next) => {
            setOutcome(null);
            setAsking(next);
          }}
        />
        <View style={{ flex: 1, gap: SPACE.hair }}>
          <Text style={{ ...TYPE.item, color: theme.colors.foreground }}>{words.title}</Text>
          <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{pending !== null ? "Switching…" : `${words.state} · ${words.meaning}`}</Text>
        </View>
      </View>
      {cannotTurnOn ? <Meta theme={theme}>{blocked}</Meta> : null}
      {note && asking === null ? <Meta theme={theme}>{note}</Meta> : null}
      <Confirm
        theme={theme}
        open={asking !== null}
        title={asking ? `Send ${APP_NAMES[app]} through the router?` : `Use this computer's own sign-in for ${APP_NAMES[app]}?`}
        text={QUESTIONS[app][asking ? "on" : "off"]}
        confirmLabel={asking ? `Yes, send ${APP_NAMES[app]} through the router` : "Use own sign-in"}
        onConfirm={confirm}
        onCancel={() => setAsking(null)}
      />
      {outcome ? <Note theme={theme} tone={outcome.ok ? "success" : "danger"}>{outcome.text}</Note> : null}
    </View>
  );
}

/** Built-in Claude's switch, wired. */
export function ClaudeSwitch({ theme, data, configured, onChanged }: { theme: Theme; data: Status; configured: boolean; onChanged?: () => void }) {
  const control = useClaudeRouting(onChanged);
  return <RoutingSwitch theme={theme} app="claude" control={control} blocked={configured ? null : "Connect a router first to turn this on."} note={control.on && data ? "Fast mode is off for these chats: the router can't pass it on yet." : null} />;
}

/** Built-in Codex's switch, wired. A launch command someone else set is left alone. */
export function CodexSwitch({ theme, data, configured, onChanged }: { theme: Theme; data: Status; configured: boolean; onChanged?: () => void }) {
  const control = useCodexRouting(data, onChanged);
  if (control.foreign) return <Meta theme={theme}>Codex has its own launch command in Paseo's config, so AI Router leaves it alone.</Meta>;
  const reroute = data.codexReroute;
  const stale = control.on && reroute && !reroute.current ? `It still points at ${reroute.baseUrl ?? "an old address"}; the next model sync moves it to this router.` : null;
  return <RoutingSwitch theme={theme} app="codex" control={control} blocked={configured ? null : "Connect a router first to turn this on."} note={stale} />;
}

// ------------------------------------------------- when the router can't

/**
 * The offer while the router is down or has paused Claude or Codex: one press
 * to use this computer's own sign-in, asked first and never automatic. Where
 * there's no sign-in here, it says so instead. Once the router works again,
 * "Switch back to the router". Nothing at all while all is well.
 */
export function RoutingOffer({ theme, data, app, control, compact, troubleOnly }: { theme: Theme; data: Status; app: RoutedApp; control: RoutingControl; compact?: boolean; troubleOnly?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const offer = routingOffer({
    app,
    routed: control.on,
    health: data.health ? { up: data.health.up, paused: data.health.paused } : null,
    signIn: data.ownSignIn?.[app] ?? null,
    switchedAway: data.switchedAway?.[app] ?? false,
  });
  if (outcome) return <Note theme={theme} tone={outcome.ok ? "success" : "danger"}>{outcome.text}</Note>;
  if (offer.kind === "none" || !control.ready || (troubleOnly && offer.kind === "back")) return null;
  if (offer.kind === "no-own") return <Note theme={theme} tone="warning">{offer.text}</Note>;
  const back = offer.kind === "back";
  const run = () => {
    setAsking(false);
    void control.set(back, !back).then(setOutcome);
  };
  return (
    <View style={{ gap: SPACE.sm }}>
      {!back && !compact ? <Text style={{ ...TYPE.secondary, color: theme.colors.foreground }}>{`${offer.problem}. ${APP_NAMES[app]} can use this computer's own sign-in until it's back.`}</Text> : null}
      {asking && (compact || !hasDialog()) ? null : (
        <Row>
          <Button theme={theme} label={offer.label} icon={back ? "Route" : "KeyRound"} primary={!back} busy={control.busy} disabled={asking} onPress={() => { setOutcome(null); setAsking(true); }} />
        </Row>
      )}
      <Confirm
        theme={theme}
        open={asking}
        inPlace={compact}
        title={back ? `Switch ${APP_NAMES[app]} back to the router?` : `Use this computer's own sign-in for ${APP_NAMES[app]}?`}
        text={offer.question}
        confirmLabel={back ? "Yes, switch back" : "Yes, use own sign-in"}
        busy={control.busy}
        onConfirm={run}
        onCancel={() => setAsking(false)}
      />
    </View>
  );
}

/** Both apps' offers, wired; renders nothing while all is well. `troubleOnly`: no "Switch back" (a chat card from the past). */
export function RoutingOffers({ theme, data, onChanged, compact, troubleOnly }: { theme: Theme; data: Status; onChanged?: () => void; compact?: boolean; troubleOnly?: boolean }) {
  const claude = useClaudeRouting(onChanged);
  const codex = useCodexRouting(data, onChanged);
  return (
    <>
      <RoutingOffer theme={theme} data={data} app="claude" control={claude} compact={compact} troubleOnly={troubleOnly} />
      {codex.foreign ? null : <RoutingOffer theme={theme} data={data} app="codex" control={codex} compact={compact} troubleOnly={troubleOnly} />}
    </>
  );
}

/** Whether an offer would show for either app: so a popover or card can leave the space out. */
export function hasRoutingOffer(data: Status | null, claudeOn: boolean): boolean {
  if (!data) return false;
  const health = data.health ? { up: data.health.up, paused: data.health.paused } : null;
  const offer = (app: RoutedApp, routed: boolean) => routingOffer({ app, routed, health, signIn: data.ownSignIn?.[app] ?? null, switchedAway: data.switchedAway?.[app] ?? false }).kind !== "none";
  return offer("claude", claudeOn) || offer("codex", data.codexReroute?.state === "on");
}

/** A fault in the offer (an app without settings in this place, say) never takes the chat card or popover with it. */
export class OfferBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
