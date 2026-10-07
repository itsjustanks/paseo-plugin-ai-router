import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { Status, connectionTest } from "../shared/contracts";
import { accessTier, agentIdFromTag, codexBaseUrl, connectionProblem, maskSecret, mergeConnection, privateDashboardUrl, publicAddress, tunnelDashboardUrl } from "../shared/logic";
import { RECOMMENDED_PLUGINS } from "../shared/plugins";
import { linkAgents } from "../shared/routers/omniroute/parsers";
import { getLastSession } from "./hooks";
import { catalogueCheck, checkAutoSync, listOwnProfiles, noteActivity, providerState, setCodexReroute, setCodexRouter, syncAiProvider, testProviderModel } from "./provider";
import { listClis, startCliUpdate } from "./clis";
import { listProviders, setProviderEnabled, tidyProviders } from "./providers";
import { adapterFor } from "./routers";
import { usageSourceRegistered } from "./usage";
import { ownSignIn, thisComputer } from "./signin";
import { clearConnection, installedPluginIds, readConnection, readProviderEntries, readRoutingSettings, readSessionLog, readSwitchedAway, settingsDir, writeConnection, writeSwitchedAway } from "./store";

/** The panel polls every 20s; a check younger than this is served from cache. */
const PANEL_HEALTH_MAX_AGE_MS = 15_000;
/** Paseo's config read is local, but the panel never waits on it longer than this. */
const ENTRIES_TIMEOUT_MS = 2_000;
/** The own sign-in check reads two files (and, on a Mac, asks the keychain once a minute); the panel waits this long at most. */
const SIGN_IN_TIMEOUT_MS = 1_500;

/**
 * The panel's first call, so it must answer fast whatever the router is
 * doing: health waits at most 1.5 s (then the last answer, marked
 * `checking`), and the tunnel comes from memory only.
 */
export async function handleStatus({ refresh }: { refresh?: boolean }, { paseo }: PluginHandlerContext): Promise<Status> {
  const [resolved, settings] = await Promise.all([readConnection(), readRoutingSettings()]);
  const { connection } = resolved;
  const router = adapterFor(connection.router);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publicUrl = publicAddress(connection);
  let signInTimer: ReturnType<typeof setTimeout> | undefined;
  const [{ health, checking }, entries, publicCheck, signIn] = await Promise.all([
    router.healthForPanel(connection, refresh ? 0 : PANEL_HEALTH_MAX_AGE_MS),
    Promise.race([readProviderEntries(paseo).catch(() => null), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ENTRIES_TIMEOUT_MS)))]),
    router.publicForPanel(publicUrl, refresh === true),
    Promise.race([ownSignIn().catch(() => null), new Promise<null>((resolve) => (signInTimer = setTimeout(() => resolve(null), SIGN_IN_TIMEOUT_MS)))]),
  ]);
  clearTimeout(timer);
  clearTimeout(signInTimer);
  const away = readSwitchedAway();
  const tunnel = router.knownTunnel(connection);
  const installed = installedPluginIds();
  return {
    connection: {
      source: connection.source,
      endpoint: connection.endpoint,
      consoleUrl: connection.consoleUrl,
      publicUrl,
      publicCheck,
      // The public address once it answers as OmniRoute; until then the private endpoint (tunnel and SSH help apply there).
      dashboardUrl: publicUrl && publicCheck?.state === "ok" ? `${publicUrl}/dashboard` : privateDashboardUrl(connection),
      sshTarget: connection.sshTarget,
      router: connection.router,
      apiKey: maskSecret(connection.apiKey),
      token: maskSecret(connection.token),
      manageKey: maskSecret(connection.manageKey),
      tunnel: tunnel?.url ? { label: tunnel.label, dashboardUrl: tunnelDashboardUrl(tunnel.url) } : null,
    },
    tier: accessTier(connection),
    problem: connectionProblem(resolved),
    warnings: resolved.warnings,
    health,
    checking,
    lastSeenAt: router.lastSeenAt(connection.endpoint),
    routeAgents: settings.routeAgents,
    lastSession: getLastSession(),
    aiProvider: {
      present: entries?.aiRouter.present ?? false,
      modelCount: entries?.aiRouter.models.length ?? 0,
      legacyCodex: entries?.codex.present ?? false,
      summary: entries?.aiRouter.summary ?? null,
      models: entries?.aiRouter.listed ?? [],
      ...providerState(),
      check: modelCheck(entries?.aiRouter.present ? entries.aiRouter.models : null),
    },
    codexRouter: { present: entries?.codexRouter.present ?? false, modelCount: entries?.codexRouter.modelCount ?? 0 },
    codexReroute: entries
      ? { state: entries.builtinCodex.state, baseUrl: entries.builtinCodex.baseUrl, current: !!connection.endpoint && entries.builtinCodex.baseUrl === codexBaseUrl(connection.endpoint) }
      : undefined,
    settingsDir: settingsDir(),
    plugins: { installed: RECOMMENDED_PLUGINS.map((plugin) => plugin.id).filter((id) => installed.has(id)) },
    nativeUsage: usageSourceRegistered(),
    computer: thisComputer(),
    ...(signIn ? { ownSignIn: signIn } : {}),
    switchedAway: { claude: away.claude !== null, codex: away.codex !== null },
  };
}

