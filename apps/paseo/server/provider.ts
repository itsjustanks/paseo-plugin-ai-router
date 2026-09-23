import { execFile } from "node:child_process";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Status } from "../shared/contracts";
import { providerLabel, type CatalogModel } from "../shared/routers/omniroute/parsers";
import {
  AI_ROUTER_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  CODEX_ROUTER_PROVIDER_ID,
  aiRouterProviderEntry,
  codexRouterProviderEntry,
  comboProfile,
  connectionProblem,
  isOwnProfile,
  mergeAgentProfiles,
  sameProviderEntry,
  withProviderEntries,
  type AgentProfile,
  type Connection,
} from "../shared/logic";
import { adapterFor } from "./routers";
import {
  connectionMtime,
  daemonStateFromConfigFile,
  describeProviderEntries,
  paseoHome,
  readConnection,
  readRoutingSettings,
  readDaemonConfig,
  readProviderEntries,
  readSyncState,
  refreshProviders,
  writeDaemonConfig,
  writeSyncState,
  type ProviderEntries,
} from "./store";

type Paseo = PluginHandlerContext["paseo"];
const tests = new Map<string, Status["aiProvider"]["tests"][number]>();
export const providerState = () => {
  const state = readSyncState();
  return {
    lastSync: state && !state.removed ? { at: state.at, ok: state.ok, message: state.message } : null,
    via: state && !state.removed ? state.via ?? "api" : null,
    tests: [...tests.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
  };
};

// ------------------------------------------------------------ the model list
//
// The catalogue is two GETs against OmniRoute; it is reused for a few minutes
// so the 5-minute check, the button and a connection save share one answer.

const CATALOGUE_MAX_AGE_MS = 4 * 60_000;
let catalogueCache: { key: string; at: number; value: Promise<Awaited<ReturnType<typeof fetchCatalogue>>> } | null = null;
const fetchCatalogue = (connection: Connection) => adapterFor(connection.router).models(connection);
function catalogueFor(connection: Connection, fresh = false) {
  const key = `${connection.endpoint}\n${connection.apiKey}\n${connection.token}`;
  if (!fresh && catalogueCache?.key === key && Date.now() - catalogueCache.at <= CATALOGUE_MAX_AGE_MS) return catalogueCache.value;
  const value = fetchCatalogue(connection);
  catalogueCache = { key, at: Date.now(), value };
  return value;
}

const codexModels = (list: CatalogModel[]) => list.filter((model) => model.provider === "codex");

/**
 * The provider entries that should be in Paseo for this model list: AI Router
 * always, Codex via OmniRoute only if it is already there (a person turns it
 * on), and the 0.1.0 Codex provider gone.
 */
export function desiredEntries(connection: Connection, list: CatalogModel[], entries: ProviderEntries): Record<string, unknown | null> {
  const desired: Record<string, unknown | null> = { [AI_ROUTER_PROVIDER_ID]: aiRouterProviderEntry(connection.endpoint!, list) };
  const codex = codexModels(list);
  if (entries.codexRouter.present && codex.length) desired[CODEX_ROUTER_PROVIDER_ID] = codexRouterProviderEntry(connection.endpoint!, codex);
  if (entries.codex.present) desired[CODEX_PROVIDER_ID] = null;
  return desired;
}

/** Only the entries that differ from what Paseo holds. */
function changedEntries(desired: Record<string, unknown | null>, entries: ProviderEntries): Record<string, unknown | null> {
  const changed: Record<string, unknown | null> = {};
  for (const [id, entry] of Object.entries(desired)) {
    const current = entries.all[id];
    if (entry === null ? current !== undefined : !sameProviderEntry(current, entry as Parameters<typeof sameProviderEntry>[1])) changed[id] = entry;
  }
  return changed;
}

function countsOf(list: CatalogModel[]): string {
  const byProvider = new Map<string, number>();
  for (const model of list) byProvider.set(model.provider, (byProvider.get(model.provider) ?? 0) + 1);
  return [...byProvider].map(([provider, n]) => `${providerLabel(provider)} ${n}`).join(" · ");
}

/**
 * Through Paseo's API: validated by the daemon and live at once. Paseo takes
 * `agentProfiles` as the whole list, so `profiles` is the merged list, with
 * everyone else's profiles exactly as Paseo returned them.
 */
async function applyThroughApi(paseo: Paseo, changed: Record<string, unknown | null>, profiles: unknown[] | null = null): Promise<void> {
  const providers = Object.fromEntries(Object.entries(changed).filter(([, entry]) => entry !== null));
  const removeProviders = Object.keys(changed).filter((id) => changed[id] === null);
  const patch = { ...(Object.keys(providers).length ? { providers } : {}), ...(removeProviders.length ? { removeProviders } : {}), ...(profiles ? { agentProfiles: profiles } : {}) };
  if (!Object.keys(patch).length) return;
  await paseo.config.patch(patch as Parameters<Paseo["config"]["patch"]>[0]);
  if (Object.keys(providers).length) await refreshProviders(paseo, Object.keys(providers));
}

/**
 * The AI Router profiles that should exist: one per combo in the provider's
 * model list, unless the switch is off or the provider was removed.
 */
export function desiredProfiles(combos: ReadonlyArray<{ id: string; name: string; notes: string; icon: string; color: string }>, on: boolean): AgentProfile[] {
  return on ? combos.map(comboProfile) : [];
}

/** `paseo daemon reload`: makes an edited config.json live without a restart. Null when it worked. */
export function reloadDaemon(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("paseo", ["daemon", "reload", "--home", paseoHome(), "--json"], { timeout: 20_000, env: process.env }, (error, _stdout, stderr) => {
      if (!error) return resolve(null);
      if ((error as { code?: unknown }).code === "ENOENT") return resolve("the paseo command is not on this daemon's PATH");
      const detail = String(stderr || error.message).trim().split("\n")[0];
      resolve(`paseo daemon reload failed${detail ? `: ${detail}` : ""}`);
    });
  });
}

