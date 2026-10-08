/**
 * Renders the surface twice per fixture: once with no RPC answered and no
 * settings, once after both arrive. A hook placed after an early return
 * changes the hook count between those renders, which React's development
 * build reports by name before throwing #310. Some mounts then press a button
 * (Edit, a model's Test), and the tab walks press every tab in one mounted
 * surface, so switching tabs is covered as well as opening on one.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiRouterSurface } from "../../client/surface";
import { RouterSettingsCard } from "../../client/insights";
import { UsageTab } from "../../client/analytics";
import { TabBar } from "../../client/navigation";
import type { GoTarget } from "../../shared/tabs";
import { createAlertStore, makeAlertChip, makeAlertPopover, registerRouterAlerts } from "../../client/alerts";
import { peekPendingMessage, registerRouterCommands, slashJob, takePendingMessage } from "../../client/commands";
import { forgetRouterErrorReads, makeRouterErrorCard, registerRouterErrors, transformRouterError } from "../../client/router-errors";
import { followAgents } from "../../client/agents";
// The same module the vite alias hands the client under "@getpaseo/plugin/client".
import contributeClient from "../../index.client";
import { hostOpener } from "../../client/links";
import { makeQuickActions, makeStatusTrailing } from "../../client/quick";
import { releaseRpc, setChatRouted, setHostExports, setAccessFixture, setActivityFixture, setClisFixture, setCompressionFixture, setHostDataReady, setProfilesFixture, setSettingsFixture, setStatusFixture, setUsageFixture } from "./stubs/plugin";

const colors = {
  surface0: "#000", surface1: "#111", surface2: "#222", border: "#333", foreground: "#fff", foregroundMuted: "#aaa",
  accent: "#88f", accentForeground: "#000", statusSuccess: "#0f0", statusWarning: "#ff0", statusDanger: "#f00",
};
/** Agents Paseo was asked to open, through the host's navigation. */
export const openedAgents: string[] = [];
const base = { theme: { colors }, host: { id: "test", label: "test" }, navigation: { openAgent: ({ agentId }: { agentId: string }) => openedAgents.push(agentId), openWorkspace() {} } } as any;
const ROUTER_DOWN = { agentId: "agent-7", text: "Router down", detail: "OmniRoute isn't answering (connection refused). This chat's requests go through it, so they fail until it's back. Reopened, it uses its own sign-in until the router is back." };

const wide = { compact: false, platform: "web" } as const;
const narrow = { compact: true, platform: "ios" } as const;
type Pick = { tab?: GoTarget; params?: Record<string, string>; accounts?: string; settings?: string; usage?: string; access?: string; compression?: string; profiles?: string; activity?: string; apps?: string };
const surface = (status: string, layout: { compact: boolean; platform: "web" | "ios" }, pick: Pick = {}) => () => {
  setStatusFixture(status, pick.accounts);
  setUsageFixture(pick.usage ?? "ok");
  if (pick.settings) setSettingsFixture(pick.settings);
  if (pick.access) setAccessFixture(pick.access);
  if (pick.compression) setCompressionFixture(pick.compression);
  if (pick.profiles) setProfilesFixture(pick.profiles);
  if (pick.activity) setActivityFixture(pick.activity);
  if (pick.apps) setClisFixture(pick.apps);
  return <AiRouterSurface {...base} layout={layout} initialTab={pick.tab} params={pick.params} />;
};

/** The router-alert chip on the old component shape, for one chat; `alert` puts a problem on it. */
const alertChip = (alert: boolean) => () => {
  setStatusFixture("routing on");
  const store = createAlertStore();
  store.set("agent-7", "ws-1");
  if (alert) store.setAlerts([ROUTER_DOWN]);
  const Chip = makeAlertChip(store);
  return <Chip {...base} layout={wide} workspaceId="ws-1" agentId="agent-7" />;
};

/** Real OmniRoute errors as Claude Code shows them (tests/fixtures/router-errors.json has the full set). */
const GATEWAY = " This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (10.0.0.5:20128).";
export const ROUTER_ERRORS = {
  paused: `API Error: 503 Provider claude circuit breaker is open.${GATEWAY}`,
  cooling: `API Error: 503 [claude/claude-fable-5-1] [429]: {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit. Please try again later."}} (reset after 1m 9s).${GATEWAY}`,
  elsewhere: "API Error: 503 [claude/claude-fable-5-1] [429]: rate_limit_error (reset after 1m 9s). This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (proxy.example.com:8080).",
};
const errorCard = (fixture: string, text: string, routed: boolean | null = true) => () => {
  setStatusFixture(fixture);
  setChatRouted(routed);
  forgetRouterErrorReads();
  const Card = makeRouterErrorCard(() => openedAgents.push("router:accounts"));
  return <Card {...base} layout={wide} agentId="agent-7" timestamp={new Date(2026, 9, 6, 16, 40, 0)} item={{ type: "plugin", kind: "router-error", version: 1, data: { message: text, source: "assistant" } }} />;
};

/** 0.21.0: the chat chip's popover on a 0.11 app, with the switch-back offer. */
const alertPopover = (fixture: string) => () => {
  setStatusFixture(fixture);
  const store = createAlertStore();
  store.set("agent-7", "ws-1");
  store.setAlerts([ROUTER_DOWN]);
  const Popover = makeAlertPopover(store, () => openedAgents.push("router:open"));
  return <Popover {...base} layout={wide} workspaceId="ws-1" agentId="agent-7" close={() => {}} />;
};

