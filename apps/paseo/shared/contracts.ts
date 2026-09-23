import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { ROUTER_IDS } from "./logic";

// Every RPC lives under `ai-router.*`. Secrets never cross this boundary: the
// key and token are reported as `present` + `last4` only.

const MaskedSchema = z.object({ present: z.boolean(), last4: z.string().nullable() });

export const HealthSchema = z.object({
  checkedAt: z.string(),
  up: z.boolean(),
  /** Round trip from this daemon, not OmniRoute's own DB timing. */
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  version: z.string().nullable(),
  uptimeSeconds: z.number().nullable(),
  /** Why version and uptime are missing when a token is set. */
  monitoringError: z.string().nullable(),
  /** Providers OmniRoute's circuit breaker is holding OPEN; read with the token, so empty without one. */
  paused: z.array(z.string()),
});

export const StatusSchema = z.object({
  connection: z.object({
    source: z.enum(["saved", "env", "none"]),
    endpoint: z.string().nullable(),
    /** As saved; null means the default. */
    consoleUrl: z.string().nullable(),
    /** What "Open OmniRoute dashboard" opens: consoleUrl or endpoint + /dashboard. */
    dashboardUrl: z.string().nullable(),
    sshTarget: z.string().nullable(),
    router: z.enum(ROUTER_IDS),
    apiKey: MaskedSchema,
    token: MaskedSchema,
    manageKey: MaskedSchema,
    /** A running OmniRoute tunnel (seen with the manage key) whose HTTPS address "Open dashboard" uses instead of dashboardUrl. */
    tunnel: z.object({ label: z.string(), dashboardUrl: z.string() }).nullable(),
  }),
  /** What the saved credentials open up: key only, read token, or manage key. */
  tier: z.enum(["none", "basic", "operator", "admin"]),
  /** Why routing cannot happen yet ("no API key set for …"), or null when configured. */
  problem: z.string().nullable(),
  warnings: z.array(z.string()),
  health: HealthSchema.nullable(),
  /** The health check is still running; `health` is the previous answer (or null). */
  checking: z.boolean(),
  /** When the router last answered its health check, across plugin restarts. */
  lastSeenAt: z.string().nullable(),
  routeAgents: z.boolean(),
  /** The last Claude or AI Router Codex session the hook looked at. */
  lastSession: z
    .object({ at: z.string(), agentId: z.string(), kind: z.enum(["claude", "provider", "codex"]), routed: z.boolean(), message: z.string(), reason: z.string().nullable() })
    .nullable(),
  /** The "AI Router" Paseo provider and the models it lists. */
  aiProvider: z.object({
    present: z.boolean(),
    modelCount: z.number(),
    /** The 0.1.0 "AI Router Codex" provider is still in Paseo's config. */
    legacyCodex: z.boolean(),
    lastSync: z.object({ at: z.string(), ok: z.boolean(), message: z.string() }).nullable(),
    tests: z.array(z.object({ model: z.string(), at: z.string(), ok: z.boolean(), message: z.string() })),
    /** "Claude 12 · Codex 30", from the synced model labels. */
    summary: z.string().nullable(),
    /** The models the AI Router provider lists in Paseo, as synced. */
    models: z.array(z.object({ id: z.string(), label: z.string() })),
    /** How the list got there last: through Paseo's API, or written to config.json at plugin load. */
    via: z.enum(["api", "config-file"]).nullable(),
  }),
  /** "Codex via OmniRoute", the Codex-derived provider. */
  codexRouter: z.object({ present: z.boolean(), modelCount: z.number() }),
  settingsDir: z.string(),
});
export type Status = z.infer<typeof StatusSchema>;

export const status = defineRpc({
  name: "ai-router.status",
  input: z.object({ refresh: z.boolean().optional() }),
  output: StatusSchema,
});

/**
 * Probe a candidate connection — /api/health/ping, then an authenticated
 * /v1/models — and save it only when the key is proven. Blank secrets keep
 * the current ones; null clears them.
 */