/**
 * Without a Paseo handle: edit config.json the way the daemon reads it, then
 * ask it to reload. Only our entries change; the file must parse as a daemon
 * config and must not have changed under us, or nothing is written.
 */
async function applyThroughFile(changed: Record<string, unknown | null>, profiles: AgentProfile[] | null): Promise<{ ok: boolean; note: string }> {
  const file = readDaemonConfig();
  if (!file) return { ok: false, note: `no ${paseoHome()}/config.json to write to` };
  const next = withProviderEntries(file.text, changed, profiles);
  if (!next.ok) return { ok: false, note: next.error };
  if (!next.changed) return { ok: true, note: "already in config.json" };
  if (!writeDaemonConfig(next.text, file)) return { ok: false, note: "config.json changed while it was being updated; will retry" };
  const reload = await reloadDaemon();
  return { ok: true, note: reload ? `written to config.json; live after the next reload or restart (${reload})` : "written to config.json and reloaded" };
}

/** Write the AI Router provider with the router's current model list, or remove it. The button, the connect-time check and the timer share this. */
export async function syncAiProvider(paseo: Paseo, connection: Connection, enabled: boolean): Promise<{ ok: boolean; message: string; log: string }> {
  const entries = await readProviderEntries(paseo);
  const at = new Date().toISOString();
  if (!enabled) {
    // The combo profiles run on this provider, so they go with it.
    const merged = mergeAgentProfiles(entries.profiles, []);
    await paseo.config.patch({ removeProviders: [AI_ROUTER_PROVIDER_ID], ...(merged.changed ? { agentProfiles: merged.next } : {}) } as Parameters<Paseo["config"]["patch"]>[0]);
    // Remembered so the auto-sync does not put back what a person took out.
    writeSyncState({ at, ok: true, message: "Removed from Paseo.", endpoint: connection.endpoint, removed: true });
    return { ok: true, message: "AI Router provider removed from Paseo.", log: "removed the AI Router provider" };
  }
  const result = await catalogueFor(connection, true);
  if (!result.ok) {
    writeSyncState({ at, ok: false, message: result.error, endpoint: connection.endpoint });
    return { ok: false, message: result.error, log: `model sync failed: ${result.error}` };
  }
  const desired = desiredEntries(connection, result.list, entries);
  const settings = await readRoutingSettings();
  const merged = mergeAgentProfiles(entries.profiles, desiredProfiles(result.combos, settings.comboProfiles));
  await applyThroughApi(paseo, desired, merged.changed ? merged.next : null);
  const counts = countsOf(result.list);
  const message = `Synced ${result.list.length} models to Paseo (${counts}).${entries.codex.present ? " Removed the old AI Router Codex provider." : ""}`;
  writeSyncState({ at, ok: true, message, endpoint: connection.endpoint, via: "api" });
  return { ok: true, message, log: `synced ${result.list.length} models (${counts})` };
}