export const mounts: Record<string, () => React.ReactElement> = {
  // The routing switches and the switch-back offer (0.21.0)
  "routing: down, Codex offer, Claude sign-in expired": surface("down, codex on", wide),
  "routing: down, Codex own sign-in asks first": surface("down, codex on", wide),
  "routing: down, Codex own sign-in confirmed": surface("down, codex on", narrow),
  "routing: Codex paused, no own sign-in": surface("codex paused, no sign-in", wide),
  "routing: router back, switch back": surface("router back", wide),
  "routing: Overview Codex switch asks first": surface("routing on", wide),
  "routing: Overview Codex switch confirmed": surface("routing on", narrow),
  "routing: chip popover offer": alertPopover("down, codex on"),
  "routing: error card offer (Claude paused)": errorCard("claude paused", ROUTER_ERRORS.paused),
  // Router errors in a chat (0.19.0)
  "router error card (Claude paused, manage key)": errorCard("claude paused", ROUTER_ERRORS.paused),
  "router error card (resume asks first)": errorCard("claude paused", ROUTER_ERRORS.paused),
  "router error card (resume confirmed)": errorCard("claude paused", ROUTER_ERRORS.paused),
  "router error card (paused, read token only)": errorCard("routing on", ROUTER_ERRORS.paused),
  "router error card (cooling down)": errorCard("routing on", ROUTER_ERRORS.cooling),
  "router error card (details)": errorCard("routing on", ROUTER_ERRORS.cooling),
  "router error card (open AI Router)": errorCard("routing on", ROUTER_ERRORS.cooling),
  "router error card (chat on its own sign-in)": errorCard("routing on", ROUTER_ERRORS.elsewhere, false),
  "router error card (another gateway, not in the log)": errorCard("routing on", ROUTER_ERRORS.elsewhere, null),
  "router error card (our gateway, log says own sign-in)": errorCard("routing on", ROUTER_ERRORS.cooling, false),
  // Connection, and the setup that lives there
  "setup (not connected, opens on Connection)": surface("not connected", wide),
  "setup (env, no key, narrow)": surface("env, no key", narrow),
  "misconfigured (opens on Connection)": surface("misconfigured", wide),
  "misconfigured overview": surface("misconfigured", narrow, { tab: "overview" }),
  "connection tab (operator, private dashboard)": surface("connected", wide, { tab: "connection" }),
  "connection tab (admin, tunnels)": surface("admin", wide, { tab: "connection" }),
  "connection tab (basic, narrow)": surface("basic", narrow, { tab: "connection" }),
  "connection tab (editing)": surface("connected", narrow, { tab: "connection" }),
  "connection tab (router down)": surface("router down", wide, { tab: "connection" }),
  "connection tab (public address ok)": surface("public ok", wide, { tab: "connection" }),
  "connection tab (public address pending, narrow)": surface("public pending", narrow, { tab: "connection" }),
  "connection tab (no public address)": surface("connected", narrow, { tab: "connection" }),
  "overview (public address ok)": surface("public ok", wide),
  // Activity
  "activity (operator)": surface("routing on", wide, { tab: "activity" }),
  "activity (operator, narrow, all sessions)": surface("routing on", narrow, { tab: "activity" }),
  "activity (errors only)": surface("routing on", narrow, { tab: "activity" }),
  "activity (all daemons, a model)": surface("admin", wide, { tab: "activity" }),
  "activity (why this route)": surface("routing on", wide, { tab: "activity" }),
  "activity (show older)": surface("routing on", narrow, { tab: "activity", activity: "many" }),
  "activity (nothing yet)": surface("routing on", wide, { tab: "activity", activity: "empty" }),
  "activity (basic)": surface("basic", narrow, { tab: "activity" }),
  "activity (router down, last answer)": surface("router down", wide, { tab: "activity" }),
  "activity (not connected)": surface("not connected", wide, { tab: "activity" }),
  "overview (last agent links to Activity)": surface("routing on", wide),
  // Overview
  "overview (routing on, narrow)": surface("routing on", narrow),
  "overview (basic)": surface("basic", wide),
  "overview (admin, tunnel)": surface("admin", narrow),
  "overview (routing off)": surface("routing off", wide),
  "overview (last agent skipped)": surface("connected", wide),
  "overview (router down)": surface("router down", wide),
  "overview (Claude paused)": surface("claude paused", wide),
  "overview (guide opened)": surface("routing on", wide),
  "overview (drift)": surface("drift", wide),
  "overview (Codex re-routed)": surface("admin", wide),
  "models tab (drift)": surface("drift", wide, { tab: "models" }),
  "providers tab (re-route Codex asks first)": surface("routing on", wide, { tab: "providers" }),
  "providers tab (re-route Codex confirmed)": surface("routing on", narrow, { tab: "providers" }),
  "providers tab (Codex back on own sign-in asks first)": surface("admin", wide, { tab: "providers" }),
  "providers tab (agent apps, Mac)": surface("routing on", wide, { tab: "providers" }),
  "providers tab (agent apps asks first)": surface("routing on", narrow, { tab: "providers" }),
  "providers tab (agent apps updating)": surface("routing on", wide, { tab: "providers", apps: "updating" }),
  // Models
  "models tab": surface("connected", wide, { tab: "models" }),
  "models tab (basic, key hides its spend)": surface("basic", narrow, { tab: "accounts", access: "hidden", params: { open: "your-access" } }),
  "accounts tab (your access)": surface("connected", wide, { tab: "accounts", params: { open: "your-access" } }),
  "models tab (testing one)": surface("routing on", narrow, { tab: "models" }),
  "models tab (not synced)": surface("routing off", wide, { tab: "models" }),
  // Providers
  "providers tab (basic, narrow)": surface("basic", narrow, { tab: "providers" }),
  "providers tab (tidy up preview)": surface("admin", wide, { tab: "providers" }),
  "providers tab (not connected)": surface("not connected", wide, { tab: "providers" }),
  "providers tab (re-route Claude asks first)": surface("routing off", wide, { tab: "providers" }),
  "providers tab (re-route Claude confirmed)": surface("routing off", wide, { tab: "providers" }),
  "providers tab (own sign-in asks first)": surface("routing on", wide, { tab: "providers" }),
  "providers tab (own sign-in asks first, cancel)": surface("routing on", narrow, { tab: "providers" }),
  // Accounts and Usage
  "accounts tab (operator)": surface("routing on", narrow, { tab: "accounts", accounts: "healthy" }),
  "accounts tab (Paseo 0.11 daemon)": surface("native usage", wide, { tab: "accounts", accounts: "healthy" }),
  "accounts tab (admin, attention)": surface("manage key", wide, { tab: "accounts", accounts: "ok" }),
  "accounts tab (Claude paused)": surface("claude paused", wide, { tab: "accounts", accounts: "paused" }),
  "accounts tab (token rejected)": surface("routing on", wide, { tab: "accounts", accounts: "error" }),
  "usage tab (in the surface)": surface("routing on", wide, { tab: "usage" }),
  "usage tab (30 days, narrow)": surface("routing on", narrow, { tab: "usage" }),
  "usage tab (24 hours)": surface("routing on", wide, { tab: "usage" }),
  "usage tab (in the surface, empty)": surface("routing on", narrow, { tab: "usage", usage: "empty" }),
  "usage tab (router down, last answer)": surface("router down", wide, { tab: "usage", usage: "stale" }),
  "models tab (combo profiles)": surface("routing on", wide, { tab: "models" }),
  "models tab (combo profiles off)": surface("routing on", narrow, { tab: "models", profiles: "off" }),
  "models tab (switch combo profiles)": surface("routing on", narrow, { tab: "models" }),
  // Settings
  "settings tab (operator, stacked compression)": surface("connected", wide, { tab: "settings", settings: "calm" }),
  "settings tab (admin, apply recommended)": surface("claude paused", narrow, { tab: "settings", settings: "editable" }),
  "settings tab (recommended already)": surface("admin", wide, { tab: "settings", settings: "calm", compression: "lite" }),
  // Overview's MCP card, Tips, and Settings at every tier
  "overview (MCP card)": surface("routing on", wide),
  "overview (MCP installed, narrow)": surface("admin", narrow),
  "overview (hide the MCP card)": surface("routing on", wide),
  "tips tab (operator)": surface("routing on", wide, { tab: "tips" }),
  "tips tab (admin, two installed, copy one)": surface("admin", narrow, { tab: "tips" }),
  "tips tab (not connected)": surface("not connected", wide, { tab: "tips" }),
  "settings tab (basic)": surface("basic", wide, { tab: "settings" }),
  "settings tab (not connected)": surface("not connected", narrow, { tab: "settings" }),
  "settings tab (MCP line off)": surface("routing on", wide, { settings: "calm" }),
  // The chip on a chat: only while the router can't serve it
  "alert chip (router down)": alertChip(true),
  "activity (open an agent)": surface("routing on", wide, { tab: "activity" }),
  // The guide's link opens Models; the setup's link opens the guide
  "overview (guide opens Models)": surface("routing on", wide),
  "overview (not connected)": surface("not connected", wide, { tab: "overview" }),
  "setup (link opens the guide)": surface("not connected", narrow, { tab: "connection" }),
  // The four tabs by their own ids, and deep links (Paseo 0.11 screen params), old ids included
  "help tab (operator)": surface("routing on", wide, { tab: "help" }),
  "help tab (basic, narrow)": surface("basic", narrow, { tab: "help" }),
  "help tab (not connected)": surface("not connected", wide, { tab: "help" }),
  "accounts tab (basic)": surface("basic", wide, { tab: "accounts" }),
  "accounts tab (not connected)": surface("not connected", narrow, { tab: "accounts" }),
  "models tab (not connected)": surface("not connected", wide, { tab: "models" }),
  "deep link (tab=connection)": surface("routing on", wide, { params: { tab: "connection" } }),
  "deep link (tab=usage)": surface("routing on", wide, { accounts: "healthy", params: { tab: "usage" } }),
  "deep link (tab=help, open=tips)": surface("routing on", narrow, { params: { tab: "help", open: "tips" } }),
  "deep link (unknown tab)": surface("routing on", wide, { params: { tab: "nowhere" } }),
  "help tab (press a question)": surface("routing on", wide, { tab: "help" }),
  "help tab (guide question)": surface("routing on", narrow, { tab: "help" }),
  "setup (advanced fields)": surface("not connected", wide),
  "providers tab (agent apps, where installed)": surface("routing on", wide, { tab: "providers" }),
  // Every visible tab in one mounted surface, pressed in turn
  "tab walk (basic)": surface("basic", narrow),
  "tab walk (operator)": surface("routing on", narrow, { accounts: "healthy" }),
  "tab walk (admin)": surface("claude paused", wide, { accounts: "paused", settings: "editable" }),
  "tab walk (router down)": surface("router down", narrow),
  "tab walk (not connected)": surface("not connected", wide),
  // The pieces on their own
  "router settings (read-only)": () => { setStatusFixture("connected"); return <RouterSettingsCard theme={base.theme} dashboardUrl="http://10.0.0.5:20128/dashboard" onMessage={() => {}} />; },
  "router settings (manage key)": () => { setStatusFixture("connected"); setSettingsFixture("editable"); return <RouterSettingsCard theme={base.theme} dashboardUrl="http://10.0.0.5:20128/dashboard" onMessage={() => {}} />; },
  "router settings (no token)": () => { setStatusFixture("connected"); setSettingsFixture("no-token"); return <RouterSettingsCard theme={base.theme} dashboardUrl={null} onMessage={() => {}} />; },
  "usage tab": () => { setStatusFixture("connected", "ok"); return <UsageTab theme={base.theme} compact={false} />; },
  "usage tab (no token)": () => { setStatusFixture("connected", "no-token"); return <UsageTab theme={base.theme} compact />; },
};

