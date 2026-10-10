// Router errors in a chat (0.19.0): which chat messages are OmniRoute's errors,
// and what to say about each in plain words. Pure, so the
// tests can check it against real error text without the app.
//
// Where they come from (Paseo 0.11.0-beta.5, read from its daemon code):
// - Claude Code reports a failed request as an assistant message that starts
//   "API Error: …". When it talks to a gateway (ANTHROPIC_BASE_URL), it ends
//   with "check your inference gateway (<host:port>)".
// - Any provider's failed turn becomes an assistant message starting
//   "[System Error] …" (Codex via OmniRoute, for example).
// - A few providers emit an `error` timeline item instead.
// The router's own parts, from OmniRoute's source and real chats:
// "[claude/claude-fable-5-1] [429]: {…} (reset after 1m 9s)",
// "[codex/gpt-6-sol] Unavailable (reset after 13s)",
// "Provider claude circuit breaker is open",
// "No active credentials for provider: claude",
// "[claude] All accounts rate limited".

import { whenWords } from "./when";

export type RouterErrorKind = "paused" | "cooling" | "no-account" | "signed-out" | "outdated" | "unsupported" | "unavailable" | "router-down" | "other";

export type RouterError = {
  kind: RouterErrorKind;
  /** OmniRoute's provider id ("claude", "codex"), when the text names one. */
  provider: string | null;
  model: string | null;
  /** The upstream status inside OmniRoute's message, else the outer one. */
  status: number | null;
  /** "(reset after 1m 9s)" in seconds. */
  resetSeconds: number | null;
  /** "host:port" from Claude Code's "check your inference gateway (…)". */
  gateway: string | null;
};

/** Messages longer than this are a reply, not an error line. */
const MAX_LENGTH = 6000;
const SYSTEM_ERROR = "[System Error]";

const GATEWAY = /check your inference gateway \(([^()\s]+)\)/i;
const TAG = /\[([a-z0-9][a-z0-9_-]*)\/([^\]\s]+)\]/i;
const BREAKER = /Provider ([a-z0-9_-]+) circuit breaker is open/i;
const NO_CREDENTIALS = /No (?:active )?credentials for provider: ([a-z0-9_-]+)/i;
const ALL_LIMITED = /\[([a-z0-9_-]+)\] All accounts rate[ -]limited/i;
const RESET = /\(reset after ((?:\d+\s*[hms]\s*)+)\)/i;

/** "1m 9s" → 69; "2h 5m" → 7500. */
export function resetSecondsOf(text: string): number | null {
  const match = text.match(RESET);
  if (!match) return null;
  let seconds = 0;
  for (const part of match[1].matchAll(/(\d+)\s*([hms])/gi)) seconds += Number(part[1]) * (part[2].toLowerCase() === "h" ? 3600 : part[2].toLowerCase() === "m" ? 60 : 1);
  return seconds;
}

/**
 * The router error in one chat item, or null for anything else. Only an item
 * that is an error by its form (an `error` item, or an assistant message that
 * starts "API Error" or "[System Error]") and carries one of OmniRoute's own
 * marks counts. A reply that merely mentions a circuit breaker is left alone.
 */
export function matchRouterError(text: string, source: "assistant" | "error"): RouterError | null {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw || raw.length > MAX_LENGTH) return null;
  if (source === "assistant" && !/^API Error\b/.test(raw) && !raw.startsWith(SYSTEM_ERROR)) return null;
  const body = raw.startsWith(SYSTEM_ERROR) ? raw.slice(SYSTEM_ERROR.length).trim() : raw;

  const gateway = body.match(GATEWAY)?.[1] ?? null;
  const tag = body.match(TAG);
  const breaker = body.match(BREAKER);
  const noCredentials = body.match(NO_CREDENTIALS);
  const allLimited = body.match(ALL_LIMITED);
  if (!gateway && !tag && !breaker && !noCredentials && !allLimited) return null;

  const provider = (breaker?.[1] ?? noCredentials?.[1] ?? allLimited?.[1] ?? tag?.[1] ?? null)?.toLowerCase() ?? null;
  const model = tag?.[2] ?? null;
  const inner = body.match(/\]\s*\[(\d{3})\]/)?.[1] ?? body.match(/Request rejected \((\d{3})\)/i)?.[1] ?? null;
  const outer = body.match(/^API Error:?\s*(\d{3})\b/)?.[1] ?? null;
  const status = inner ? Number(inner) : outer ? Number(outer) : null;
  const resetSeconds = resetSecondsOf(body);
  const kind: RouterErrorKind = breaker
    ? "paused"
    : noCredentials
      ? "no-account"
      : allLimited || status === 429 || /rate_limit_error|rate limit|usage limit has been reached|quota (?:is )?exhausted/i.test(body)
        ? "cooling"
        : status === 401 || status === 403 || /authentication_error|token_revoked|invalidated oauth|has been revoked|sign-?in expired/i.test(body)
          ? "signed-out"
          : /Claude Code version [\d.]+ or newer is required/i.test(body)
            ? "outdated"
            : /is not supported when using|model is not supported|model_not_found|does not exist/i.test(body)
            ? "unsupported"
            : /connection refused|ECONNREFUSED|can't reach the API server|EAI_AGAIN|ENOTFOUND/i.test(body)
              ? "router-down"
              : /timed out|timeout|ETIMEDOUT|\bUnavailable\b|overloaded/i.test(body) || status === 502 || status === 503 || status === 504
                ? "unavailable"
                : "other";
  return { kind, provider, model, status, resetSeconds, gateway };
}