/** Add or remove "Codex via OmniRoute". Needs a Codex account in OmniRoute. */
export async function setCodexRouter(paseo: Paseo, connection: Connection, enabled: boolean): Promise<{ ok: boolean; message: string }> {
  if (!enabled) {
    await paseo.config.patch({ removeProviders: [CODEX_ROUTER_PROVIDER_ID] });
    return { ok: true, message: "Codex via OmniRoute removed from Paseo. Built-in Codex is unchanged." };
  }
  const problem = connectionProblem({ connection, blocked: null });
  if (problem) return { ok: false, message: `Connect the router first: ${problem}.` };
  const result = await catalogueFor(connection, true);
  if (!result.ok) return { ok: false, message: result.error };
  const codex = codexModels(result.list);
  if (!codex.length) return { ok: false, message: "OmniRoute has no active Codex account, so there is nothing for Codex to use." };
  await applyThroughApi(paseo, { [CODEX_ROUTER_PROVIDER_ID]: codexRouterProviderEntry(connection.endpoint!, codex) });
  return { ok: true, message: `Added "Codex via OmniRoute" with ${codex.length} model${codex.length === 1 ? "" : "s"}. Pick it when you start a Codex agent; this daemon needs no Codex login for it.` };
}

// ---------------------------------------------------------------- auto-sync
//
// Paseo cannot register a Claude-derived provider from a plugin (the SDK's
// registerProvider wants a whole agent runtime), so "AI Router" stays a
// config entry and this keeps it current:
//   - at plugin load, with no Paseo handle, by editing config.json and
//     running `paseo daemon reload`;
//   - the moment the app connects to this host (the client contribution calls
//     ai-router.ensure), and on any RPC or hook, through config.patch;
//   - every 5 minutes after that, either way.
// Each check compares the entries with OmniRoute's current model list and
// writes only when something changed.

const CHECK_EVERY_MS = 5 * 60_000;
const THROTTLE_MS = 5_000;
/** At load the daemon may not be listening yet; give it a moment before asking it to reload. */
const FIRST_CHECK_MS = 5_000;

let paseoHandle: Paseo | null = null;
let lastMtime: number | null | undefined; // undefined: not looked at since the plugin loaded
let lastCheck = 0;
let lastRun = 0;
let running: Promise<void> | null = null;
const logged = new Set<string>();

function say(line: string, once: boolean): void {
  if (once && logged.has(line)) return;
  logged.add(line);
  console.log(`[ai-router] ${line}`);
}

/** Why the provider entries should be written now, or null. */
export function syncReason(input: { removed: boolean; present: boolean; changed: string[] }): string | null {
  if (input.removed) return null;
  if (!input.present) return "provider missing";
  return input.changed.length ? `${input.changed.join(" and ")} out of date` : null;
}

