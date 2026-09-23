import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  accountAction,
  accounts,
  accountsCheckAll,
  aiProvider,
  codexRouter,
  connectionClear,
  connectionTest,
  ensure,
  modelTest,
  access,
  compression,
  compressionApply,
  providerEnable,
  providersList,
  providersTidy,
  routerSettings,
  settingApply,
  status,
  tunnelSet,
  tunnels,
  usage,
} from "./shared/contracts";
import { routingSettings } from "./shared/settings";
import {
  handleAccountAction,
  handleAccounts,
  handleAccountsCheckAll,
  handleAiProvider,
  handleCodexRouter,
  handleConnectionClear,
  handleConnectionTest,
  handleEnsure,
  handleModelTest,
  handleAccess,
  handleCompression,
  handleCompressionApply,
  handleProviderEnable,
  handleProvidersList,
  handleProvidersTidy,
  handleSettingApply,
  handleSettings,
  handleStatus,
  handleTunnelSet,
  handleTunnels,
  handleUsage,
} from "./server/handlers";
import { registerRoutingHooks } from "./server/hooks";
import { noteActivity, startAutoSync } from "./server/provider";

/** Every RPC is also a chance to run the background model sync; it never delays the answer. */
function active<I, O>(handler: (input: I, context: PluginHandlerContext) => O) {
  return (input: I, context: PluginHandlerContext) => {
    noteActivity(context.paseo);
    return handler(input, context);
  };
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(routingSettings);
  registerRoutingHooks(server);
  server.handle(status, active(handleStatus));
  server.handle(connectionTest, active(handleConnectionTest));
  server.handle(connectionClear, active(handleConnectionClear));
  server.handle(aiProvider, active(handleAiProvider));
  server.handle(modelTest, active(handleModelTest));
  server.handle(accounts, active(handleAccounts));
  server.handle(usage, active(handleUsage));
  server.handle(routerSettings, active(handleSettings));
  server.handle(settingApply, active(handleSettingApply));
  server.handle(ensure, handleEnsure);
  server.handle(providersList, active(handleProvidersList));
  server.handle(providerEnable, active(handleProviderEnable));
  server.handle(providersTidy, active(handleProvidersTidy));
  server.handle(codexRouter, active(handleCodexRouter));
  server.handle(accountAction, active(handleAccountAction));
  server.handle(accountsCheckAll, active(handleAccountsCheckAll));
  server.handle(tunnels, active(handleTunnels));
  server.handle(tunnelSet, active(handleTunnelSet));
  server.handle(access, active(handleAccess));
  server.handle(compression, active(handleCompression));
  server.handle(compressionApply, active(handleCompressionApply));
  // Also checks the AI Router provider once at load, with no Paseo handle yet (see server/provider.ts).
  return startAutoSync();
}
