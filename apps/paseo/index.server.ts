import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  accountAction,
  accounts,
  activity,
  activityDetail,
  accountsCheckAll,
  accountReset,
  alerts,
  chatRoute,
  aiProvider,
  codexRouter,
  codexReroute,
  cliUpdate,
  clis,
  connectionClear,
  connectionTest,
  ensure,
  modelTest,
  access,
  compression,
  compressionApply,
  profiles,
  providerEnable,
  providersList,
  providersTidy,
  routerSettings,
  settingApply,
  status,
  switchedAway,
  tunnelSet,
  tunnels,
  updates,
  usage,
  usageKey,
} from "./shared/contracts";
import { routingSettings } from "./shared/settings";
import {
  handleAccountAction,
  handleActivity,
  handleActivityDetail,
  handleAccounts,
  handleAccountsCheckAll,
  handleAccountReset,
  handleAiProvider,
  handleCodexRouter,
  handleCodexReroute,
  handleCliUpdate,
  handleClis,
  handleConnectionClear,
  handleConnectionTest,
  handleEnsure,
  handleModelTest,
  handleAccess,
  handleCompression,
  handleCompressionApply,
  handleProfiles,
  handleProviderEnable,
  handleProvidersList,
  handleProvidersTidy,
  handleSettingApply,
  handleSettings,
  handleStatus,
  handleSwitchedAway,
  handleTunnelSet,
  handleTunnels,
  handleUsage,
  handleUsageKey,
} from "./server/handlers";
import { handleUpdates } from "./server/updates";
import { handleAlerts, handleChatRoute } from "./server/alerts";
import { registerRoutingHooks } from "./server/hooks";
import { noteActivity, recheckSoon, startAutoSync } from "./server/provider";
import { registerUsage } from "./server/usage";

/** Every RPC is also a chance to run the background model sync; it never delays the answer. */
function active<I, O>(handler: (input: I, context: PluginHandlerContext) => O) {
  return (input: I, context: PluginHandlerContext) => {
    noteActivity(context.paseo);
    return handler(input, context);
  };
}

export default function contribute(server: PluginServerContext) {
  // Paseo 0.10+ hands back the settings with subscribe(): a switch flipped anywhere (this panel, Paseo's
  // Settings, another client) re-checks the combo profiles at once. Older daemons return nothing; the
  // panel's own apply call and the 5-minute check cover them.
  const settings = server.registerSettings(routingSettings) as unknown as { subscribe?: (listener: () => void) => () => void } | undefined;
  const unsubscribe = typeof settings?.subscribe === "function" ? settings.subscribe(() => recheckSoon()) : null;
  registerRoutingHooks(server);
  server.handle(status, active(handleStatus));
  server.handle(connectionTest, active(handleConnectionTest));
  server.handle(connectionClear, active(handleConnectionClear));
  server.handle(aiProvider, active(handleAiProvider));
  server.handle(modelTest, active(handleModelTest));
  server.handle(accounts, active(handleAccounts));
  server.handle(usage, active(handleUsage));
  server.handle(usageKey, active(handleUsageKey));
  // Release checks talk to GitHub, not the router, so they don't run the model sync.
  server.handle(updates, handleUpdates);
  server.handle(routerSettings, active(handleSettings));
  server.handle(settingApply, active(handleSettingApply));
  server.handle(ensure, handleEnsure);
  server.handle(providersList, active(handleProvidersList));
  server.handle(providerEnable, active(handleProviderEnable));
  server.handle(providersTidy, active(handleProvidersTidy));
  server.handle(codexRouter, active(handleCodexRouter));
  server.handle(codexReroute, active(handleCodexReroute));
  server.handle(switchedAway, active(handleSwitchedAway));
  server.handle(clis, handleClis);
  server.handle(cliUpdate, handleCliUpdate);
  server.handle(accountAction, active(handleAccountAction));
  server.handle(accountsCheckAll, active(handleAccountsCheckAll));
  server.handle(accountReset, active(handleAccountReset));
  server.handle(tunnels, active(handleTunnels));
  server.handle(tunnelSet, active(handleTunnelSet));
  server.handle(access, active(handleAccess));
  server.handle(profiles, active(handleProfiles));
  server.handle(activity, active(handleActivity));
  server.handle(activityDetail, active(handleActivityDetail));
  server.handle(compression, active(handleCompression));
  server.handle(compressionApply, active(handleCompressionApply));
  // Chat alerts: no model sync, so a chat's chip never adds work beyond its own read.
  server.handle(alerts, handleAlerts);
  // Router-error cards in a chat (0.19.0): one local read per chat.
  server.handle(chatRoute, handleChatRoute);
  // Paseo 0.11+: one card per router account on Paseo's own Usage page. Older daemons skip this.
  registerUsage(server);
  // Also checks the AI Router provider once at load, with no Paseo handle yet (see server/provider.ts).
  const stop = startAutoSync();
  return () => {
    stop();
    unsubscribe?.();
  };
}
