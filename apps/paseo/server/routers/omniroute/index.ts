import type { RouterAdapter } from "..";
import { currentHealth, healthForPanel, lastSeenAt, recentlyDown, testConnection } from "./health";
import {
  accountAction,
  applyRecommendedCompression,
  applySetting,
  catalogue,
  checkAllAccounts,
  checkManageKey,
  getAccess,
  getAccounts,
  getCompression,
  getSettings,
  getTunnels,
  getUsage,
  knownTunnel,
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
  models: catalogue,
  testModel,
  access: getAccess,
  accounts: getAccounts,
  usage: getUsage,
  settings: getSettings,
  applySetting,
  compression: getCompression,
  applyRecommendedCompression,
  accountAction,
  checkAllAccounts,
  tunnels: getTunnels,
  setTunnel,
  knownTunnel,
};
