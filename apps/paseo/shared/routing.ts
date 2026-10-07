// Built-in Claude and Codex: through the router, or on this computer's own
// sign-in (0.21.0). The words for the two switches, whether this computer has
// a sign-in of its own, and what to offer while the router can't serve them.
// Every switch is a person's choice: nothing here flips one by itself. No imports.

export type RoutedApp = "claude" | "codex";
export const APP_NAMES: Record<RoutedApp, string> = { claude: "Claude", codex: "Codex" };

/** The two switches, in plain words: what on and off mean for new chats. */
export function switchWords(app: RoutedApp, on: boolean): { title: string; state: string; meaning: string } {
  return {
    title: `${APP_NAMES[app]} · through the router`,
    state: on ? "On" : "Off",
    meaning: on ? "Uses your team's accounts on the router" : "Uses this computer's own sign-in",
  };
}

// ------------------------------------------------------------ own sign-in

/** This computer's own sign-in for Claude Code or Codex. Never carries a secret, only whether one is there. */
export type OwnSignIn = { state: "ok" | "expired" | "missing"; detail: string };

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const ms = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
};

/**
 * Claude Code's own sign-in: an API key or token in the daemon's environment,
 * its credentials file (`.credentials.json` in its config folder), or on a
 * Mac the keychain item it keeps instead. A login whose refresh token has
 * lapsed has expired: Claude Code can't renew it without a person.
 */
export function claudeSignIn(input: { file: unknown; keychain: boolean; env: Record<string, string | undefined>; now: number }): OwnSignIn {
  if (text(input.env.ANTHROPIC_API_KEY)) return { state: "ok", detail: "an Anthropic API key in this daemon's environment" };
  if (text(input.env.CLAUDE_CODE_OAUTH_TOKEN)) return { state: "ok", detail: "a Claude sign-in token in this daemon's environment" };
  const oauth = rec(rec(input.file).claudeAiOauth);
  if (text(oauth.refreshToken)) {
    const until = ms(oauth.refreshTokenExpiresAt);
    if (until === null || until > input.now) return { state: "ok", detail: "Claude Code's own login" };
    return { state: "expired", detail: "Claude Code's own login has expired; run `claude` here and sign in again" };
  }
  if (text(oauth.accessToken)) {
    const until = ms(oauth.expiresAt);
    if (until === null || until > input.now) return { state: "ok", detail: "Claude Code's own login" };
    return { state: "expired", detail: "Claude Code's own login has expired; run `claude` here and sign in again" };
  }
  if (input.keychain) return { state: "ok", detail: "Claude Code's login in this Mac's keychain" };
  return { state: "missing", detail: "Claude Code isn't signed in on this computer" };
}

/** A JWT's expiry, without checking its signature (we only want to know whether it has run out). */
function jwtExpiry(token: unknown): number | null {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = typeof atob === "function" ? atob(part.replace(/-/g, "+").replace(/_/g, "/")) : "";
    return ms(rec(JSON.parse(json)).exp);
  } catch {
    return null;
  }
}

/**
 * Codex's own sign-in, from its `auth.json`: an API key, or a ChatGPT login
 * it can renew (a refresh token). An access token alone counts only until it
 * runs out.
 */
export function codexSignIn(input: { file: unknown; now: number }): OwnSignIn {
  const file = rec(input.file);
  if (text(file.OPENAI_API_KEY)) return { state: "ok", detail: "an OpenAI API key in Codex's settings" };
  const tokens = rec(file.tokens);
  if (text(tokens.refresh_token)) return { state: "ok", detail: "Codex's own ChatGPT login" };
  if (text(tokens.access_token)) {
    const until = jwtExpiry(tokens.access_token);
    if (until === null || until > input.now) return { state: "ok", detail: "Codex's own ChatGPT login" };
    return { state: "expired", detail: "Codex's own login has expired; run `codex login` here" };
  }
  return { state: "missing", detail: "Codex isn't signed in on this computer" };
}

// --------------------------------------------------- when the router can't

/**
 * What to offer for one app, from the router's health and this computer's own
 * sign-in. Only ever an offer: a person presses it, and it asks first.
 *  - `use-own`: routed, and the router is down or has paused this app; this
 *    computer has its own sign-in.
 *  - `no-own`: the same, but there is no usable sign-in here, so switching
 *    would break chats: say so instead of offering it.
 *  - `back`: someone switched to the own sign-in because of a problem, and the
 *    router serves this app again.
 */
export type RoutingOffer =
  | { kind: "none" }
  | { kind: "use-own"; app: RoutedApp; label: string; problem: string; question: string }
  | { kind: "no-own"; app: RoutedApp; problem: string; text: string }
  | { kind: "back"; app: RoutedApp; label: string; question: string };

export type RouterHealth = { up: boolean; paused: readonly string[] } | null;

/** Why the router can't serve this app right now, or null. Unknown health is not a problem. */
export function routerProblem(app: RoutedApp, health: RouterHealth): string | null {
  if (!health) return null;
  if (!health.up) return "The router isn't answering";
  if (health.paused.includes(app)) return `The router has paused ${APP_NAMES[app]}`;
  return null;
}

export function routingOffer(input: { app: RoutedApp; routed: boolean; health: RouterHealth; signIn: OwnSignIn | null; switchedAway: boolean }): RoutingOffer {
  const { app, routed, health, signIn } = input;
  const name = APP_NAMES[app];
  const problem = routerProblem(app, health);
  if (routed && problem) {
    if (!signIn) return { kind: "none" };
    if (signIn.state !== "ok") {
      const why = signIn.state === "expired" ? `${name}'s own sign-in on this computer has expired` : `this computer has no ${name} sign-in of its own`;
      return { kind: "no-own", app, problem, text: `${problem}, and ${why}, so switching ${name} off the router would leave its chats unable to answer. Wait for the router, or sign ${name} in on this computer first.` };
    }
    return {
      kind: "use-own",
      app,
      problem,
      label: `Use this computer's own sign-in for ${name}`,
      question: `New ${name} chats here will use this computer's own sign-in (${signIn.detail}) instead of the router. Open chats switch when they restart. Nothing switches back by itself: you'll see "Switch back to the router" once it's working again.`,
    };
  }
  if (!routed && input.switchedAway && health?.up && !problem) {
    return { kind: "back", app, label: "Switch back to the router", question: `The router is working again. New ${name} chats here will use your team's accounts on the router instead of this computer's own sign-in.` };
  }
  return { kind: "none" };
}