/** Buttons and links pressed, by accessibility label, once data has arrived. */
export const presses: Record<string, string[]> = {
  "router error card (resume asks first)": ["Resume now: Claude"],
  "router error card (resume confirmed)": ["Resume now: Claude", "Yes, resume now"],
  "router error card (details)": ["Details"],
  "router error card (open AI Router)": ["Open AI Router's Accounts tab"],
  "connection tab (operator, private dashboard)": ["Dashboard won't open? It is on a private network — show how"],
  "connection tab (editing)": ["Edit"],
  "models tab (testing one)": ["Test Opus 5.5"],
  "providers tab (tidy up preview)": ["Tidy up…"],
  "providers tab (re-route Claude asks first)": ["Claude · through the router"],
  "providers tab (re-route Claude confirmed)": ["Claude · through the router", "Yes, send Claude through the router"],
  "providers tab (own sign-in asks first)": ["Claude · through the router"],
  "providers tab (own sign-in asks first, cancel)": ["Claude · through the router", "Cancel"],
  "routing: down, Codex own sign-in asks first": ["Use this computer's own sign-in for Codex"],
  "routing: down, Codex own sign-in confirmed": ["Use this computer's own sign-in for Codex", "Yes, use own sign-in"],
  "routing: router back, switch back": ["Switch back to the router", "Yes, switch back"],
  "routing: Overview Codex switch asks first": ["Codex · through the router"],
  "routing: Overview Codex switch confirmed": ["Codex · through the router", "Yes, send Codex through the router"],
  "settings tab (admin, apply recommended)": ["Apply recommended…", "What each engine does"],
  "usage tab (30 days, narrow)": ["Last 30 days"],
  "usage tab (24 hours)": ["Today"],
  "models tab (switch combo profiles)": ["Show combos as agent profiles"],
  "connection tab (public address ok)": ["Copy the Claude Code setup"],
  "activity (operator, narrow, all sessions)": ["Show all 11"],
  "activity (errors only)": ["Errors only"],
  "activity (all daemons, a model)": ["All daemons", "Only claude-haiku-4-5"],
  "activity (why this route)": ["Request r-300, succeeded; show why"],
  "activity (show older)": ["Show older"],
  "overview (last agent links to Activity)": ["See every chat in Recent traffic"],
  "overview (hide the MCP card)": ["Hide the Connectors line"],
  "overview (guide opened)": ["New to AI Router? How it works"],
  "providers tab (re-route Codex asks first)": ["Codex · through the router"],
  "providers tab (re-route Codex confirmed)": ["Codex · through the router", "Yes, send Codex through the router"],
  "providers tab (Codex back on own sign-in asks first)": ["Codex · through the router"],
  "providers tab (agent apps asks first)": ["Update to 0.160.0"],
  "tips tab (admin, two installed, copy one)": ["Copy the Tell Agent install command"],
  "settings tab (MCP line off)": ["Hide the Connectors line", "Help", "What does AI Router add to Paseo?", "Show the Connectors suggestion on Overview again"],
  "help tab (press a question)": ["Which plugins work well with AI Router?"],
  "activity (open an agent)": ["Open Fix the login bug", "Open Draft release notes"],
  "overview (guide opens Models)": ["New to AI Router? How it works", "Open the Models tab"],
  "setup (link opens the guide)": ["Set up"],
  "help tab (guide question)": ["How does AI Router work?"],
  "setup (advanced fields)": ["Advanced (optional): public address and SSH target"],
  "providers tab (agent apps, where installed)": ["Where it's installed"],
};

