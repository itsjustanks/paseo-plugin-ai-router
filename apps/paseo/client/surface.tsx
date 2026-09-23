import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { access, aiProvider, connectionClear, connectionTest, modelTest, status, tunnelSet, tunnels, type Status } from "../shared/contracts";
import { providerLabel } from "../server/routers/omniroute/parsers";
import { CODEX_LOGIN_PORT, TIER_LABELS, lastAgentLine, privateDashboardAccess, tunnelDashboardUrl } from "../shared/logic";
import { routingSettings } from "../shared/settings";
import { ROUTERS } from "../server/routers/copy";
import { OpenDashboardButton, dashboardTarget, useLinks } from "./dashboard";
import { AccountsTab, UsageTab } from "./insights";
import { SectionHeading, TabBar, visibleTabs, type TabId } from "./navigation";
import { ProvidersTab } from "./providers";
import { SettingsTab } from "./settings";
import { ConnectionForm, KeysCard, STATUS_KEY, errorText, type Message } from "./setup";
import { Banner, Button, Card, Chip, Fact, Field, Link, Note, Row, StatusLine, type Tone } from "./ui";

type Theme = PluginTheme;
type Go = (tab: TabId) => void;
type Say = (message: Message) => void;
const masked = (secret: Status["connection"]["apiKey"]) => (secret.present ? `…${secret.last4}` : "none");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** "14:02" today, "Sep 22, 14:02" otherwise. */
function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? hhmm(iso) : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${hhmm(iso)}`;
}

function healthLine(data: Status): { label: string; tone: Tone } {
  const health = data.health;
  if (!health) return data.checking ? { label: "Checking…", tone: "neutral" } : { label: "Not checked", tone: "neutral" };
  if (!health.up) return { label: "Down", tone: "danger" };
  return { label: health.latencyMs === null ? "Up" : `Up · ${health.latencyMs} ms`, tone: "success" };
}

/** Overview's button and the Models tab share one sync. */
function useSync(say: Say) {
  const queryClient = useQueryClient();
  const call = useRpc(aiProvider);
  return useMutation({
    mutationFn: (enabled: boolean) => call({ enabled }),
    onSuccess: (result) => {
      say({ text: result.message, tone: result.ok ? "success" : "danger" });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
}

/** Check now: a fresh health check, said in one line. */
function useCheck(say: Say, name: string) {
  const queryClient = useQueryClient();
  const call = useRpc(status);
  return useMutation({
    mutationFn: () => call({ refresh: true }),
    onSuccess: (next) => {
      queryClient.setQueryData(STATUS_KEY, next);
      const health = next.health;
      if (next.checking) say({ text: `${name} is slow to answer; still checking.`, tone: "warning" });
      else if (health?.up) say({ text: `${name} answered${health.latencyMs !== null ? ` in ${health.latencyMs} ms` : ""}.`, tone: "success" });
      else say({ text: `${name} did not answer: ${health?.error ?? "no reason given"}`, tone: "danger" });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
}

/** One small line: what a read token or manage key would add. Nothing at the top tier. */
function MoreAccessLine({ theme, data, go }: { theme: Theme; data: Status; go: Go }) {
  const text =
    data.tier === "basic" ? "More with a read token (every account's health, usage, router settings) or a manage key (account checks, tunnels, settings changes)." :
    data.tier === "operator" ? "More with a manage key: account checks, tunnels and settings changes." : null;
  if (!text) return null;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={text} onPress={() => go("connection")} style={{ paddingVertical: 4 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{text} <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>Connection →</Text></Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Overview

/** Up or down, Claude routing, models in Paseo, access; the three actions; the last agent. */
function OverviewTab({ theme, data, go, say }: { theme: Theme; data: Status; go: Go; say: Say }) {
  const settings = useSettings(routingSettings);
  const sync = useSync(say);
  const name = ROUTERS[data.connection.router].label;
  const check = useCheck(say, name);
  const on = settings.status === "ready" ? settings.values.routeAgents : data.routeAgents;
  const toggle = () => {
    if (settings.status === "ready") void settings.save({ ...settings.values, routeAgents: !on }, settings.revision);
  };
  const health = healthLine(data);
  const down = data.health?.up === false;
  const { present, modelCount } = data.aiProvider;
  // A breaker the router holds open matters more than "up": that provider's requests are failing.
  const paused = data.health?.up ? data.health.paused.map(providerLabel) : [];
  const router = paused.length
    ? { value: `${health.label.split(" · ")[0]} · ${paused.join(", ")} paused`, tone: "danger" as const, hint: `${paused.join(" and ")} requests fail until ${name} retries`, action: data.tier === "operator" || data.tier === "admin" ? { label: "Accounts", onPress: () => go("accounts") } : null }
    : { value: health.label, tone: health.tone, hint: null, action: null };
  // One primary button: the next thing to do, else the dashboard. While the router is down, the banner's Open Connection is it.
  const next = down ? null : !on ? "routing" : !present ? "sync" : "dashboard";
  const last = data.lastSession;
  return (
    <>
      {down ? (
        <Banner theme={theme} tone="danger" title={`${name} unreachable — ${data.lastSeenAt ? `last seen ${when(data.lastSeenAt)}` : "not seen since this plugin started"}`}>
          <Note theme={theme}>{data.health?.error ?? "No answer."}</Note>
          <Note theme={theme}>Until it answers, Claude agents keep their own sign-in and AI Router agents will not start.</Note>
          <Row>
            <Button theme={theme} label="Open Connection" primary onPress={() => go("connection")} />
            <Button theme={theme} label="Check again" busy={check.isPending} onPress={() => check.mutate()} />
          </Row>
        </Banner>
      ) : null}
      <Card theme={theme}>
        {!down ? <StatusLine theme={theme} label="Router" value={router.value} tone={router.tone} hint={router.hint} action={router.action} /> : null}
        <StatusLine theme={theme} label="Claude routing" value={on ? "On" : "Off"} tone={on ? "success" : "neutral"} hint={on ? "Claude agents go through the router" : "Claude agents use their own sign-in"} />
        <StatusLine theme={theme} label="Models in Paseo" value={present ? `${modelCount} synced` : "Not synced"} tone={present ? "success" : "neutral"} action={{ label: "Models", onPress: () => go("models") }} />
        <StatusLine theme={theme} label="Access" value={TIER_LABELS[data.tier]} tone="neutral" action={{ label: "Connection", onPress: () => go("connection") }} />
        {last ? <Note theme={theme} tone={last.routed ? "success" : "warning"}>{lastAgentLine(last, name, hhmm(last.at))}</Note> : null}
      </Card>
      <Card theme={theme}>
        <Row>
          <OpenDashboardButton theme={theme} data={data} say={say} primary={next === "dashboard"} />
          <Button theme={theme} label={present ? "Sync models again" : "Sync models to Paseo"} primary={next === "sync"} busy={sync.isPending} disabled={down} onPress={() => sync.mutate(true)} />
          <Button theme={theme} label={on ? "Turn Claude routing off" : "Route Claude agents through AI Router"} primary={next === "routing"} busy={settings.saving} disabled={settings.status !== "ready"} onPress={toggle} />
        </Row>
        <Note theme={theme}>If the router is down or the key is missing, Claude agents keep their own sign-in. ~/.claude is never changed.</Note>
        {settings.saveError ? <Note theme={theme} tone="danger">{settings.saveError}</Note> : null}
        {settings.status === "error" || settings.status === "invalid" ? <Note theme={theme} tone="danger">{settings.error}</Note> : null}
      </Card>
      <MoreAccessLine theme={theme} data={data} go={go} />
    </>
  );
}

// -------------------------------------------------------------------- Models

/** "Claude · Opus 5.5" rows grouped under "Claude". */
function groupModels(models: Status["aiProvider"]["models"]) {
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const model of models) {
    const [group, name] = model.label.includes(" · ") ? model.label.split(" · ") : ["Other", model.label];
    groups.set(group, [...(groups.get(group) ?? []), { id: model.id, name }]);
  }
  return [...groups];
}

const money = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);

/** What this key itself may see: its name, spend against its limit, the accounts' quota. Nothing about other keys. */
function YourAccess({ theme, data }: { theme: Theme; data: Status }) {
  const call = useRpc(access);
  const query = useQuery({ queryKey: ["ai-router", "access"], queryFn: () => call({}), refetchInterval: 60_000 });
  const mine = query.data;
  const models = data.aiProvider.present ? `${data.aiProvider.modelCount} models on connected accounts` : null;
  return (
    <Card theme={theme} title="Your access">
      {!mine ? (
        <Note theme={theme}>{query.error ? errorText(query.error) : "Asking the router…"}</Note>
      ) : mine.state !== "ok" ? (
        <>
          {models ? <Fact theme={theme} label="Models" value={models} /> : null}
          <Note theme={theme} tone={mine.state === "error" ? "warning" : "neutral"}>{mine.message}</Note>
        </>
      ) : (
        <>
          {mine.keyName ? <Fact theme={theme} label="This key" value={mine.keyName} /> : null}
          {models ? <Fact theme={theme} label="Models" value={models} /> : null}
          {mine.spend ? (
            <Fact
              theme={theme}
              label={`Spend (${mine.spend.period})`}
              value={mine.spend.limitUsd !== null ? `${money(mine.spend.usedUsd)} of ${money(mine.spend.limitUsd)}${mine.spend.resetAt ? ` · resets ${mine.spend.resetAt.slice(0, 10)}` : ""}` : `${money(mine.spend.usedUsd)} · no limit set`}
            />
          ) : null}
          {mine.tokens !== null ? <Fact theme={theme} label="Tokens" value={`${Math.round(mine.tokens).toLocaleString()} this period`} /> : null}
          {mine.quotas.map((quota) => <Fact key={quota.provider + quota.text} theme={theme} label={`${quota.provider} quota`} value={quota.text} />)}
        </>
      )}
    </Card>
  );
}

function ModelsTab({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const queryClient = useQueryClient();
  const sync = useSync(say);
  const callTest = useRpc(modelTest);
  const [model, setModel] = useState("");
  const test = useMutation({
    mutationFn: (id: string) => callTest({ model: id }),
    onSuccess: (result) => {
      say({ text: result.message, tone: result.ok ? "success" : "danger" });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  const { present, modelCount, legacyCodex, lastSync, tests, summary, models, via } = data.aiProvider;
  const results = new Map(tests.map((entry) => [entry.model, entry]));
  const testing = test.isPending ? test.variables : null;
  return (
    <>
      <YourAccess theme={theme} data={data} />
      <Card theme={theme} title="Sync models to Paseo">
        <Note theme={theme}>Adds "AI Router" to Paseo's provider menu with every model of your connected accounts, so one chat can switch between Claude and GPT. It stays current by itself: checked when the plugin loads, when the app connects, and every 5 minutes.</Note>
        <Row>
          <Button theme={theme} label="Sync models to Paseo" primary busy={sync.isPending} onPress={() => sync.mutate(true)} />
          {present ? <Button theme={theme} label="Remove from Paseo" busy={sync.isPending} onPress={() => sync.mutate(false)} /> : null}
        </Row>
        {present && lastSync?.ok ? <Note theme={theme}>{`Last changed ${when(lastSync.at)} · ${modelCount} models${summary ? ` (${summary})` : ""}${via === "config-file" ? " · written at plugin load" : ""}`}</Note> : null}
        {present && !lastSync && summary ? <Note theme={theme}>{`${modelCount} models (${summary})`}</Note> : null}
        {!present && !lastSync ? <Note theme={theme}>Not synced yet: Paseo has no AI Router provider.</Note> : null}
        {lastSync && !lastSync.ok ? <Note theme={theme} tone="danger">{`Sync failed at ${hhmm(lastSync.at)}: ${lastSync.message}`}</Note> : null}
        {legacyCodex ? <Note theme={theme} tone="warning">The old "AI Router Codex" provider is still in Paseo. Syncing removes it.</Note> : null}
      </Card>
      {models.length ? (
        <Card theme={theme} title="In Paseo's model picker">
          <Note theme={theme}>Test sends one tiny request through the router and shows its answer.</Note>
          {groupModels(models).map(([group, rows]) => (
            <View key={group} style={{ gap: 2 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700", marginTop: 6 }}>{`${group} · ${rows.length}`}</Text>
              {rows.map((row) => {
                const result = results.get(row.id);
                return (
                  <View key={row.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{row.name}</Text>
                    <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.id}</Text>
                    {result ? <Chip theme={theme} label={result.ok ? "answered" : "failed"} tone={result.ok ? "success" : "danger"} /> : null}
                    <Link theme={theme} label={testing === row.id ? "Testing…" : "Test"} accessibilityLabel={`Test ${row.name}`} onPress={() => { if (!test.isPending) test.mutate(row.id); }} />
                  </View>
                );
              })}
            </View>
          ))}
        </Card>
      ) : null}
      <Card theme={theme} title={models.length ? "Test another model" : "Test a model"}>
        <Field theme={theme} label="Model id (sends one tiny request through the router)" value={model} onChangeText={setModel} placeholder="cc/claude-sonnet-5 or cx/gpt-6-sol" />
        <Row><Button theme={theme} label="Test model" busy={test.isPending && testing === model.trim()} disabled={!model.trim() || test.isPending} onPress={() => test.mutate(model.trim())} /></Row>
        {tests.map((entry) => <Note key={entry.model} theme={theme} tone={entry.ok ? "success" : "danger"}>{entry.message}</Note>)}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- Connection

/** OmniRoute's own tunnels, for admins: status, start and stop, and "use this address". */
function TunnelsSection({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const queryClient = useQueryClient();
  const call = useRpc(tunnels);
  const callSet = useRpc(tunnelSet);
  const callSave = useRpc(connectionTest);
  const links = useLinks(say);
  const query = useQuery({ queryKey: ["ai-router", "tunnels"], queryFn: () => call({}), refetchInterval: 30_000 });
  const done = (result: { ok: boolean; message: string }) => {
    say({ text: result.message, tone: result.ok ? "success" : "danger" });
    void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
  };
  const fail = (error: unknown) => say({ text: errorText(error), tone: "danger" });
  const set = useMutation({ mutationFn: (input: { id: "cloudflared" | "ngrok" | "tailscale"; on: boolean }) => callSet(input), onSuccess: done, onError: fail });
  const save = useMutation({
    mutationFn: (consoleUrl: string) => callSave({ router: data.connection.router, endpoint: data.connection.endpoint ?? "", consoleUrl, sshTarget: data.connection.sshTarget }),
    onSuccess: done,
    onError: fail,
  });
  const list = query.data;
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>OmniRoute's tunnels</Text>
      <Note theme={theme} tone="warning">Starting a tunnel makes the dashboard reachable from the internet. Its login is still required.</Note>
      {!list ? <Note theme={theme}>{query.error ? errorText(query.error) : "Asking the router…"}</Note> : null}
      {list && list.state !== "ok" ? <Note theme={theme} tone="warning">{list.message}</Note> : null}
      {list?.tunnels.map((tunnel) => (
        <View key={tunnel.id} style={{ gap: 4 }}>
          <Row>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{tunnel.label}</Text>
            <Chip theme={theme} label={!tunnel.installed ? "not installed" : tunnel.running ? (tunnel.url ? "running" : "starting") : tunnel.phase === "error" ? "error" : "stopped"} tone={tunnel.url ? "success" : tunnel.phase === "error" ? "danger" : "neutral"} />
            {tunnel.installed ? (
              <Button theme={theme} label={tunnel.running ? "Stop" : "Start"} busy={set.isPending && set.variables?.id === tunnel.id} onPress={() => set.mutate({ id: tunnel.id, on: !tunnel.running })} />
            ) : null}
          </Row>
          {tunnel.url ? (
            <Row>
              <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{tunnel.url}</Text>
              <Link theme={theme} label="Copy" accessibilityLabel={`Copy ${tunnel.label} address`} onPress={() => links.copy(tunnelDashboardUrl(tunnel.url!), "the tunnel address")} />
              {data.connection.consoleUrl !== tunnelDashboardUrl(tunnel.url) ? <Link theme={theme} label={save.isPending ? "Saving…" : "Use as this daemon's dashboard address"} onPress={() => save.mutate(tunnelDashboardUrl(tunnel.url!))} /> : null}
            </Row>
          ) : null}
          {tunnel.error ? <Note theme={theme} tone="warning">{tunnel.error}</Note> : null}
        </View>
      ))}
      <Note theme={theme}>For every daemon to open the dashboard through the tunnel, set its address as AI_ROUTER_CONSOLE_URL there, or save it on each daemon's Connection tab.</Note>
    </View>
  );
}

function ConnectionTab({ theme, data, configured, say }: { theme: Theme; data: Status; configured: boolean; say: Say }) {
  const queryClient = useQueryClient();
  const callClear = useRpc(connectionClear);
  const links = useLinks(say);
  const [editing, setEditing] = useState(false);
  const [showPrivate, setShowPrivate] = useState(false);
  const { connection, health } = data;
  const name = ROUTERS[connection.router].label;
  const check = useCheck(say, name);
  const clear = useMutation({
    mutationFn: () => callClear({}),
    onSuccess: (result) => {
      say({ text: result.message, tone: "neutral" });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  useEffect(() => {
    if (!configured) setEditing(false);
  }, [configured]);
  const { url: dashboard, via } = dashboardTarget(data);
  const privateAccess = dashboard ? privateDashboardAccess(dashboard, connection.sshTarget) : null;
  const warnings = data.warnings.map((warning) => <Note key={warning} theme={theme} tone="warning">{warning}</Note>);

  if (!configured || editing) {
    return (
      <Card theme={theme} title={configured ? "Edit connection" : "Set up"}>
        {warnings}
        {connection.source === "none" && !configured ? (
          <Note theme={theme}>Four steps, about two minutes. Nothing changes for your agents until you turn routing on in Overview.</Note>
        ) : data.problem ? (
          <Note theme={theme} tone="warning">{`Not connected yet: ${data.problem}.`}</Note>
        ) : null}
        {health?.error ? <Note theme={theme} tone="danger">{health.error}</Note> : null}
        <ConnectionForm theme={theme} data={data} onDone={(next, saved) => { setEditing(false); if (saved) say(next); }} />
        {!configured && connection.source === "saved" ? <Row><Button theme={theme} label="Disconnect (remove saved connection)" busy={clear.isPending} onPress={() => clear.mutate()} /></Row> : null}
      </Card>
    );
  }
  return (
    <>
      <Card theme={theme} title={name}>
        {warnings}
        <Fact theme={theme} label="Endpoint" value={connection.endpoint ?? "none"} />
        <Fact theme={theme} label="API key" value={masked(connection.apiKey)} />
        <Fact theme={theme} label="Set by" value={connection.source === "env" ? "AI_ROUTER_* environment variables" : "saved plugin settings"} />
        {health?.error ? <Note theme={theme} tone="danger">{health.error}</Note> : null}
        {!health?.error && data.lastSeenAt && health?.up ? <Note theme={theme}>{`Answering · last check ${when(health.checkedAt)}`}</Note> : null}
        <Row>
          <Button theme={theme} label="Check now" busy={check.isPending} onPress={() => check.mutate()} />
          <Button theme={theme} label="Edit" onPress={() => setEditing(true)} />
          {connection.source === "saved" ? <Button theme={theme} label="Disconnect" busy={clear.isPending} onPress={() => clear.mutate()} /> : null}
        </Row>
        <Note theme={theme}>{`Stored in ${data.settingsDir}`}</Note>
      </Card>
      <KeysCard theme={theme} data={data} tokenProblem={health?.monitoringError ?? null} onMessage={say} />
      {dashboard ? (
        <Card theme={theme} title="Dashboard">
          <Fact theme={theme} label="Address" value={dashboard} />
          <Row>
            <Button theme={theme} label="Open" onPress={() => void links.open(dashboard)} />
            <Button theme={theme} label="Copy link" onPress={() => links.copy(dashboard, dashboard)} />
            {via ? <Chip theme={theme} label={via} tone="success" /> : null}
          </Row>
          <Note theme={theme}>Dashboard login: ask your router admin.</Note>
          {privateAccess ? <Link theme={theme} label={showPrivate ? "Hide how to open it from elsewhere" : "Dashboard won't open? It is on a private network — show how"} onPress={() => setShowPrivate(!showPrivate)} /> : null}
          {privateAccess && showPrivate ? (
            <>
              <Note theme={theme} tone="warning">
                {`The dashboard is on a private network (${privateAccess.hostPort}), so it only opens from a device on that network. Otherwise forward it first: Daemon Link → Connect → Saved SSH forward to the router host, remote port ${privateAccess.hostPort.split(":").pop()}. For Codex sign-in, also forward port ${CODEX_LOGIN_PORT}. Or run:`}
              </Note>
              <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace" }}>{privateAccess.command}</Text>
              <Row>
                <Button theme={theme} label="Copy SSH command" onPress={() => links.copy(privateAccess.command, "the SSH command")} />
                <Button theme={theme} label={`Open ${privateAccess.localUrl}`} onPress={() => void links.open(privateAccess.localUrl)} />
              </Row>
              {!connection.sshTarget ? <Note theme={theme}>Set the SSH target under Edit to fill in the router host.</Note> : null}
            </>
          ) : null}
          {data.tier === "admin" ? <TunnelsSection theme={theme} data={data} say={say} /> : null}
        </Card>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------- surface

/** `initialTab` lets tests and the preview open a tab directly; Paseo does not pass it. */
export function AiRouterSurface({ theme, layout, initialTab }: PluginSurfaceProps & { initialTab?: TabId }) {
  const callStatus = useRpc(status);
  const [message, setMessage] = useState<Message>(null);
  const [chosen, setChosen] = useState<TabId | null>(initialTab ?? null);
  const query = useQuery({ queryKey: STATUS_KEY, queryFn: () => callStatus({}), refetchInterval: 20_000 });
  const data = query.data;
  const configured = data?.problem === null;
  const pad = layout.compact ? 16 : 24;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0, alignItems: "center", justifyContent: "center", padding: pad, gap: 12 }}>
        {query.error ? (
          <>
            <Note theme={theme} tone="danger">{errorText(query.error)}</Note>
            <Button theme={theme} label="Try again" busy={query.isFetching} onPress={() => void query.refetch()} />
          </>
        ) : (
          <ActivityIndicator color={theme.colors.accent} />
        )}
      </View>
    );
  }
  const tabs = visibleTabs(data.tier);
  // Not set up yet: open on Connection, where the setup lives. A tab the tier no longer offers falls back to Overview.
  const wanted: TabId = chosen ?? (configured ? "overview" : "connection");
  const tab: TabId = tabs.includes(wanted) ? wanted : "overview";
  const go = (next: TabId) => {
    setMessage(null);
    setChosen(next);
  };
  const { connection } = data;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: pad, paddingBottom: 40, maxWidth: 980, width: "100%", alignSelf: "center" }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 24, fontWeight: "700" }}>AI Router</Text>
        <Note theme={theme}>{configured ? `Connected to ${ROUTERS[connection.router].label}` : "Not connected yet. Routing stays off until setup is done and you turn it on."}</Note>
      </View>
      <TabBar theme={theme} compact={layout.compact} tabs={tabs} active={tab} onSelect={go} />
      <SectionHeading theme={theme} tab={tab} />
      {message ? <View style={{ marginBottom: 12 }}><Note theme={theme} tone={message.tone}>{message.text}</Note></View> : null}
      {tab === "connection" ? <ConnectionTab theme={theme} data={data} configured={configured} say={setMessage} /> : null}
      {tab === "providers" ? <ProvidersTab theme={theme} data={data} say={setMessage} compact={layout.compact} /> : null}
      {tab !== "connection" && tab !== "providers" && !configured ? (
        <Banner theme={theme} tone="neutral" title="Connect a router first">
          <Note theme={theme}>{data.problem ? `Not connected yet: ${data.problem}.` : "No router is set up."}</Note>
          <Row><Button theme={theme} label="Open Connection" primary onPress={() => go("connection")} /></Row>
        </Banner>
      ) : null}
      {configured && tab === "overview" ? <OverviewTab theme={theme} data={data} go={go} say={setMessage} /> : null}
      {configured && tab === "models" ? <ModelsTab theme={theme} data={data} say={setMessage} /> : null}
      {configured && tab === "accounts" ? <AccountsTab theme={theme} data={data} say={setMessage} /> : null}
      {configured && tab === "usage" ? <UsageTab theme={theme} /> : null}
      {configured && tab === "settings" ? <SettingsTab theme={theme} data={data} say={setMessage} /> : null}
    </ScrollView>
  );
}
