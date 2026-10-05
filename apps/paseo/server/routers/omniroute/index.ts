import type { RouterAdapter } from "..";
import { currentHealth, healthForPanel, lastSeenAt, publicForPanel, recentlyDown, testConnection } from "./health";
import {
  accountAction,
  applyRecommendedCompression,
  applySetting,
  catalogue,
  checkAllAccounts,
  checkManageKey,
  countCodexAccounts,
  getAccess,
  getAccounts,
  getCompression,
  getExplanation,
  getRequests,
  getSettings,
  getTunnels,
  getUsage,
  getUsageKey,
  knownTunnel,
  resetAccount,
  setTunnel,
  testModel,
} from "./insights";

/** OmniRoute: the one router today. Its HTTP calls, parsers and copy live beside this file. */
export const omniroute: RouterAdapter = {
  async test(candidate) {
    const result = await testConnection(candidate);
    if (!result.ok || !candidate.manageKey) return result;
    const manage = await checkManageKey(candidate);
    return { ok: manage === "manage key accepted", message: `${result.message} · ${manage}` };
  },
  health: currentHealth,
  healthForPanel,
  recentlyDown: (connection) => recentlyDown(connection),
  lastSeenAt,
  publicForPanel,
  models: catalogue,
  testModel,
  access: getAccess,
  accounts: getAccounts,
  usage: getUsage,
  usageKey: getUsageKey,
  codexAccounts: countCodexAccounts,
  settings: getSettings,
  applySetting,
  compression: getCompression,
  applyRecommendedCompression,
  accountAction,
  checkAllAccounts,
  resetAccount,
  tunnels: getTunnels,
  setTunnel,
  knownTunnel,
  requests: getRequests,
  explanation: getExplanation,
};
