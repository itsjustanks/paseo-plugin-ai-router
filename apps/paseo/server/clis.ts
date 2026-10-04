import { execFile, spawn } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Clis } from "../shared/contracts";
import { AGENT_CLIS, cliInfo, detectInstall, parseVersion, tailLines, updatePlan, versionState, type CliId } from "../shared/clis";

// Claude Code and Codex as this daemon runs them: the binary first on the
// daemon's PATH (the same lookup Paseo does), its version, npm's latest, and
// an update run as the daemon's own user. Nothing here runs unless asked,
// except `--version` and one registry read an hour.

const LATEST_MAX_AGE_MS = 60 * 60_000;
const LATEST_RETRY_MS = 10 * 60_000;
const LATEST_TIMEOUT_MS = 5_000;
const LOCAL_MAX_AGE_MS = 60_000;
const VERSION_TIMEOUT_MS = 10_000;
const UPDATE_TIMEOUT_MS = 10 * 60_000;

type Job = NonNullable<Clis["job"]>;
let job: Job | null = null;
let localSeen: { at: number; value: Promise<Clis["tools"]> } | null = null;
const latestSeen = new Map<CliId, { at: number; ok: boolean; value: string | null }>();

/** The first executable called `name` on PATH, as Paseo finds it. */
export function findOnPath(name: string, path = process.env.PATH ?? ""): string | null {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

function writable(...dirs: string[]): boolean {
  try {
    for (const dir of dirs) accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function run(file: string, args: string[], timeout: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, env: process.env }, (error, stdout, stderr) => resolve({ ok: !error, out: `${stdout}\n${stderr}` }));
  });
}

/** npm's newest version, an hour at a time; offline it is null, quietly, and asked again in 10 minutes. */
async function latest(id: CliId, force = false): Promise<string | null> {
  const seen = latestSeen.get(id);
  const maxAge = force ? LOCAL_MAX_AGE_MS : seen?.ok ? LATEST_MAX_AGE_MS : LATEST_RETRY_MS;
  if (seen && Date.now() - seen.at < maxAge) return seen.value;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), LATEST_TIMEOUT_MS);
  try {
    // npm's own setting for a mirror, when the daemon has one.
    const registry = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");
    const response = await fetch(`${registry}/${cliInfo(id).pkg}/latest`, { signal: abort.signal, headers: { accept: "application/json" } });
    const body = response.ok ? ((await response.json()) as { version?: unknown }) : null;
    const value = typeof body?.version === "string" ? body.version : null;
    latestSeen.set(id, { at: Date.now(), ok: value !== null, value: value ?? seen?.value ?? null });
    return value ?? seen?.value ?? null;
  } catch {
    latestSeen.set(id, { at: Date.now(), ok: false, value: seen?.value ?? null });
    return seen?.value ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Where the binary really lives, how it got there, and the update for it. */
function planFor(id: CliId, found: string) {
  let real = found;
  try {
    real = realpathSync(found);
  } catch {
    // keep the PATH entry
  }
  const method = detectInstall(id, real);
  const canWrite = method.kind === "npm" ? writable(join(method.prefix, "lib", "node_modules"), join(method.prefix, "bin")) : method.kind === "claude-native" ? writable(method.root) : false;
  return { real, plan: updatePlan(id, method, { binPath: found, writable: canWrite, npm: findOnPath("npm") }) };
}

async function describe(id: CliId, force: boolean) {
  const { label, bin } = cliInfo(id);
  const found = findOnPath(bin);
  const newest = await latest(id, force);
  if (!found) return { id, label, path: null, installed: null, latest: newest, state: versionState(null, newest, false), method: "not installed", command: `npm install -g ${cliInfo(id).pkg}`, canUpdate: false, why: `${bin} isn't on this daemon's PATH.` };
  const { real, plan } = planFor(id, found);
  const version = await run(found, ["--version"], VERSION_TIMEOUT_MS);
  const installed = parseVersion(version.out);
  return { id, label, path: real, installed, latest: newest, state: versionState(installed, newest, true), method: plan.method, command: plan.command, canUpdate: plan.run !== null, why: plan.why };
}

function readTools(refresh: boolean): Promise<Clis["tools"]> {
  if (!refresh && localSeen && Date.now() - localSeen.at < LOCAL_MAX_AGE_MS) return localSeen.value;
  const value = Promise.all(AGENT_CLIS.map((cli) => describe(cli.id, refresh)));
  localSeen = { at: Date.now(), value };
  value.catch(() => { if (localSeen?.value === value) localSeen = null; });
  return value;
}

export async function listClis(refresh: boolean): Promise<Clis> {
  const tools = await readTools(refresh);
  return { checkedAt: new Date().toISOString(), tools, job };
}

/**
 * Update one app, as the daemon's user, in the background: the panel polls
 * for the output. One at a time; only the plan's own command, never anything
 * the client sends. Afterwards the version is read again.
 */
export async function startCliUpdate(id: CliId): Promise<{ ok: boolean; message: string }> {
  if (job?.state === "running") return { ok: false, message: `${cliInfo(job.id).label} is already updating.` };
  const { bin, label } = cliInfo(id);
  const found = findOnPath(bin);
  if (!found) return { ok: false, message: `${bin} isn't on this daemon's PATH.` };
  const before = (await readTools(true)).find((tool) => tool.id === id);
  const { plan } = planFor(id, found);
  if (!plan.run || !plan.command) return { ok: false, message: plan.why ?? `AI Router can't update ${label} here.` };
  const current: Job = { id, state: "running", startedAt: new Date().toISOString(), finishedAt: null, command: plan.command, output: [], before: before?.installed ?? null, after: null, message: null };
  job = current;
  console.log(`[ai-router] updating ${label}: ${plan.command}`);
  const child = spawn(plan.run.file, plan.run.args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const take = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    current.output = tailLines(current.output, text);
    for (const line of text.split(/\r?\n/).filter((l) => l.trim())) console.log(`[ai-router] ${bin} update: ${line.trimEnd()}`);
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const timer = setTimeout(() => child.kill("SIGTERM"), UPDATE_TIMEOUT_MS);
  const finish = async (code: number | null, error?: Error) => {
    clearTimeout(timer);
    if (current.state !== "running") return;
    const after = (await readTools(true).catch(() => [])).find((tool) => tool.id === id)?.installed ?? null;
    current.after = after;
    current.finishedAt = new Date().toISOString();
    current.state = code === 0 && !error ? "done" : "failed";
    current.message = current.state === "done"
      ? after && after !== current.before ? `${label} updated: ${current.before ?? "?"} → ${after}. Running chats keep the old version until they restart.` : `${label} is at ${after ?? "the latest version"}; nothing changed.`
      : `${label} update failed${error ? `: ${error.message}` : code === null ? " (stopped)" : ` (exit ${code})`}.`;
    console.log(`[ai-router] ${current.message}`);
  };
  child.on("error", (error) => void finish(null, error));
  child.on("close", (code) => void finish(code));
  return { ok: true, message: `Updating ${label}…` };
}