/** Mounts whose every visible tab is pressed in turn, then the first again. */
export const walks = new Set(["tab walk (basic)", "tab walk (operator)", "tab walk (admin)", "tab walk (router down)", "tab walk (not connected)"]);

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export async function renderThroughDataArrival(name: string): Promise<{ before: { nodes: number; text: string }; after: { nodes: number; text: string }; tabs: Record<string, string> }> {
  setHostDataReady(false);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = <QueryClientProvider client={queryClient}>{mounts[name]()}</QueryClientProvider>;
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(element); });
  await act(flush);
  const before = describe(renderer.toJSON());
  await act(async () => { setHostDataReady(true); releaseRpc(); await flush(); await flush(); });
  await act(flush);
  for (const label of presses[name] ?? []) {
    const target = renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === label)[0];
    if (!target) throw new Error(`nothing labelled "${label}" to press`);
    await act(async () => { target.props.onPress(); await flush(); });
    // The press's update renders when act() exits; a query it starts answers after that.
    for (let i = 0; i < 4; i += 1) await act(flush);
  }
  const after = describe(renderer.toJSON());
  const tabs: Record<string, string> = {};
  if (walks.has(name)) {
    const tabNodes = () => renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityRole === "tab");
    const labels = tabNodes().map((node) => node.props.accessibilityLabel as string);
    for (const label of [...labels, labels[0]]) {
      const target = tabNodes().find((node) => node.props.accessibilityLabel === label)!;
      await act(async () => { target.props.onPress(); for (let i = 0; i < 6; i += 1) await flush(); });
      await act(flush);
      tabs[label] = describe(renderer.toJSON()).text;
    }
  }
  await act(async () => { renderer.unmount(); });
  queryClient.clear();
  return { before, after, tabs };
}

function describe(tree: any): { nodes: number; text: string } {
  let nodes = 0;
  const text = (node: any): string => {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(text).join(" ");
    nodes += 1;
    return text(node.children);
  };
  const joined = text(tree);
  return { nodes, text: joined };
}

/**
 * The router-alert chips on the old component shape (0.8.0-beta.1): a chip
 * only on a chat a router problem reaches, gone once it clears; reads are
 * one at a time.
 */
