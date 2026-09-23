// What is filling an agent's context window, from what Paseo already has.
//
// The total is exact: the agent's own CLI reports it after each turn and
// Paseo keeps it on the agent (`lastUsage`). The parts are estimates from
// the chat's timeline, about four characters per token, counted since the
// last compaction. "The rest" is the total minus those estimates: what never
// shows in the timeline (system prompt, tool definitions including every MCP
// server's tools, CLAUDE.md or AGENTS.md). With a read token, OmniRoute's size
// of the chat's first request measures that start instead. Only lengths are
// read, never kept.

export const CHARS_PER_TOKEN = 4;
export const estimateTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

export type ContextPartId = "base" | "unseen" | "files" | "shell" | "mcp" | "web" | "search" | "edits" | "subagents" | "tools" | "user" | "assistant";
type TimelinePartId = Exclude<ContextPartId, "base" | "unseen">;

export const CONTEXT_PART_LABELS: Record<ContextPartId, string> = {
  base: "System prompt, tools and instructions",
  unseen: "Not in the chat's history",
  files: "Files read",
  shell: "Command output",
  mcp: "MCP tool results",
  web: "Web pages and web searches",
  search: "Code searches",
  edits: "Edits and new files",
  subagents: "Sub-agent reports",
  tools: "Other tool calls",
  user: "Your messages",
  assistant: "Agent replies",
};

// -------------------------------------------------------------- the badge

/** 950, 4.2k, 186k, 1M, 1.2M. */
export function formatTokens(n: number): string {
  const trim = (value: number) => value.toFixed(1).replace(/\.0$/, "");
  if (n < 1_000) return String(Math.round(n));
  if (n < 10_000) return `${trim(n / 1_000)}k`;
  if (n < 999_500) return `${Math.round(n / 1_000)}k`;
  return `${trim(n / 1_000_000)}M`;
}

export const badgeLabel = (used: number, max: number) => `${formatTokens(used)} / ${formatTokens(max)}`;

export type ContextTone = "neutral" | "warning" | "danger";
/** Calm until 60 % full, amber until 85 %, red after: agents compact on their own a little later. */
export function contextTone(used: number, max: number): ContextTone {
  const share = max > 0 ? used / max : 0;
  return share >= 0.85 ? "danger" : share >= 0.6 ? "warning" : "neutral";
}

export type ContextUsage = { used: number; max: number };
/** The agent's last reported window, or null when it has not reported one (no turn yet, or a provider that does not say). */
export function usageOf(lastUsage: unknown): ContextUsage | null {
  const usage = lastUsage as { contextWindowUsedTokens?: unknown; contextWindowMaxTokens?: unknown } | null | undefined;
  const used = usage?.contextWindowUsedTokens;
  const max = usage?.contextWindowMaxTokens;
  return typeof used === "number" && typeof max === "number" && Number.isFinite(used) && Number.isFinite(max) && used > 0 && max > 0 ? { used, max } : null;
}

// ------------------------------------------------------------ the timeline

type Bucket = { chars: number; by: Map<string, number> };
export type ContextTally = {
  parts: Record<TimelinePartId, Bucket>;
  /** Timeline entries looked at. */
  items: number;
  /** The compaction the count stopped at (newest first), if any. */
  compaction: { at: string | null; preTokens: number | null } | null;
  /** Stopped at the page limit before the start of the chat or a compaction. */
  capped: boolean;
  /** Characters of the oldest user message counted: the chat's first message once the count reaches the start. */
  oldestUserChars: number;
};

export function createTally(): ContextTally {
  const bucket = (): Bucket => ({ chars: 0, by: new Map() });
  return {
    parts: { files: bucket(), shell: bucket(), mcp: bucket(), web: bucket(), search: bucket(), edits: bucket(), subagents: bucket(), tools: bucket(), user: bucket(), assistant: bucket() },
    items: 0,
    compaction: null,
    capped: false,
    oldestUserChars: 0,
  };
}

const len = (value: unknown): number => {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
};

/** A path relative to the agent's folder when it is inside it; otherwise the last two segments. */
export function shortPath(path: string, cwd: string | null): string {
  if (cwd && path.startsWith(`${cwd.replace(/\/+$/, "")}/`)) return path.slice(cwd.replace(/\/+$/, "").length + 1);
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}

