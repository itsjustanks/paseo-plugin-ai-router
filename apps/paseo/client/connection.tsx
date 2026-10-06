import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionClear, connectionTest, status, tunnelSet, tunnels, type Status } from "../shared/contracts";
import { CODEX_LOGIN_PORT, privateDashboardAccess, tunnelDashboardUrl } from "../shared/logic";
import { ROUTERS } from "../shared/routers/copy";
import type { GoTarget } from "../shared/tabs";
import { checkReply } from "./commands";
import { dashboardTarget, useLinks } from "./dashboard";
import { ConnectionForm, PUBLIC_ADDRESS_WHY, STATUS_KEY, errorText, type Message } from "./setup";
import { Button, Card, Chip, Fact, ItemTitle, Link, Meta, Note, Row, TYPE, SPACE } from "./ui";

type Theme = PluginTheme;
type Go = (target: GoTarget) => void;
type Say = (message: Message) => void;
const masked = (secret: Status["connection"]["apiKey"]) => (secret.present ? `…${secret.last4}` : "none");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** "14:02" today, "Sep 22, 14:02" otherwise. */
export function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date().toDateString() === date.toDateString();
  return today ? hhmm(iso) : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${hhmm(iso)}`;
}

/** Check now: a fresh health check, said in one line (the same line as the "Check router" command). */
export function useCheck(say: Say) {
  const queryClient = useQueryClient();
  const call = useRpc(status);
  return useMutation({
    mutationFn: () => call({ refresh: true }),
    onSuccess: (next) => {
      queryClient.setQueryData(STATUS_KEY, next);
      say(checkReply(next));
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
}

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
    <View style={{ gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
      <ItemTitle theme={theme}>OmniRoute's tunnels</ItemTitle>
      <Note theme={theme} tone="warning">A tunnel puts the dashboard on the internet, behind OmniRoute's own login.</Note>
      {!list ? <Note theme={theme}>{query.error ? errorText(query.error) : "Asking the router…"}</Note> : null}
      {list && list.state !== "ok" ? <Note theme={theme} tone="warning">{list.message}</Note> : null}
      {list?.tunnels.map((tunnel) => (
        <View key={tunnel.id} style={{ gap: SPACE.xs }}>
          <Row>
            <ItemTitle theme={theme}>{tunnel.label}</ItemTitle>
            <Chip theme={theme} label={!tunnel.installed ? "not installed" : tunnel.running ? (tunnel.url ? "running" : "starting") : tunnel.phase === "error" ? "error" : "stopped"} tone={tunnel.url ? "success" : tunnel.phase === "error" ? "danger" : "neutral"} />
            {tunnel.installed ? (
              <Button theme={theme} label={tunnel.running ? "Stop" : "Start"} busy={set.isPending && set.variables?.id === tunnel.id} onPress={() => set.mutate({ id: tunnel.id, on: !tunnel.running })} />
            ) : null}
          </Row>
          {tunnel.url ? (
            <Row>
              <Meta theme={theme} selectable>{tunnel.url}</Meta>
              <Link theme={theme} label="Copy" accessibilityLabel={`Copy ${tunnel.label} address`} onPress={() => links.copy(tunnelDashboardUrl(tunnel.url!), "the tunnel address")} />
              {data.connection.publicUrl !== tunnel.url.replace(/\/+$/, "") ? <Link theme={theme} label={save.isPending ? "Saving…" : "Use as the public address"} onPress={() => save.mutate(tunnel.url!)} /> : null}
            </Row>
          ) : null}
          {tunnel.error ? <Note theme={theme} tone="warning">{tunnel.error}</Note> : null}
        </View>
      ))}
      <Meta theme={theme}>For every daemon, set it as AI_ROUTER_CONSOLE_URL or save it in each one's Help → "How is this computer connected?".</Meta>
    </View>
  );
}

/**
 * The router this computer uses: before setup, the four-step form; after, its
 * address, key, where it is set and Check now / Edit / Disconnect. On
 * Overview while setup is unfinished, and in Help as "How is this computer
 * connected?". `guideLink` points at the guide when it isn't on the same tab.
 */
export function ConnectionCard({ theme, data, configured, go, say, guideLink = true }: { theme: Theme; data: Status; configured: boolean; go: Go; say: Say; guideLink?: boolean }) {
  const queryClient = useQueryClient();
  const callClear = useRpc(connectionClear);
  const [editing, setEditing] = useState(false);
  const { connection, health } = data;
  const name = ROUTERS[connection.router].label;
  const check = useCheck(say);
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
  const warnings = data.warnings.map((warning) => <Note key={warning} theme={theme} tone="warning">{warning}</Note>);

  if (!configured || editing) {
    return (
      <Card theme={theme} title={configured ? "Edit connection" : "Set up"} icon={configured ? "Settings2" : "Plug"}>
        {warnings}
        {connection.source === "none" && !configured ? (
          <>
            <Note theme={theme}>Four steps, about two minutes. Your agents don't change until you pick the AI Router provider.</Note>
            {guideLink ? <Link theme={theme} label="New to AI Router? Overview explains what it is and how it works" onPress={() => go("overview")} /> : null}
          </>
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
      <Card theme={theme} title={name} icon="Server" tone={health?.up === false ? "danger" : health?.up ? "success" : "accent"} subtitle="The shared router this computer sends its chats to">
        {warnings}
        <Fact theme={theme} label="Endpoint" value={connection.endpoint ?? "none"} />
        <Fact theme={theme} label="Public address" value={connection.publicUrl ?? "not set"} />
        {connection.publicCheck ? (
          <View style={{ gap: SPACE.xs }}>
            <Row>
              <Chip theme={theme} label={connection.publicCheck.label} tone={connection.publicCheck.state === "ok" ? "success" : connection.publicCheck.state === "checking" ? "neutral" : "warning"} />
            </Row>
            {connection.publicCheck.detail ? <Note theme={theme}>{connection.publicCheck.detail}</Note> : null}
          </View>
        ) : null}
        <Note theme={theme}>{connection.publicUrl ? PUBLIC_ADDRESS_WHY : `No public address (custom domain) yet: add one under Edit. ${PUBLIC_ADDRESS_WHY}`}</Note>
        <Fact theme={theme} label="API key" value={masked(connection.apiKey)} />
        <Fact theme={theme} label="Set by" value={connection.source === "env" ? "AI_ROUTER_* environment variables" : "saved plugin settings"} />
        {health?.error ? <Note theme={theme} tone="danger">{health.error}</Note> : null}
        {!health?.error && data.lastSeenAt && health?.up ? <Meta theme={theme}>{`Answering · last check ${when(health.checkedAt)}`}</Meta> : null}
        <Row>
          <Button theme={theme} label="Check now" icon="RefreshCw" busy={check.isPending} onPress={() => check.mutate()} />
          <Button theme={theme} label="Edit" icon="Pencil" onPress={() => setEditing(true)} />
          {connection.source === "saved" ? <Button theme={theme} label="Disconnect" busy={clear.isPending} onPress={() => clear.mutate()} /> : null}
        </Row>
        <Meta theme={theme} selectable>{`Stored in ${data.settingsDir}`}</Meta>
      </Card>
    </>
  );
}

/** The router's own website: its address, Open and Copy, how to reach it on a private network, and (manage key) OmniRoute's tunnels. */
export function DashboardCard({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const links = useLinks(say);
  const [showPrivate, setShowPrivate] = useState(false);
  const { connection } = data;
  const { url: dashboard, via } = dashboardTarget(data);
  const privateAccess = dashboard ? privateDashboardAccess(dashboard, connection.sshTarget) : null;
  if (!dashboard) return null;
  return (
        <Card theme={theme} title="Dashboard" icon="Globe" subtitle="The router's own website, for its admin settings">
          <Fact theme={theme} label="Address" value={dashboard} />
          <Row>
            <Button theme={theme} label="Open" icon="ExternalLink" onPress={() => void links.open(dashboard)} />
            <Button theme={theme} label="Copy link" icon="Copy" onPress={() => links.copy(dashboard, dashboard)} />
            {via ? <Chip theme={theme} label={via} tone="success" /> : null}
          </Row>
          <Meta theme={theme}>Its login comes from your router admin.</Meta>
          {privateAccess ? <Link theme={theme} label={showPrivate ? "Hide how to open it from elsewhere" : "Dashboard won't open? It is on a private network — show how"} onPress={() => setShowPrivate(!showPrivate)} /> : null}
          {privateAccess && showPrivate ? (
            <>
              <Note theme={theme} tone="warning">
                {`The dashboard is on a private network (${privateAccess.hostPort}), so it only opens from a device on that network. Otherwise forward it first: Daemon Link → Connect → Saved SSH forward to the router host, remote port ${privateAccess.hostPort.split(":").pop()}. For Codex sign-in, also forward port ${CODEX_LOGIN_PORT}. Or run:`}
              </Note>
              <View style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, padding: SPACE.row }}>
                <Text selectable style={{ ...TYPE.mono, color: theme.colors.foreground }}>{privateAccess.command}</Text>
              </View>
              <Row>
                <Button theme={theme} label="Copy SSH command" onPress={() => links.copy(privateAccess.command, "the SSH command")} />
                <Button theme={theme} label={`Open ${privateAccess.localUrl}`} onPress={() => void links.open(privateAccess.localUrl)} />
              </Row>
              {!connection.sshTarget ? <Note theme={theme}>Set the SSH target under Edit to fill in the router host.</Note> : null}
            </>
          ) : null}
          {data.tier === "admin" ? <TunnelsSection theme={theme} data={data} say={say} /> : null}
        </Card>
  );
}