export async function alertRegistryCheck(): Promise<Record<string, unknown>> {
  const added: string[] = [];
  const removed: string[] = [];
  let opened = 0;
  let emit: (update: any) => void = () => {};
  let alertsNext: unknown[] = [];
  let rpcCalls = 0;
  let slow = false;
  let release: () => void = () => {};
  const client = {
    addComposerPill(pill: any) {
      added.push(pill.agentId);
      pill.onPress();
      return () => removed.push(pill.agentId);
    },
    rpc: () => {
      rpcCalls += 1;
      if (slow) return new Promise((resolve) => { release = () => resolve({ alerts: [] }); });
      return Promise.resolve({ alerts: alertsNext });
    },
    paseo: { agents: { subscribe(handler: any) { emit = handler; return () => { emit = () => {}; }; } } },
  } as any;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const stop = registerRouterAlerts(client, createAlertStore(), () => { opened += 1; }, { pollMs: 5, capMs: 20 });
  const agent = (id: string, over: Record<string, unknown> = {}) => ({ kind: "upsert", agent: { id, workspaceId: "ws-1", archivedAt: null, lastUsage: { contextWindowUsedTokens: 40_000, contextWindowMaxTokens: 200_000 }, ...over } });
  emit(agent("a"));
  emit(agent("b"));
  emit(agent("c", { archivedAt: "2026-09-23T00:00:00Z" }));
  await wait(30);
  const calm = [...added];
  // The router goes down: a and c are routed, but c is archived; b is not reached.
  alertsNext = [{ agentId: "a", text: "Router down", detail: "x" }, { agentId: "c", text: "Router down", detail: "x" }];
  await wait(30);
  const down = [...added];
  alertsNext = [];
  await wait(30);
  const cleared = removed.includes("a");
  // A slow daemon: the next read stays out; no second read starts meanwhile.
  slow = true;
  const beforeSlow = rpcCalls;
  await wait(30);
  const whileOut = rpcCalls - beforeSlow;
  release();
  stop();
  const afterStop = rpcCalls;
  await wait(30);
  return { calm, down, cleared, opened, whileOut, stoppedReads: rpcCalls - afterStop };
}

/**
 * The same chips on Paseo 0.8.0 stable and later (0.15.1): chips are buttons
 * the app validates, the label is pushed with update(), and agents come from
 * the plugin's own observation (0.9+).
 */
export async function alertButtonsCheck(): Promise<Record<string, unknown>> {
  const added: Array<{ agentId: string; label?: string; icon: string }> = [];
  const updates: Array<[string, unknown]> = [];
  const removed: string[] = [];
  const invalid: string[] = [];
  const presses = new Map<string, () => void>();
  let opened = 0;
  let refuseNext = 0;
  let observer: any = null;
  let released = 0;
  let listCalls = 0;
  let oldSubscribeCalls = 0;
  let alertsNext: unknown[] = [{ agentId: "a", text: "Router down", detail: "x" }];
  const agentOf = (id: string, over: Record<string, unknown> = {}) => ({ id, workspaceId: "ws-1", archivedAt: null, ...over });
  // What the 0.11 app's validateButton and requireButtonId check, so a wrong shape fails here as it does there.
  const validate = (pill: any) => {
    const b = pill.button;
    if (typeof pill.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(pill.id)) return "id";
    if (!b || typeof b.title !== "string" || !b.title.trim()) return "title";
    if (b.label !== undefined && (typeof b.label !== "string" || !b.label.trim())) return "label";
    if (typeof b.icon !== "string" || b.icon !== "TriangleAlert") return "icon";
    if (b.behavior?.kind !== "action" || typeof b.behavior.onPress !== "function") return "behavior";
    if ("Component" in pill || "onPress" in pill) return "old shape";
    return null;
  };
  const client = {
    addHeaderButton() {},
    addComposerPill(pill: any) {
      const problem = validate(pill);
      if (problem) {
        invalid.push(problem);
        throw new Error(`invalid button: ${problem}`);
      }
      if (refuseNext > 0) {
        refuseNext -= 1;
        throw new Error("Plugin button needs a workspace");
      }
      added.push({ agentId: pill.agentId, label: pill.button.label, icon: pill.button.icon });
      presses.set(pill.agentId, pill.button.behavior.onPress);
      return {
        update(patch: unknown) {
          const problem = validate({ ...pill, button: { ...pill.button, ...(patch as object) } });
          if (problem) invalid.push(`update ${problem}`);
          updates.push([pill.agentId, patch]);
        },
        remove: () => removed.push(pill.agentId),
      };
    },
    rpc: async () => ({ alerts: alertsNext }),
    paseo: {
      observeEvents() {},
      agents: {
        subscribe() { oldSubscribeCalls += 1; return () => {}; },
        async list(options: any) {
          listCalls += 1;
          if (!options?.subscribe) throw new Error("no subscribe");
          return {
            entries: [{ agent: agentOf("a") }, { agent: agentOf("b") }, { agent: agentOf("c", { archivedAt: "2026-09-23T00:00:00Z" }) }],
            subscription: { subscribe(next: any) { observer = next; return () => {}; }, release: async () => { released += 1; } },
          };
        },
      },
    },
  } as any;
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  // The first add is refused (the app doesn't know the workspace yet): the loop carries on and retries.
  refuseNext = 1;
  const stop = registerRouterAlerts(client, createAlertStore(), () => { opened += 1; }, { pollMs: 5, capMs: 20 });
  await flush();
  await flush();
  const afterRefusal = { refusedLeft: refuseNext, added: added.map((pill) => pill.agentId) };
  await wait(30);
  const first = added.map((pill) => ({ ...pill }));
  presses.get("a")?.();
  // Claude paused instead: the label is pushed, not a second chip.
  alertsNext = [{ agentId: "a", text: "Claude paused", detail: "x" }];
  await wait(30);
  const pausedUpdate = updates.filter(([id]) => id === "a").at(-1)?.[1];
  const updatesBefore = updates.length;
  await wait(30);
  const quietUpdates = updates.length - updatesBefore;
  alertsNext = [];
  await wait(30);
  const afterClear = { added: added.map((pill) => pill.agentId), removed: [...removed] };
  // A fresh snapshot (a reconnect) replaces the list: b is gone, d is new and alerted.
  alertsNext = [{ agentId: "d", text: "Router down", detail: "x" }];
  observer.snapshot({ entries: [{ agent: agentOf("d") }] });
  await wait(30);
  const afterSnapshot = added.map((pill) => pill.agentId);
  stop();
  await flush();
  return { afterRefusal, first, opened, pausedUpdate, quietUpdates, afterClear, afterSnapshot, removedAll: [...removed].sort(), released, listCalls, oldSubscribeCalls, invalid };
}