export const connectionTest = defineRpc({
  name: "ai-router.connection.test",
  input: z.object({
    router: z.string().optional(),
    endpoint: z.string(),
    manageKey: z.string().nullable().optional(),
    apiKey: z.string().nullable().optional(),
    token: z.string().nullable().optional(),
    consoleUrl: z.string().nullable().optional(),
    sshTarget: z.string().nullable().optional(),
  }),
  output: z.object({ ok: z.boolean(), saved: z.boolean(), message: z.string() }),
});

/** Forget the saved connection; the AI_ROUTER_* variables apply again if set. */
export const connectionClear = defineRpc({
  name: "ai-router.connection.clear",
  input: z.object({}),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

const Result = z.object({ ok: z.boolean(), message: z.string() });

/** Add or refresh the "AI Router" provider with every model of the connected accounts, or remove it. */
export const aiProvider = defineRpc({ name: "ai-router.provider", input: z.object({ enabled: z.boolean() }), output: Result });

/** One tiny /v1/messages call, so an upstream refusal ("400 — version 2.1.251 or newer is required") shows up here. */
export const modelTest = defineRpc({ name: "ai-router.model.test", input: z.object({ model: z.string().min(1).max(200) }), output: Result });

// ----------------------------------------------------- accounts and usage
// Read through the optional read token on the daemon; the token never crosses.

const Insight = {
  /** no-token: nothing to read with. error: the main call failed, `message` says how. */
  state: z.enum(["ok", "no-token", "error"]),
  message: z.string().nullable(),
  checkedAt: z.string().nullable(),
  /** Parts that failed while the rest worked: "Quota bars unavailable: 403 — …". */
  notes: z.array(z.string()),
  /** The router did not answer just now; this is its last good answer (`checkedAt`), and why the new one failed. */
  stale: z.object({ reason: z.string() }).nullable(),
};

export const AccountsSchema = z.object({
  ...Insight,
  accounts: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      shortName: z.string(),
      label: z.string().nullable(),
      state: z.enum(["healthy", "attention", "disabled"]),
      problem: z.string().nullable(),
      coolingUntil: z.number().nullable(),
      quotas: z.array(z.object({ name: z.string(), remainingPct: z.number(), resetAt: z.string().nullable() })),
      authType: z.string().nullable(),
      health: z
        .object({ state: z.string(), successRatePct: z.number().nullable(), requests: z.number(), issueCount: z.number(), lastErrorAt: z.string().nullable(), failingModels: z.array(z.string()) })
        .nullable(),
      expiry: z.object({ status: z.enum(["active", "expiring_soon", "expired", "unknown"]), expiresAt: z.string().nullable(), note: z.string().nullable() }).nullable(),
    }),
  ),
  /** A manage key is saved, so Check now, Check all and Refresh token are offered. */
  canAct: z.boolean(),
  router: z
    .object({
      breakers: z.object({ text: z.string(), tone: z.enum(["success", "warning", "danger"]) }).nullable(),
      providers: z.array(z.object({ name: z.string(), requests: z.number(), errorPct: z.number().nullable(), avgLatencyMs: z.number().nullable() })),
      p95Ms: z.number().nullable(),
      failingModels: z.array(z.object({ model: z.string(), provider: z.string(), failed: z.number(), requests: z.number() })),
      paused: z.array(z.object({ provider: z.string(), retryAfterMs: z.number().nullable(), lastError: z.string().nullable() })),
    })
    .nullable(),
});
export type Accounts = z.infer<typeof AccountsSchema>;

const Rows = z.array(
  z.object({
    label: z.string(),
    requests: z.number(),
    tokens: z.number().nullable(),
    cost: z.number().nullable(),
    thisDaemon: z.boolean().optional(),
    failedPct: z.number().nullable().optional(),
    provider: z.string().nullable().optional(),
    successRatePct: z.number().nullable().optional(),
    avgLatencyMs: z.number().nullable().optional(),
    sharePct: z.number().nullable().optional(),
  }),
);

export const ANALYTICS_RANGES = ["1d", "7d", "30d"] as const;
export type AnalyticsRangeId = (typeof ANALYTICS_RANGES)[number];

