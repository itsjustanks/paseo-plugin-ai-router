// Settings-path and envelope reading adapted from the 9Router Agent Link plugin's server/hooks.ts (MIT); see THIRD-PARTY-NOTICES.md.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  AI_ROUTER_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  CODEX_ROUTER_PROVIDER_ID,
  parseRoutingEnvelope,
  resolveConnection,
  type Connection,
  type ResolvedConnection,
  type RoutingSettingsShape,
} from "../shared/logic";
import { ROUTING_SETTINGS_ID } from "../shared/settings";

/** The id in paseo-plugin.json; the daemon names the settings directory after it. */
export const PLUGIN_ID = "ai-router";

/**
 * @getpaseo/plugin/server 0.8.0-beta.1 has no server-side settings read API.
 * The daemon persists each settings document as
 *   $PASEO_HOME/plugin-settings/<pluginId>/<settingsId>.json
 * with the envelope `{ "version": n, "values": { ... } }`; PASEO_HOME defaults
 * to ~/.paseo. The connection lives beside it in connection.json, written only
 * by this plugin and never registered as a settings document, because
 * settings documents are sent to every client as-is and this one holds a key.
 */
export function paseoHome(): string {
  return process.env.PASEO_HOME?.replace(/^~(?=$|\/)/, homedir()) || join(homedir(), ".paseo");
}

export function settingsDir(): string {
  return join(paseoHome(), "plugin-settings", PLUGIN_ID);
}

const connectionPath = () => join(settingsDir(), "connection.json");

/** Missing file = null. Any other read failure = a value that will not parse, so callers fail closed. */
async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    return (error as { code?: unknown })?.code === "ENOENT" ? null : "\u0000unreadable";
  }
}

export async function readConnection(): Promise<ResolvedConnection> {
  return resolveConnection(await readOptional(connectionPath()), process.env);
}

export async function readRoutingSettings(): Promise<RoutingSettingsShape> {
  return parseRoutingEnvelope(await readOptional(join(settingsDir(), `${ROUTING_SETTINGS_ID}.json`)));
}

