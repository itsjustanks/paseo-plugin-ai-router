import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ContextView } from "../shared/contracts";
import { buildBreakdown, createTally, tallyEntry, usageOf, type ContextTally } from "../shared/context";
import { accessTier, connectionProblem, sessionTagFor } from "../shared/logic";
import { bareModel } from "../shared/routers/omniroute/parsers";
import { adapterFor } from "./routers";
import { readConnection, readRoutingSettings, readSessionLog } from "./store";

type Paseo = PluginHandlerContext["paseo"];
type Agent = { id: string; provider: string; cwd: string | null; model: string | null; title: string | null; createdAt: string | null; lastUsage: unknown };

/** The timeline is read newest first, this many entries a page, and never more than this many pages. */
const PAGE = 200;
const MAX_PAGES = 10;
const CALL_TIMEOUT_MS = 8_000;
/** An answer is reused while the agent's reported total is unchanged, up to this long; one whose router read failed, less. */
const FRESH_MS = 5 * 60_000;
const FRESH_ROUTER_ERROR_MS = 30_000;
/** After a failure the same chat waits 30 s, then 1, 2, 4 … up to 10 minutes, unless Refresh is pressed. */
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 10 * 60_000;
/** This daemon's latest requests read from OmniRoute's call log to find the chat's own. */
const ROUTER_ROWS = 200;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took longer than ${CALL_TIMEOUT_MS / 1000} s`)), CALL_TIMEOUT_MS)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const blankRouter = (state: ContextView["router"]["state"], message: string | null = null): ContextView["router"] => ({ state, message, requests: 0, latest: null, first: null, complete: false });
const blankCounted = { items: 0, capped: false, compactedAt: null, overshoot: false };

async function readAgent(paseo: Paseo, agentId: string): Promise<Agent | null> {
  const result = await withTimeout(paseo.agents.ref(agentId).refresh(), "Paseo's agent lookup");
  const agent = result?.agent as Partial<Agent> | undefined;
  if (!agent || typeof agent.id !== "string") return null;
  return {
    id: agent.id,
    provider: typeof agent.provider === "string" ? agent.provider : "unknown",
    cwd: typeof agent.cwd === "string" ? agent.cwd : null,
    model: typeof agent.model === "string" ? agent.model : null,
    title: typeof agent.title === "string" && agent.title ? agent.title : null,
    createdAt: typeof agent.createdAt === "string" ? agent.createdAt : null,
    lastUsage: agent.lastUsage,
  };
}

/** The timeline changed under a read (a new epoch): the pages no longer line up. */
class TimelineMoved extends Error {}

/**
 * Page back through the chat's timeline to its start or its last compaction,
 * counting as it goes; nothing is kept. If the timeline changes between pages
 * (the agent reloaded), the count starts over once.
 */
async function tallyTimeline(paseo: Paseo, agent: Agent): Promise<ContextTally> {
  try {
    return await tallyOnce(paseo, agent);
  } catch (error) {
    if (!(error instanceof TimelineMoved)) throw error;
    try {
      return await tallyOnce(paseo, agent);
    } catch (again) {
      if (again instanceof TimelineMoved) throw new Error("The chat's history changed while it was being read; try Refresh.");
      throw again;
    }
  }
}

async function tallyOnce(paseo: Paseo, agent: Agent): Promise<ContextTally> {
  const tally = createTally();
  const timeline = paseo.agents.ref(agent.id).timeline;
  let cursor: { epoch: string; seq: number } | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload: Awaited<ReturnType<typeof timeline.refetch>> = await withTimeout(
      timeline.refetch(cursor ? { direction: "before", cursor, limit: PAGE, projection: "projected" } : { direction: "tail", limit: PAGE, projection: "projected" }),
      "Reading the chat's timeline",
    );
    if (payload.error) throw new Error(`Paseo could not read the chat's timeline: ${payload.error}`);
    // Past the first page, a reset or a stale cursor means Paseo answered from a new timeline: this count is off.
    if (cursor && (payload.reset || payload.staleCursor)) throw new TimelineMoved();
    const entries = [...(payload.entries ?? [])].sort((a, b) => b.seqStart - a.seqStart);
    let going = true;
    for (const entry of entries) {
      going = tallyEntry(tally, entry, agent.cwd);
      if (!going) break;
    }
    if (!going || !payload.hasOlder || !payload.startCursor) return tally;
    cursor = payload.startCursor;
  }
  tally.capped = true;
  return tally;
}

/**
 * What OmniRoute measured for this chat: its requests among this daemon's
 * latest, found by the session tag the hook adds. Read token only; nothing
 * is asked of the router for a chat it never saw.
 */