/** Usage & analytics for one range, from OmniRoute's `/api/usage/analytics` (read token). */
export const UsageSchema = z.object({
  ...Insight,
  range: z.enum(ANALYTICS_RANGES),
  totals: z
    .object({
      requests: z.number(),
      promptTokens: z.number().nullable(),
      completionTokens: z.number().nullable(),
      tokens: z.number().nullable(),
      cost: z.number().nullable(),
      successRatePct: z.number().nullable(),
      avgLatencyMs: z.number().nullable(),
      fallbackRatePct: z.number().nullable(),
      streak: z.number().nullable(),
    })
    .nullable(),
  /** One entry per UTC day of the range, zero-filled. */
  trend: z.array(z.object({ date: z.string(), requests: z.number(), tokens: z.number().nullable(), cost: z.number().nullable() })),
  /** Tokens per day stacked by provider; `values` line up with `providers` (the last may be "Other"). */
  providerTrend: z.object({ providers: z.array(z.string()), days: z.array(z.object({ date: z.string(), values: z.array(z.number()) })) }),
  byModel: Rows,
  byProvider: Rows,
  byAccount: Rows,
  byDaemon: Rows,
  errors: z.array(z.object({ type: z.string(), count: z.number() })),
  /** Tokens per UTC day over the last year, days with traffic only. */
  activity: z.array(z.object({ date: z.string(), tokens: z.number() })),
  busiestWeekday: z.string().nullable(),
  /** This daemon's key name in OmniRoute, when it could be identified. */
  ownKey: z.string().nullable(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const accounts = defineRpc({ name: "ai-router.accounts", input: z.object({ refresh: z.boolean().optional() }), output: AccountsSchema });
export const usage = defineRpc({ name: "ai-router.usage", input: z.object({ refresh: z.boolean().optional(), range: z.enum(ANALYTICS_RANGES).optional() }), output: UsageSchema });

export const RouterSettingsSchema = z.object({
  ...Insight,
  /** A manage key is saved, so toggles and actions are offered. */
  canEdit: z.boolean(),
  items: z.array(
    z.object({
      id: z.enum(["compression", "breakers", "preferClaudeCode", "routing"]),
      label: z.string(),
      why: z.string(),
      value: z.string(),
      detail: z.string().nullable(),
      tone: z.enum(["success", "warning", "danger", "neutral"]),
      toggle: z.boolean().nullable(),
      action: z.string().nullable(),
      dashboardPath: z.string(),
    }),
  ),
});
export type RouterSettings = z.infer<typeof RouterSettingsSchema>;

export const routerSettings = defineRpc({ name: "ai-router.settings", input: z.object({ refresh: z.boolean().optional() }), output: RouterSettingsSchema });
/** Flip a toggle (`on`) or run an action (no `on`) with the manage key. */
export const settingApply = defineRpc({
  name: "ai-router.settings.apply",
  input: z.object({ id: z.enum(["compression", "breakers", "preferClaudeCode"]), on: z.boolean().optional() }),
  output: Result,
});

// ------------------------------------------------------------- 0.5.0 RPCs

/**
 * Sent by the client contribution the moment the app connects to this host,
 * panel open or not. It gives the server a Paseo handle, so the AI Router
 * provider is checked and synced without anyone opening the panel.
 */
export const ensure = defineRpc({ name: "ai-router.ensure", input: z.object({}), output: z.object({ ok: z.boolean() }) });

const ProviderRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ready", "loading", "error", "unavailable"]),
  error: z.string().nullable(),
  enabled: z.boolean(),
  owner: z.enum(["paseo", "ai-router", "user"]),
  through: z.enum(["claude-toggle", "codex-provider", "is-router", "none"]),
  /** Why Tidy up would switch it off; null leaves it alone. */
  tidy: z.string().nullable(),
});
export const ProvidersSchema = z.object({
  state: z.enum(["ok", "error"]),
  message: z.string().nullable(),
  checkedAt: z.string(),
  rows: z.array(ProviderRowSchema),
});
export type Providers = z.infer<typeof ProvidersSchema>;
/** Every Paseo provider on this daemon, with status, enabled, and what OmniRoute can do for it. */
export const providersList = defineRpc({ name: "ai-router.providers.list", input: z.object({ refresh: z.boolean().optional() }), output: ProvidersSchema });
/** Write `agents.providers.<id>.enabled`. */
export const providerEnable = defineRpc({ name: "ai-router.providers.enable", input: z.object({ id: z.string().min(1), enabled: z.boolean() }), output: Result });
/** Switch off the listed providers; the server re-checks each against the Tidy up rules first. */
export const providersTidy = defineRpc({ name: "ai-router.providers.tidy", input: z.object({ ids: z.array(z.string()).min(1) }), output: Result });
/** Add or remove "Codex via OmniRoute". */
export const codexRouter = defineRpc({ name: "ai-router.codex-router", input: z.object({ enabled: z.boolean() }), output: Result });

/** Account actions, with the manage key. */
export const accountAction = defineRpc({
  name: "ai-router.accounts.action",
  input: z.object({ action: z.enum(["test", "refresh"]), id: z.string().min(1), name: z.string() }),
  output: Result,
});
export const accountsCheckAll = defineRpc({ name: "ai-router.accounts.check-all", input: z.object({}), output: Result });

export const TunnelsSchema = z.object({
  state: z.enum(["ok", "no-manage-key", "error"]),
  message: z.string().nullable(),
  tunnels: z.array(
    z.object({ id: z.enum(["cloudflared", "ngrok", "tailscale"]), label: z.string(), installed: z.boolean(), running: z.boolean(), url: z.string().nullable(), phase: z.string(), error: z.string().nullable() }),
  ),
});
export type Tunnels = z.infer<typeof TunnelsSchema>;
/** OmniRoute's own tunnels (manage key). */
export const tunnels = defineRpc({ name: "ai-router.tunnels", input: z.object({ refresh: z.boolean().optional() }), output: TunnelsSchema });
export const tunnelSet = defineRpc({ name: "ai-router.tunnels.set", input: z.object({ id: z.enum(["cloudflared", "ngrok", "tailscale"]), on: z.boolean() }), output: Result });

/** "Your access": what this key itself may see about itself (`/v1/me/status`). No other key's data. */
export const AccessSchema = z.object({
  /** hidden: the key lacks OmniRoute's self:usage scope, so the router will not say. */
  state: z.enum(["ok", "hidden", "error"]),
  message: z.string().nullable(),
  checkedAt: z.string().nullable(),
  keyName: z.string().nullable(),
  spend: z.object({ usedUsd: z.number(), limitUsd: z.number().nullable(), remainingUsd: z.number().nullable(), usedPercent: z.number().nullable(), period: z.string(), resetAt: z.string().nullable() }).nullable(),
  tokens: z.number().nullable(),
  quotas: z.array(z.object({ provider: z.string(), text: z.string() })),
});
export type Access = z.infer<typeof AccessSchema>;
export const access = defineRpc({ name: "ai-router.access", input: z.object({ refresh: z.boolean().optional() }), output: AccessSchema });

/** Context compression as the router runs it now, for the Settings tab's explanation and recommendation. */
export const CompressionSchema = z.object({
  state: z.enum(["ok", "no-token", "error"]),
  message: z.string().nullable(),
  /** "off", "lite", "stacked", … */
  mode: z.string().nullable(),
  /** Engines running now, in order. */
  engines: z.array(z.string()),
  /** "12.3k tokens saved on 40 requests (avg 18%)". */
  savings: z.string().nullable(),
  /** The running setup is already the recommended one. */
  recommended: z.boolean(),
  canEdit: z.boolean(),
});
export type Compression = z.infer<typeof CompressionSchema>;
export const compression = defineRpc({ name: "ai-router.compression", input: z.object({ refresh: z.boolean().optional() }), output: CompressionSchema });
/** Admin only, after a confirmation in the panel. Never run on its own. */
export const compressionApply = defineRpc({ name: "ai-router.compression.apply", input: z.object({}), output: Result });

/** The agent profiles AI Router keeps for OmniRoute's combos. `apply` checks and syncs now (after the switch changes). */
export const ProfilesSchema = z.object({
  enabled: z.boolean(),
  profiles: z.array(z.object({ id: z.string(), name: z.string(), model: z.string().nullable(), notes: z.string().nullable(), icon: z.string().nullable(), color: z.string().nullable() })),
  /** Why the list could not be read or synced, in words. */
  message: z.string().nullable(),
});
export type Profiles = z.infer<typeof ProfilesSchema>;
export const profiles = defineRpc({ name: "ai-router.profiles", input: z.object({ apply: z.boolean().optional() }), output: ProfilesSchema });