/** "1m 9s", "2h 5m", "40s". */
export function waitWords(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : "", !h && s ? `${s}s` : ""].filter(Boolean).join(" ") || "0s";
}

export type RouterErrorWords = { title: string; retry: string; tone: "warning" | "danger"; icon: string };

/**
 * What happened, in one line, and whether anything retries by itself. `at` is
 * when the error happened (the timeline item's time), so "until 16:45" stays
 * true however late the chat is read. `label` turns a provider id into a name.
 */
export function routerErrorWords(error: RouterError, at: Date, label: (provider: string) => string, now: Date = new Date()): RouterErrorWords {
  const name = error.provider ? label(error.provider) : "This provider";
  const accounts = error.provider ? `${label(error.provider)} accounts` : "The router's accounts";
  const until = error.resetSeconds !== null ? new Date(at.getTime() + error.resetSeconds * 1000) : null;
  // The time is in the title; the retry line just says "then".
  const again = until ? "then" : "in a few minutes";
  switch (error.kind) {
    case "paused":
      return {
        title: `${name} is paused on the router after repeated errors`,
        retry: `OmniRoute tries ${name} again by itself after a short wait. This chat won't retry: send your message again once it's back.`,
        tone: "warning",
        icon: "CirclePause",
      };
    case "cooling":
      return {
        title: until ? `${accounts} are cooling down until ${whenWords(until.getTime(), now.getTime())}` : `${accounts} have hit their usage limit`,
        retry: `The router moves to another account by itself when one has room. This chat won't retry: send your message again ${again}, or pick another model.`,
        tone: "warning",
        icon: "Timer",
      };
    case "no-account":
      return {
        title: `No ${name} account is signed in on the router`,
        retry: `Nothing retries until someone adds a ${name} account in the router's dashboard. Pick another model meanwhile.`,
        tone: "danger",
        icon: "UserX",
      };
    case "signed-out":
      return {
        title: `A ${name} account's sign-in has run out on the router`,
        retry: `The router tries the other ${name} accounts by itself. Someone with the dashboard login needs to sign this one in again.`,
        tone: "danger",
        icon: "KeyRound",
      };
    case "outdated":
      return {
        title: "Anthropic asks for a newer Claude Code than the router sends",
        retry: "This won't fix itself: whoever runs the router updates its Claude Code version. Pick another model meanwhile.",
        tone: "warning",
        icon: "Ban",
      };
    case "unsupported":
      return {
        title: error.model ? `${error.model} can't be used through the router's ${name} account` : `This model can't be used through the router's ${name} account`,
        retry: "This won't fix itself: pick another model.",
        tone: "warning",
        icon: "Ban",
      };
    case "router-down":
      return {
        title: "The router isn't answering",
        retry: "Routed chats can't answer until it's back. Send your message again once AI Router says it's working.",
        tone: "danger",
        icon: "CircleAlert",
      };
    case "unavailable":
      return {
        title: error.provider ? `${name} didn't answer through the router` : "The router didn't get an answer in time",
        retry: until ? `Usually brief. This chat won't retry: send your message again in ${waitWords(error.resetSeconds ?? 0)}.` : "Usually brief. This chat won't retry: send your message again in a moment.",
        tone: "warning",
        icon: "CloudOff",
      };
    default:
      return {
        title: "The router returned an error",
        retry: "Send your message again. If it keeps happening, open AI Router to see what's wrong.",
        tone: "warning",
        icon: "TriangleAlert",
      };
  }
}

/** "10.0.0.9:20128" for an endpoint URL, so a chat's gateway can be compared with this router. */
export function endpointHost(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether to show the card. Claude Code names this router as its gateway:
 * yes. Otherwise what the session log says: routed, yes; its own sign-in, no.
 * Not in the log (an older chat): yes only when there is no other gateway
 * named and the text carries OmniRoute's own marks.
 */
export function isOurs(error: RouterError, routed: boolean | null, endpoint: string | null): boolean {
  const ours = endpointHost(endpoint);
  if (error.gateway && ours && error.gateway.toLowerCase() === ours) return true;
  if (routed !== null) return routed;
  return !error.gateway;
}