/**
 * The last comparison with OmniRoute against what Paseo lists now: drift is a
 * model the filter keeps that Paseo lacks, or the reverse. The models the
 * filter drops (effort copies, twins, other accounts) are not drift.
 */
function modelCheck(present: string[] | null): Status["aiProvider"]["check"] {
  const check = catalogueCheck();
  if (!check) return null;
  const have = new Set(present ?? []);
  const want = new Set(check.wanted);
  return {
    at: check.at,
    ok: check.ok,
    message: check.message,
    upstream: check.upstream,
    kept: check.wanted.length,
    missing: present && check.wanted.length ? check.wanted.filter((id) => !have.has(id)) : [],
    extra: present && check.wanted.length ? [...have].filter((id) => !want.has(id)) : [],
  };
}

/** Save only a proven connection; then refresh an existing AI Router provider's model list for it. */
export async function handleConnectionTest(input: RpcInput<typeof connectionTest>, { paseo }: PluginHandlerContext) {
  const { connection } = await readConnection();
  const merged = mergeConnection(connection, input);
  if (!merged.ok) return { ok: false, saved: false, message: merged.error };
  const result = await adapterFor(merged.value.router).test({ ...merged.value, source: "saved" });
  if (!result.ok) return { ok: false, saved: false, message: `${result.message}. Nothing was saved.` };
  writeConnection(merged.value);
  let note = "";
  try {
    if ((await readProviderEntries(paseo)).aiRouter.present) note = ` ${(await syncAiProvider(paseo, { ...merged.value, source: "saved" }, true)).message}`;
  } catch (error) {
    note = ` Refreshing the AI Router provider failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { ok: true, saved: true, message: `${result.message}. Saved.${note}` };
}

export async function handleConnectionClear() {
  const removed = clearConnection();
  const { connection } = await readConnection();
  const next = connection.source === "env" ? "The AI_ROUTER_* environment variables apply again." : "No connection is set.";
  return { ok: true, message: removed ? `Saved connection removed. ${next}` : `There was no saved connection. ${next}` };
}

const current = async () => (await readConnection()).connection;
export const handleAiProvider = async ({ enabled }: { enabled: boolean }, { paseo }: PluginHandlerContext) => {
  const { ok, message } = await syncAiProvider(paseo, await current(), enabled);
  return { ok, message };
};
export const handleModelTest = async ({ model }: { model: string }) => testProviderModel(await current(), model);
export const handleAccounts = async ({ refresh }: { refresh?: boolean }) => { const c = await current(); return adapterFor(c.router).accounts(c, refresh === true); };
type WindowInput = { range?: "today" | "7d" | "30d" | "custom"; start?: string; end?: string };
export const handleUsage = async ({ refresh, ...window }: { refresh?: boolean } & WindowInput) => { const c = await current(); return adapterFor(c.router).usage(c, refresh === true, window); };
export const handleUsageKey = async ({ keyId, ...window }: { keyId: string } & WindowInput) => { const c = await current(); return adapterFor(c.router).usageKey(c, keyId, window); };

/** The combo profiles, as Paseo holds them. `apply`: sync now (the switch just changed), then read. */
export async function handleProfiles({ apply }: { apply?: boolean }, { paseo }: PluginHandlerContext) {
  const settings = await readRoutingSettings();
  let message: string | null = null;
  if (apply) {
    try {
      // A check already running may have read the switch before it changed: let it finish, then check again.
      await checkAutoSync(paseo);
      await checkAutoSync(paseo);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const { profiles } = await readProviderEntries(paseo);
    return { enabled: settings.comboProfiles, profiles: listOwnProfiles(profiles), message };
  } catch (error) {
    return { enabled: settings.comboProfiles, profiles: [], message: `Could not read Paseo's profiles: ${error instanceof Error ? error.message : String(error)}` };
  }
}
export const handleSettings = async ({ refresh }: { refresh?: boolean }) => { const c = await current(); return adapterFor(c.router).settings(c, refresh === true); };
export const handleSettingApply = async ({ id, on }: { id: string; on?: boolean }) => { const c = await current(); return adapterFor(c.router).applySetting(c, id, on); };

