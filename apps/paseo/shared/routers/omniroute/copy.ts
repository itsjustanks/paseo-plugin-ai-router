/**
 * Everything the panel says about OmniRoute specifically: where its keys come
 * from, its dashboard pages, what its compression engines do. No imports, so
 * the client can bundle it and the tests can load it on its own.
 */

export const OMNIROUTE_COPY = {
  label: "OmniRoute",
  summary: "Self-hosted AI router: one endpoint and key for your Claude and Codex accounts.",
  keyHint: "sk-…",
  keyWhere: "OmniRoute → API Keys",
  tokenHint: "oma_live_…",
  tokenWhere: "OmniRoute → Settings → Access Tokens, scope: read",
  manageWhere: "OmniRoute → API Keys, a key with the manage scope",
  /** Where a person adds or re-signs-in an account, per provider (`{provider}` is filled in). */
  providerPage: "/dashboard/providers/{provider}",
  providersPage: "/dashboard/providers",
  /** OmniRoute's own tunnels live on its Endpoint page. */
  tunnelsPage: "/dashboard/endpoint",
  compressionPage: "/dashboard/context",
  exclusionsPage: "/dashboard/compression/exclusions",
} as const;

/** "More in OmniRoute": one line each and the dashboard page. The dashboard needs its own login. */
export const OMNIROUTE_MORE: ReadonlyArray<{ title: string; detail: string; path: string }> = [
  { title: "Add a provider", detail: "The onboarding wizard walks through connecting a new provider account.", path: "/dashboard/onboarding" },
  { title: "Provider quotas", detail: "Every account's quota windows, with auto-refresh.", path: "/dashboard/quota" },
  { title: "Context sources for MCP", detail: "Let agents read Notion pages and Obsidian vaults through OmniRoute's MCP server.", path: "/dashboard/endpoint" },
  { title: "Routing rules", detail: "Per-key rules that reroute a model or change its reasoning effort.", path: "/dashboard/api-manager/routing" },
  { title: "Embedded services", detail: "Run CLIProxyAPI, 9Router, Mux, Bifrost or Dario alongside OmniRoute.", path: "/dashboard/providers/services" },
  { title: "OpenWA", detail: "Chat with your models from WhatsApp through open-wa.", path: "/dashboard/providers/services?tab=openwa" },
];

export type EngineVerdict = "recommended" | "safe" | "risky" | "avoid";

/**
 * OmniRoute's compression engines in plain words, and what each means for a
 * coding agent. From OmniRoute's docs/compression and its engine catalogue
 * (open-sse/services/compression/engineCatalog.ts, lite.ts, bodyAdapter.ts).
 */
export const COMPRESSION_ENGINES: ReadonlyArray<{ id: string; label: string; what: string; agents: string; verdict: EngineVerdict }> = [
  { id: "lite", label: "Lite", what: "Tidies whitespace, drops duplicate system text and repeated messages, shortens inline images. Wording stays the same.", agents: "Safe for Claude Code. In OpenAI-style requests it also cuts tool output after 2,000 characters, and that includes Codex shell output.", verdict: "recommended" },
  { id: "session-dedup", label: "Session dedup", what: "Replaces text already sent earlier in the session with a pointer back to it.", agents: "Nothing is lost, but the model has to look back for the original. Not needed for agents.", verdict: "safe" },
  { id: "headroom", label: "Headroom", what: "Packs long, uniform JSON arrays into a compact table. Nothing is dropped.", agents: "Harmless; coding agents rarely send such arrays.", verdict: "safe" },
  { id: "ccr", label: "CCR", what: "Swaps large repeated blocks for references the model can fetch back with a tool.", agents: "Only useful when the agent has OmniRoute's retrieve tool (its MCP server).", verdict: "safe" },
  { id: "rtk", label: "RTK", what: "Filters terminal output: strips progress bars, colours and repeats, keeps errors, warnings and the end.", agents: "Can drop a line an agent needed from a long test or build log.", verdict: "risky" },
  { id: "codex-responses", label: "Responses tool output", what: "Compresses Codex shell, patch, search and build output conservatively; read, grep and edit output pass through.", agents: "Codex requests only. Long diagnostics can lose detail.", verdict: "risky" },
  { id: "caveman", label: "Caveman", what: "Rewrites prose to drop filler words and hedging.", agents: "Changes the wording of your instructions and of earlier turns, which also defeats prompt caching.", verdict: "risky" },
  { id: "relevance", label: "Relevance", what: "Drops sentences it scores as unrelated to the last question.", agents: "A later step can need exactly what it dropped.", verdict: "avoid" },
  { id: "llmlingua", label: "LLMLingua", what: "Removes single words a small model judges low in information.", agents: "Can corrupt code and exact error text.", verdict: "avoid" },
  { id: "aggressive", label: "Aggressive", what: "Summarises and progressively shortens older turns.", agents: "Rewrites history every turn, so the prompt cache never hits, and summarises tool output the agent may still need.", verdict: "avoid" },
  { id: "ultra", label: "Ultra", what: "Prunes whole messages and thins code blocks to fit the context window.", agents: "Only for rescuing a session that no longer fits.", verdict: "avoid" },
  { id: "omniglyph", label: "OmniGlyph", what: "Sends older context to the model as images.", agents: "Not meant for coding agents.", verdict: "avoid" },
];