/** Atomic write, readable by the daemon's user only: the file holds a bearer key. */
export function writeConnection(value: Omit<Connection, "source">): void {
  mkdirSync(settingsDir(), { recursive: true, mode: 0o700 });
  const path = connectionPath();
  const tmp = `${path}.tmp-ai-router`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/** connection.json's mtime, or null when it is missing: cheap change detection for files written by hand or by an orchestrator. */
export function connectionMtime(): number | null {
  try {
    return statSync(connectionPath()).mtimeMs;
  } catch {
    return null;
  }
}

/** The last model sync, kept on disk so the panel and the auto-sync agree across plugin restarts. No secrets. */
export type SyncState = { at: string; ok: boolean; message: string; endpoint: string | null; removed?: boolean; via?: "api" | "config-file" };
const syncStatePath = () => join(settingsDir(), "sync-state.json");

export function readSyncState(): SyncState | null {
  try {
    const value = JSON.parse(readFileSync(syncStatePath(), "utf8")) as SyncState;
    return typeof value?.at === "string" ? value : null;
  } catch {
    return null;
  }
}

export function writeSyncState(state: SyncState): void {
  mkdirSync(settingsDir(), { recursive: true, mode: 0o700 });
  writeFileSync(syncStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/** When the router last answered, so the panel can say "last seen 14:02" after a restart. No secrets. */
const lastSeenPath = () => join(settingsDir(), "health-state.json");
export function readLastSeen(): { endpoint: string; at: string } | null {
  try {
    const value = JSON.parse(readFileSync(lastSeenPath(), "utf8")) as { endpoint?: unknown; at?: unknown };
    return typeof value.endpoint === "string" && typeof value.at === "string" ? { endpoint: value.endpoint, at: value.at } : null;
  } catch {
    return null;
  }
}
export function writeLastSeen(value: { endpoint: string; at: string }): void {
  mkdirSync(settingsDir(), { recursive: true, mode: 0o700 });
  writeFileSync(lastSeenPath(), `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

// ------------------------------------------------------ Paseo's config.json
//
// Without a Paseo handle (no RPC or hook yet) the only way to put a provider
// in place is the file the daemon itself reads: $PASEO_HOME/config.json. The
// daemon re-reads that file on every config.patch and on `paseo daemon
// reload`, so an edit here is kept, and a reload makes it live.

export const daemonConfigPath = () => join(paseoHome(), "config.json");

export function readDaemonConfig(): { text: string; mtimeMs: number; mode: number } | null {
  try {
    const stat = statSync(daemonConfigPath());
    return { text: readFileSync(daemonConfigPath(), "utf8"), mtimeMs: stat.mtimeMs, mode: stat.mode & 0o777 };
  } catch {
    return null;
  }
}

/** Atomic replace, keeping the file's mode. Refuses when the file changed since it was read. */
export function writeDaemonConfig(text: string, readAt: { mtimeMs: number; mode: number }): boolean {
  const path = daemonConfigPath();
  if (statSync(path).mtimeMs !== readAt.mtimeMs) return false;
  const tmp = `${path}.tmp-ai-router`;
  writeFileSync(tmp, text, { mode: readAt.mode || 0o600 });
  renameSync(tmp, path);
  return true;
}

export function clearConnection(): boolean {
  const path = connectionPath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

type Paseo = PluginHandlerContext["paseo"];

type Entry = { env?: Record<string, unknown>; models?: unknown[] } | undefined;
const envString = (entry: Entry, name: string) => (typeof entry?.env?.[name] === "string" ? (entry.env[name] as string) : null);

export type ProviderEntries = {
  aiRouter: { present: boolean; models: string[]; listed: Array<{ id: string; label: string }>; summary: string | null; baseUrl: string | null; entry: unknown };
  codex: { present: boolean; baseUrl: string | null };
  codexRouter: { present: boolean; baseUrl: string | null; modelCount: number; entry: unknown };
  /** Every provider entry, as Paseo holds it. */
  all: Record<string, unknown>;
  /** Every agent profile, as Paseo holds it (ours start with "ai-router:"). */
  profiles: unknown[];
};

/** Providers (`agents.providers`) and profiles (`daemon.agentProfiles`) from config.json, for when there is no Paseo handle. */
export function daemonStateFromConfigFile(): { providers: Record<string, unknown>; profiles: unknown[] } | null {
  const file = readDaemonConfig();
  if (!file) return null;
  try {
    const config = JSON.parse(file.text) as { agents?: { providers?: unknown }; daemon?: { agentProfiles?: unknown } };
    const providers = config.agents?.providers;
    const profiles = config.daemon?.agentProfiles;
    return { providers: providers && typeof providers === "object" ? (providers as Record<string, unknown>) : {}, profiles: Array.isArray(profiles) ? profiles : [] };
  } catch {
    return null;
  }
}

/** Our provider entries in Paseo's config. The daemon returns providers flattened. */
export async function readProviderEntries(paseo: Paseo): Promise<ProviderEntries> {
  const { config } = await paseo.config.get();
  const view = config as { providers?: Record<string, Entry>; agentProfiles?: unknown };
  return describeProviderEntries(view.providers ?? {}, Array.isArray(view.agentProfiles) ? view.agentProfiles : []);
}

export function describeProviderEntries(providers: Record<string, Entry | unknown>, profiles: unknown[] = []): ProviderEntries {
  const entry = (id: string) => providers[id] as Entry;
  const ai = entry(AI_ROUTER_PROVIDER_ID);
  const codex = entry(CODEX_PROVIDER_ID);
  const codexRouter = entry(CODEX_ROUTER_PROVIDER_ID);
  const baseUrl = codex?.env?.OPENAI_BASE_URL;
  const listed = (Array.isArray(ai?.models) ? ai.models : []) as Array<{ id?: unknown; label?: unknown }>;
  const models = listed.map((model) => model?.id).filter((id): id is string => typeof id === "string");
  const named = listed
    .filter((model): model is { id: string; label?: unknown } => typeof model?.id === "string")
    .map((model) => ({ id: model.id, label: typeof model.label === "string" ? model.label : model.id }));
  // Labels read "Claude · Opus 5.5"; the part before the dot is the account's provider.
  const counts = new Map<string, number>();
  for (const model of listed) {
    const group = typeof model?.label === "string" && model.label.includes(" · ") ? model.label.split(" · ")[0] : "Other";
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return {
    aiRouter: {
      present: ai !== undefined,
      models,
      listed: named,
      summary: counts.size ? [...counts].map(([group, n]) => `${group} ${n}`).join(" · ") : null,
      baseUrl: envString(ai, "ANTHROPIC_BASE_URL"),
      entry: ai,
    },
    codex: { present: codex !== undefined, baseUrl: typeof baseUrl === "string" ? baseUrl : null },
    codexRouter: {
      present: codexRouter !== undefined,
      baseUrl: envString(codexRouter, "OPENAI_BASE_URL"),
      modelCount: Array.isArray(codexRouter?.models) ? codexRouter.models.length : 0,
      entry: codexRouter,
    },
    all: providers as Record<string, unknown>,
    profiles,
  };
}

/** Best effort: a provider change is persisted either way, and a later reload picks it up. Never restart the daemon here. */
export async function refreshProviders(paseo: Paseo, ids: string[]): Promise<void> {
  try {
    await paseo.providers.refresh({ providers: ids });
  } catch {
    // keep the persisted config
  }
}