/** The app just connected: check the provider now, but answer at once. */
export const handleEnsure = async (_input: unknown, { paseo }: PluginHandlerContext) => {
  noteActivity(paseo, true);
  return { ok: true };
};
/** Paseo's providers, and how many Codex accounts OmniRoute has (from a 5-minute cache; never waits on the router long). */
export async function handleProvidersList({ refresh }: { refresh?: boolean }, { paseo }: PluginHandlerContext) {
  const c = await current();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const codex = Promise.race([adapterFor(c.router).codexAccounts(c).catch(() => null), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), 3_000)))]);
  const [list, codexAccounts] = await Promise.all([listProviders(paseo, refresh === true), codex]);
  clearTimeout(timer);
  return { ...list, codexAccounts };
}
export const handleProviderEnable = ({ id, enabled }: { id: string; enabled: boolean }, { paseo }: PluginHandlerContext) => setProviderEnabled(paseo, id, enabled);
export const handleProvidersTidy = ({ ids }: { ids: string[] }, { paseo }: PluginHandlerContext) => tidyProviders(paseo, ids);
export const handleCodexRouter = async ({ enabled }: { enabled: boolean }, { paseo }: PluginHandlerContext) => setCodexRouter(paseo, await current(), enabled);
export const handleCodexReroute = async ({ enabled, fallback }: { enabled: boolean; fallback?: boolean }, { paseo }: PluginHandlerContext) => setCodexReroute(paseo, await current(), enabled, fallback === true);
/** Claude's switch is the routing setting the panel saves; this only remembers why it went off, for "Switch back to the router". */
export const handleSwitchedAway = async ({ app, away }: { app: "claude" | "codex"; away: boolean }) => {
  writeSwitchedAway(app, away ? new Date().toISOString() : null);
  return { ok: true, message: away ? "Noted: switch back to the router once it works again." : "Noted." };
};
export const handleClis = ({ refresh }: { refresh?: boolean }) => listClis(refresh === true);
export const handleCliUpdate = ({ id }: { id: "claude" | "codex" }) => startCliUpdate(id);
export const handleAccountAction = async ({ action, id, name }: { action: "test" | "refresh"; id: string; name: string }) => { const c = await current(); return adapterFor(c.router).accountAction(c, action, id, name); };
export const handleAccountsCheckAll = async () => { const c = await current(); return adapterFor(c.router).checkAllAccounts(c); };
/** The RPC refuses without `confirm: true`: the panel always asks first. */
export const handleAccountReset = async ({ confirm, ...input }: { kind: "cooldown" | "error" | "lockout" | "codex-cooldown" | "credit" | "breaker"; provider: string; id?: string; model?: string | null; name: string; confirm: true }) => {
  if (confirm !== true) return { ok: false, message: "Not reset: the panel asks first." };
  const c = await current();
  return adapterFor(c.router).resetAccount(c, input);
};
export const handleTunnels = async ({ refresh }: { refresh?: boolean }) => { const c = await current(); return adapterFor(c.router).tunnels(c, refresh === true); };
export const handleTunnelSet = async ({ id, on }: { id: "cloudflared" | "ngrok" | "tailscale"; on: boolean }) => { const c = await current(); return adapterFor(c.router).setTunnel(c, id, on); };
export const handleAccess = async ({ refresh }: { refresh?: boolean }) => { const c = await current(); return adapterFor(c.router).access(c, refresh === true); };
export const handleCompression = async ({ refresh }: { refresh?: boolean }) => { const c = await current(); return adapterFor(c.router).compression(c, refresh === true); };
export const handleCompressionApply = async () => { const c = await current(); return adapterFor(c.router).applyRecommendedCompression(c); };