/** One check, through the Paseo handle when there is one, else through config.json. Never throws; one at a time. */
export function checkAutoSync(paseo: Paseo | null): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      const resolved = await readConnection();
      const { connection } = resolved;
      const problem = connectionProblem(resolved);
      if (problem) return say(`model sync skipped: ${problem}`, true);
      const state = readSyncState();
      const daemon = paseo ? await readProviderEntries(paseo) : (() => {
        const file = daemonStateFromConfigFile();
        return file ? describeProviderEntries(file.providers, file.profiles) : null;
      })();
      if (!daemon) return say(`model sync skipped: cannot read ${paseoHome()}/config.json`, true);
      const settings = await readRoutingSettings();
      if (state?.removed) {
        // The provider was taken out in the panel: leave it out, and take its combo profiles with it.
        const leftover = mergeAgentProfiles(daemon.profiles, []);
        if (!leftover.changed) return;
        if (paseo) await applyThroughApi(paseo, {}, leftover.next);
        else await applyThroughFile({}, []);
        return say("removed the combo profiles of the removed AI Router provider", false);
      }
      const entries = daemon;
      const result = await catalogueFor(connection);
      if (!result.ok) return say(`model sync skipped: ${result.error}`, true);
      const changed = changedEntries(desiredEntries(connection, result.list, entries), entries);
      const wantedProfiles = desiredProfiles(result.combos, settings.comboProfiles);
      const profiles = mergeAgentProfiles(entries.profiles, wantedProfiles);
      const reason = syncReason({ removed: false, present: entries.aiRouter.present, changed: [...Object.keys(changed), ...(profiles.changed ? ["combo profiles"] : [])] });
      if (!reason) return;
      const counts = countsOf(result.list);
      const at = new Date().toISOString();
      const ours = wantedProfiles.length;
      const profileWords = profiles.changed ? `${ours} combo profile${ours === 1 ? "" : "s"}` : null;
      const message = `Synced ${result.list.length} models to Paseo (${counts}).${profileWords ? ` ${profileWords.replace(/^./, (c) => c.toUpperCase())} kept.` : ""}`;
      const log = Object.keys(changed).length ? `synced ${result.list.length} models (${counts})${profileWords ? `, ${profileWords}` : ""}` : `updated the combo profiles (${profileWords})`;
      if (paseo) {
        await applyThroughApi(paseo, changed, profiles.changed ? profiles.next : null);
        if (Object.keys(changed).length) writeSyncState({ at, ok: true, message, endpoint: connection.endpoint, via: "api" });
        return say(log, false);
      }
      const written = await applyThroughFile(changed, profiles.changed ? wantedProfiles : null);
      if (!written.ok) return say(`model sync at load skipped: ${written.note}`, true);
      if (Object.keys(changed).length) writeSyncState({ at, ok: true, message: `${message} ${written.note.replace(/^./, (c) => c.toUpperCase())}.`, endpoint: connection.endpoint, via: "config-file" });
      say(`${log} at load: ${written.note}`, false);
    } catch (error) {
      say(`model sync failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Called at the top of every RPC and hook. Cheap: a stat and a clock check, at most every 5 s. */
export function noteActivity(paseo: Paseo, force = false): void {
  const first = paseoHandle === null;
  paseoHandle = paseo;
  const now = Date.now();
  if (!force && !first && now - lastCheck < THROTTLE_MS) return;
  lastCheck = now;
  const mtime = connectionMtime();
  const due = force || first || lastMtime === undefined || mtime !== lastMtime || now - lastRun > CHECK_EVERY_MS;
  lastMtime = mtime;
  if (!due) return;
  lastRun = now;
  void checkAutoSync(paseo);
}

/** The load-time check (no handle needed) and the 5-minute re-check. Returns the cleanup. */
export function startAutoSync(): () => void {
  const first = setTimeout(() => {
    if (paseoHandle) return; // the app connected first and already checked
    lastRun = Date.now();
    lastMtime = connectionMtime();
    void checkAutoSync(null);
  }, FIRST_CHECK_MS);
  const timer = setInterval(() => {
    lastRun = Date.now();
    lastMtime = connectionMtime();
    void checkAutoSync(paseoHandle);
  }, CHECK_EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export async function testProviderModel(connection: Connection, model: string): Promise<{ ok: boolean; message: string }> {
  const outcome = await adapterFor(connection.router).testModel(connection, model);
  tests.set(model, { model, at: new Date().toISOString(), ...outcome });
  return outcome;
}

/** The combo profiles AI Router keeps, as Paseo holds them now. */
export function listOwnProfiles(profiles: unknown[]): Array<{ id: string; name: string; model: string | null; notes: string | null; icon: string | null; color: string | null }> {
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return profiles.filter(isOwnProfile).map((p) => ({ id: p.id, name: typeof p.name === "string" ? p.name : p.id, model: text(p.model), notes: text(p.notes), icon: text(p.icon), color: text(p.color) }));
}