/**
 * The setting to recommend for Claude Code and Codex agents: Lite alone, with
 * Codex models excluded from compression (OmniRoute matches exclusions against
 * the bare id and the provider/model form, `*` as the only wildcard).
 */
export const RECOMMENDED_COMPRESSION = {
  engines: ["lite"],
  exclusions: ["cx/*", "codex/*"],
  title: "Recommended for Claude Code and Codex agents: Lite only, with Codex models left alone",
  why: [
    "Agents send the whole conversation again every turn and lean on prompt caching, where the repeated part is billed at a fraction of the price. Lite is deterministic, so that repeated part stays identical.",
    "Lite leaves Claude Code's tool results alone, but it cuts OpenAI-style tool output after 2,000 characters, which reaches Codex shell output. Excluding cx/* keeps Codex requests byte for byte.",
    "Every other engine rewrites, summarises or drops content. That changes the cached part, so each turn pays full price, and it can hide a failing test or an earlier instruction from Opus 5.5 or GPT-6.",
  ],
} as const;

/**
 * OmniRoute's own one-line descriptions of its auto combos, from its UI copy
 * (i18n `combos.autoDesc` and `settings.routingDefaultAutoVariant*Desc`). A
 * combo id is matched to a variant by its words, the way OmniRoute's
 * builtinCatalog maps `auto/best-coding` to "coding". First match wins.
 */
export const AUTO_COMBO_KINDS: ReadonlyArray<{ match: RegExp; words: string; icon: string; color: string }> = [
  { match: /coding|code/, words: "Quality-first for code", icon: "code", color: "blue" },
  { match: /reasoning|smart|opus/, words: "Best discovery (10% explore)", icon: "brain", color: "indigo" },
  { match: /vision|multimodal/, words: "Best discovery (10% explore)", icon: "eye", color: "pink" },
  { match: /fast|haiku/, words: "Low-latency routing", icon: "rocket", color: "amber" },
  { match: /cheap|free|thrifty/, words: "Cost-optimized", icon: "package", color: "emerald" },
  { match: /offline|reliable/, words: "High availability", icon: "shield", color: "teal" },
  { match: /lkgp/, words: "Last Known Good Provider", icon: "compass", color: "sky" },
  { match: /subscription/, words: "Plan-included accounts first", icon: "layers", color: "violet" },
  { match: /chat|sonnet/, words: "Self-healing smart routing pool with multi-factor scoring", icon: "feather", color: "orange" },
];
export const AUTO_COMBO_DEFAULT = { words: "Self-healing smart routing pool with multi-factor scoring", icon: "sparkles", color: "violet" } as const;
export const CUSTOM_COMBO_LOOK = { icon: "boxes", color: "sky" } as const;
