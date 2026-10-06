// The panel's four tabs (0.18.0), and where each of the nine old tabs went.
// Pure, so the tests can check every old id without React.

export const TAB_IDS = ["overview", "accounts", "models", "help"] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Each tab's name, on the tab bar and in the window title. */
export const TAB_LABELS: Record<TabId, string> = { overview: "Overview", accounts: "Accounts", models: "Models", help: "Help" };

/** The nine tabs before 0.18.0. Deep links, buttons and tests may still name them. */
export const LEGACY_TAB_IDS = ["overview", "activity", "models", "providers", "accounts", "usage", "settings", "connection", "tips"] as const;
export type LegacyTabId = (typeof LEGACY_TAB_IDS)[number];

/** Where to go: a tab, and the fold-outs on it to open. */
export type Target = { tab: TabId; open: readonly string[] };

/**
 * Each old tab's new home: the tab it moved to and the fold-outs that hold
 * what it showed, opened on arrival. Tabs that kept their name keep their place.
 */
export const LEGACY_TARGETS: Record<LegacyTabId, Target> = {
  overview: { tab: "overview", open: [] },
  activity: { tab: "overview", open: ["traffic"] },
  models: { tab: "models", open: ["models-list", "combos"] },
  providers: { tab: "models", open: ["codex-extras", "tidy", "agent-apps"] },
  accounts: { tab: "accounts", open: ["router-health"] },
  usage: { tab: "accounts", open: ["usage-days", "usage-split", "usage-accounts", "usage-errors", "usage-year"] },
  settings: { tab: "help", open: ["in-paseo", "compression", "router-settings", "more"] },
  connection: { tab: "help", open: ["connection", "keys", "share", "dashboard"] },
  tips: { tab: "help", open: ["tips"] },
};

const isTab = (id: string): id is TabId => (TAB_IDS as readonly string[]).includes(id);
const isLegacy = (id: string): id is LegacyTabId => (LEGACY_TAB_IDS as readonly string[]).includes(id);

/**
 * A tab id, old or new, plus any extra fold-outs (a screen's `open` param, a
 * comma list) to a place in the panel. Unknown ids land on Overview.
 */
export function resolveTarget(id: string | null | undefined, extra?: string | null): Target {
  const key = (id ?? "").trim().toLowerCase();
  const base: Target = isLegacy(key) ? LEGACY_TARGETS[key] : isTab(key) ? { tab: key, open: [] } : { tab: "overview", open: [] };
  const more = (extra ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return more.length ? { tab: base.tab, open: [...base.open, ...more.filter((part) => !base.open.includes(part))] } : base;
}

/** Anywhere the panel can send someone: a tab, or an old tab id that maps to one. */
export type GoTarget = TabId | LegacyTabId;

/** The screen's header and window title (Paseo 0.11): "AI Router" on Overview, "AI Router · Accounts" on a tab. */
export function screenTitle(params: Record<string, string> | undefined): string {
  const { tab } = resolveTarget(params?.tab);
  return tab === "overview" ? "AI Router" : `AI Router · ${TAB_LABELS[tab]}`;
}
