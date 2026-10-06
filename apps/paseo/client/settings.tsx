import React, { useState } from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { compression, compressionApply, settingApply, type Status } from "../shared/contracts";
import { dashboardLink } from "../shared/logic";
import { routingSettings } from "../shared/settings";
import { ROUTERS } from "../shared/routers/copy";
import type { EngineVerdict } from "../shared/routers/omniroute/copy";
import { dashboardTarget, useLinks } from "./dashboard";
import { errorText, type Message } from "./setup";
import type { GoTarget } from "../shared/tabs";
import { Button, Card, Chip, ItemTitle, Link, Meta, Note, Row, ToggleRow, type Tone, SPACE } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;
const VERDICT: Record<EngineVerdict, { label: string; tone: Tone }> = {
  recommended: { label: "recommended", tone: "success" },
  safe: { label: "safe", tone: "neutral" },
  risky: { label: "risky for agents", tone: "warning" },
  avoid: { label: "avoid for agents", tone: "danger" },
};

/**
 * What the router's compression does to agent sessions, the setting to use,
 * and (manage key only, after a confirmation) applying it. Never switched on
 * by itself.
 */
export function CompressionCard({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const queryClient = useQueryClient();
  const call = useRpc(compression);
  const callApply = useRpc(compressionApply);
  const callSetting = useRpc(settingApply);
  const [confirming, setConfirming] = useState(false);
  const [showEngines, setShowEngines] = useState(false);
  const query = useQuery({ queryKey: ["ai-router", "compression"], queryFn: () => call({}), refetchInterval: 60_000 });
  const done = (result: { ok: boolean; message: string }) => {
    setConfirming(false);
    say({ text: result.message, tone: result.ok ? "success" : "danger" });
    void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
  };
  const fail = (error: unknown) => say({ text: errorText(error), tone: "danger" });
  const apply = useMutation({ mutationFn: () => callApply({}), onSuccess: done, onError: fail });
  const off = useMutation({ mutationFn: () => callSetting({ id: "compression", on: false }), onSuccess: done, onError: fail });
  const copy = ROUTERS[data.connection.router];
  const now = query.data;
  const running = now?.state === "ok" ? now.engines : [];
  const flagged = copy.engines.filter((engine) => running.includes(engine.id) && (engine.verdict === "risky" || engine.verdict === "avoid"));
  const label = (id: string) => copy.engines.find((engine) => engine.id === id)?.label ?? id;
  return (
    <Card theme={theme} title="Context compression" icon="Minimize2" subtitle="How the router shrinks long prompts before sending them on">
      {!now ? (
        <Note theme={theme}>{query.error ? errorText(query.error) : "Asking the router…"}</Note>
      ) : now.state !== "ok" ? (
        <Note theme={theme} tone={now.state === "error" ? "danger" : "neutral"}>{now.message}</Note>
      ) : (
        <>
          <Row>
            <Chip theme={theme} label={running.length ? `Now: ${running.map(label).join(" → ")}` : "Now: off"} tone={now.recommended ? "success" : flagged.length ? "warning" : "neutral"} />
            {now.recommended ? <Chip theme={theme} label="recommended setting" tone="success" /> : null}
          </Row>
          {now.savings ? <Note theme={theme}>{now.savings}</Note> : null}
          {flagged.map((engine) => <Note key={engine.id} theme={theme} tone="warning">{`${engine.label} is on: ${engine.agents}`}</Note>)}
        </>
      )}
      <View style={{ gap: SPACE.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
        <ItemTitle theme={theme}>{copy.recommended.title}</ItemTitle>
        {copy.recommended.why.map((line) => <Note key={line} theme={theme}>{`• ${line}`}</Note>)}
      </View>
      {now?.state === "ok" && now.canEdit ? (
        confirming ? (
          <>
            <Note theme={theme} tone="warning">Turns every engine off except Lite, and excludes Codex models where this OmniRoute can. This changes the router for every daemon using it.</Note>
            <Row>
              <Button theme={theme} label="Confirm: Lite only" primary busy={apply.isPending} onPress={() => apply.mutate()} />
              <Button theme={theme} label="Cancel" onPress={() => setConfirming(false)} />
            </Row>
          </>
        ) : (
          <Row>
            {!now.recommended ? <Button theme={theme} label="Apply recommended…" onPress={() => setConfirming(true)} /> : null}
            {running.length ? <Button theme={theme} label="Turn compression off" busy={off.isPending} onPress={() => off.mutate()} /> : null}
          </Row>
        )
      ) : null}
      <Link theme={theme} label={showEngines ? "Hide what each engine does" : "What each engine does"} onPress={() => setShowEngines(!showEngines)} />
      {showEngines
        ? copy.engines.map((engine) => (
            <View key={engine.id} style={{ gap: SPACE.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.sm }}>
              <Row>
                <ItemTitle theme={theme}>{engine.label}</ItemTitle>
                <Chip theme={theme} label={VERDICT[engine.verdict].label} tone={VERDICT[engine.verdict].tone} />
                {running.includes(engine.id) ? <Chip theme={theme} label="on" /> : null}
              </Row>
              <Note theme={theme}>{engine.what}</Note>
              <Meta theme={theme}>{`For agents: ${engine.agents}`}</Meta>
            </View>
          ))
        : null}
    </Card>
  );
}

/** A few of the router's features worth knowing about, each one line and a link. */
export function MoreCard({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const links = useLinks(say);
  const { url } = dashboardTarget(data);
  const copy = ROUTERS[data.connection.router];
  return (
    <Card theme={theme} title={`More in ${copy.label}`} icon="Compass">
      <Meta theme={theme}>In the dashboard, which has its own login (ask your router admin).</Meta>
      {copy.more.map((item) => {
        const link = dashboardLink(url, item.path);
        return (
          <View key={item.title} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.sm }}>
            <View style={{ flex: 1, minWidth: 200, gap: SPACE.hair }}>
              <ItemTitle theme={theme}>{item.title}</ItemTitle>
              <Meta theme={theme}>{item.detail}</Meta>
            </View>
            {link ? <Link theme={theme} label="Open" accessibilityLabel={`Open ${item.title}`} onPress={() => void links.open(link)} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

/**
 * What AI Router adds to Paseo itself. Every tier, and no router needed. Since
 * 0.18.0 a chat shows a chip from AI Router only while the router can't serve
 * it, so there is no chip switch; the commands are listed here so they can be found.
 */
export function InPaseoCard({ theme, say }: { theme: Theme; say: Say }) {
  const settings = useSettings(routingSettings);
  const ready = settings.status === "ready";
  const mcp = ready ? settings.values.mcpCard !== false : true;
  const setMcp = (next: boolean) => {
    if (settings.status !== "ready") return;
    void settings.save({ ...settings.values, mcpCard: next }, settings.revision).then((saved) => {
      say(saved ? { text: next ? "MCP line back on Overview." : "MCP line hidden.", tone: "success" } : { text: "The switch was changed elsewhere; try again.", tone: "warning" });
    });
  };
  return (
    <Card theme={theme} title="In Paseo" icon="ToggleRight">
      <Note theme={theme}>A chat shows a warning chip from AI Router only while the router can't serve it, such as "Router down" or "Claude paused". It goes away by itself once that's fixed.</Note>
      <Meta theme={theme}>From the Command Center: "Sync AI Router models to Paseo" and "Check the AI Router connection". In a chat: /ai-router sync or /ai-router check.</Meta>
      <ToggleRow theme={theme} label="MCP plugin line on Overview" text="MCP plugin line on Overview" value={mcp} busy={settings.saving} disabled={!ready} onChange={setMcp} />
      {settings.saveError ? <Note theme={theme} tone="danger">{settings.saveError}</Note> : null}
      {settings.status === "error" || settings.status === "invalid" ? <Note theme={theme} tone="danger">{settings.error}</Note> : null}
    </Card>
  );
}

/** Router settings for someone without a read token, or before a router is connected: what a token adds, and where to add it. */
export function RouterSettingsNeedToken({ theme, configured, go }: { theme: Theme; configured: boolean; go: (target: GoTarget) => void }) {
  return (
    <>
      <Note theme={theme}>{configured ? "A read token shows how the router compresses prompts, and a few key settings." : "Connect a router to see its settings."}</Note>
      <Link theme={theme} label={configured ? "Add a read token" : "Connect a router"} onPress={() => go("connection")} />
    </>
  );
}
