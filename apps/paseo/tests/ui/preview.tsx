import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiRouterSurface } from "../../client/surface";
import type { TabId } from "../../client/navigation";
import { setPreview } from "./plugin";

/** Every state the screenshots cover: `?state=<name>&theme=light|dark`. Tiers: basic = key only, operator = read token, admin = manage key. */
export const STATES: Record<string, { status: string; tab?: TabId; accounts?: string; usage?: string; settings?: string; access?: string; compression?: string }> = {
  setup: { status: "not connected" },
  overview: { status: "routing on", settings: "calm" },
  "overview-basic": { status: "basic" },
  "overview-admin": { status: "admin" },
  "overview-router-down": { status: "router down" },
  "overview-claude-paused": { status: "claude paused" },
  models: { status: "routing on", tab: "models" },
  "models-basic": { status: "basic", tab: "models" },
  providers: { status: "basic", tab: "providers" },
  "providers-admin": { status: "admin", tab: "providers" },
  "accounts-operator": { status: "routing on", tab: "accounts", accounts: "healthy" },
  "accounts-admin": { status: "manage key", tab: "accounts", accounts: "ok" },
  "accounts-claude-paused": { status: "claude paused", tab: "accounts", accounts: "paused" },
  "usage-populated": { status: "routing on", tab: "usage", usage: "ok" },
  "usage-empty": { status: "routing on", tab: "usage", usage: "empty" },
  "settings-operator": { status: "connected", tab: "settings", settings: "calm", compression: "stacked" },
  "settings-manage-key": { status: "claude paused", tab: "settings", settings: "editable", compression: "stacked" },
  "settings-recommended": { status: "admin", tab: "settings", settings: "calm", compression: "lite" },
  connection: { status: "routing on", tab: "connection" },
  "connection-basic": { status: "basic", tab: "connection" },
  "connection-admin": { status: "admin", tab: "connection" },
  "connection-router-down": { status: "router down", tab: "connection" },
  "connection-misconfigured": { status: "misconfigured" },
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
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })}>
      <AiRouterSurface {...props} initialTab={state.tab} />
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
