import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CONTEXT_PANEL_ID, createBadgeStore, makeContextPanel, registerContextBadges } from "./client/context";
import { AiRouterSurface } from "./client/surface";
import { ensure } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  client.addSurface("ai-router", AiRouterSurface);
  // The app just connected to this host: let the server check the AI Router provider now,
  // with a Paseo handle, instead of waiting until someone opens the panel or starts an agent.
  void client.rpc(ensure, {}).catch(() => undefined);
  client.addSidebarItem({ id: "ai-router", title: "AI Router", icon: "Route", surface: "ai-router" });
  client.addCommandCenterItem({
    id: "open-ai-router",
    title: "Open AI Router (OmniRoute connection & routing)",
    icon: "Route",
    keywords: ["ai router", "omniroute", "routing", "router", "api key", "dashboard"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("ai-router");
    },
  });
  // The context badge: a chip on each chat, and the panel it opens.
  const badges = createBadgeStore();
  client.addWorkspacePanel({
    id: CONTEXT_PANEL_ID,
    title: "Context",
    icon: "Gauge",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: makeContextPanel(badges),
  });
  client.addCommandCenterItem({
    id: "open-context",
    title: "Context used in this chat",
    icon: "Gauge",
    keywords: ["context", "tokens", "window", "compact", "mcp", "size"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(CONTEXT_PANEL_ID);
    },
  });
  return registerContextBadges(client, badges);
}
