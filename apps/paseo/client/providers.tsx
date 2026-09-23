import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codexRouter, providersList, providersTidy, type Providers, type Status } from "../shared/contracts";
import { AI_ROUTER_PROVIDER_ID } from "../shared/logic";
import { routingSettings } from "../shared/settings";
import { AdvancedBanner } from "./dashboard";
import { STATUS_KEY, errorText, type Message } from "./setup";
import { Banner, Button, Card, Chip, Note, Row, Toggle } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;
type ProviderRowData = Providers["rows"][number];
const PROVIDERS_KEY = ["ai-router", "providers"] as const;

/**
 * Built-in Claude: its own sign-in, or OmniRoute's accounts. Off unless a
 * person turns it on, and either way the switch asks first and says what
 * changes; nothing is saved until they confirm.
 */
function ClaudeReroute({ theme, say }: { theme: Theme; say: Say }) {
  const settings = useSettings(routingSettings);
  const [asking, setAsking] = useState<boolean | null>(null);
  const on = settings.status === "ready" ? settings.values.routeAgents : false;
  const confirm = () => {
    if (settings.status !== "ready" || asking === null) return;
    const next = asking;
    void settings.save({ ...settings.values, routeAgents: next }, settings.revision).then((saved) => {
      setAsking(null);
      say(saved
        ? { text: next ? "Claude re-routed: new Claude chats use OmniRoute." : "Claude back on its own sign-in for new chats.", tone: "success" }
        : { text: "The switch was changed elsewhere; try again.", tone: "warning" });
    });
  };
  return (
    <View style={{ gap: 6, flexShrink: 1 }}>
      <Row>
        <Toggle theme={theme} label="Re-route Claude through OmniRoute" value={on} busy={settings.saving} disabled={settings.status !== "ready" || asking !== null} onChange={(next) => setAsking(next)} />
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{on ? "Through OmniRoute" : "Own sign-in"}</Text>
      </Row>
      {asking === true ? (
        <>
          <Note theme={theme} tone="warning">New Claude chats on this daemon will use OmniRoute's accounts instead of this daemon's own Claude sign-in. Open chats switch when they reopen. ~/.claude is not changed, and if OmniRoute is down a chat keeps its own sign-in.</Note>
          <Row>
            <Button theme={theme} label="Re-route Claude" primary busy={settings.saving} onPress={confirm} />
            <Button theme={theme} label="Cancel" onPress={() => setAsking(null)} />
          </Row>
        </>
      ) : null}
      {asking === false ? (
        <>
          <Note theme={theme} tone="warning">New Claude chats will use this daemon's own Claude sign-in. If this daemon has none, they won't answer: pick the AI Router provider for Claude through OmniRoute instead.</Note>
          <Row>
            <Button theme={theme} label="Use own sign-in" primary busy={settings.saving} onPress={confirm} />
            <Button theme={theme} label="Cancel" onPress={() => setAsking(null)} />
          </Row>
        </>
      ) : null}
      {settings.saveError ? <Note theme={theme} tone="danger">{settings.saveError}</Note> : null}
    </View>
  );
}