async function routerView(agent: Agent): Promise<ContextView["router"]> {
  const opened = readSessionLog().filter((entry) => entry.agentId === agent.id);
  const last = opened.at(-1);
  if (!last?.routed) return blankRouter("not-routed");
  if (!last.tagged) {
    return blankRouter("untagged", last.kind === "codex"
      ? "Codex via OmniRoute requests carry no session tag, so the router's numbers can't be tied to this chat."
      : "This chat's requests carry no session tag (it was opened before AI Router added one), so the router's numbers can't be tied to it.");
  }
  const resolved = await readConnection();
  const { connection } = resolved;
  const problem = connectionProblem(resolved);
  if (problem) return blankRouter("error", `Not connected: ${problem}.`);
  const tier = accessTier(connection);
  if (tier !== "operator" && tier !== "admin") return blankRouter("no-token", "A read token adds what OmniRoute measured for this chat: the size of its first and latest request.");
  const answer = await adapterFor(connection.router).requests(connection, { scope: "daemon", errorsOnly: false, model: null, provider: null, limit: ROUTER_ROWS }, false);
  if (answer.state !== "ok") return blankRouter(answer.state === "no-token" ? "no-token" : "error", answer.message);
  const tag = sessionTagFor(agent.id);
  const mine = answer.rows.filter((row) => row.sessionTag === tag && row.ok && typeof row.tokensIn === "number" && row.tokensIn > 0);
  const main = bareModel(agent.model);
  // Claude Code also sends small side requests (titles, summaries) on a lighter model: the first request is the chat's own model.
  const onMain = main ? mine.filter((row) => bareModel(row.requestedModel) === main || bareModel(row.model) === main) : mine;
  const oldest = answer.rows.at(-1);
  const complete = !answer.hasMore || (!!oldest && !!agent.createdAt && Date.parse(oldest.at) <= Date.parse(agent.createdAt));
  const point = (row: (typeof mine)[number] | undefined) => (row ? { at: row.at, tokensIn: row.tokensIn as number, model: row.model ?? row.requestedModel } : null);
  return {
    state: "ok",
    message: answer.stale ? "The router is not answering just now; these are from its last answer." : null,
    requests: mine.length,
    latest: point(mine[0]),
    first: point(onMain.at(-1)),
    complete,
  };
}

async function compute(paseo: Paseo, agent: Agent, used: number, max: number): Promise<ContextView> {
  const [tally, router] = await Promise.all([
    tallyTimeline(paseo, agent),
    routerView(agent).catch((error: unknown) => blankRouter("error", error instanceof Error ? error.message : String(error))),
  ]);
  // OmniRoute's size of the chat's first request is the starting cost, measured, when it is known to be the first.
  const measuredBase = router.state === "ok" && router.complete && router.first ? router.first.tokensIn : null;
  const breakdown = buildBreakdown({ used, max, tally, codex: agent.provider.includes("codex"), measuredBase });
  return {
    state: "ok",
    message: null,
    agent: { id: agent.id, title: agent.title, provider: agent.provider, model: agent.model },
    usedTokens: used,
    maxTokens: max,
    parts: breakdown.parts,
    hint: breakdown.hint,
    urgent: breakdown.urgent,
    counted: { items: tally.items, capped: tally.capped, compactedAt: tally.compaction?.at ?? null, overshoot: breakdown.overshoot },
    router,
    checkedAt: new Date().toISOString(),
  };
}

const answers = new Map<string, { used: number; at: number; keepMs: number; value: Promise<ContextView> }>();
const failures = new Map<string, { count: number; until: number; value: ContextView }>();

function blank(agent: Agent | null, state: "no-usage" | "error", message: string): ContextView {
  return {
    state,
    message,
    agent: agent ? { id: agent.id, title: agent.title, provider: agent.provider, model: agent.model } : null,
    usedTokens: null,
    maxTokens: null,
    parts: [],
    hint: null,
    urgent: null,
    counted: blankCounted,
    router: blankRouter("not-routed"),
    checkedAt: new Date().toISOString(),
  };
}

function failure(agentId: string, agent: Agent | null, message: string): ContextView {
  const before = failures.get(agentId);
  // A run of failures long past (nobody asked since) does not stretch the next wait.
  const count = before && Date.now() - before.until < BACKOFF_CAP_MS ? before.count + 1 : 1;
  const value = blank(agent, "error", message);
  failures.set(agentId, { count, until: Date.now() + Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (count - 1)), value });
  return value;
}

/**
 * One chat's context: the exact total from Paseo, the estimated parts from its
 * timeline, and OmniRoute's own numbers when the tier allows. Asked for only
 * when someone opens the breakdown; reused while the total is unchanged.
 */
export async function handleContext({ agentId, refresh }: { agentId: string; refresh?: boolean }, { paseo }: PluginHandlerContext): Promise<ContextView> {
  const backingOff = failures.get(agentId);
  if (!refresh && backingOff && Date.now() < backingOff.until) return backingOff.value;
  let agent: Agent | null;
  try {
    agent = await readAgent(paseo, agentId);
  } catch (error) {
    return failure(agentId, null, error instanceof Error ? error.message : String(error));
  }
  if (!agent) return failure(agentId, null, "Paseo has no such agent on this daemon (it may have been archived).");
  const usage = usageOf(agent.lastUsage);
  if (!usage) return blank(agent, "no-usage", "No context size yet: the agent reports it after a turn, and some providers don't report it at all.");
  const hit = answers.get(agentId);
  if (!refresh && hit && hit.used === usage.used && Date.now() - hit.at <= hit.keepMs) return hit.value;
  const now = Date.now();
  for (const [id, entry] of answers) if (now - entry.at > FRESH_MS) answers.delete(id);
  const entry = { used: usage.used, at: now, keepMs: FRESH_MS, value: null as unknown as Promise<ContextView> };
  entry.value = compute(paseo, agent, usage.used, usage.max).then(
    (answer) => {
      failures.delete(agentId);
      if (answer.router.state === "error") entry.keepMs = FRESH_ROUTER_ERROR_MS;
      return answer;
    },
    (error: unknown) => {
      // Only this read's own entry: a Refresh that started meanwhile keeps its answer.
      if (answers.get(agentId) === entry) answers.delete(agentId);
      return failure(agentId, agent, error instanceof Error ? error.message : String(error));
    },
  );
  answers.set(agentId, entry);
  return entry.value;
}

/** Whether the composer chips should show; a local file read, no router call. */
export const handleBadge = async () => ({ enabled: (await readRoutingSettings()).contextBadge });

/** For tests: forget cached answers and back-offs, as a restarted plugin would. */
export function forgetContext(): void {
  answers.clear();
  failures.clear();
}
