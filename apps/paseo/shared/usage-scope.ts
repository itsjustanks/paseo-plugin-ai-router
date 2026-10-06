/**
 * Which router accounts one Paseo chat runs on, for the context-window hover
 * card (Paseo 0.11.0-beta.5: a usage source's `discover(scope)`). Pure: the
 * accounts, the model list and any known serving account come in as data.
 *
 * Paseo hands over the chat's runtime, not its menu entry: an AI Router chat
 * arrives as provider "claude" and Codex via OmniRoute as "codex", each with
 * the environment it launched with. So a chat counts as routed when that
 * environment points at this router (or carries our Codex key variable), or
 * when a later Paseo passes our own provider id.
 */
import { AI_ROUTER_PROVIDER_ID, CODEX_KEY_ENV, CODEX_PROVIDER_ID, CODEX_ROUTER_PROVIDER_ID, SESSION_HEADER, normaliseEndpoint } from "./logic";
import type { ComboMembers } from "./routers/omniroute/parsers";

export type UsageScope = { kind: "global" } | { kind: "session"; provider: string; model?: string; env: Record<string, string> };

/** beta.3 and beta.4 call `discover()` with nothing: that is the Usage page, so global. Anything unreadable is global too. */
export function usageScope(scope: unknown): UsageScope {
  const value = (scope ?? {}) as { kind?: unknown; provider?: unknown; model?: unknown; env?: unknown };
  if (value.kind !== "session" || typeof value.provider !== "string") return { kind: "global" };
  const env: Record<string, string> = {};
  if (value.env && typeof value.env === "object" && !Array.isArray(value.env)) {
    for (const [name, text] of Object.entries(value.env as Record<string, unknown>)) if (typeof text === "string") env[name] = text;
  }
  return { kind: "session", provider: value.provider, ...(typeof value.model === "string" && value.model ? { model: value.model } : {}), env };
}

/** "claude" (Claude Code on OmniRoute's Anthropic API) or "codex" (Codex on its /v1), or null when the chat doesn't go through this router. */
export function routedRuntime(scope: Extract<UsageScope, { kind: "session" }>, endpoint: string | null): "claude" | "codex" | null {
  if (scope.provider === AI_ROUTER_PROVIDER_ID) return "claude";
  if (scope.provider === CODEX_ROUTER_PROVIDER_ID || scope.provider === CODEX_PROVIDER_ID) return "codex";
  if (!endpoint) return null;
  const at = (name: string) => (scope.env[name] ? normaliseEndpoint(scope.env[name]) === endpoint : false);
  if (at("ANTHROPIC_BASE_URL")) return "claude";
  if (at("OPENAI_BASE_URL") || !!scope.env[CODEX_KEY_ENV]) return "codex";
  return null;
}

/** The tag the session_open hook put in ANTHROPIC_CUSTOM_HEADERS; Codex chats carry none. */
export function sessionTagFromEnv(env: Record<string, string>): string | null {
  for (const line of (env.ANTHROPIC_CUSTOM_HEADERS ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0 && line.slice(0, at).trim().toLowerCase() === SESSION_HEADER) return line.slice(at + 1).trim() || null;
  }
  return null;
}

/** OmniRoute's model prefixes and the provider whose accounts serve them. */
const PREFIX_OWNERS: Record<string, string> = { cc: "claude", claude: "claude", anthropic: "claude", cx: "codex", codex: "codex", kmc: "kimi-coding", kimi: "kimi-coding" };
/** A bare model id, as built-in Claude or Codex names it. */
const FAMILY_OWNERS: Array<[RegExp, string]> = [
  [/^(claude|opus|sonnet|haiku|fable)/, "claude"],
  [/^(gpt|o\d|codex)/, "codex"],
  [/^kimi/, "kimi-coding"],
];

/** "kimi-coding" and "kimi" are one family of accounts; so are "claude" and "claude-code". */
const family = (provider: string) => provider.toLowerCase().split(/[-_\s]/)[0];