/** Built-in Codex ignores env, so OmniRoute comes in as a separate "Codex via OmniRoute" provider. */
function CodexThrough({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const queryClient = useQueryClient();
  const call = useRpc(codexRouter);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => call({ enabled }),
    onSuccess: (result) => {
      say({ text: result.message, tone: result.ok ? "success" : "danger" });
      void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  const present = data.codexRouter.present;
  return (
    <View style={{ gap: 4, flexShrink: 1 }}>
      <Row>
        <Toggle theme={theme} label="Codex via OmniRoute" value={present} busy={toggle.isPending} disabled={data.problem !== null} onChange={(next) => toggle.mutate(next)} />
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{present ? `Codex via OmniRoute · ${data.codexRouter.modelCount} models` : "Add Codex via OmniRoute"}</Text>
      </Row>
      {!present ? <Note theme={theme}>A separate provider that runs Codex on your OmniRoute accounts; no Codex login needed here.</Note> : null}
    </View>
  );
}

/**
 * The providers that can go through OmniRoute, and how. The AI Router
 * provider is the way to use OmniRoute; a built-in provider keeps its own
 * sign-in unless a person re-routes it here.
 */
function RerouteCard({ theme, rows, data, say }: { theme: Theme; rows: readonly ProviderRowData[]; data: Status; say: Say }) {
  const router = rows.find((row) => row.id === AI_ROUTER_PROVIDER_ID);
  const claude = rows.find((row) => row.through === "claude-toggle");
  const codex = rows.find((row) => row.through === "codex-provider");
  const others = rows.filter((row) => row.through === "none").map((row) => row.label);
  const line = (label: string, body: React.ReactNode) => (
    <View style={{ gap: 6, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 10 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      {body}
    </View>
  );
  return (
    <Card theme={theme} title="Re-route providers">
      <Note theme={theme}>The AI Router provider is the way to use OmniRoute: pick it in Paseo's menu and every connected model is there. A built-in provider keeps its own sign-in unless you re-route it here.</Note>
      {line(router?.label ?? "AI Router", data.aiProvider.present
        ? <Row><Chip theme={theme} label="Always through OmniRoute" tone="success" /><Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`${data.aiProvider.modelCount} models`}</Text></Row>
        : <Note theme={theme}>Not in Paseo yet: Models → Sync models to Paseo adds it.</Note>)}
      {claude ? line(claude.label, <ClaudeReroute theme={theme} say={say} />) : null}
      {codex ? line(codex.label, <CodexThrough theme={theme} data={data} say={say} />) : null}
      {others.length ? <Note theme={theme}>{`Can't be re-routed: ${others.join(", ")}. Their models are in the AI Router provider when OmniRoute has an account for them.`}</Note> : null}
    </Card>
  );
}

export function ProvidersTab({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const queryClient = useQueryClient();
  const callList = useRpc(providersList);
  const callTidy = useRpc(providersTidy);
  const [previewing, setPreviewing] = useState(false);
  const query = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => callList({}), refetchInterval: 30_000 });
  const done = (result: { ok: boolean; message: string }) => {
    say({ text: result.message, tone: result.ok ? "success" : "danger" });
    void queryClient.invalidateQueries({ queryKey: PROVIDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  };
  const fail = (error: unknown) => say({ text: errorText(error), tone: "danger" });
  const tidy = useMutation({ mutationFn: (ids: string[]) => callTidy({ ids }), onSuccess: (result) => { setPreviewing(false); done(result); }, onError: fail });
  const refresh = useMutation({ mutationFn: () => callList({ refresh: true }), onSuccess: (next) => queryClient.setQueryData(PROVIDERS_KEY, next), onError: fail });
  const list = query.data;
  const candidates = list?.rows.filter((row) => row.tidy !== null) ?? [];
  return (
    <>
      {list?.state === "ok" ? <RerouteCard theme={theme} rows={list.rows} data={data} say={say} /> : null}
      <AdvancedBanner theme={theme} data={data} say={say} />
      {!list ? (
        <Card theme={theme} title="Re-route providers">
          {query.error ? <Note theme={theme} tone="danger">{errorText(query.error)}</Note> : <Note theme={theme}>Asking Paseo…</Note>}
        </Card>
      ) : list.state === "error" ? (
        <Banner theme={theme} tone="danger" title="Could not read Paseo's providers">
          <Note theme={theme}>{list.message}</Note>
          <Row><Button theme={theme} label="Try again" busy={refresh.isPending} onPress={() => refresh.mutate()} /></Row>
        </Banner>
      ) : null}
      {list?.state === "ok" ? (
        <Card theme={theme} title="Tidy up">
          {!candidates.length ? (
            <Note theme={theme}>Nothing to tidy: every enabled provider answers. Claude, Codex, the router's providers and anything you set up yourself are never touched. Turning providers on and off one by one is in Paseo's Settings → Providers.</Note>
          ) : !previewing ? (
            <>
              <Note theme={theme}>{`${candidates.length} enabled provider${candidates.length === 1 ? " is" : "s are"} not usable on this daemon. Turning ${candidates.length === 1 ? "it" : "them"} off tidies Paseo's menu; any can go back on in Paseo's Settings → Providers.`}</Note>
              <Row><Button theme={theme} label="Tidy up…" onPress={() => setPreviewing(true)} /></Row>
            </>
          ) : (
            <>
              <Note theme={theme}>These will be turned off:</Note>
              {candidates.map((row) => <Note key={row.id} theme={theme}>{`• ${row.label} — ${row.tidy}`}</Note>)}
              <Note theme={theme}>Claude, Codex, the router's providers and anything you set up yourself are never touched.</Note>
              <Row>
                <Button theme={theme} label={`Turn off ${candidates.length}`} primary busy={tidy.isPending} onPress={() => tidy.mutate(candidates.map((row) => row.id))} />
                <Button theme={theme} label="Cancel" onPress={() => setPreviewing(false)} />
              </Row>
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}