/**
 * A shell call is named by its program only (`npm`, `curl`), never by its
 * arguments: a command line can carry a key or a prompt. Leading `VAR=value`
 * pairs and `sudo`, `env`, `time` are skipped; anything that is not a plain
 * program name reads as null.
 */
export function programOf(command: string): string | null {
  const words = command.trim().split(/\s+/);
  let index = 0;
  while (index < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]) || ["sudo", "env", "time", "exec", "nohup"].includes(words[index]))) index += 1;
  const word = (words[index] ?? "").split("/").pop() ?? "";
  return /^[A-Za-z0-9._+-]{1,32}$/.test(word) ? word : null;
}

/** A plain label (a tool or agent type), or null when it looks like free text. */
const plainName = (value: string) => (/^[A-Za-z0-9._:+-]{1,40}$/.test(value) ? value : null);

function add(tally: ContextTally, part: TimelinePartId, chars: number, name: string | null): void {
  if (chars <= 0) return;
  const bucket = tally.parts[part];
  bucket.chars += chars;
  if (name) bucket.by.set(name, (bucket.by.get(name) ?? 0) + chars);
}

type Detail = { type?: unknown; [key: string]: unknown };

/**
 * `mcp__<server>__<tool>` is Claude Code's name for an MCP tool; the server
 * part can hold `__` itself ("IKIT: Attio" becomes `IKIT__Attio`), tool names
 * do not, so the server is everything up to the last `__`.
 */
export function mcpServerOf(toolName: string): string | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice(5);
  const cut = rest.lastIndexOf("__");
  return cut > 0 ? rest.slice(0, cut).replace(/__/g, ": ") : null;
}

/** One tool call: which part it fills and under what name. */
function addToolCall(tally: ContextTally, name: string, detail: Detail, cwd: string | null): void {
  const server = mcpServerOf(name);
  if (server) return add(tally, "mcp", len(detail), server);
  const d = detail as Record<string, unknown>;
  const str = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "");
  switch (detail.type) {
    case "read":
      return add(tally, "files", len(d.content) + str("filePath").length, str("filePath") ? shortPath(str("filePath"), cwd) : null);
    case "shell":
      return add(tally, "shell", len(d.output) + str("command").length, programOf(str("command")));
    case "edit":
      return add(tally, "edits", len(d.oldString) + len(d.newString) + (d.oldString || d.newString ? 0 : len(d.unifiedDiff)), str("filePath") ? shortPath(str("filePath"), cwd) : null);
    case "write":
      return add(tally, "edits", len(d.content), str("filePath") ? shortPath(str("filePath"), cwd) : null);
    // Searches are named by tool, never by their query; fetches by host only; sub-agents by their type.
    case "search": {
      const chars = len(d.content) + len(d.filePaths) + len(d.webResults) + len(d.annotations) + str("query").length;
      const web = d.toolName === "web_search";
      return add(tally, web ? "web" : "search", chars, web ? "web search" : plainName(str("toolName")) ?? "search");
    }
    case "fetch": {
      let host: string | null = null;
      try {
        host = str("url") ? new URL(str("url")).host || null : null;
      } catch {
        host = null;
      }
      return add(tally, "web", len(d.result) + str("prompt").length, host);
    }
    case "sub_agent":
      return add(tally, "subagents", len(d.log) + len(d.actions), plainName(str("subAgentType")));
    // Paseo's own worktree setup never reaches the model.
    case "worktree_setup":
      return;
    case "plain_text":
      return add(tally, "tools", len(d.text) + str("label").length, plainName(name));
    case "plan":
      return add(tally, "tools", len(d.text), plainName(name));
    default:
      return add(tally, "tools", len(d.input) + len(d.output), plainName(name));
  }
}

/**
 * Count one timeline entry. Pages are read newest first, so a finished
 * compaction ends the count: what came before it was summarised away.
 * Returns false once the count is complete.
 */
