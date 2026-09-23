import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { compression, compressionApply, settingApply, type Status } from "../shared/contracts";
import { dashboardLink } from "../shared/logic";
import { ROUTERS } from "../server/routers/copy";
import type { EngineVerdict } from "../server/routers/omniroute/copy";
import { AdvancedBanner, dashboardTarget, useLinks } from "./dashboard";
import { RouterSettingsCard } from "./insights";
import { errorText, type Message } from "./setup";
import { Button, Card, Chip, Link, Note, Row, type Tone } from "./ui";

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
function CompressionCard({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
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
    <Card theme={theme} title="Context compression">
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
      <View style={{ gap: 4, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{copy.recommended.title}</Text>
        {copy.recommended.why.map((line) => <Note key={line} theme={theme}>{`• ${line}`}</Note>)}
      </View>
      {now?.state === "ok" && now.canEdit ? (
        confirming ? (
          <>
            <Note theme={theme} tone="warning">Turns every engine off except Lite, and excludes Codex models where this OmniRoute supports it. It changes the router for every key and daemon using it.</Note>
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
            <View key={engine.id} style={{ gap: 2 }}>
              <Row>
                <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{engine.label}</Text>
                <Chip theme={theme} label={VERDICT[engine.verdict].label} tone={VERDICT[engine.verdict].tone} />
                {running.includes(engine.id) ? <Chip theme={theme} label="on" /> : null}
              </Row>
              <Note theme={theme}>{engine.what}</Note>
              <Note theme={theme}>{`For agents: ${engine.agents}`}</Note>
            </View>
          ))
        : null}
    </Card>
  );
}

/** A few of the router's features worth knowing about, each one line and a link. */
function MoreCard({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const links = useLinks(say);
  const { url } = dashboardTarget(data);
  const copy = ROUTERS[data.connection.router];
  return (
    <Card theme={theme} title={`More in ${copy.label}`}>
      <Note theme={theme}>These live in the dashboard, which asks for its own login (ask your router admin).</Note>
      {copy.more.map((item) => {
        const link = dashboardLink(url, item.path);
        return (
          <View key={item.title} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{item.title}</Text>
              <Note theme={theme}>{item.detail}</Note>
            </View>
            {link ? <Link theme={theme} label="Open" accessibilityLabel={`Open ${item.title}`} onPress={() => void links.open(link)} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

export function SettingsTab({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  return (
    <>
      <AdvancedBanner theme={theme} data={data} say={say} />
      <CompressionCard theme={theme} data={data} say={say} />
      <RouterSettingsCard theme={theme} dashboardUrl={dashboardTarget(data).url} onMessage={say} />
      <MoreCard theme={theme} data={data} say={say} />
    </>
  );
}
