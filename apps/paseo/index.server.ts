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
import { redactSecrets } from "./shared/redact";
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

/** A reply's `message` with any credential a router or provider quoted back hidden (0.22.0); the panel hides them again. */
export function hideSecrets<T>(value: T): T {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as { message?: unknown }).message === "string") {
    return { ...value, message: redactSecrets((value as unknown as { message: string }).message) };
  }
  return value;
}
function safe<I, O>(handler: (input: I, context: PluginHandlerContext) => O | Promise<O>) {
  return async (input: I, context: PluginHandlerContext): Promise<O> => hideSecrets(await handler(input, context));
}

export default function contribute(server: PluginServerContext) {
  // Paseo 0.10+ hands back the settings with subscribe(): a switch flipped anywhere (this panel, Paseo's
  // Settings, another client) re-checks the combo profiles at once. Older daemons return nothing; the
  // panel's own apply call and the 5-minute check cover them.
  const settings = server.registerSettings(routingSettings) as unknown as { subscribe?: (listener: () => void) => () => void } | undefined;
  const unsubscribe = typeof settings?.subscribe === "function" ? settings.subscribe(() => recheckSoon()) : null;
  registerRoutingHooks(server);
  server.handle(status, safe(active(handleStatus)));
  server.handle(connectionTest, safe(active(handleConnectionTest)));
  server.handle(connectionClear, safe(active(handleConnectionClear)));
  server.handle(aiProvider, safe(active(handleAiProvider)));
  server.handle(modelTest, safe(active(handleModelTest)));
  server.handle(accounts, safe(active(handleAccounts)));
  server.handle(usage, safe(active(handleUsage)));
  server.handle(usageKey, safe(active(handleUsageKey)));
  // Release checks talk to GitHub, not the router, so they don't run the model sync.
  server.handle(updates, safe(handleUpdates));
  server.handle(routerSettings, safe(active(handleSettings)));
  server.handle(settingApply, safe(active(handleSettingApply)));
  server.handle(ensure, safe(handleEnsure));
  server.handle(providersList, safe(active(handleProvidersList)));
  server.handle(providerEnable, safe(active(handleProviderEnable)));
  server.handle(providersTidy, safe(active(handleProvidersTidy)));
  server.handle(codexRouter, safe(active(handleCodexRouter)));
  server.handle(codexReroute, safe(active(handleCodexReroute)));
  server.handle(switchedAway, safe(active(handleSwitchedAway)));
  server.handle(clis, safe(handleClis));
  server.handle(cliUpdate, safe(handleCliUpdate));
  server.handle(accountAction, safe(active(handleAccountAction)));
  server.handle(accountsCheckAll, safe(active(handleAccountsCheckAll)));
  server.handle(accountReset, safe(active(handleAccountReset)));
  server.handle(tunnels, safe(active(handleTunnels)));
  server.handle(tunnelSet, safe(active(handleTunnelSet)));
  server.handle(access, safe(active(handleAccess)));
  server.handle(profiles, safe(active(handleProfiles)));
  server.handle(activity, safe(active(handleActivity)));
  server.handle(activityDetail, safe(active(handleActivityDetail)));
  server.handle(compression, safe(active(handleCompression)));
  server.handle(compressionApply, safe(active(handleCompressionApply)));
  // Chat alerts: no model sync, so a chat's chip never adds work beyond its own read.
  server.handle(alerts, safe(handleAlerts));
  // Router-error cards in a chat (0.19.0): one local read per chat.
  server.handle(chatRoute, safe(handleChatRoute));
  // Paseo 0.11+: one card per router account on Paseo's own Usage page. Older daemons skip this.
  registerUsage(server);
  // Also checks the AI Router provider once at load, with no Paseo handle yet (see server/provider.ts).
  const stop = startAutoSync();
  return () => {
    stop();
    unsubscribe?.();
  };
}