export function tallyEntry(tally: ContextTally, entry: { item?: unknown; timestamp?: unknown }, cwd: string | null): boolean {
  const item = (entry?.item ?? null) as { type?: unknown; [key: string]: unknown } | null;
  if (!item || typeof item.type !== "string") return true;
  tally.items += 1;
  switch (item.type) {
    case "user_message":
      add(tally, "user", len(item.text), null);
      tally.oldestUserChars = len(item.text);
      return true;
    case "assistant_message":
      add(tally, "assistant", len(item.text), null);
      return true;
    case "tool_call":
      addToolCall(tally, typeof item.name === "string" ? item.name : "tool", (item.detail ?? {}) as Detail, cwd);
      return true;
    case "todo":
      add(tally, "tools", len(item.items), "Task list");
      return true;
    case "compaction":
      if (item.status !== "completed") return true;
      tally.compaction = { at: typeof entry.timestamp === "string" ? entry.timestamp : null, preTokens: typeof item.preTokens === "number" ? item.preTokens : null };
      return false;
    // Thinking, errors, notices and plugin items are Paseo's view of the chat, not what the model is sent again.
    default:
      return true;
  }
}

// ------------------------------------------------------------ the breakdown

export type ContextPart = {
  id: ContextPartId;
  label: string;
  tokens: number;
  /** Of the reported total, 0 to 1. */
  share: number;
  /** "estimate" from the timeline; "rest" is the reported total minus the estimates; "measured" is OmniRoute's size of the chat's first request. */
  kind: "estimate" | "rest" | "measured";
  /** The biggest few inside it: files, commands, MCP servers, sites. */
  top: Array<{ name: string; tokens: number }>;
  /** One line on what the part holds, where the label alone could mislead. */
  note: string | null;
};

export type ContextBreakdown = { parts: ContextPart[]; hint: string | null; urgent: string | null; estimated: number; overshoot: boolean };

const HINTS: Record<ContextPartId, (top: string | null, codex: boolean) => string> = {
  base: (_top, codex) =>
    `Most of it is loaded before the chat starts: turn off MCP servers this chat doesn't use, and keep ${codex ? "AGENTS.md" : "CLAUDE.md and memory files"} short.`,
  unseen: () => "Much of it isn't in the chat's own history (images, attachments, long tool output): compact the chat (/compact).",
  files: () => "Whole-file reads stay in context: ask for just the lines you need, or compact the chat (/compact) after a big read.",
  shell: () => "Long command output stays in context: have the agent pipe it through tail or grep, or compact the chat (/compact).",
  mcp: (top) => `MCP results${top ? ` from ${top}` : ""} are the biggest part: compact the chat (/compact), and turn that server off for this chat once you're done with it.`,
  web: () => "Fetched pages are large: compact the chat (/compact) once the agent has what it needs.",
  search: () => "Search results add up: ask for narrower searches, or compact the chat (/compact).",
  edits: () => "Big edits and new files stay in context as written: compact the chat (/compact) after a large change.",
  subagents: () => "Sub-agent reports add up: ask sub-agents for short summaries, or compact the chat (/compact).",
  tools: () => "Tool results add up: compact the chat (/compact).",
  user: () => "Your own messages are the biggest part: attach long text as a file instead of pasting it, or start a fresh chat for the next task.",
  assistant: () => "It's mostly the conversation itself: compact the chat (/compact), or start a fresh chat for the next task.",
};

/**
 * The parts, biggest first, with "the rest" worked out from the exact total.
 * With OmniRoute's size of the chat's first request (`measuredBase`, only
 * while no compaction has replaced the start), the starting cost is that
 * measurement and whatever is still unexplained gets its own line instead of
 * hiding in it. A part under 1 % and under 1k tokens is left out.
 */
