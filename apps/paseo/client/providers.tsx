import React, { useState } from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codexRouter, providersList, providersTidy, type Providers, type Status } from "../shared/contracts";
import { AI_ROUTER_PROVIDER_ID, codexRowState, providerDashboardPage } from "../shared/logic";
import { dashboardTarget, useLinks } from "./dashboard";
import { STATUS_KEY, errorText, type Message } from "./setup";
import { ClaudeSwitch, CodexSwitch } from "./routing";
import { Banner, Button, Card, ItemTitle, Link, Meta, Note, Row, ToggleRow, SPACE } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;
type ProviderRowData = Providers["rows"][number];
export const PROVIDERS_KEY = ["ai-router", "providers"] as const;

/** After a routing switch: every AI Router read on the page again. */
function useRoutingChanged() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
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

/** Codex: what OmniRoute has for it. Its two optional extras are the Models tab's "Codex extras" fold-out. */
function CodexSection({ theme, data, accounts, say }: { theme: Theme; data: Status; accounts: number | null; say: Say }) {
  const links = useLinks(say);
  const models = data.aiProvider.models.filter((model) => model.label.startsWith("Codex · ")).length;
  const row = codexRowState({ accounts, models, synced: data.aiProvider.present });
  const addPage = row.state === "none" ? providerDashboardPage(dashboardTarget(data).url, "codex") : null;
  return (
    <View style={{ gap: SPACE.sm }}>
      <Note theme={theme} tone={row.tone === "warning" ? "warning" : "neutral"}>{row.text}</Note>
      {addPage ? <Link theme={theme} label="Add a Codex account in the dashboard" onPress={() => void links.open(addPage)} /> : null}
    </View>
  );
}

/** The Codex extras, both optional: built-in Codex through the router, and a separate "Codex via OmniRoute" provider. */
export function CodexExtras({ theme, data, configured, say }: { theme: Theme; data: Status; configured: boolean; say: Say }) {
  const changed = useRoutingChanged();
  return (
    <>
      <CodexSwitch theme={theme} data={data} configured={configured} onChanged={changed} />
      <CodexThrough theme={theme} data={data} say={say} />
    </>
  );
}

/** Whether a Codex extra is on, so its fold-out opens by itself. */
export const codexExtrasOn = (data: Status) => data.codexRouter.present || data.codexReroute?.state === "on";

/**
 * The providers that can go through OmniRoute, and how. The AI Router
 * provider always does; built-in Claude has an ask-first switch; Codex says
 * what OmniRoute has, with its two extras folded; the rest aren't switched here.
 * Before a router is connected, the AI Router and Codex rows (which depend on
 * it) stay out: the tab's one "Connect a router first" line says it.
 */
function RerouteCard({ theme, rows, data, configured, codexAccounts, say }: { theme: Theme; rows: readonly ProviderRowData[]; data: Status; configured: boolean; codexAccounts: number | null; say: Say }) {
  const router = rows.find((row) => row.id === AI_ROUTER_PROVIDER_ID);
  const claude = rows.find((row) => row.through === "claude-toggle");
  const codex = rows.find((row) => row.through === "codex-toggle");
  const others = rows.filter((row) => row.through === "none").map((row) => row.label);
  const changed = useRoutingChanged();
  const line = (label: string, body: React.ReactNode) => (
    <View style={{ gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
      <ItemTitle theme={theme}>{label}</ItemTitle>
      {body}
    </View>
  );
  return (
    <Card theme={theme} title="Send chats through the router" icon="Route">
      <Meta theme={theme}>AI Router chats always go through OmniRoute. Built-in Claude and Codex can too; each switch asks first, and Overview has the same two.</Meta>
      {configured
        ? line(router?.label ?? "AI Router", data.aiProvider.present
          ? <Meta theme={theme}>{`Always through OmniRoute · ${data.aiProvider.modelCount} models`}</Meta>
          : <Note theme={theme}>Not in Paseo yet: Sync models, above, adds it.</Note>)
        : null}
      {claude ? line(claude.label, <ClaudeSwitch theme={theme} data={data} configured={configured} onChanged={changed} />) : null}
      {codex && configured ? line(codex.label, <CodexSection theme={theme} data={data} accounts={codexAccounts} say={say} />) : null}
      {others.length ? line("Other providers", <Meta theme={theme}>{`${others.join(", ")}: not switched here; they keep their own sign-in.`}</Meta>) : null}
    </Card>
  );
}

/** Paseo's providers, read once and shared by the routing card and Tidy up. */
function useProvidersList() {
  const callList = useRpc(providersList);
  return useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => callList({}), refetchInterval: 30_000 });
}