type AgentNames = Map<string, { title: string | null; model: string | null }>;
/** Activity refreshes every 10 s; Paseo's whole agent list is read at most this often. */
const AGENTS_MAX_AGE_MS = 20_000;
let agentsSeen: { at: number; value: Promise<AgentNames> } | null = null;

/** Agent titles and models from Paseo, shared by Activity polls for 20 s. An empty or late answer is not reused. */
function agentsById(paseo: PluginHandlerContext["paseo"]): Promise<AgentNames> {
  if (agentsSeen && Date.now() - agentsSeen.at <= AGENTS_MAX_AGE_MS) return agentsSeen.value;
  const entry = { at: Date.now(), value: listAgents(paseo) };
  agentsSeen = entry;
  void entry.value.then((names) => {
    if (!names.size && agentsSeen === entry) agentsSeen = null;
  });
  return entry.value;
}

/** Never waits more than 2 s. */
async function listAgents(paseo: PluginHandlerContext["paseo"]): Promise<AgentNames> {
  const byId: AgentNames = new Map();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const listed = await Promise.race([
      paseo.agents.list({}),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), 2_000))),
    ]);
    for (const entry of (listed as { entries?: Array<{ agent?: { id?: unknown; title?: unknown; model?: unknown } }> } | null)?.entries ?? []) {
      const agent = entry?.agent;
      if (typeof agent?.id === "string") byId.set(agent.id, { title: typeof agent.title === "string" && agent.title ? agent.title : null, model: typeof agent.model === "string" ? agent.model : null });
    }
  } catch {
    // titles are a nicety; ids still show
  } finally {
    clearTimeout(timer);
  }
  return byId;
}

/** Activity: this daemon's routing decisions (every tier), and the router's recent requests (read token). */
export async function handleActivity(input: { scope?: "daemon" | "all"; errorsOnly?: boolean; model?: string | null; provider?: string | null; limit?: number }, { paseo }: PluginHandlerContext) {
  const connection = await current();
  const filter = { scope: input.scope ?? "daemon", errorsOnly: input.errorsOnly === true, model: input.model?.trim() || null, provider: input.provider?.trim() || null, limit: input.limit ?? 25 };
  const [agents, requests] = await Promise.all([agentsById(paseo), adapterFor(connection.router).requests(connection, filter, false)]);
  const log = readSessionLog();
  const links = linkAgents(requests.rows, log, agents, agentIdFromTag);
  return {
    sessions: log.slice().reverse().map((entry) => ({ ...entry, agentTitle: agents.get(entry.agentId)?.title ?? null })),
    requests: { ...requests, rows: requests.rows.map(({ sessionTag: _tag, connectionId: _account, ...row }) => ({ ...row, agent: links.get(row.id) ?? null })) },
  };
}

export const handleActivityDetail = async ({ id }: { id: string }) => { const c = await current(); return adapterFor(c.router).explanation(c, id); };