export function buildBreakdown(input: { used: number; max: number; tally: ContextTally; codex?: boolean; measuredBase?: number | null }): ContextBreakdown {
  const { used, max, tally } = input;
  const share = (tokens: number) => (used > 0 ? tokens / used : 0);
  const timeline: ContextPart[] = (Object.keys(tally.parts) as TimelinePartId[]).map((id) => {
    const bucket = tally.parts[id];
    const top = [...bucket.by].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, chars]) => ({ name, tokens: estimateTokens(chars) }));
    const tokens = estimateTokens(bucket.chars);
    return { id, label: CONTEXT_PART_LABELS[id], tokens, share: share(tokens), kind: "estimate" as const, top, note: null };
  });
  const estimated = timeline.reduce((sum, part) => sum + part.tokens, 0);
  const restTokens = Math.max(0, used - estimated);
  // The first request also carried the first message, which "Your messages" already counts: take it out once.
  // Only when the count reached the start of the chat: no compaction replaced it, no page limit cut it short.
  const measurable = !tally.compaction && !tally.capped && typeof input.measuredBase === "number" && input.measuredBase > 0;
  const measured = measurable ? Math.min(Math.max(0, (input.measuredBase as number) - estimateTokens(tally.oldestUserChars)), restTokens) : null;
  const start: ContextPart[] = measured !== null
    ? [
        { id: "base", label: CONTEXT_PART_LABELS.base, tokens: measured, share: share(measured), kind: "measured", top: [], note: "Measured by OmniRoute: the chat's first request, less its first message (counted under your messages)." },
        { id: "unseen", label: CONTEXT_PART_LABELS.unseen, tokens: restTokens - measured, share: share(restTokens - measured), kind: "rest", top: [], note: "The total minus every other line: images, attachments, and tool output Paseo keeps shorter than the agent saw." },
      ]
    : [
        tally.compaction
          ? { id: "base", label: "System prompt, tools, instructions and the compaction summary", tokens: restTokens, share: share(restTokens), kind: "rest", top: [], note: "Since the last compaction, the chat also carries a summary of what came before." }
          : { id: "base", label: CONTEXT_PART_LABELS.base, tokens: restTokens, share: share(restTokens), kind: "rest", top: [], note: null },
      ];
  const parts = [...start, ...timeline]
    .filter((part) => part.tokens > 0 && (part.share >= 0.01 || part.tokens >= 1_000))
    .sort((a, b) => b.tokens - a.tokens);
  const first = parts[0];
  const full = max > 0 ? used / max : 0;
  return {
    parts,
    hint: first ? HINTS[first.id](first.top[0]?.name ?? null, input.codex === true) : null,
    urgent: full >= 0.85 ? "Nearly full: compact the chat now (/compact), or start a fresh one for the next task." : null,
    estimated,
    overshoot: estimated > used,
  };
}

// ------------------------------------------------------------- router alerts

export type ChatAlert = { agentId: string; text: string; detail: string };
type SessionLike = { agentId: string; kind: "claude" | "provider" | "codex"; routed: boolean };

/**
 * Which routed chats a router problem reaches, from the hook's session log
 * (each chat's latest open). Down reaches every routed chat. A paused provider
 * reaches Claude chats (claude) and Codex via OmniRoute chats (codex); an AI
 * Router chat can use either, so it is told "if".
 */
export function chatAlerts(input: { down: string | null; paused: readonly string[]; sessions: readonly SessionLike[]; label: (provider: string) => string }): ChatAlert[] {
  const { down, paused, label } = input;
  if (!down && !paused.length) return [];
  const latest = new Map<string, SessionLike>();
  for (const session of input.sessions) latest.set(session.agentId, session);
  const reopen: Record<SessionLike["kind"], string> = {
    claude: "Reopened, it uses its own sign-in until the router is back.",
    provider: "An AI Router chat can't reopen until the router is back.",
    codex: "Codex via OmniRoute can't reopen until the router is back.",
  };
  const alerts: ChatAlert[] = [];
  for (const session of latest.values()) {
    if (!session.routed) continue;
    if (down) {
      alerts.push({ agentId: session.agentId, text: "Router down", detail: `OmniRoute isn't answering (${down}). This chat's requests go through it, so they fail until it's back. ${reopen[session.kind]}` });
      continue;
    }
    const own = session.kind === "claude" ? "claude" : session.kind === "codex" ? "codex" : null;
    if (own && paused.includes(own)) {
      alerts.push({ agentId: session.agentId, text: `${label(own)} paused`, detail: `OmniRoute has paused ${label(own)} after repeated failures. This chat's requests fail until OmniRoute retries it, unless its combos or fallbacks send them elsewhere.` });
    } else if (session.kind === "provider") {
      const names = paused.map(label).join(" and ");
      alerts.push({ agentId: session.agentId, text: `${names} paused`, detail: `OmniRoute has paused ${names} after repeated failures. If this chat's model runs there, its requests fail until OmniRoute retries it, unless its combos or fallbacks send them elsewhere.` });
    }
  }
  return alerts;
}