/** Which chats go through the router: the AI Router provider, built-in Claude's switch, and what Codex has. */
export function RoutingCard({ theme, data, configured, say }: { theme: Theme; data: Status; configured: boolean; say: Say }) {
  const queryClient = useQueryClient();
  const callList = useRpc(providersList);
  const query = useProvidersList();
  const refresh = useMutation({ mutationFn: () => callList({ refresh: true }), onSuccess: (next) => queryClient.setQueryData(PROVIDERS_KEY, next), onError: (error) => say({ text: errorText(error), tone: "danger" }) });
  const list = query.data;
  if (list?.state === "ok") return <RerouteCard theme={theme} rows={list.rows} data={data} configured={configured} codexAccounts={list.codexAccounts} say={say} />;
  if (list?.state === "error") {
    return (
      <Banner theme={theme} tone="danger" title="Could not read Paseo's providers">
        <Note theme={theme}>{list.message}</Note>
        <Row><Button theme={theme} label="Try again" busy={refresh.isPending} onPress={() => refresh.mutate()} /></Row>
      </Banner>
    );
  }
  return (
    <Card theme={theme} title="Send chats through the router" icon="Route">
      {query.error ? <Note theme={theme} tone="danger">{errorText(query.error)}</Note> : <Note theme={theme}>Asking Paseo…</Note>}
    </Card>
  );
}

/** How many enabled providers can't run here, for Tidy up's one-line summary; null until Paseo answers. */
export function useTidyCount(): number | null {
  const list = useProvidersList().data;
  return list?.state === "ok" ? list.rows.filter((row) => row.tidy !== null).length : null;
}

/** Turn off enabled providers that can't run on this daemon, after a preview. */
export function TidyUp({ theme, say }: { theme: Theme; say: Say }) {
  const queryClient = useQueryClient();
  const callTidy = useRpc(providersTidy);
  const [previewing, setPreviewing] = useState(false);
  const list = useProvidersList().data;
  const tidy = useMutation({
    mutationFn: (ids: string[]) => callTidy({ ids }),
    onSuccess: (result) => {
      setPreviewing(false);
      say({ text: result.message, tone: result.ok ? "success" : "danger" });
      void queryClient.invalidateQueries({ queryKey: PROVIDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  if (list?.state !== "ok") return <Meta theme={theme}>{list ? "Paseo's providers couldn't be read." : "Asking Paseo…"}</Meta>;
  const candidates = list.rows.filter((row) => row.tidy !== null);
  if (!candidates.length) return <Meta theme={theme}>Nothing to tidy: every enabled provider answers.</Meta>;
  if (!previewing) {
    return (
      <>
        <Note theme={theme}>{`${candidates.length} enabled provider${candidates.length === 1 ? " can't" : "s can't"} run here. Turn ${candidates.length === 1 ? "it" : "them"} off to tidy Paseo's menu; Settings → Providers turns any back on.`}</Note>
        <Row><Button theme={theme} label="Tidy up…" icon="Sparkles" onPress={() => setPreviewing(true)} /></Row>
      </>
    );
  }
  return (
    <>
      <Note theme={theme}>These will be turned off:</Note>
      {candidates.map((row) => <Note key={row.id} theme={theme}>{`• ${row.label} — ${row.tidy}`}</Note>)}
      <Note theme={theme}>Claude, Codex, the router's providers and anything you set up yourself are never touched.</Note>
      <Row>
        <Button theme={theme} label={`Turn off ${candidates.length}`} primary busy={tidy.isPending} onPress={() => tidy.mutate(candidates.map((row) => row.id))} />
        <Button theme={theme} label="Cancel" onPress={() => setPreviewing(false)} />
      </Row>
    </>
  );
}