/** The agent follower: no observation on 0.8; on 0.9+ one, reopened with backoff when dropped or refused, released on stop. */
export async function followAgentsCheck(): Promise<Record<string, unknown>> {
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const seen: string[] = [];
  const follower = { replaceAll: (list: any[]) => seen.push(`all:${list.map((a) => a.id).join(",")}`), upsert: (a: any) => seen.push(`up:${a.id}`), remove: (id: string) => seen.push(`rm:${id}`) };

  let oldList = 0;
  let oldEmit: (update: any) => void = () => {};
  const old = { paseo: { agents: { list: async () => { oldList += 1; return { entries: [] }; }, subscribe(handler: any) { oldEmit = handler; return () => { oldEmit = () => {}; }; } } } } as any;
  const stopOld = followAgents(old, follower);
  oldEmit({ kind: "upsert", agent: { id: "p", workspaceId: "ws" } });
  oldEmit({ kind: "remove", agentId: "p" });
  stopOld();
  const onOld = { listCalls: oldList, seen: seen.splice(0) };

  let calls = 0;
  let released = 0;
  let observer: any = null;
  const current = {
    paseo: {
      observeEvents() {},
      agents: {
        subscribe() { throw new Error("0.9+: agents.subscribe alone hears nothing"); },
        async list(options: any) {
          calls += 1;
          if (calls === 1) throw new Error("host not connected yet");
          if (calls === 2) return { entries: [] }; // no observation handed back: treated as a failure
          return { entries: [{ agent: { id: "a", workspaceId: "ws" } }, { agent: null }], subscription: { subscribe(next: any) { observer = next; return () => {}; }, release: async () => { released += 1; } }, _signal: options.signal };
        },
      },
    },
  } as any;
  const stop = followAgents(current, follower, { minMs: 1, maxMs: 4 });
  await wait(30);
  const opened = { calls, seen: seen.splice(0) };
  observer.error(new Error("dropped"));
  await wait(30);
  const reopened = { calls, seen: seen.splice(0) };
  stop();
  await wait(10);
  return { onOld, opened, reopened, released, callsAfterStop: calls };
}

/** The tab bar measured at a narrow window: labels give way to icons, the active tab keeps its name. */
export async function tabBarWidthCheck(): Promise<{ wide: string; tight: string; tightIcons: number }> {
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(<TabBar theme={base.theme} compact={false} active="accounts" onSelect={() => {}} />); });
  const text = () => describe(renderer.toJSON()).text;
  const bar = () => renderer.root.findAll((node) => node.props.accessibilityRole === "tablist")[0];
  await act(async () => { bar().props.onLayout({ nativeEvent: { layout: { width: 900 } } }); });
  const wide = text();
  await act(async () => { bar().props.onLayout({ nativeEvent: { layout: { width: 360 } } }); });
  const tight = text();
  const tightIcons = renderer.root.findAll((node) => node.type === "Icon").length;
  await act(async () => { renderer.unmount(); });
  return { wide, tight, tightIcons };
}

/** The "Sync models" and "Check router" commands and /ai-router: each runs, leaves its reply for the screen, and opens it. */
export async function commandsCheck(): Promise<Record<string, unknown>> {
  const items: any[] = [];
  const slashes: any[] = [];
  const opened: unknown[] = [];
  const calls: string[] = [];
  const rpc = async (contract: any, input: any) => {
    calls.push(`${contract.name}:${JSON.stringify(input)}`);
    if (contract.name === "ai-router.provider") return { ok: true, message: "12 models synced to Paseo." };
    return { problem: null, checking: false, connection: { router: "omniroute" }, health: { up: false, error: "connection refused", latencyMs: null } };
  };
  const client: any = {
    addCommandCenterItem: (item: any) => { items.push(item); return () => {}; },
    addSlashCommand: (command: any) => { slashes.push(command); return () => {}; },
  };
  const cleanups = registerRouterCommands(client, (capabilities) => opened.push(capabilities ? "opened" : "none"));
  await items.find((item) => item.id === "ai-router-sync").onSelect({ context: "global", rpc });
  const synced = takePendingMessage();
  await items.find((item) => item.id === "ai-router-check").onSelect({ context: "global", rpc });
  const checked = takePendingMessage();
  await slashes[0].onSubmit({ context: "agent", rpc, args: " check now" });
  const slashChecked = takePendingMessage();
  await slashes[0].onSubmit({ context: "agent", rpc, args: "" });
  const slashOpened = peekPendingMessage();
  const noSlash: any[] = [];
  const older = registerRouterCommands({ addCommandCenterItem: (item: any) => { noSlash.push(item.id); return () => {}; } } as any, () => {});
  return {
    ids: items.map((item) => item.id),
    slash: slashes.map((command) => ({ name: command.name, hint: command.argumentHint, context: command.context })),
    cleanups: cleanups.length,
    synced,
    checked,
    slashChecked,
    slashOpened,
    opened: opened.length,
    calls,
    words: [slashJob("sync"), slashJob("Models"), slashJob("health"), slashJob("what")],
    older: { ids: noSlash, cleanups: older.length },
  };
}

/**
 * The client entry against a fake Paseo app of each age: a 0.9 app (surface
 * and sidebar item, as 0.13 registered them), a 0.11 app (screen and the
 * app's own sidebar row), and a 0.11 app without the row component.
 */
