import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codexRouter, providerEnable, providersList, providersTidy, type Providers, type Status } from "../shared/contracts";
import { routingSettings } from "../shared/settings";
import { AdvancedBanner } from "./dashboard";
import { STATUS_KEY, errorText, type Message } from "./setup";
import { Banner, Button, Card, Chip, Link, Note, Row, Toggle, type Tone } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;
type ProviderRowData = Providers["rows"][number];
const PROVIDERS_KEY = ["ai-router", "providers"] as const;

const STATUS_WORDS: Record<ProviderRowData["status"], { label: string; tone: Tone }> = {
  ready: { label: "Available", tone: "success" },
  loading: { label: "Still loading", tone: "warning" },
  error: { label: "Error", tone: "danger" },
  unavailable: { label: "Not installed", tone: "neutral" },
};

/** Built-in Claude: the routing switch, the same one Overview has. */
function ClaudeThrough({ theme }: { theme: Theme }) {
  const settings = useSettings(routingSettings);
  const on = settings.status === "ready" ? settings.values.routeAgents : false;
  return (
    <Row>
      <Toggle theme={theme} label="Route Claude agents through OmniRoute" value={on} busy={settings.saving} disabled={settings.status !== "ready"} onChange={(next) => { if (settings.status === "ready") void settings.save({ ...settings.values, routeAgents: next }, settings.revision); }} />
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{on ? "Routed" : "Own sign-in"}</Text>
    </Row>
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

function Through({ theme, row, data, say }: { theme: Theme; row: ProviderRowData; data: Status; say: Say }) {
  if (row.through === "claude-toggle") return <ClaudeThrough theme={theme} />;
  if (row.through === "codex-provider") return <CodexThrough theme={theme} data={data} say={say} />;
  if (row.through === "is-router") return <Chip theme={theme} label="Always through OmniRoute" tone="success" />;
  return <Note theme={theme}>Not supported — use the AI Router provider for its models.</Note>;
}

function ProviderRow({ theme, row, data, say, compact, first, onEnable, busy }: { theme: Theme; row: ProviderRowData; data: Status; say: Say; compact: boolean; first: boolean; onEnable: (enabled: boolean) => void; busy: boolean }) {
  const status = STATUS_WORDS[row.status];
  return (
    <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: compact ? 8 : 16, borderTopWidth: first ? 0 : 1, borderColor: theme.colors.border, paddingTop: first ? 0 : 12 }}>
      <View style={{ flex: compact ? undefined : 1, minWidth: 160, gap: 4 }}>
        <Row>
          <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{row.label}</Text>
          <Chip theme={theme} label={row.enabled ? status.label : "Off"} tone={row.enabled ? status.tone : "neutral"} />
          {row.owner === "user" ? <Chip theme={theme} label="yours" /> : null}
        </Row>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.error && row.enabled ? `${row.id} · ${row.error}` : row.id}</Text>
      </View>
      <Row>
        <Toggle theme={theme} label={`${row.label} enabled`} value={row.enabled} busy={busy} onChange={onEnable} />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, width: compact ? undefined : 52 }}>{row.enabled ? "Enabled" : "Disabled"}</Text>
      </Row>
      <View style={{ flex: compact ? undefined : 1.4 }}>
        <Through theme={theme} row={row} data={data} say={say} />
      </View>
    </View>
  );
}

export function ProvidersTab({ theme, data, say, compact }: { theme: Theme; data: Status; say: Say; compact: boolean }) {
  const queryClient = useQueryClient();
  const callList = useRpc(providersList);
  const callEnable = useRpc(providerEnable);
  const callTidy = useRpc(providersTidy);
  const [previewing, setPreviewing] = useState(false);
  const query = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => callList({}), refetchInterval: 30_000 });
  const done = (result: { ok: boolean; message: string }) => {
    say({ text: result.message, tone: result.ok ? "success" : "danger" });
    void queryClient.invalidateQueries({ queryKey: PROVIDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  };
  const fail = (error: unknown) => say({ text: errorText(error), tone: "danger" });
  const enable = useMutation({ mutationFn: (input: { id: string; enabled: boolean }) => callEnable(input), onSuccess: done, onError: fail });
  const tidy = useMutation({ mutationFn: (ids: string[]) => callTidy({ ids }), onSuccess: (result) => { setPreviewing(false); done(result); }, onError: fail });
  const refresh = useMutation({ mutationFn: () => callList({ refresh: true }), onSuccess: (next) => queryClient.setQueryData(PROVIDERS_KEY, next), onError: fail });
  const list = query.data;
  const candidates = list?.rows.filter((row) => row.tidy !== null) ?? [];
  return (
    <>
      <AdvancedBanner theme={theme} data={data} say={say} />
      {!list ? (
        <Card theme={theme} title="Agent providers on this daemon">
          {query.error ? <Note theme={theme} tone="danger">{errorText(query.error)}</Note> : <Note theme={theme}>Asking Paseo…</Note>}
        </Card>
      ) : list.state === "error" ? (
        <Banner theme={theme} tone="danger" title="Could not read Paseo's providers">
          <Note theme={theme}>{list.message}</Note>
          <Row><Button theme={theme} label="Try again" busy={refresh.isPending} onPress={() => refresh.mutate()} /></Row>
        </Banner>
      ) : (
        <Card theme={theme} title="Agent providers on this daemon">
          <Note theme={theme}>Off hides a provider from Paseo's menu on this daemon. "Through OmniRoute" is what the router can do for it.</Note>
          {list.rows.map((row, index) => (
            <ProviderRow
              key={row.id}
              theme={theme}
              row={row}
              data={data}
              say={say}
              compact={compact}
              first={index === 0}
              busy={enable.isPending && enable.variables?.id === row.id}
              onEnable={(enabled) => enable.mutate({ id: row.id, enabled })}
            />
          ))}
          <Row><Link theme={theme} label={refresh.isPending ? "Checking…" : "Check again"} onPress={() => refresh.mutate()} /></Row>
        </Card>
      )}
      {list?.state === "ok" ? (
        <Card theme={theme} title="Tidy up">
          {!candidates.length ? (
            <Note theme={theme}>Nothing to tidy: every enabled provider answers. Claude, Codex, the router's providers and anything you set up yourself are never touched.</Note>
          ) : !previewing ? (
            <>
              <Note theme={theme}>{`${candidates.length} enabled provider${candidates.length === 1 ? " is" : "s are"} not usable on this daemon. Turning ${candidates.length === 1 ? "it" : "them"} off tidies Paseo's menu; you can turn any back on above.`}</Note>
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
