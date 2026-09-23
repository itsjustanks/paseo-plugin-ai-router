import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiRouterSurface } from "../../client/surface";
import { createBadgeStore, makeContextChip, makeContextPanel } from "../../client/context";
import type { TabId } from "../../client/navigation";
import { setPreview } from "./plugin";

/** Every state the screenshots cover: `?state=<name>&theme=light|dark`. Tiers: basic = key only, operator = read token, admin = manage key. */
export const STATES: Record<string, { status: string; tab?: TabId; accounts?: string; usage?: string; settings?: string; access?: string; compression?: string; profiles?: string; activity?: string; range?: "1d" | "7d" | "30d"; context?: string; usage_?: { used: number; max: number }; alert?: boolean }> = {
  setup: { status: "not connected" },
  overview: { status: "routing on", settings: "calm" },
  "overview-basic": { status: "basic" },
  "overview-admin": { status: "admin" },
  "overview-router-down": { status: "router down" },
  "overview-claude-paused": { status: "claude paused" },
  activity: { status: "routing on", tab: "activity" },
  "activity-basic": { status: "basic", tab: "activity" },
  "activity-router-down": { status: "router down", tab: "activity" },
  models: { status: "routing on", tab: "models" },
  "models-basic": { status: "basic", tab: "models" },
  "models-profiles-off": { status: "routing on", tab: "models", profiles: "off" },
  providers: { status: "basic", tab: "providers" },
  "providers-admin": { status: "admin", tab: "providers" },
  "accounts-operator": { status: "routing on", tab: "accounts", accounts: "healthy" },
  "accounts-admin": { status: "manage key", tab: "accounts", accounts: "ok" },
  "accounts-claude-paused": { status: "claude paused", tab: "accounts", accounts: "paused" },
  "usage-populated": { status: "routing on", tab: "usage", usage: "ok" },
  "usage-30-days": { status: "routing on", tab: "usage", usage: "ok", range: "30d" },
  "usage-24-hours": { status: "routing on", tab: "usage", usage: "ok", range: "1d" },
  "usage-empty": { status: "routing on", tab: "usage", usage: "empty" },
  "usage-router-down": { status: "router down", tab: "usage", usage: "stale" },
  "settings-operator": { status: "connected", tab: "settings", settings: "calm", compression: "stacked" },
  "settings-manage-key": { status: "claude paused", tab: "settings", settings: "editable", compression: "stacked" },
  "settings-recommended": { status: "admin", tab: "settings", settings: "calm", compression: "lite" },
  connection: { status: "routing on", tab: "connection" },
  "connection-basic": { status: "basic", tab: "connection" },
  "connection-admin": { status: "admin", tab: "connection" },
  "connection-router-down": { status: "router down", tab: "connection" },
  "connection-misconfigured": { status: "misconfigured" },
  "connection-public": { status: "public ok", tab: "connection" },
  "connection-public-pending": { status: "public pending", tab: "connection" },
  "settings-basic": { status: "basic", tab: "settings" },
  tips: { status: "routing on", tab: "tips" },
  "tips-admin": { status: "admin", tab: "tips" },
  // The context badge's panel, as the chip opens it (the chip itself sits at the top).
  context: { status: "routing on", context: "ok", usage_: { used: 186_204, max: 1_000_000 } },
  "context-full": { status: "routing on", context: "full", usage_: { used: 172_000, max: 200_000 } },
  "context-basic": { status: "basic", context: "basic", usage_: { used: 58_400, max: 200_000 } },
  "context-router-down": { status: "routing on", context: "ok", usage_: { used: 186_204, max: 1_000_000 }, alert: true },
};

const params = new URLSearchParams(location.search);
const state = STATES[params.get("state") ?? "setup"] ?? STATES.setup;
setPreview(state);
const light = params.get("theme") === "light";
const colors = light
  ? { surface0: "#f5f6f8", surface1: "#ffffff", surface2: "#edf0f4", border: "#d7dbe1", foreground: "#20252d", foregroundMuted: "#606b78", accent: "#4f46e5", accentForeground: "#ffffff", statusSuccess: "#15803d", statusWarning: "#a16207", statusDanger: "#b91c1c" }
  : { surface0: "#11151b", surface1: "#1a2029", surface2: "#252d38", border: "#394352", foreground: "#eef1f6", foregroundMuted: "#a2adbc", accent: "#a5b4fc", accentForeground: "#14192c", statusSuccess: "#6ee7a0", statusWarning: "#facc6b", statusDanger: "#fda4af" };

const errors: string[] = [];
Object.assign(window, { __renderErrors: errors });
addEventListener("error", (event) => errors.push(String(event.error?.message ?? event.message)));
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); consoleError(...args); };

function Preview() {
  const [compact, setCompact] = useState(innerWidth < 640);
  useEffect(() => {
    const resize = () => setCompact(innerWidth < 640);
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  const props = { theme: { colors }, host: { id: "preview", label: "daemon-b" }, layout: { compact, platform: "web" as const }, navigation: { openAgent() {}, openWorkspace() {} } } as any;
  if (state.context) {
    const store = createBadgeStore();
    store.set("agent-7", "ws-1", state.usage_ ?? null);
    if (state.alert) store.setAlerts([{ agentId: "agent-7", text: "Router down", detail: "OmniRoute isn't answering (connection refused at http://10.0.0.5:20128/api/health/ping). This chat's requests go through it, so they fail until it's back. Reopened, it uses its own sign-in until the router is back." }]);
    const Panel = makeContextPanel(store, () => {});
    const Chip = makeContextChip(store);
    return (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
        <div style={{ display: "flex", flexDirection: "column", height: "100vh", maxWidth: 520, background: colors.surface0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", alignSelf: "flex-start", margin: 12, padding: "4px 10px", border: `1px solid ${colors.border}`, borderRadius: 999, fontSize: 12, fontFamily: "system-ui" }}>
            <Chip {...props} workspaceId="ws-1" agentId="agent-7" />
          </div>
          <Panel {...props} context="agent" workspaceId="ws-1" agentId="agent-7" />
          <span style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: "system-ui", padding: 12 }}>AI Router · context panel preview</span>
        </div>
      </QueryClientProvider>
    );
  }
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
      <AiRouterSurface {...props} initialTab={state.tab} initialRange={state.range} />
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
