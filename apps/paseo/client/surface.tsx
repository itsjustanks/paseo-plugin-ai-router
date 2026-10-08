import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiProvider, clis, modelTest, profiles, providersList, status, type AnalyticsRangeId, type Status } from "../shared/contracts";
import { providerLabel } from "../shared/routers/omniroute/parsers";
import { TIER_LABELS, lastAgentLine } from "../shared/logic";
import { routingSettings } from "../shared/settings";
import { ROUTERS } from "../shared/routers/copy";
import { resolveTarget, type GoTarget, type TabId } from "../shared/tabs";
import { versionsLine } from "../shared/updates";
import { ActivityTab, type OpenAgent } from "./activity";
import { UsageTab } from "./analytics";
import { AgentAppsCard, CLIS_KEY } from "./apps";
import { checkReply, peekPendingMessage, subscribePendingMessage, takePendingMessage } from "./commands";
import { ConnectionCard, when } from "./connection";
import { AdvancedBanner, OpenDashboardButton, useLinks } from "./dashboard";
import { OverviewGuide } from "./guide";
import { HelpTab } from "./help";
import { AccountsTab, YourAccess } from "./insights";
import { McpCard } from "./mcp";
import { TabBar } from "./navigation";
import { CodexExtras, PROVIDERS_KEY, RoutingCard, TidyUp, codexExtrasOn, useTidyCount } from "./providers";
import { ClaudeSwitch, CodexSwitch, RoutingOffers } from "./routing";
import { noteHost } from "./host";
import { hostName, notConnectedLine } from "../shared/host";
import { syncScreenTab } from "./native";
import { STATUS_KEY, errorText, type Message } from "./setup";
import { useSay } from "./feedback";
import { WhatsNew, useUpdates } from "./updates";
import { Accordion, AccordionItem, Banner, Button, Card, Chip, CopyIcon, Divider, Field, FoldsContext, HeroCard, HostIcon, IconBadge, ItemTitle, Link, MessageBar, Meta, Note, Row, SectionTitle, StatusLine, TYPE, ToggleRow, toneColor, type Tone, SPACE } from "./ui";

type Theme = PluginTheme;
type Go = (target: GoTarget) => void;
type Say = (message: Message) => void;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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

/** The kinds of account the router offers, from the model list's groups ("Claude · Opus 5.5" is Claude); combos aside. */
function accountKinds(models: Status["aiProvider"]["models"]): string[] {
  return groupModels(models).map(([group]) => group).filter((group) => group !== "Combo" && group !== "Other");
}

// ------------------------------------------------------------------ Overview

/**
 * Overview is live status and actions only: the hero says the state in words
 * (working, a step left, paused, down), then its rows (router, models in
 * Paseo, what goes through the router, versions), the last chat and the two
 * main buttons. The teaching lives in one "How it works" disclosure under it,
 * open until setup is done; recent traffic is one fold-out below that.
 * 0.21.0: the card also holds the two routing switches (built-in Claude and
 * Codex, each asking first; Models has the same two) and, while the router
 * can't serve them, the one-press way back to this computer's own sign-in.
 */