export function nativeRegistrationCheck() {
  const fakeApp = (extra: Record<string, unknown>) => {
    const calls: Array<[string, any]> = [];
    const commands: any[] = [];
    const client: any = {
      addSurface: (id: string, Component: unknown) => { calls.push(["addSurface", { id, Component }]); return () => {}; },
      addSidebarItem: (item: unknown) => { calls.push(["addSidebarItem", item]); return () => {}; },
      addCommandCenterItem: (item: any) => { commands.push(item); return () => {}; },
      addWorkspacePanel: (panel: any) => { calls.push(["addWorkspacePanel", panel.id]); return () => {}; },
      addComposerPill: () => () => {},
      openPanel() {},
      openSurface: (id: string) => calls.push(["openSurface", id]),
      rpc: async () => ({ ok: true, enabled: true, alerts: [] }),
      paseo: { agents: { subscribe: () => () => {} } },
      ...extra,
    };
    const stop = contributeClient(client);
    stop();
    const opened: unknown[] = [];
    const open = commands.find((command) => command.id === "open-ai-router");
    open.onSelect({ context: "global", openSurface: (id: string) => opened.push(["openSurface", id]), ...(extra.openScreen ? { openScreen: (input: unknown) => opened.push(["openScreen", input]) } : {}) });
    return { names: calls.map(([name]) => name), calls: Object.fromEntries(calls), opened };
  };

  setHostExports({ SidebarRow: undefined });
  const old = fakeApp({});

  const Row = (props: Record<string, unknown>) => React.createElement("SidebarRow", props);
  setHostExports({ SidebarRow: Row });
  const screens: any[] = [];
  const items: any[] = [];
  const next = fakeApp({ addScreen: (c: any) => { screens.push(c); return () => {}; }, addSidebarHeaderItem: (c: any) => { items.push(c); return () => {}; }, openScreen() {} });
  const pressed: unknown[] = [];
  const rowFor = (currentScreen: unknown) => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => { renderer = create(React.createElement(items[0].Component, { ...base, layout: wide, currentScreen, openScreen: (input: unknown) => pressed.push(input), openPopover() {} })); });
    const row = renderer!.root.findAll((node) => node.type === Row)[0].props;
    act(() => renderer!.unmount());
    return row;
  };
  const open = rowFor({ screenId: "ai-router", params: {} });
  const elsewhere = rowFor(null);
  open.onPress();

  setHostExports({ SidebarRow: undefined });
  const partial = fakeApp({ addScreen: () => () => {}, addSidebarHeaderItem: () => () => {}, openScreen() {} });
  setHostExports({ SidebarRow: undefined });

  setHostExports({ openExternalUrl: undefined });
  const noOpener = hostOpener();
  const opener = async (_url: string) => {};
  setHostExports({ openExternalUrl: opener });
  const withOpener = hostOpener() === opener;

  return {
    old,
    next: { names: next.names, screen: { id: screens[0]?.id, title: typeof screens[0]?.title === "function" ? [screens[0].title({}), screens[0].title({ tab: "accounts" }), screens[0].title({ tab: "connection" })] : screens[0]?.title, sameView: screens[0]?.Component === AiRouterSurface }, item: { id: items[0]?.id, title: items[0]?.title }, opened: next.opened },
    row: { open: { icon: open.icon, active: open.active, label: open.label }, elsewhere: { active: elsewhere.active }, pressed, trailing: React.isValidElement(open.trailing) },
    partial: partial.names,
    surfaceIsTheView: old.calls.addSurface?.Component === AiRouterSurface,
    links: { noOpener, withOpener },
  };
}

/**
 * 0.20.0: on a 0.11 app a tab picked inside the screen goes into its params
 * (`openScreen` with `{ tab }`, none for Overview), so the window title follows.
 * Opening it again without params (the sidebar row) lands on Overview.
 */
export async function titleFollowsTabCheck() {
  setStatusFixture("routing on");
  setHostDataReady(true);
  const opened: any[] = [];
  const client: any = {
    addSurface() { return () => {}; }, addSidebarItem() { return () => {}; }, addCommandCenterItem() { return () => {}; }, addSlashCommand() { return () => {}; }, addComposerPill: () => () => {},
    addScreen: () => () => {}, addSidebarHeaderItem: () => () => {}, openScreen: (input: any) => opened.push(input), openSurface() {}, openPanel() {},
    rpc: async () => ({ ok: true, enabled: true, alerts: [] }), paseo: { agents: { subscribe: () => () => {} } },
  };
  const stop = contributeClient(client);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (params: Record<string, string>) => <QueryClientProvider client={queryClient}><AiRouterSurface {...base} layout={wide} params={params} /></QueryClientProvider>;
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(view({ tab: "help", open: "tips" })); });
  await act(flush);
  await act(flush);
  const pressTab = async (label: string) => {
    const tab = renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityRole === "tab" && node.props.accessibilityLabel === label)[0];
    await act(async () => { tab?.props.onPress(); await flush(); });
  };
  const afterDeepLink = opened.length;
  await pressTab("Models");
  await pressTab("Overview");
  await act(async () => { renderer.update(view({ tab: "accounts" })); await flush(); });
  const activeAfterParams = renderer.root.findAll((node) => node.props.accessibilityRole === "tab" && node.props.accessibilityState?.selected)[0]?.props.accessibilityLabel;
  await act(async () => { renderer.update(view({})); await flush(); });
  const activeAfterSidebar = renderer.root.findAll((node) => node.props.accessibilityRole === "tab" && node.props.accessibilityState?.selected)[0]?.props.accessibilityLabel;
  await act(async () => { renderer.unmount(); });
  stop();
  return { afterDeepLink, opened, activeAfterParams, activeAfterSidebar };
}

