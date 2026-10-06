import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createAlertStore, registerRouterAlerts } from "./client/alerts";
import { registerRouterCommands } from "./client/commands";
import { registerRouterErrors } from "./client/router-errors";
import { openMainScreen, registerMainScreen } from "./client/native";
import { makeQuickActions, makeStatusTrailing } from "./client/quick";
import { AiRouterSurface } from "./client/surface";
import { ensure } from "./shared/contracts";
import { screenTitle } from "./shared/tabs";

const MAIN_SCREEN = "ai-router";

export default function contribute(client: PluginClientContext) {
  // A screen and the app's own sidebar row on Paseo 0.11 apps; the surface and sidebar item before.
  // On 0.11 the row also carries a status dot; pressing it opens quick actions (open, dashboard, sync).
  // No sidebar footer item as well: the row's dot already says whether the router works.
  // 0.20.0: the window title follows the tab ("AI Router · Accounts").
  registerMainScreen(client, { id: MAIN_SCREEN, title: "AI Router", screenTitle, icon: "Route", Component: AiRouterSurface, Trailing: makeStatusTrailing(makeQuickActions(MAIN_SCREEN)) });
  // The app just connected to this host: let the server check the AI Router provider now,
  // with a Paseo handle, instead of waiting until someone opens the panel or starts an agent.
  void client.rpc(ensure, {}).catch(() => undefined);
  const open = (capabilities: unknown) => openMainScreen((capabilities ?? client) as Parameters<typeof openMainScreen>[0], MAIN_SCREEN);
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
  // 0.18.0: "Sync models" and "Check router" from the Command Center, and /ai-router in chats.
  const commands = registerRouterCommands(client, open);
  // A chip on a chat only while the router can't serve it ("Router down", "Claude paused"); pressing it opens AI Router.
  const stopAlerts = registerRouterAlerts(client, createAlertStore(), () => openMainScreen(client, MAIN_SCREEN));
  // 0.19.0: OmniRoute's errors in a routed chat become a plain card (the original text under Details).
  const errors = registerRouterErrors(client, () => openMainScreen(client, MAIN_SCREEN, { tab: "accounts" }));
  return () => {
    stopAlerts();
    for (const cleanup of [...commands, ...errors]) cleanup();
  };
}