function OverviewTab({ theme, data, compact, go, say, openAgent, initialNews = false }: { theme: Theme; data: Status; compact: boolean; go: Go; say: Say; openAgent: OpenAgent; initialNews?: boolean }) {
  const settings = useSettings(routingSettings);
  const sync = useSync(say);
  const queryClient = useQueryClient();
  const changed = () => void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
  const name = ROUTERS[data.connection.router].label;
  const news = useUpdates();
  const [showNews, setShowNews] = useState(initialNews);
  const versions = news.data ? versionsLine(news.data.router, news.data.plugin) : null;
  const claude = settings.status === "ready" ? settings.values.routeAgents : data.routeAgents;
  const codex = data.codexReroute?.state === "on";
  const health = healthLine(data);
  const down = data.health?.up === false;
  const { present, modelCount } = data.aiProvider;
  const drift = driftOf(data);
  // A breaker the router holds open matters more than "up": that provider's requests are failing.
  const paused = data.health?.up ? data.health.paused.map(providerLabel) : [];
  const router = paused.length
    ? { value: `${health.label.split(" · ")[0]} · ${paused.join(", ")} paused`, tone: "danger" as const, hint: `${paused.join(" and ")} requests fail until ${name} retries`, action: data.tier === "operator" || data.tier === "admin" ? { label: "Accounts", onPress: () => go("accounts") } : null }
    : { value: health.label, tone: health.tone, hint: null, action: null };
  // One primary button: the next thing to do, else the dashboard. While the router is down, the hero's Open Connection is it.
  const next = down ? null : !present ? "sync" : "dashboard";
  const last = data.lastSession;
  const hero: { tone: Tone; icon: string; title: string; lead: string | null } = down
    ? { tone: "danger", icon: "CircleAlert", title: `${name} unreachable — ${data.lastSeenAt ? `last seen ${when(data.lastSeenAt)}` : "not seen since this plugin started"}`, lead: null }
    : paused.length
      ? { tone: "warning", icon: "CirclePause", title: `Working, but ${paused.join(" and ")} ${paused.length === 1 ? "is" : "are"} paused`, lead: `${name} paused ${paused.join(" and ")} after errors and retries by itself. Everything else works.` }
      : !data.health
        ? { tone: "neutral", icon: "Loader", title: data.checking ? "Checking the router…" : "The router hasn't been checked yet", lead: null }
        : !present
          ? { tone: "neutral", icon: "RefreshCw", title: "Connected: one step left", lead: "Sync the models to add AI Router to Paseo's provider menu." }
          : { tone: "success", icon: "CircleCheck", title: "All set: AI Router is working", lead: "Pick AI Router when you start a chat." };
  return (
    <>
      <HeroCard theme={theme} tone={hero.tone} icon={hero.icon} title={hero.title} lead={hero.lead ?? undefined}>
        {down ? (
          <>
            <Note theme={theme}>{data.health?.error ?? "No answer."}</Note>
            <Note theme={theme}>{`Until it answers, AI Router chats can't start${claude ? (data.ownSignIn && data.ownSignIn.claude.state !== "ok" ? ", and new Claude chats have no working sign-in of their own here" : ", new Claude chats use this computer's own sign-in") : ""}${codex ? ", re-routed Codex can't answer" : ""}.`}</Note>
            <Row>
              <Button theme={theme} label="Check the connection" icon="Link" primary onPress={() => go("connection")} />
            </Row>
            <Divider theme={theme} />
          </>
        ) : null}
        <RoutingOffers theme={theme} data={data} onChanged={changed} />
        <View style={{ gap: SPACE.xs }}>
          {!down ? <StatusLine theme={theme} label="Router" value={router.value} tone={router.tone} hint={router.hint} action={router.action} /> : null}
          <StatusLine theme={theme} label="Models in Paseo" value={present ? `${modelCount} models` : "Not synced"} tone={!present ? "neutral" : drift ? "warning" : "success"} hint={drift ? `${drift} out of step with ${name}` : null} action={{ label: "Models", onPress: () => go("models") }} />
          {versions ? <StatusLine theme={theme} label="Versions" value={versions.value} tone={versions.tone} hint={versions.hint} action={{ label: showNews ? "Hide" : "What's new", onPress: () => setShowNews(!showNews) }} /> : null}
        </View>
        {showNews && news.data ? <WhatsNew theme={theme} data={news.data} say={say} /> : null}
        <Divider theme={theme} />
        <View style={{ gap: SPACE.row }}>
          <ClaudeSwitch theme={theme} data={data} configured onChanged={changed} />
          <CodexSwitch theme={theme} data={data} configured onChanged={changed} />
        </View>
        <Divider theme={theme} />
        {last ? (
          <Pressable accessibilityRole="link" accessibilityLabel="See every chat in Recent traffic" onPress={() => go("activity")} style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
            {HostIcon ? <View style={{ paddingTop: SPACE.hair }}><HostIcon name="Bot" size={16} color={toneColor(theme, last.routed ? "success" : "warning")} /></View> : null}
            <Text style={{ ...TYPE.secondary, color: last.routed ? theme.colors.foregroundMuted : toneColor(theme, "warning"), flex: 1 }}>
              {`${lastAgentLine(last, name, hhmm(last.at))}  `}
              <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>Recent traffic →</Text>
            </Text>
          </Pressable>
        ) : null}
        <Row>
          <OpenDashboardButton theme={theme} data={data} say={say} primary={next === "dashboard"} />
          <Button theme={theme} label={present ? "Sync models" : "Sync models to Paseo"} icon="RefreshCw" primary={next === "sync"} busy={sync.isPending} disabled={down} onPress={() => sync.mutate(true)} />
        </Row>
      </HeroCard>
      <OverviewGuide theme={theme} compact={compact} go={go} router={name} accounts={accountKinds(data.aiProvider.models)} synced={present} open={!present} />
      <Accordion theme={theme}>
        <AccordionItem theme={theme} id="traffic" icon="ArrowLeftRight" title="Recent traffic" summary="Chats started here, and the requests the router served">
          <ActivityTab theme={theme} data={data} openAgent={openAgent} />
        </AccordionItem>
      </Accordion>
      <McpCard theme={theme} data={data} say={say} />
    </>
  );
}

