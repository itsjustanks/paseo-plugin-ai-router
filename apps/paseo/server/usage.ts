import { createHash } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import type { Accounts } from "../shared/contracts";
import { accessTier, connectionProblem, type Connection } from "../shared/logic";
import { healthLine, quotaName, quotaShortLabel, type Account } from "../shared/routers/omniroute/parsers";
import { ROUTERS } from "../shared/routers/copy";
import { whenWords } from "../shared/when";
import { routedRuntime, sessionAccounts, sessionTagFromEnv, usageScope, type UsageScope } from "../shared/usage-scope";
import { routedModels } from "./provider";
import { adapterFor } from "./routers";
import { readConnection } from "./store";

// ------------------------------------------------------- Paseo's usage API
//
// Paseo 0.11 daemons let a plugin add cards to their Usage page with
// `registerUsageSource`. The types and helpers below copy
// @getpaseo/plugin 0.11.0-beta.5 (dist/server/usage.d.ts and usage.js) rather
// than import them: daemons before 0.11 refuse to compile a plugin that names
// `@getpaseo/plugin/server/usage` at all, even in a type import, and the 0.8
// SDK this plugin builds against does not declare them. beta.5 adds the
// `scope` argument to discover and `harness` on accounts; earlier betas call
// discover() with nothing and ignore `harness`.

export type UsageTone = "default" | "ok" | "warning" | "danger";
export interface UsageWindow {
  id: string;
  label: string;
  shortLabel?: string;
  summary?: boolean;
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
  runsOutAt?: string | null;
  shortfallPct?: number | null;
  tone?: UsageTone;
}
export interface UsageDetail {
  id: string;
  label: string;
  value: string;
  tone?: UsageTone;
}
export type UsageProblem = { kind: "expired"; expiresAt: string; refreshedBy?: string } | { kind: "rejected"; status: number; refreshedBy?: string } | { kind: "no_quota"; detail: string };
export type UsageReport =
  | { status: "available"; planLabel?: string; windows: UsageWindow[]; details?: UsageDetail[] }
  | { status: "unavailable"; problem: UsageProblem }
  | { status: "error"; error: string };
export interface UsageAccount {
  /** Stable, [A-Za-z0-9._-]{1,128}, never a credential or a raw email. */
  key: string;
  label?: string;
  /** Harness owning this login, e.g. Codex, OpenCode, Pi or OMP. */
  harness?: string;
  input: UsageInput;
}
export interface UsageSourceRegistration {
  id: string;
  label: string;
  /** Plugin-directory-relative path to a self-contained SVG. */
  icon?: string;
  input: z.ZodType;
  /** Accounts for this scope only. The same key in any scope identifies the same account. */
  discover(scope?: UsageScope): Promise<UsageAccount[]>;
  fetch(input: unknown): Promise<UsageReport>;
}

export function toneFromUsedPct(usedPct: number | null | undefined): UsageTone {
  if (typeof usedPct !== "number") return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "ok";
}

export function windowFromUsedPct(input: { id: string; label: string; shortLabel?: string; summary?: boolean; utilizationPct: number | null | undefined; resetsAt?: string | null; tone?: UsageTone }): UsageWindow {
  const usedPct = typeof input.utilizationPct === "number" ? input.utilizationPct : null;
  const window: UsageWindow = { id: input.id, label: input.label, usedPct, remainingPct: usedPct === null ? null : Math.max(0, 100 - usedPct), resetsAt: input.resetsAt ?? null };
  if (input.shortLabel !== undefined) window.shortLabel = input.shortLabel;
  if (input.summary) window.summary = true;
  if (input.tone) window.tone = input.tone;
  return window;
}

export const hashAccountKey = (value: string) => createHash("sha256").update(value).digest("hex");
export const unavailable = (problem: UsageProblem): UsageReport => ({ status: "unavailable", problem });

// ------------------------------------------------------------- the source