/** What the sync last learned from OmniRoute: each model's provider (combos are "combo") and each custom combo's members. */
export type RoutedModels = { owners: Record<string, string>; combos: Record<string, ComboMembers> };

type Target = { kind: "providers"; providers: string[]; connections: string[] } | { kind: "any" } | { kind: "unknown" };

function ownerOf(model: string, models: RoutedModels | null): string | "combo" | null {
  const known = models?.owners[model];
  if (known) return known;
  const slash = model.indexOf("/");
  if (slash > 0) {
    const prefix = model.slice(0, slash).toLowerCase();
    if (prefix === "auto") return "combo";
    return PREFIX_OWNERS[prefix] ?? prefix;
  }
  if (model === "auto") return "combo";
  return FAMILY_OWNERS.find(([pattern]) => pattern.test(model.toLowerCase()))?.[1] ?? null;
}

/** A combo's providers and pinned accounts, following combo references; "any" when its members aren't known (auto combos). */
function comboTarget(name: string, models: RoutedModels | null, seen: Set<string>): Target {
  const members = models?.combos[name];
  if (!members) return { kind: "any" };
  seen.add(name);
  const providers = new Set(members.providers);
  const connections = new Set(members.connections);
  for (const model of members.models) {
    const owner = ownerOf(model, models);
    if (owner === "combo") {
      if (seen.has(model)) continue;
      const inner = comboTarget(model, models, seen);
      if (inner.kind !== "providers") return inner;
      inner.providers.forEach((p) => providers.add(p));
      inner.connections.forEach((c) => connections.add(c));
    } else if (owner) providers.add(owner);
  }
  for (const ref of members.refs) {
    if (seen.has(ref)) continue;
    const inner = comboTarget(ref, models, seen);
    if (inner.kind !== "providers") return inner;
    inner.providers.forEach((p) => providers.add(p));
    inner.connections.forEach((c) => connections.add(c));
  }
  // Steps it couldn't read: it may use anything.
  if (!providers.size && !connections.size) return { kind: "any" };
  return { kind: "providers", providers: [...providers], connections: [...connections] };
}

function targetFor(model: string | undefined, runtime: "claude" | "codex", models: RoutedModels | null): Target {
  // No model named: the runtime's own default, Claude or Codex.
  const id = model?.replace(/\[[^\]]*\]$/, "").trim();
  if (!id) return { kind: "providers", providers: [runtime], connections: [] };
  const owner = ownerOf(id, models);
  if (owner === "combo") return comboTarget(id, models, new Set());
  if (owner) return { kind: "providers", providers: [owner], connections: [] };
  // A bare name the model list doesn't know is most likely a custom combo the sync hasn't seen yet.
  return id.includes("/") ? { kind: "unknown" } : { kind: "any" };
}

type AccountLike = { id: string; provider: string; state: string };

/**
 * The router accounts that can serve this chat, in the router's order:
 * - cc/ and Claude models → the Claude accounts; cx/ and GPT models → Codex;
 *   kmc/ → Kimi; any other prefix → that provider's accounts;
 * - a combo → its members' accounts (an auto combo, or one not read yet: all);
 * - when a call-log read in memory names the account that served this chat,
 *   only that one, as long as it is one of the above.
 * Accounts turned off in the router are left out: they serve nothing.
 */
export function sessionAccounts<A extends AccountLike>(input: { model: string | undefined; runtime: "claude" | "codex"; accounts: readonly A[]; models: RoutedModels | null; serving: string | null }): A[] {
  const live = input.accounts.filter((account) => account.state !== "disabled");
  const target = targetFor(input.model, input.runtime, input.models);
  const pool =
    target.kind === "any"
      ? live
      : target.kind === "unknown"
        ? []
        : live.filter((account) => target.connections.includes(account.id) || target.providers.some((provider) => family(provider) === family(account.provider)));
  const serving = input.serving ? pool.find((account) => account.id === input.serving) : undefined;
  return serving ? [serving] : pool;
}