/** Paseo 0.11's sidebar row: the status dot opens the quick actions popover; without popovers it is only a dot. */
export async function quickActionsCheck() {
  setStatusFixture("routing on");
  setHostDataReady(true);
  const Quick = makeQuickActions("ai-router");
  const Dot = makeStatusTrailing(Quick);
  const popovers: unknown[] = [];
  const screens: unknown[] = [];
  let closed = 0;
  const textOf = (renderer: ReturnType<typeof create>) => renderer.root.findAll((node) => (node.type as unknown) === "Text").map((node) => [node.props.children].flat().filter((part: unknown) => typeof part === "string").join("")).join(" | ");
  let dot!: ReturnType<typeof create>;
  await act(async () => { dot = create(<Dot theme={base.theme} openPopover={(Content) => popovers.push(Content)} />); await flush(); });
  const button = dot.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel).startsWith("AI Router:"))[0];
  const label = button?.props.accessibilityLabel ?? null;
  await act(async () => { button?.props.onPress(); });
  let plain!: ReturnType<typeof create>;
  await act(async () => { plain = create(<Dot theme={base.theme} />); await flush(); });
  const plainPressables = plain.root.findAll((node) => node.type === "Pressable").length;
  let popover!: ReturnType<typeof create>;
  await act(async () => { popover = create(<Quick theme={base.theme} close={() => { closed += 1; }} openScreen={(input) => screens.push(input)} />); await flush(); });
  const press = async (name: string) => {
    const target = popover.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === name)[0];
    await act(async () => { target?.props.onPress(); await flush(); await flush(); });
    return !!target;
  };
  const synced = await press("Sync models");
  const text = textOf(popover);
  const opened = await press("Open AI Router");
  // Their minute-by-minute status reads stop with them.
  act(() => { dot.unmount(); plain.unmount(); popover.unmount(); });
  return { label, popped: popovers[0] === Quick, plainPressables, text, synced, opened, screens, closed };
}

/** The timeline hooks: registered only when the app has both; the transform picks out router errors only, once complete. */
export function routerErrorsCheck() {
  const added: { renderers: any[]; transformers: any[] } = { renderers: [], transformers: [] };
  const removed: string[] = [];
  const full: any = {
    addTimelineRenderer: (c: any) => { added.renderers.push(c); return () => removed.push(`renderer:${c.kind}`); },
    addTimelineTransformer: (c: any) => { added.transformers.push(c); return () => removed.push(`transformer:${c.id}`); },
  };
  const cleanups = registerRouterErrors(full, () => {});
  for (const cleanup of cleanups) cleanup();
  const older = registerRouterErrors({ addTimelineRenderer: () => () => {} } as any, () => {}).length;
  const refusing: string[] = [];
  const refused = registerRouterErrors({ addTimelineRenderer: () => () => refusing.push("renderer"), addTimelineTransformer: () => { throw new Error("no"); } } as any, () => {}).length;
  const t = (item: any, phase: "streaming" | "complete" = "complete") => transformRouterError({ item, phase }) as any;
  const routerItem = t({ type: "assistant_message", text: ROUTER_ERRORS.cooling });
  return {
    renderer: added.renderers.map((c) => ({ kind: c.kind, version: c.version, parses: c.schema.safeParse({ message: "x", source: "assistant" }).success, rejects: !c.schema.safeParse({ message: 1 }).success })),
    transformers: added.transformers.map((c) => ({ id: c.id, itemType: c.query.itemType })),
    removed,
    older,
    refused: { kept: refused, undone: refusing },
    routerItem: routerItem?.items.map((i: any) => ({ type: i.type, kind: i.kind, version: i.version, source: i.data.source, same: i.data.message === ROUTER_ERRORS.cooling })),
    streaming: t({ type: "assistant_message", text: ROUTER_ERRORS.cooling }, "streaming"),
    reply: t({ type: "assistant_message", text: "Here is the fix. The router once said Provider claude circuit breaker is open." }),
    native: t({ type: "assistant_message", text: "API Error: 529 Overloaded" }),
    errorItem: t({ type: "error", message: "[codex/gpt-6-sol] Unavailable (reset after 13s)" })?.items[0].data,
  };
}

/**
 * 0.22.0, on an app with Paseo's toast, clipboard and dialog: the page's
 * replies are toasts (no message bar), copying uses the app's clipboard and
 * says so, and the ask-first questions on the screen open a dialog that
 * changes nothing until confirmed. A popover still asks in place.
 */
export async function hostFeedbackCheck() {
  const toasts: Array<{ text: string; variant?: string }> = [];
  const copied: string[] = [];
  let copyFails = false;
  const toast = { show: (text: string, options?: { variant?: string }) => toasts.push({ text, variant: options?.variant }), error: (text: string) => toasts.push({ text, variant: "error" }) };
  const Dialog = ({ title, open, children }: { title: string; open: boolean; onOpenChange(open: boolean): void; children: React.ReactNode }) => (open ? React.createElement("Modal", { title }, children) : null);
  setHostExports({ useToast: () => toast, copyText: async (text: string) => { if (copyFails) throw new Error("denied"); copied.push(text); }, Modal: Dialog });
  const run = async (name: string, labels: string[]) => {
    setHostDataReady(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<QueryClientProvider client={queryClient}>{mounts[name]()}</QueryClientProvider>); await flush(); await flush(); });
    for (let i = 0; i < 6; i += 1) await act(flush);
    const steps: Array<{ label: string; pressed: boolean; dialogs: string[]; text: string }> = [];
    for (const label of labels) {
      const target = renderer.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === label)[0];
      if (target) await act(async () => { target.props.onPress(); await flush(); });
      for (let i = 0; i < 4; i += 1) await act(flush);
      steps.push({ label, pressed: !!target, dialogs: renderer.root.findAll((node) => (node.type as unknown) === "Modal").map((node) => node.props.title), text: describe(renderer.toJSON()).text });
    }
    await act(async () => { renderer.unmount(); });
    queryClient.clear();
    return steps;
  };
  try {
    const offer = await run("routing: down, Codex own sign-in asks first", ["Use this computer's own sign-in for Codex", "Yes, use own sign-in"]);
    const disconnect = await run("connection tab (operator, private dashboard)", ["Copy the endpoint", "Disconnect", "Cancel", "Disconnect", "Yes, disconnect"]);
    copyFails = true;
    const failed = await run("connection tab (operator, private dashboard)", ["Copy the endpoint"]);
    copyFails = false;
    const models = await run("providers tab (own sign-in asks first)", ["Claude · through the router", "Use own sign-in"]);
    return { offer, disconnect, failed, models, toasts, copied };
  } finally {
    setHostExports({ useToast: undefined, copyText: undefined, Modal: undefined });
  }
}
