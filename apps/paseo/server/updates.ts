import type { Updates } from "../shared/contracts";
import { PLUGIN_VERSION, RELEASE_SOURCES, pickLatestRelease, releasesApiUrl, releasesPageUrl, updateState, type Release, type ReleaseSourceId } from "../shared/updates";
import { adapterFor } from "./routers";
import { readConnection, readReleases, writeReleases } from "./store";

/**
 * The newest release of OmniRoute and of this plugin, from GitHub's public
 * API. Each project is asked at most once every 6 hours per daemon (and kept
 * on disk across restarts), or every 30 minutes after a failure. Offline it
 * stays quiet: the last answer, or "couldn't check".
 */
const FRESH_MS = 6 * 60 * 60_000;
const RETRY_MS = 30 * 60_000;
const TIMEOUT_MS = 8_000;
/** The panel never waits longer than this; a slow GitHub answers on the next poll. */
const PANEL_WAIT_MS = 2_000;

type Entry = { at: number; release: Release | null; error: string | null };
const memory = new Map<ReleaseSourceId, Entry>();
const inflight = new Map<ReleaseSourceId, Promise<Entry>>();

function fromDisk(id: ReleaseSourceId): Entry | null {
  const saved = readReleases()?.[id] as Partial<Entry> | undefined;
  return saved && typeof saved.at === "number" ? { at: saved.at, release: (saved.release as Release | null) ?? null, error: typeof saved.error === "string" ? saved.error : null } : null;
}

async function fetchLatest(id: ReleaseSourceId, previous: Entry | null): Promise<Entry> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let entry: Entry;
  try {
    const response = await fetch(releasesApiUrl(RELEASE_SOURCES[id].repo), { headers: { accept: "application/vnd.github+json", "user-agent": "paseo-ai-router" }, signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? "GitHub's rate limit" : `GitHub answered ${response.status}`);
    entry = { at: Date.now(), release: pickLatestRelease(await response.json()), error: null };
  } catch (error) {
    // Keep the last good release; only say why this check failed.
    const reason = error instanceof Error && error.name === "AbortError" ? "GitHub didn't answer" : error instanceof Error ? error.message : String(error);
    entry = { at: Date.now(), release: previous?.release ?? null, error: reason.length > 80 ? `${reason.slice(0, 77)}…` : reason };
  } finally {
    clearTimeout(timer);
  }
  memory.set(id, entry);
  try {
    writeReleases({ ...(readReleases() ?? {}), [id]: entry });
  } catch {
    // memory is enough until the next check
  }
  return entry;
}

/** The cached answer while it is fresh; otherwise one check, shared by every caller. */
function latest(id: ReleaseSourceId, refresh: boolean): Promise<Entry> {
  const known = memory.get(id) ?? fromDisk(id);
  if (known) memory.set(id, known);
  const age = known ? Date.now() - known.at : Number.POSITIVE_INFINITY;
  // Refresh skips the 6 hours, but never asks more than once a minute.
  if (known && (refresh ? age < 60_000 : age < (known.error ? RETRY_MS : FRESH_MS))) return Promise.resolve(known);
  const running = inflight.get(id);
  if (running) return running;
  const promise = fetchLatest(id, known).finally(() => inflight.delete(id));
  inflight.set(id, promise);
  return promise;
}

function within(promise: Promise<Entry>, fallback: Entry | null): Promise<Entry | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Entry | null>((resolve) => (timer = setTimeout(() => resolve(fallback), PANEL_WAIT_MS)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export async function handleUpdates({ refresh }: { refresh?: boolean }): Promise<Updates> {
  const { connection } = await readConnection();
  const [router, plugin, health] = await Promise.all([
    within(latest("router", refresh === true), memory.get("router") ?? null),
    within(latest("plugin", refresh === true), memory.get("plugin") ?? null),
    // The version comes with the health check the panel already makes (a read token is needed for it).
    connection.endpoint ? adapterFor(connection.router).health(connection, 60_000).catch(() => null) : Promise.resolve(null),
  ]);
  const product = (id: ReleaseSourceId, entry: Entry | null, running: string | null) => ({
    label: RELEASE_SOURCES[id].label,
    running,
    latest: entry?.release ?? null,
    state: updateState(running, entry?.release?.version ?? null),
    changelogUrl: releasesPageUrl(RELEASE_SOURCES[id].repo),
    error: entry?.error ?? (entry ? null : "still checking"),
  });
  const times = [router?.at, plugin?.at].filter((at): at is number => typeof at === "number");
  return {
    router: product("router", router, health?.version ?? null),
    plugin: product("plugin", plugin, PLUGIN_VERSION),
    checkedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
  };
}
