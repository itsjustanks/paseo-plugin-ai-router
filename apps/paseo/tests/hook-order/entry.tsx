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
import type { TabId } from "../../client/navigation";
// The same module the vite alias hands the client under "@getpaseo/plugin/client".
import { releaseRpc, setAccessFixture, setActivityFixture, setCompressionFixture, setHostDataReady, setProfilesFixture, setSettingsFixture, setStatusFixture, setUsageFixture } from "./stubs/plugin";

const colors = {
  surface0: "#000", surface1: "#111", surface2: "#222", border: "#333", foreground: "#fff", foregroundMuted: "#aaa",
  accent: "#88f", accentForeground: "#000", statusSuccess: "#0f0", statusWarning: "#ff0", statusDanger: "#f00",
};
const base = { theme: { colors }, host: { id: "test", label: "test" }, navigation: { openAgent() {}, openWorkspace() {} } } as any;

const wide = { compact: false, platform: "web" } as const;
const narrow = { compact: true, platform: "ios" } as const;
type Pick = { tab?: TabId; accounts?: string; settings?: string; usage?: string; access?: string; compression?: string; profiles?: string; activity?: string };
const surface = (status: string, layout: { compact: boolean; platform: "web" | "ios" }, pick: Pick = {}) => () => {
  setStatusFixture(status, pick.accounts);
  setUsageFixture(pick.usage ?? "ok");
  if (pick.settings) setSettingsFixture(pick.settings);
  if (pick.access) setAccessFixture(pick.access);
  if (pick.compression) setCompressionFixture(pick.compression);
  if (pick.profiles) setProfilesFixture(pick.profiles);
  if (pick.activity) setActivityFixture(pick.activity);
  return <AiRouterSurface {...base} layout={layout} initialTab={pick.tab} />;
};

export const mounts: Record<string, () => React.ReactElement> = {
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
  // Models
  "models tab": surface("connected", wide, { tab: "models" }),
  "models tab (basic, key hides its spend)": surface("basic", narrow, { tab: "models", access: "hidden" }),
  "models tab (testing one)": surface("routing on", narrow, { tab: "models" }),
  "models tab (not synced)": surface("routing off", wide, { tab: "models" }),
  // Providers
  "providers tab (basic, narrow)": surface("basic", narrow, { tab: "providers" }),
  "providers tab (tidy up preview)": surface("admin", wide, { tab: "providers" }),
  "providers tab (not connected)": surface("not connected", wide, { tab: "providers" }),
  // Accounts and Usage
  "accounts tab (operator)": surface("routing on", narrow, { tab: "accounts", accounts: "healthy" }),
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
  "connection tab (operator, private dashboard)": ["Dashboard won't open? It is on a private network — show how"],
  "connection tab (editing)": ["Edit"],
  "models tab (testing one)": ["Test Opus 5.5"],
  "providers tab (tidy up preview)": ["Tidy up…"],
  "settings tab (admin, apply recommended)": ["Apply recommended…", "What each engine does"],
  "usage tab (30 days, narrow)": ["Last 30 days"],
  "usage tab (24 hours)": ["Last 24 hours"],
  "models tab (switch combo profiles)": ["Show combos as agent profiles"],
  "connection tab (public address ok)": ["Copy the Claude Code setup"],
  "activity (operator, narrow, all sessions)": ["Show all 11"],
  "activity (errors only)": ["Errors only"],
  "activity (all daemons, a model)": ["All daemons", "Only claude-haiku-4-5"],
  "activity (why this route)": ["Request r-300, succeeded; show why"],
  "activity (show older)": ["Show older"],
  "overview (last agent links to Activity)": ["See every agent session in Activity"],
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