/** How many models are out of step between OmniRoute's kept list and Paseo, or 0. */
function driftOf(data: Status): number {
  const check = data.aiProvider.check;
  return check?.ok ? check.missing.length + check.extra.length : 0;
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


const PROFILES_KEY = ["ai-router", "profiles"] as const;

/**
 * OmniRoute's combos as Paseo agent profiles: one per combo in the model
 * list, on the AI Router provider, kept current by the same sync as the
 * models. The switch is host-wide; turning it off removes only these.
 */
function ComboProfiles({ theme, say }: { theme: Theme; say: Say }) {
  const queryClient = useQueryClient();
  const settings = useSettings(routingSettings);
  const call = useRpc(profiles);
  const query = useQuery({ queryKey: PROFILES_KEY, queryFn: () => call({}), refetchInterval: 60_000 });
  const [showAll, setShowAll] = useState(false);
  const apply = useMutation({
    mutationFn: async (next: boolean) => {
      if (settings.status !== "ready") throw new Error("Settings are still loading.");
      const saved = await settings.save({ ...settings.values, comboProfiles: next }, settings.revision);
      if (saved === false) throw new Error("The switch was changed elsewhere; try again.");
      return call({ apply: true });
    },
    onSuccess: (result) => {
      queryClient.setQueryData(PROFILES_KEY, result);
      say(result.message ? { text: result.message, tone: "warning" } : { text: result.enabled ? `${result.profiles.length} combo profile${result.profiles.length === 1 ? "" : "s"} in Paseo.` : "Combo profiles removed from Paseo. Your own profiles are unchanged.", tone: "success" });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  const on = settings.status === "ready" ? settings.values.comboProfiles !== false : query.data?.enabled ?? true;
  const list = query.data?.profiles ?? [];
  const shown = showAll ? list : list.slice(0, 6);
  return (
    <Card theme={theme}>
      <ToggleRow theme={theme} label="Show combos as agent profiles" text="Show combos as agent profiles" value={on} busy={apply.isPending} disabled={settings.status !== "ready"} onChange={(next) => apply.mutate(next)} />
      <Meta theme={theme}>Each combo becomes a profile in Paseo's agent picker, with its description as notes. Your own profiles are never touched.</Meta>
      {query.data?.message ? <Note theme={theme} tone="warning">{query.data.message}</Note> : null}
      {on && !list.length ? <Note theme={theme}>{query.isLoading ? "Reading Paseo's profiles…" : "No combo profiles yet: they appear with the next sync once OmniRoute lists a combo."}</Note> : null}
      {shown.map((profile) => (
        <View key={profile.id} style={{ gap: SPACE.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.sm }}>
          <Row>
            <ItemTitle theme={theme}>{profile.name}</ItemTitle>
            {profile.model ? <Meta theme={theme} selectable>{profile.model}</Meta> : null}
          </Row>
          {profile.notes ? <Text style={{ ...TYPE.secondary, color: theme.colors.foreground }}>{profile.notes}</Text> : null}
        </View>
      ))}
      {list.length > shown.length || showAll ? <Link theme={theme} label={showAll ? "Show fewer" : `Show all ${list.length}`} onPress={() => setShowAll(!showAll)} /> : null}
    </Card>
  );
}

/** Up to four ids, then "and N more". */
const someIds = (ids: readonly string[]) => (ids.length > 4 ? `${ids.slice(0, 4).join(", ")} and ${ids.length - 4} more` : ids.join(", "));

/**
 * The sync, said plainly: how many models Paseo has, when it last compared
 * them with OmniRoute (every 5 minutes and when the app connects), why
 * OmniRoute lists more than Paseo shows, and any real drift, with Sync.
 */
function SyncCard({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const sync = useSync(say);
  const { present, modelCount, legacyCodex, lastSync, summary, via, check } = data.aiProvider;
  const name = ROUTERS[data.connection.router].label;
  const drift = driftOf(data);
  const gap = check?.ok && check.upstream !== null && check.upstream > check.kept
    ? `${check.kept} of the ${check.upstream} models ${name} lists${data.tier === "basic" ? " for this key" : ""}: one per model. Effort levels (Paseo's thinking control), duplicates${data.tier === "basic" ? "" : ", providers with no account"} and unproven variants are left out.`
    : null;
  const times = [check ? `compared ${when(check.at)}` : null, lastSync?.ok ? `changed ${when(lastSync.at)}${via === "config-file" ? " (at plugin load)" : ""}` : null].filter(Boolean).join(" · ");
  return (
    <Card theme={theme} title="Sync models to Paseo" icon="RefreshCw">
      <StatusLine
        theme={theme}
        label="In Paseo"
        value={present ? `${modelCount} models` : "Not synced"}
        tone={!present ? "neutral" : drift ? "warning" : check?.ok ? "success" : "neutral"}
        hint={!present ? `Paseo has no AI Router provider yet` : drift ? `out of step with ${name}` : check?.ok ? `in step with ${name}` : summary}
      />
      {check?.ok && check.missing.length ? <Note theme={theme} tone="warning">{`${name} offers ${check.missing.length === 1 ? "a model" : `${check.missing.length} models`} Paseo doesn't list yet: ${someIds(check.missing)}.`}</Note> : null}
      {check?.ok && check.extra.length ? <Note theme={theme} tone="warning">{`Paseo lists ${check.extra.length === 1 ? "a model" : `${check.extra.length} models`} ${name} no longer offers: ${someIds(check.extra)}.`}</Note> : null}
      {check && !check.ok ? <Note theme={theme} tone="danger">{`Couldn't compare with ${name} at ${hhmm(check.at)}: ${check.message}`}</Note> : null}
      {lastSync && !lastSync.ok && (!check || check.ok) ? <Note theme={theme} tone="danger">{`Sync failed at ${hhmm(lastSync.at)}: ${lastSync.message}`}</Note> : null}
      {gap ? <Meta theme={theme}>{gap}</Meta> : null}
      <Row>
        <Button theme={theme} label={drift ? "Sync now" : "Sync models to Paseo"} icon="RefreshCw" primary={!present || drift > 0} busy={sync.isPending} onPress={() => sync.mutate(true)} />
        {present ? <Button theme={theme} label="Remove from Paseo" busy={sync.isPending} onPress={() => sync.mutate(false)} /> : null}
      </Row>
      <Meta theme={theme}>{`${times ? `${times[0].toUpperCase()}${times.slice(1)} · ` : ""}runs by itself every 5 minutes and when the app connects`}</Meta>
      {legacyCodex ? <Note theme={theme} tone="warning">The old "AI Router Codex" provider is still in Paseo. Syncing removes it.</Note> : null}
    </Card>
  );
}

/**
 * Models: is the model list in Paseo current (status first), which chats go
 * through the router, then the less-used parts folded: the full list with a
 * test, combos, the Codex extras, tidying the provider menu and updating the
 * agent apps. Before setup: one "Connect a router first" line, the switches
 * shown but off-limits, and the folds that need no router (tidy, versions).
 */
function ModelsTab({ theme, data, configured, go, say }: { theme: Theme; data: Status; configured: boolean; go: Go; say: Say }) {
  const queryClient = useQueryClient();
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
  const tidyCount = useTidyCount();
  const links = useLinks(say);
  const { tests, models } = data.aiProvider;
  const results = new Map(tests.map((entry) => [entry.model, entry]));
  const testing = test.isPending ? test.variables : null;
  const extrasOn = codexExtrasOn(data);
  return (
    <>
      {configured ? <SyncCard theme={theme} data={data} say={say} /> : <ConnectFirst theme={theme} go={go} />}
      <RoutingCard theme={theme} data={data} configured={configured} say={say} />
      <Accordion theme={theme}>
        {configured ? (
          <AccordionItem theme={theme} id="models-list" icon="Boxes" title="Models in Paseo's picker" summary={models.length ? `${models.length} models · test one with a tiny request` : "Test a model with a tiny request"}>
            {models.length ? (
              <Card theme={theme}>
                <Meta theme={theme}>Test sends one tiny request through the router.</Meta>
                {groupModels(models).map(([group, rows]) => (
                  <View key={group} style={{ gap: SPACE.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.sm }}>
                    <Text style={{ ...TYPE.item, fontWeight: "700", color: theme.colors.foreground }}>{`${group} · ${rows.length}`}</Text>
                    {rows.map((row) => {
                      const result = results.get(row.id);
                      return (
                        <View key={row.id} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: SPACE.sm, rowGap: SPACE.hair }}>
                          <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>{row.name}</Text>
                          {row.id !== row.name ? <Meta theme={theme} selectable>{row.id}</Meta> : null}
                          <CopyIcon theme={theme} label={`Copy the model id ${row.id}`} onPress={() => void links.copy(row.id, row.id)} />
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
          </AccordionItem>
        ) : null}
        {configured ? (
          <AccordionItem theme={theme} id="combos" icon="Layers" title="Combos as agent profiles" summary="Each router combo, ready in Paseo's agent picker">
            <ComboProfiles theme={theme} say={say} />
          </AccordionItem>
        ) : null}
        <AccordionItem theme={theme} id="codex-extras" icon="SquareTerminal" title="Codex extras" summary={extrasOn ? "One is on" : "Optional: built-in Codex through the router, or a second Codex"} open={extrasOn}>
          <CodexExtras theme={theme} data={data} configured={configured} say={say} />
        </AccordionItem>
        <AccordionItem theme={theme} id="tidy" icon="Sparkles" title="Tidy up Paseo's provider menu" summary={tidyCount ? `${tidyCount} can't run here` : "Turn off providers that can't run here"}>
          <TidyUp theme={theme} say={say} />
        </AccordionItem>
        <AccordionItem theme={theme} id="agent-apps" icon="AppWindow" title="Claude Code and Codex versions" summary="What this daemon runs, and updates">
          <AgentAppsCard theme={theme} say={say} />
        </AccordionItem>
      </Accordion>
      <AdvancedBanner theme={theme} data={data} say={say} />
    </>
  );
}

// ------------------------------------------------------------------ Accounts

/**
 * Accounts: the team's subscriptions and what each has left, then how much
 * the router is used over a date range, then the router's health and this
 * key's own spend, folded. Without a read token: what one adds, and this
 * key's spend.
 */
function AccountsView({ theme, data, configured, compact, go, say, initialRange }: { theme: Theme; data: Status; configured: boolean; compact: boolean; go: Go; say: Say; initialRange?: AnalyticsRangeId }) {
  if (!configured) return <ConnectFirst theme={theme} go={go} />;
  const access = (
    <AccordionItem theme={theme} id="your-access" icon="KeyRound" title="This key's spending" summary="Its name, spend against its limit, and quotas">
      <YourAccess theme={theme} data={data} />
    </AccordionItem>
  );
  if (data.tier !== "operator" && data.tier !== "admin") {
    return (
      <>
        <Banner theme={theme} tone="neutral" title="See your team's accounts and usage">
          <Note theme={theme}>A read token shows each account, how much it has left, and how much the router is used. It is read-only.</Note>
          <Row><Button theme={theme} label="Add a read token" icon="KeyRound" primary onPress={() => go("connection")} /></Row>
        </Banner>
        <Accordion theme={theme}>{access}</Accordion>
      </>
    );
  }
  return (
    <AccountsTab theme={theme} data={data} say={say} folds={access}>
      <View style={{ marginBottom: SPACE.row }}>
        <SectionTitle theme={theme} icon="Activity">Usage</SectionTitle>
      </View>
      <UsageTab theme={theme} compact={compact} initialRange={initialRange} />
    </AccountsTab>
  );
}

/** A tab that needs a router, before one is connected: one line and the way to set it up (0.20.0). */
function ConnectFirst({ theme, go }: { theme: Theme; go: Go }) {
  return (
    <Card theme={theme}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: SPACE.row }}>
        <ItemTitle theme={theme}>Connect a router first</ItemTitle>
        <Button theme={theme} label="Set up" icon="Plug" primary onPress={() => go("overview")} />
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------- surface

/**
 * Refresh (0.20.0), the page's one way to check again: the router's health,
 * Paseo's providers and the agent apps' latest versions, then every list on
 * the page. It says the result in the same words as the "Check router" command.
 */
function useRefresh(say: Say) {
  const queryClient = useQueryClient();
  const callStatus = useRpc(status);
  const callClis = useRpc(clis);
  const callProviders = useRpc(providersList);
  return useMutation({
    mutationFn: async () => {
      const [next] = await Promise.all([
        callStatus({ refresh: true }),
        callClis({ refresh: true }).then((value) => queryClient.setQueryData(CLIS_KEY, value), () => undefined),
        callProviders({ refresh: true }).then((value) => queryClient.setQueryData(PROVIDERS_KEY, value), () => undefined),
      ]);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(STATUS_KEY, next);
      void queryClient.invalidateQueries({ queryKey: ["ai-router"], predicate: (query) => ![STATUS_KEY, CLIS_KEY, PROVIDERS_KEY].some((key) => key.every((part, index) => query.queryKey[index] === part)) });
      say(checkReply(next));
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
}

/** The page header: the plugin's icon and name, one line on the connection with a coloured dot, and Refresh. */
function PageHeader({ theme, data, configured, host, say }: { theme: Theme; data: Status; configured: boolean; host: string | null; say: Say }) {
  const refresh = useRefresh(say);
  const dot = !configured ? theme.colors.foregroundMuted : data.health?.up === false ? theme.colors.statusDanger : data.health?.up ? theme.colors.statusSuccess : theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.row }}>
      <IconBadge theme={theme} name="Route" size={46} />
      <View style={{ flex: 1, gap: SPACE.hair }}>
        <Text accessibilityRole="header" style={{ ...TYPE.page, color: theme.colors.foreground }}>
          AI Router
          {host ? <Text style={{ fontWeight: "400", color: theme.colors.foregroundMuted }}>{` · ${host}`}</Text> : null}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
          {configured ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
          <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted, flexShrink: 1 }}>{configured ? `Connected to ${ROUTERS[data.connection.router].label} · ${TIER_LABELS[data.tier]}` : notConnectedLine(data.computer)}</Text>
        </View>
      </View>
      <Link theme={theme} label={refresh.isPending ? "Refreshing…" : "Refresh"} accessibilityLabel="Refresh AI Router" onPress={() => { if (!refresh.isPending) refresh.mutate(); }} />
    </View>
  );
}

type Place = { tab: TabId; open: readonly string[]; visit: number };

/**
 * `params` (Paseo 0.11 screens): `tab` opens a tab, old ids included
 * ("connection" opens Help with its connection fold-outs); `open` adds
 * fold-outs by id. `initialTab`, `initialRange` and `initialNews` let tests and
 * the preview open a view directly; Paseo does not pass them.
 */
export function AiRouterSurface({ theme, host, layout, navigation, params, initialTab, initialRange, initialNews }: PluginSurfaceProps & { params?: Record<string, string>; initialTab?: GoTarget; initialRange?: AnalyticsRangeId; initialNews?: boolean }) {
  noteHost(host);
  const callStatus = useRpc(status);
  // 0.22.0: Paseo's toasts where the app has them; the message bar below the tabs otherwise.
  const [message, setMessage] = useSay();
  const deepLink = initialTab ?? params?.tab ?? null;
  const [place, setPlace] = useState<Place>(() => ({ ...resolveTarget(deepLink, params?.open), visit: 0 }));
  // Opened again with other params (the screen stays mounted, 0.11): go there.
  // Opened with none, as the sidebar row does, means Overview.
  const paramsKey = params ? `${params.tab ?? ""}|${params.open ?? ""}` : null;
  const seenParams = useRef(paramsKey);
  useEffect(() => {
    if (initialTab || paramsKey === seenParams.current) return;
    seenParams.current = paramsKey;
    setPlace((now) => ({ ...resolveTarget(params?.tab, params?.open), visit: now.visit + 1 }));
  }, [paramsKey]);
  // The other way round: a tab picked here goes into the params, so the window title follows it.
  useEffect(() => {
    if (!initialTab) syncScreenTab(place.tab, params, (id) => resolveTarget(id).tab);
  }, [place.tab]);
  // A reply from a Command Center item or /ai-router: shown here once.
  const pending = useSyncExternalStore(subscribePendingMessage, peekPendingMessage, peekPendingMessage);
  useEffect(() => {
    if (!pending) return;
    setMessage(takePendingMessage());
    setPlace((now) => ({ tab: "overview", open: [], visit: now.visit + 1 }));
  }, [pending]);
  const folds = useMemo(() => ({ open: new Set(place.open), visit: place.visit }), [place]);
  const query = useQuery({ queryKey: STATUS_KEY, queryFn: () => callStatus({}), refetchInterval: 20_000 });
  const data = query.data;
  const configured = data?.problem === null;
  const pad = layout.compact ? SPACE.md : SPACE.section;
  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0, alignItems: "center", justifyContent: "center", padding: pad, gap: SPACE.row }}>
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
  const go: Go = (target) => {
    setMessage(null);
    setPlace((now) => ({ ...resolveTarget(target), visit: now.visit + 1 }));
  };
  const tab = place.tab;
  const name = ROUTERS[data.connection.router].label;
  const openAgent: OpenAgent = navigation ? (agentId) => navigation.openAgent({ agentId }) : null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: pad, paddingBottom: SPACE.section * 2, maxWidth: 980, width: "100%", alignSelf: "center" }}>
      <PageHeader theme={theme} data={data} configured={configured} host={hostName(host?.label, data.computer)} say={setMessage} />
      <TabBar theme={theme} compact={layout.compact} active={tab} onSelect={go} />
      {message ? <MessageBar theme={theme} tone={message.tone} text={message.text} /> : null}
      <FoldsContext.Provider value={folds}>
        {tab === "overview" && configured ? <OverviewTab theme={theme} data={data} compact={layout.compact} go={go} say={setMessage} openAgent={openAgent} initialNews={initialNews} /> : null}
        {tab === "overview" && !configured ? (
          <>
            <ConnectionCard theme={theme} data={data} configured={false} go={go} say={setMessage} />
            <OverviewGuide theme={theme} compact={layout.compact} go={go} router={name} accounts={[]} synced={false} open />
            <Accordion theme={theme}>
              <AccordionItem theme={theme} id="traffic" icon="ArrowLeftRight" title="Recent traffic" summary="Chats started here, and whether they used the router">
                <ActivityTab theme={theme} data={data} openAgent={openAgent} />
              </AccordionItem>
            </Accordion>
          </>
        ) : null}
        {tab === "accounts" ? <AccountsView theme={theme} data={data} configured={configured} compact={layout.compact} go={go} say={setMessage} initialRange={initialRange} /> : null}
        {tab === "models" ? <ModelsTab theme={theme} data={data} configured={configured} go={go} say={setMessage} /> : null}
        {tab === "help" ? <HelpTab theme={theme} data={data} configured={configured} compact={layout.compact} go={go} say={setMessage} /> : null}
      </FoldsContext.Provider>
    </ScrollView>
  );
}
