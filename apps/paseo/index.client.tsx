import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CONTEXT_PANEL_ID, createBadgeStore, makeContextPanel, registerContextBadges } from "./client/context";
import { openMainScreen, registerMainScreen } from "./client/native";
import { AiRouterSurface } from "./client/surface";
import { ensure } from "./shared/contracts";

const MAIN_SCREEN = "ai-router";

export default function contribute(client: PluginClientContext) {
  // A screen and the app's own sidebar row on Paseo 0.11 apps; the surface and sidebar item before.
  registerMainScreen(client, { id: MAIN_SCREEN, title: "AI Router", icon: "Route", Component: AiRouterSurface });
  // The app just connected to this host: let the server check the AI Router provider now,
  // with a Paseo handle, instead of waiting until someone opens the panel or starts an agent.
  void client.rpc(ensure, {}).catch(() => undefined);
  client.addCommandCenterItem({
    id: "open-ai-router",
    title: "Open AI Router (OmniRoute connection & routing)",
    icon: "Route",
    keywords: ["ai router", "omniroute", "routing", "router", "api key", "dashboard"],
    context: "global",
    onSelect(command) {
      openMainScreen(command, MAIN_SCREEN);
    },
  });
  // The context breakdown: a chip on each chat beside Paseo's own context meter, and the panel it opens.
  const badges = createBadgeStore();
  client.addWorkspacePanel({
    id: CONTEXT_PANEL_ID,
    title: "Context",
    icon: "ChartPie",
    context: "agent",
    locations: ["workspace", "explorer"],
    Component: makeContextPanel(badges, (id) => openMainScreen(client, id)),
  });
  client.addCommandCenterItem({
    id: "open-context",
    title: "What fills this chat's context",
    icon: "ChartPie",
    keywords: ["context", "tokens", "window", "compact", "mcp", "size"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(CONTEXT_PANEL_ID);
    },
  });
  return registerContextBadges(client, badges);
}
