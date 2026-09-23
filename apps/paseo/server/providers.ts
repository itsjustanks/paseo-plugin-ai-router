import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Providers } from "../shared/contracts";
import { AI_ROUTER_PROVIDER_ID, CODEX_ROUTER_PROVIDER_ID, paseoProviderName, providerOwner, throughRouter, tidyReason, type ProviderStatus } from "../shared/logic";
import { refreshProviders } from "./store";

type Paseo = PluginHandlerContext["paseo"];

/** Paseo discovers providers lazily; the panel never waits longer than this for it. */
const SNAPSHOT_TIMEOUT_MS = 6_000;
const STATUSES: readonly ProviderStatus[] = ["ready", "loading", "error", "unavailable"];
const ORDER = ["claude", "codex", AI_ROUTER_PROVIDER_ID, CODEX_ROUTER_PROVIDER_ID];

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

type SnapshotEntry = { provider: string; status?: string; enabled?: boolean; source?: string; error?: string; label?: string };

async function snapshot(paseo: Paseo, refresh: boolean): Promise<SnapshotEntry[]> {
  if (refresh) await within(paseo.providers.refresh({}), SNAPSHOT_TIMEOUT_MS, "Paseo's provider refresh").catch(() => null);
  const first = (await within(paseo.providers.snapshot(), SNAPSHOT_TIMEOUT_MS, "Paseo's provider list")) as { entries?: SnapshotEntry[] };
  const entries = first.entries ?? [];
  if (!entries.some((entry) => entry.status === "loading")) return entries;
  // A provider still loading gets a short, bounded wait; one that never finishes is what Tidy up is for.
  const settled = (await within(paseo.providers.waitForReady({ timeoutMs: 4_000 }), 5_000, "Paseo's provider discovery").catch(() => null)) as { entries?: SnapshotEntry[] } | null;
  return settled?.entries?.length ? settled.entries : entries;
}

/** Every Paseo provider on this daemon: status, enabled, who owns the entry, and what OmniRoute can do for it. */
export async function listProviders(paseo: Paseo, refresh: boolean): Promise<Providers> {
  const checkedAt = new Date().toISOString();
  try {
    const [entries, { config }] = await Promise.all([snapshot(paseo, refresh), paseo.config.get()]);
    const configured = ((config as { providers?: Record<string, unknown> }).providers ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const ids = [...new Set([...entries.map((entry) => entry.provider), ...Object.keys(configured)])];
    const rows = ids.map((id) => {
      const entry = entries.find((candidate) => candidate.provider === id);
      const override = configured[id] ?? {};
      const status = STATUSES.find((value) => value === entry?.status) ?? "unavailable";
      const base = {
        id,
        status,
        error: entry?.error ?? (entry ? null : "not in Paseo's provider list"),
        enabled: override.enabled === false ? false : entry?.enabled ?? true,
        source: (entry?.source === "custom" || (override.extends !== undefined && !["claude", "codex", "copilot", "opencode", "pi", "omp"].includes(id)) ? "custom" : "builtin") as "builtin" | "custom",
        configured: Object.keys(override).some((field) => field !== "enabled" && field !== "order"),
      };
      return {
        id,
        label: paseoProviderName(id, entry?.label ?? (typeof override.label === "string" ? override.label : null)),
        status,
        error: base.error,
        enabled: base.enabled,
        owner: providerOwner(base),
        through: throughRouter(id),
        tidy: tidyReason(base),
      };
    });
    const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
    rows.sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
    return { state: "ok", message: null, checkedAt, rows };
  } catch (error) {
    return { state: "error", message: `Could not read Paseo's providers: ${error instanceof Error ? error.message : String(error)}`, checkedAt, rows: [] };
  }
}

/** `agents.providers.<id>.enabled`, through Paseo's config API. */
export async function setProviderEnabled(paseo: Paseo, id: string, enabled: boolean): Promise<{ ok: boolean; message: string }> {
  await paseo.config.patch({ providers: { [id]: { enabled } } });
  await refreshProviders(paseo, [id]);
  return { ok: true, message: `${paseoProviderName(id, null)} ${enabled ? "turned on" : "turned off"}.` };
}

/** Switch off the listed providers that Tidy up would pick right now; anything else in the list is left alone. */
export async function tidyProviders(paseo: Paseo, ids: string[]): Promise<{ ok: boolean; message: string }> {
  const current = await listProviders(paseo, false);
  if (current.state !== "ok") return { ok: false, message: current.message ?? "Could not read Paseo's providers." };
  const allowed = current.rows.filter((row) => row.tidy !== null && ids.includes(row.id));
  const skipped = ids.filter((id) => !allowed.some((row) => row.id === id));
  if (!allowed.length) return { ok: false, message: "Nothing to tidy: those providers are fine now, or are not Paseo's own." };
  await paseo.config.patch({ providers: Object.fromEntries(allowed.map((row) => [row.id, { enabled: false }])) });
  await refreshProviders(paseo, allowed.map((row) => row.id));
  const names = allowed.map((row) => row.label).join(", ");
  return { ok: true, message: `Turned off ${names}. Turn any back on from this list.${skipped.length ? ` Left alone: ${skipped.join(", ")}.` : ""}` };
}
