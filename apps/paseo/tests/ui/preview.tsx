import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiRouterSurface } from "../../client/surface";
import { createAlertStore, makeAlertChip } from "../../client/alerts";
import type { GoTarget } from "../../shared/tabs";
import type { AnalyticsRangeId } from "../../shared/contracts";
import { setChatRouted, setPreview } from "./plugin";
import { forgetRouterErrorReads, makeRouterErrorCard } from "../../client/router-errors";

/** Every state the screenshots cover: `?state=<name>&theme=light|dark`. Tiers: basic = key only, operator = read token, admin = manage key. */
export const STATES: Record<string, { status: string; tab?: GoTarget; accounts?: string; usage?: string; settings?: string; access?: string; compression?: string; profiles?: string; activity?: string; range?: AnalyticsRangeId; chip?: boolean; error?: string; routed?: boolean | null; apps?: string; alert?: boolean; updates?: string; news?: boolean; codexAccounts?: number | null }> = {
  setup: { status: "not connected" },
  overview: { status: "routing on", settings: "calm" },
  "overview-basic": { status: "basic" },
  "overview-admin": { status: "admin" },
  "overview-router-down": { status: "router down" },
  "overview-claude-paused": { status: "claude paused" },
  "overview-update": { status: "admin", updates: "behind" },
  "overview-whats-new": { status: "admin", updates: "behind", news: true },
  activity: { status: "routing on", tab: "activity" },
  "activity-basic": { status: "basic", tab: "activity" },
  "activity-router-down": { status: "router down", tab: "activity" },
  models: { status: "routing on", tab: "models" },
  "models-basic": { status: "basic", tab: "models" },
  "models-profiles-off": { status: "routing on", tab: "models", profiles: "off" },
  "models-drift": { status: "drift", tab: "models" },
  "overview-drift": { status: "drift" },
  providers: { status: "basic", tab: "providers" },
  "providers-admin": { status: "admin", tab: "providers", apps: "fleet" },
  "providers-updating": { status: "routing on", tab: "providers", apps: "updating" },
  "providers-operator": { status: "routing on", tab: "providers", apps: "fleet" },
  "providers-codex-none": { status: "routing on", tab: "providers", apps: "fleet", codexAccounts: 0 },
  "accounts-operator": { status: "routing on", tab: "accounts", accounts: "healthy" },
  "accounts-admin": { status: "manage key", tab: "accounts", accounts: "ok" },
  "accounts-claude-paused": { status: "claude paused", tab: "accounts", accounts: "paused" },
  "accounts-native-usage": { status: "native usage", tab: "accounts", accounts: "healthy" },
  "usage-populated": { status: "routing on", tab: "usage", usage: "ok" },
  "usage-30-days": { status: "routing on", tab: "usage", usage: "ok", range: "30d" },
  "usage-today": { status: "routing on", tab: "usage", usage: "ok", range: "today" },
  "usage-custom": { status: "routing on", tab: "usage", usage: "ok", range: "custom" },
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
  // The four tabs by their own ids (0.18.0).
  help: { status: "routing on", tab: "help" },
  "help-admin": { status: "admin", tab: "help" },
  "help-basic": { status: "basic", tab: "help" },
  "accounts-basic": { status: "basic", tab: "accounts" },
  // The chip on a chat's composer: only while the router can't serve it.
  "chip-router-down": { status: "routing on", chip: true, alert: true },
  "chip-calm": { status: "routing on", chip: true },
  // A router error in a chat (0.19.0), as Claude Code reported it, between two ordinary messages.
  "chat-error-paused": { status: "claude paused", error: "paused" },
  "chat-error-cooling": { status: "routing on", error: "cooling" },
  "chat-error-no-account": { status: "routing on", error: "no-account" },
  "chat-error-not-routed": { status: "routing on", error: "elsewhere", routed: false },
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
  if (state.error) {
    const gateway = " This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (10.0.0.5:20128).";
    const texts: Record<string, string> = {
      paused: `API Error: 503 Provider claude circuit breaker is open.${gateway}`,
      cooling: `API Error: 503 [claude/claude-fable-5-1] [429]: {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit. Please try again later."}} (reset after 4m 51s).${gateway}`,
      "no-account": `API Error: 503 No active credentials for provider: codex.${gateway}`,
      elsewhere: "API Error: 503 [claude/claude-fable-5-1] [429]: rate_limit_error (reset after 1m 9s). This is a server-side issue, usually temporary — try again in a moment. If it persists, check your inference gateway (proxy.example.com:8080).",
    };
    setChatRouted(state.routed === undefined ? true : state.routed);
    forgetRouterErrorReads();
    const Card = makeRouterErrorCard(() => {});
    const bubble = { padding: "10px 14px", borderRadius: 14, fontSize: 15, lineHeight: "22px", fontFamily: "system-ui", color: colors.foreground, maxWidth: 560 } as const;
    return (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, maxWidth: 720, minHeight: "100vh", boxSizing: "border-box", background: colors.surface0 }}>
          <div style={{ ...bubble, alignSelf: "flex-end", background: colors.surface2 }}>Can you tidy the parser and run the tests?</div>
          <div style={{ alignSelf: "stretch" }}>
            <Card {...props} agentId="agent-7" timestamp={new Date(Date.now() - 2 * 60_000)} item={{ type: "plugin", kind: "router-error", version: 1, data: { message: texts[state.error], source: "assistant" } }} />
          </div>
          <span style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: "system-ui" }}>AI Router · a router error in a chat</span>
        </div>
      </QueryClientProvider>
    );
  }
  if (state.chip) {
    const store = createAlertStore();
    store.set("agent-7", "ws-1");
    if (state.alert) store.setAlerts([{ agentId: "agent-7", text: "Router down", detail: "" }]);
    const Chip = makeAlertChip(store);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16, maxWidth: 520, background: colors.surface0, fontFamily: "system-ui" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.surface1, color: colors.foregroundMuted, fontSize: 14 }}>
          <span style={{ flex: 1 }}>Message the agent…</span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "4px 10px", border: `1px solid ${colors.border}`, borderRadius: 999, fontSize: 12 }}>
            <Chip {...props} workspaceId="ws-1" agentId="agent-7" />
          </span>
        </div>
        <span style={{ color: colors.foregroundMuted, fontSize: 11 }}>AI Router · composer chip preview ({state.alert ? "router down" : "calm: no chip"})</span>
      </div>
    );
  }
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
      <AiRouterSurface {...props} initialTab={state.tab} initialRange={state.range} initialNews={state.news} />
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
