import React, { useState } from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codexReroute, codexRouter, providersList, providersTidy, type Providers, type Status } from "../shared/contracts";
import { AI_ROUTER_PROVIDER_ID, codexRowState, providerDashboardPage } from "../shared/logic";
import { routingSettings } from "../shared/settings";
import { AdvancedBanner, dashboardTarget, useLinks } from "./dashboard";
import { STATUS_KEY, errorText, type Message } from "./setup";
import { AgentAppsCard } from "./apps";
import { Banner, Button, Card, Disclosure, ItemTitle, Link, Meta, Note, Row, ToggleRow, SPACE } from "./ui";

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
    <View style={{ gap: SPACE.sm, flexShrink: 1 }}>
      <ToggleRow theme={theme} label="Re-route Claude through OmniRoute" text={on ? "Through OmniRoute" : "Own sign-in"} value={on} busy={settings.saving} disabled={settings.status !== "ready" || asking !== null} onChange={(next) => setAsking(next)} />
      {on && asking === null ? <Meta theme={theme}>Fast mode is off for these chats: OmniRoute can't pass it on yet.</Meta> : null}
      {asking === true ? (
        <>
          <Note theme={theme} tone="warning">New Claude chats here will use OmniRoute's accounts, not this daemon's sign-in; open chats switch when reopened. If OmniRoute is down, they use their own sign-in. Fast mode stays off: OmniRoute can't pass it on yet.</Note>
          <Row>
            <Button theme={theme} label="Re-route Claude" primary busy={settings.saving} onPress={confirm} />
            <Button theme={theme} label="Cancel" onPress={() => setAsking(null)} />
          </Row>
        </>
      ) : null}
      {asking === false ? (
        <>
          <Note theme={theme} tone="warning">New Claude chats will use this daemon's own sign-in. Without one they won't answer; the AI Router provider still reaches Claude through OmniRoute.</Note>
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

/**
 * Built-in Codex: its own sign-in, or OmniRoute. Codex takes its model
 * provider from config, not from the environment, so re-routing sets Paseo's
 * launch command for Codex; the key is added when each chat starts. Asks
 * first, like Claude, and says the one real difference: no fallback.
 */
function CodexReroute({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const queryClient = useQueryClient();
  const call = useRpc(codexReroute);
  const [asking, setAsking] = useState<boolean | null>(null);
  const reroute = data.codexReroute ?? { state: "off" as const, baseUrl: null, current: false };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => call({ enabled }),
    onSuccess: (result) => {
      setAsking(null);
      say({ text: result.message, tone: result.ok ? "success" : "danger" });
      void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  if (reroute.state === "foreign") return <Meta theme={theme}>Built-in Codex has its own launch command in Paseo's config, so AI Router leaves it alone.</Meta>;
  const on = reroute.state === "on";
  return (
    <View style={{ gap: SPACE.sm, flexShrink: 1 }}>
      <ToggleRow theme={theme} label="Re-route built-in Codex through OmniRoute" text={on ? "Built-in Codex goes through OmniRoute" : "Re-route built-in Codex: off, it uses its own sign-in"} value={on} busy={toggle.isPending} disabled={data.problem !== null || asking !== null} onChange={(next) => setAsking(next)} />
      {on && !reroute.current && asking === null ? <Note theme={theme} tone="warning">{`It still points at ${reroute.baseUrl ?? "an old address"}; the next model sync moves it to this router.`}</Note> : null}
      {on && asking === null ? <Meta theme={theme}>Speed: when Codex offers Fast here, OmniRoute asks its Codex account for it, and it uses that account's limits faster.</Meta> : null}
      {asking === true ? (
        <>
          <Note theme={theme} tone="warning">New built-in Codex chats here will use OmniRoute's accounts, not this daemon's sign-in; open chats switch when restarted. ~/.codex isn't changed. Unlike Claude there's no fallback: while OmniRoute is down, these chats won't answer.</Note>
          <Row>
            <Button theme={theme} label="Re-route Codex" primary busy={toggle.isPending} onPress={() => toggle.mutate(true)} />
            <Button theme={theme} label="Cancel" onPress={() => setAsking(null)} />
          </Row>
        </>
      ) : null}
      {asking === false ? (
        <>
          <Note theme={theme} tone="warning">New built-in Codex chats will use this daemon's own sign-in. Without one they won't answer; the AI Router provider still has Codex's models.</Note>
          <Row>
            <Button theme={theme} label="Use own sign-in" primary busy={toggle.isPending} onPress={() => toggle.mutate(false)} />
            <Button theme={theme} label="Cancel" onPress={() => setAsking(null)} />
          </Row>
        </>
      ) : null}
    </View>
  );
}

/** "Codex via OmniRoute": an optional second Codex entry in Paseo's menu that always uses OmniRoute. */
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
    <View style={{ gap: SPACE.xs }}>
      <ToggleRow theme={theme} label="Separate Codex via OmniRoute provider" text={present ? `"Codex via OmniRoute" is in Paseo's menu · ${data.codexRouter.modelCount} models` : `Separate "Codex via OmniRoute" provider: not added`} value={present} busy={toggle.isPending} disabled={data.problem !== null} onChange={(next) => toggle.mutate(next)} />
      <Meta theme={theme}>A second Codex in the provider menu that always uses OmniRoute, for people who prefer Codex's own app to the AI Router provider.</Meta>
    </View>
  );
}

/** Codex: what OmniRoute has first, then the two optional extras, folded unless one is on. */
function CodexSection({ theme, data, accounts, say }: { theme: Theme; data: Status; accounts: number | null; say: Say }) {
  const links = useLinks(say);
  const models = data.aiProvider.models.filter((model) => model.label.startsWith("Codex · ")).length;
  const row = codexRowState({ accounts, models, synced: data.aiProvider.present });
  const extrasOn = data.codexRouter.present || data.codexReroute?.state === "on";
  const addPage = row.state === "none" ? providerDashboardPage(dashboardTarget(data).url, "codex") : null;
  return (
    <View style={{ gap: SPACE.sm }}>
      <Note theme={theme} tone={row.tone === "warning" ? "warning" : "neutral"}>{row.text}</Note>
      {addPage ? <Link theme={theme} label="Add a Codex account in the dashboard" onPress={() => void links.open(addPage)} /> : null}
      <Disclosure theme={theme} quiet label={extrasOn ? "Optional extras (one is on)" : "Optional extras"} openLabel="Hide optional extras" initiallyOpen={extrasOn}>
        <CodexReroute theme={theme} data={data} say={say} />
        <CodexThrough theme={theme} data={data} say={say} />
      </Disclosure>
    </View>
  );
}

/**
 * The providers that can go through OmniRoute, and how. The AI Router
 * provider always does; built-in Claude has an ask-first switch; Codex says
 * what OmniRoute has, with its two extras folded; the rest aren't switched here.
 */
function RerouteCard({ theme, rows, data, codexAccounts, say }: { theme: Theme; rows: readonly ProviderRowData[]; data: Status; codexAccounts: number | null; say: Say }) {
  const router = rows.find((row) => row.id === AI_ROUTER_PROVIDER_ID);
  const claude = rows.find((row) => row.through === "claude-toggle");
  const codex = rows.find((row) => row.through === "codex-toggle");
  const others = rows.filter((row) => row.through === "none").map((row) => row.label);
  const line = (label: string, body: React.ReactNode) => (
    <View style={{ gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
      <ItemTitle theme={theme}>{label}</ItemTitle>
      {body}
    </View>
  );
  return (
    <Card theme={theme} title="Re-route providers" icon="Route">
      <Meta theme={theme}>AI Router always goes through OmniRoute. Claude can too; the switch asks first.</Meta>
      {line(router?.label ?? "AI Router", data.aiProvider.present
        ? <Meta theme={theme}>{`Always through OmniRoute · ${data.aiProvider.modelCount} models`}</Meta>
        : <Note theme={theme}>Not in Paseo yet: Models → Sync models adds it.</Note>)}
      {claude ? line(claude.label, <ClaudeReroute theme={theme} say={say} />) : null}
      {codex ? line(codex.label, <CodexSection theme={theme} data={data} accounts={codexAccounts} say={say} />) : null}
      {others.length ? line("Other providers", <Meta theme={theme}>{`${others.join(", ")}: not switched here; they keep their own sign-in.`}</Meta>) : null}
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
      {list?.state === "ok" ? <RerouteCard theme={theme} rows={list.rows} data={data} codexAccounts={list.codexAccounts} say={say} /> : null}
      {!list ? (
        <Card theme={theme} title="Re-route providers" icon="Route">
          {query.error ? <Note theme={theme} tone="danger">{errorText(query.error)}</Note> : <Note theme={theme}>Asking Paseo…</Note>}
        </Card>
      ) : list.state === "error" ? (
        <Banner theme={theme} tone="danger" title="Could not read Paseo's providers">
          <Note theme={theme}>{list.message}</Note>
          <Row><Button theme={theme} label="Try again" busy={refresh.isPending} onPress={() => refresh.mutate()} /></Row>
        </Banner>
      ) : null}
      {list?.state === "ok" ? (
        <Card theme={theme} title="Tidy up" icon="Sparkles">
          {!candidates.length ? (
            <Meta theme={theme}>Nothing to tidy: every enabled provider answers.</Meta>
          ) : !previewing ? (
            <>
              <Note theme={theme}>{`${candidates.length} enabled provider${candidates.length === 1 ? " can't" : "s can't"} run here. Turn ${candidates.length === 1 ? "it" : "them"} off to tidy Paseo's menu; Settings → Providers turns any back on.`}</Note>
              <Row><Button theme={theme} label="Tidy up…" icon="Sparkles" onPress={() => setPreviewing(true)} /></Row>
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
      <AgentAppsCard theme={theme} say={say} />
      <AdvancedBanner theme={theme} data={data} say={say} />
    </>
  );
}