export const USAGE_SOURCE_ID = "ai-router";
/** `account`: the router's id for one account. Null: the one card that says why there are no account cards. */
const UsageInputSchema = z.object({ account: z.string().min(1).max(200).nullable() });
type UsageInput = z.infer<typeof UsageInputSchema>;
/** The card shown instead of account cards: a key-only connection, or a router that has not answered yet. */
const routerCard = (router: string): UsageAccount => ({ key: "router", label: router, harness: HARNESS, input: { account: null } });
/** Who holds these logins: OmniRoute, not this daemon. */
const HARNESS = "OmniRoute";

/** "Add a read token" for a key-only connection: the plain key cannot see the router's accounts. */
export const READ_TOKEN_NEEDED = "Add a read-only access token in AI Router → Help → \"How do I see accounts and usage?\" to see each of the router's accounts and how much of its limits is left.";
/** The one card before setup (0.20.0): what to do, instead of an empty Usage page. */
// No harness: Paseo would print "OmniRoute:" before the hint, and nothing is signed in yet.
const setupCard: UsageAccount = { key: "setup", label: "Not set up", input: { account: null } };
export const SETUP_NEEDED = "Set up AI Router to see your team's AI accounts here: open AI Router in the sidebar and connect your router. It takes about two minutes.";

const iso = (value: string | null | undefined): string | null => {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
/** The daemon cannot know the viewer's zone, so always include the UTC date. */
const utcTime = (ms: number, now: number) => whenWords(ms, now, { timeZone: "UTC", sayZone: true });
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;

/** Stable per router account: the same account keeps its card (and any pinned limit) across restarts and key changes. */
export const accountKey = (connection: Pick<Connection, "router">, accountId: string) => hashAccountKey(`${connection.router}:${accountId}`);

/** Window ids: "session (5h)" → "session-5h", "Weekly limit" → "weekly-limit"; unique within the card. */
function windowIds(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "quota";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

function signInKind(authType: string | null): string | null {
  if (authType === "oauth") return "Subscription";
  if (authType && /^api[-_ ]?key$/i.test(authType)) return "API key";
  return null;
}

/**
 * One router account as a Usage-page card: each quota as a window (used and
 * left, reset time, tone), and a few plain details. An account that cannot
 * be used says why instead.
 *
 * Paseo's card header shows the source's label ("AI Router") and the
 * report's `planLabel`; the account's own label only appears small in the
 * footer (and in pinned limits). So `planLabel` carries the account's name,
 * "Claude #1" (numbered by OmniRoute priority), and the header reads
 * "AI Router · Claude #1". How it signs in becomes a detail line.
 */
export function accountReport(account: Account, context: { router: string; paused: boolean; stale: { reason: string; checkedAt: string | null } | null; now?: number }): UsageReport {
  const { router } = context;
  const now = context.now ?? Date.now();
  if (account.state === "disabled") return unavailable({ kind: "no_quota", detail: `Turned off in ${router}, so the router does not use it.` });
  const expiredAt = account.expiry?.status === "expired" ? iso(account.expiry.expiresAt) : null;
  if (expiredAt) return unavailable({ kind: "expired", expiresAt: expiredAt });
  if (account.problem === "re-login required" || account.expiry?.status === "expired") return unavailable({ kind: "no_quota", detail: `Its sign-in has expired. Sign in to it again on ${router}'s dashboard.` });
  if (account.problem?.startsWith("banned")) return unavailable({ kind: "no_quota", detail: sentence(account.problem) });

  const labels = account.quotas.map((quota) => quotaName(quota.name, quota));
  // A weekly-only Codex plan keeps the same id from provider-limits and the pool fallback.
  // Other ids stay unchanged so existing pinned limits keep working.
  const weeklyOnly = account.provider === "codex" && labels.length === 1 && labels[0] === "Weekly limit";
  const ids = windowIds(account.quotas.map((quota, index) => weeklyOnly ? labels[index] : quota.name));
  const windows = account.quotas.map((quota, index) => {
    const used = Math.max(0, Math.min(100, 100 - quota.remainingPct));
    return windowFromUsedPct({ id: ids[index], label: labels[index], shortLabel: quotaShortLabel(quota.name, quota) ?? undefined, summary: weeklyOnly || undefined, utilizationPct: used, resetsAt: iso(quota.resetAt), tone: toneFromUsedPct(used) });
  });
  const status: UsageDetail | null = context.paused
    ? { id: "status", label: "Status", value: `Paused for a moment by ${router} after errors; it tries again by itself`, tone: "danger" }
    : account.problem
      ? { id: "status", label: "Status", value: sentence(account.problem), tone: "warning" }
      : account.coolingUntil
        ? { id: "status", label: "Status", value: `Cooling down until ${utcTime(account.coolingUntil, now)}`, tone: "warning" }
        : null;
  if (!windows.length) return unavailable({ kind: "no_quota", detail: status ? sentence(status.value) : `${router} has not reported this account's limits yet.` });

  const details: UsageDetail[] = [];
  if (account.label) details.push({ id: "account", label: "Account", value: account.label });
  const kind = signInKind(account.authType);
  if (kind) details.push({ id: "plan", label: "Signs in with", value: kind });
  if (status) details.push(status);
  if (account.expiry?.status === "expiring_soon") details.push({ id: "sign-in", label: "Sign-in", value: iso(account.expiry.expiresAt) ? `Expires ${utcTime(Date.parse(account.expiry.expiresAt!), now)}` : "Expires soon", tone: "warning" });
  if (account.health) details.push({ id: "health", label: "Last 24 hours", value: healthLine(account.health), tone: account.health.state === "healthy" ? "default" : "warning" });
  if (context.stale) {
    const at = iso(context.stale.checkedAt);
    details.push({ id: "stale", label: "Last read", value: `${at ? utcTime(Date.parse(at), now) : "Earlier"}: ${router} is not answering now (${context.stale.reason})`, tone: "warning" });
  }
  return { status: "available", planLabel: account.shortName, windows, details };
}

// ----------------------------------------------------------- the reads
//
// The Usage page calls discover, then fetch once per card, and Paseo keeps
// each card for five minutes: there is no polling here. The cards share one
// accounts read (the same one the Accounts tab uses, with its last-good
// fallback while the router is down). After a failed read the next one waits
// 30 s, then 1, 2, 4 … up to 15 minutes, answering from memory meanwhile.

const FRESH_MS = 30_000;
const RETRY_FIRST_MS = 30_000;
const RETRY_CAP_MS = 15 * 60_000;
let read: { key: string; until: number; failures: number; value: Promise<Accounts> } | null = null;

function failedRead(message: string): Accounts {
  return { state: "error", message, checkedAt: new Date().toISOString(), notes: [], stale: null, accounts: [], router: null, canAct: false };
}

function accountsForUsage(connection: Connection): Promise<Accounts> {
  const key = `${connection.router}\n${connection.endpoint}\n${connection.token ?? connection.manageKey ?? ""}`;
  const now = Date.now();
  if (read && read.key === key && now < read.until) return read.value;
  const failures = read?.key === key ? read.failures : 0;
  const value = adapterFor(connection.router)
    .accounts(connection, false)
    .catch((error: unknown) => failedRead(`Accounts: ${error instanceof Error ? error.message : String(error)}`));
  const entry = { key, until: now + FRESH_MS, failures, value };
  read = entry;
  void value.then((answer) => {
    if (read !== entry) return;
    const ok = answer.state === "ok" && !answer.stale;
    entry.failures = ok ? 0 : failures + 1;
    entry.until = Date.now() + (ok ? FRESH_MS : Math.min(RETRY_CAP_MS, RETRY_FIRST_MS * 2 ** (entry.failures - 1)));
  });
  return value;
}

/**
 * The cards for a scope. Global (the Usage page, and every call from Paseo
 * before 0.11.0-beta.5): every router account, or one "set up" card before
 * a router is connected. A session (one chat's
 * context-window hover card): the accounts that chat's model runs on, or none
 * when the chat doesn't go through this router. Both reuse the one cached
 * accounts read and what the model sync already knows; a hover never adds a
 * request to the router of its own.
 */
export async function discoverUsage(scope?: unknown): Promise<UsageAccount[]> {
  const where = usageScope(scope);
  const resolved = await readConnection();
  // Not set up: one card on the Usage page that says how; nothing on a chat's hover card.
  if (connectionProblem(resolved)) return where.kind === "session" ? [] : [setupCard];
  const { connection } = resolved;
  const runtime = where.kind === "session" ? routedRuntime(where, connection.endpoint) : null;
  if (where.kind === "session" && !runtime) return [];
  const card = routerCard(ROUTERS[connection.router].label);
  if (accessTier(connection) === "basic") return [card];
  const answer = await accountsForUsage(connection);
  if (!answer.accounts.length) return answer.state === "ok" ? [] : [card];
  const accounts =
    where.kind === "session" && runtime
      ? sessionAccounts({ model: where.model, runtime, accounts: answer.accounts, models: routedModels(), serving: servingAccount(connection, where.env) })
      : answer.accounts;
  return accounts.map((account) => ({ key: accountKey(connection, account.id), label: account.shortName, harness: HARNESS, input: { account: account.id } }));
}

/** The account OmniRoute's call log says served this chat, from reads already in memory. */
function servingAccount(connection: Connection, env: Record<string, string>): string | null {
  const tag = sessionTagFromEnv(env);
  return tag ? adapterFor(connection.router).servingAccount(connection, tag) : null;
}

export async function fetchUsage(input: UsageInput): Promise<UsageReport> {
  const resolved = await readConnection();
  const problem = connectionProblem(resolved);
  if (problem) return input.account === null ? unavailable({ kind: "no_quota", detail: SETUP_NEEDED }) : { status: "error", error: `AI Router is not connected to a router: ${problem}.` };
  const { connection } = resolved;
  if (accessTier(connection) === "basic") return unavailable({ kind: "no_quota", detail: READ_TOKEN_NEEDED });
  const answer = await accountsForUsage(connection);
  const router = ROUTERS[connection.router].label;
  const failure = answer.message ?? `${router} did not answer.`;
  if (input.account === null) return answer.state === "ok" ? unavailable({ kind: "no_quota", detail: `${router} has no connected accounts.` }) : { status: "error", error: failure };
  const account = answer.accounts.find((entry) => entry.id === input.account);
  if (!account) return answer.state === "ok" ? { status: "error", error: `This account is no longer on ${router}.` } : { status: "error", error: failure };
  const paused = answer.router?.paused.some((entry) => entry.provider === account.provider) ?? false;
  return accountReport(account, { router, paused, stale: answer.stale ? { reason: answer.stale.reason, checkedAt: answer.checkedAt } : null });
}

// ----------------------------------------------------------- registration

let registered = false;
/** Whether this daemon put the router's accounts on Paseo's Usage page; the Accounts tab says so. */
export const usageSourceRegistered = () => registered;

type UsageHost = { registerUsageSource?: unknown };

/**
 * Paseo 0.11 and later: one Usage-page card per router account. Older daemons
 * have no `registerUsageSource`, and nothing changes for them. Never throws:
 * a refusal from the daemon leaves the rest of the plugin working.
 */
export function registerUsage(server: PluginServerContext): boolean {
  const register = (server as PluginServerContext & UsageHost).registerUsageSource;
  if (typeof register !== "function") return false;
  const source: UsageSourceRegistration = {
    id: USAGE_SOURCE_ID,
    label: "AI Router",
    icon: "assets/ai-router.svg",
    input: UsageInputSchema,
    discover: (scope) => discoverUsage(scope),
    fetch: (input) => fetchUsage(UsageInputSchema.parse(input)),
  };
  try {
    register.call(server, source);
    registered = true;
  } catch (error) {
    console.warn(`[ai-router] Paseo's Usage page refused the AI Router source: ${error instanceof Error ? error.message : String(error)}`);
  }
  return registered;
}
