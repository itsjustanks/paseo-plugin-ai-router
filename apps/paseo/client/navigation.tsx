import React, { useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { AccessTier } from "../shared/logic";
import { Bullets, Disclosure, HostIcon, IconBadge, TYPE, SPACE } from "./ui";

export { HostIcon } from "./ui";

type Theme = PluginTheme;
const RANK: Record<AccessTier, number> = { none: 0, basic: 1, operator: 2, admin: 3 };

/**
 * Nine tabs, one job each, in one row. Icons are Lucide names, drawn by the
 * Paseo app. Accounts and Usage need a read token, so they are not shown
 * without one; Settings always shows, for the switches that need no router.
 * `title`, `summary` and `canDo` open each tab in plain words, for someone
 * who has never heard of a router or an API key.
 */
export const TABS = [
  {
    id: "overview", label: "Overview", icon: "LayoutDashboard", minTier: "none",
    title: "Overview",
    summary: "Whether AI Router works right now, and what to do next.",
    canDo: ["See whether the router is answering", "Open its dashboard or sync the models", "Learn how AI Router works"],
  },
  {
    id: "activity", label: "Traffic", icon: "ArrowLeftRight", minTier: "none",
    title: "Traffic through the router",
    summary: "The chats and requests that went through the router: which model and account answered, and why.",
    canDo: ["See each chat started here and whether it used the router", "With a read token, see every request and why it went where it did", "Show only errors, one model or one provider"],
  },
  {
    id: "models", label: "Models", icon: "Boxes", minTier: "none",
    title: "Models you can use",
    summary: "The models your chats can use through the router. Syncing puts them in Paseo's model picker.",
    canDo: ["Sync every model from your team's accounts into Paseo", "Turn the router's combos into agent profiles", "Send a tiny test message to a model", "See this key's spending limit"],
  },
  {
    id: "providers", label: "Providers", icon: "Plug", minTier: "none",
    title: "Providers and re-routing",
    summary: "Which of Paseo's providers go through the router. Each one's on/off switch stays in Paseo's Settings → Providers.",
    canDo: ["Re-route built-in Claude or Codex (each asks first)", "See how Codex reaches the router's accounts", "Update Claude Code and Codex on this daemon", "Turn off providers that can't run here"],
  },
  {
    id: "accounts", label: "Accounts", icon: "Users", minTier: "operator",
    title: "Your team's AI accounts",
    summary: "The subscriptions signed in on the router, whether each is healthy, and how much each has left.",
    canDo: ["See each account's health and remaining limits", "With a manage key: re-check, refresh a sign-in, clear a cooldown or use a reset credit", "See the router's own health"],
  },
  {
    id: "usage", label: "Usage", icon: "Activity", minTier: "operator",
    title: "Usage and value",
    summary: "How much the router was used, by which daemon, and what it was worth. Tokens are how AI use is counted.",
    canDo: ["Pick today, 7 days, 30 days or your own dates", "See which daemon uses the most, and on which models", "Compare value at API prices with what's billed", "Spot which requests fail most"],
  },
  {
    id: "settings", label: "Settings", icon: "SlidersHorizontal", minTier: "none",
    title: "Settings",
    summary: "What AI Router adds to Paseo and, with a read token, the router settings that matter for coding agents.",
    canDo: ["Show or hide the Breakdown chip and the MCP line", "See how the router shrinks long prompts", "Check router settings; change them with a manage key"],
  },
  {
    id: "connection", label: "Connection", icon: "Link", minTier: "none",
    title: "Connection and keys",
    summary: "Which router this computer uses, its keys, and how to reach the router's dashboard. Setup starts here.",
    canDo: ["Set the router's address and API key", "Add a read token or manage key to see and do more", "Share the router through its public address", "Open the dashboard, even on a private network"],
  },
  {
    id: "tips", label: "Tips", icon: "Lightbulb", minTier: "none",
    title: "Plugins worth adding",
    summary: "Paseo plugins that work well with AI Router, from Paseo Cafe.",
    canDo: ["See which ones this computer already has", "Open a plugin's page or copy its install command"],
  },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function visibleTabs(tier: AccessTier): TabId[] {
  return TABS.filter((tab) => RANK[tier] >= RANK[tab.minTier]).map((tab) => tab.id);
}

/** About what one tab needs with its label (icon, name, padding); nine need ~900 px. */
const LABELLED_TAB_WIDTH = 100;

/**
 * An underline tab bar in one row. When the full labels do not fit (a narrow
 * screen, or a half-width desktop window, measured here), every tab shows its
 * icon and the active tab its label beside it, so nothing is cut off. Without
 * app icons, the labels scroll sideways instead.
 */
export function TabBar({ theme, compact, tabs, active, onSelect }: { theme: Theme; compact: boolean; tabs: readonly TabId[]; active: TabId; onSelect: (id: TabId) => void }) {
  const [width, setWidth] = useState<number | null>(null);
  const tight = compact || (width !== null && width < tabs.length * LABELLED_TAB_WIDTH);
  const iconsOnly = tight && !!HostIcon;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  const items = TABS.filter((tab) => tabs.includes(tab.id)).map((tab) => {
    const selected = tab.id === active;
    const color = selected ? theme.colors.accent : theme.colors.foregroundMuted;
    return (
      <Pressable
        key={tab.id}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected }}
        onPress={() => onSelect(tab.id)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: SPACE.xs,
          paddingHorizontal: compact ? SPACE.sm : SPACE.row,
          paddingVertical: SPACE.row,
          marginBottom: -1,
          borderBottomWidth: 2,
          borderColor: selected ? theme.colors.accent : "transparent",
          ...(iconsOnly && !selected ? { flexGrow: 1 } : {}),
        }}
      >
        {HostIcon ? <HostIcon name={tab.icon} size={16} color={color} /> : null}
        {!iconsOnly || selected ? <Text numberOfLines={1} style={{ ...TYPE.secondary, color: selected ? theme.colors.accent : theme.colors.foreground, fontWeight: selected ? "700" : "500" }}>{tab.label}</Text> : null}
      </Pressable>
    );
  });
  const bar = { flexDirection: "row" as const, borderBottomWidth: 1, borderColor: theme.colors.border, marginTop: SPACE.row, marginBottom: SPACE.section };
  if (tight && !HostIcon) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" onLayout={onLayout} style={{ ...bar, flexGrow: 0 }}>
        {items}
      </ScrollView>
    );
  }
  return <View accessibilityRole="tablist" onLayout={onLayout} style={bar}>{items}</View>;
}

const INTRO_ICON = 40;

/**
 * The top of each tab: its icon, a clear title and one or two plain sentences
 * on what it is for. "What you can do here" waits behind a small link, so the
 * tab's own content stays near the top. Overview has none: its status card is
 * its introduction.
 */
export function TabIntro({ theme, tab, compact }: { theme: Theme; tab: TabId; compact: boolean }) {
  const item = TABS.find((entry) => entry.id === tab)!;
  return (
    <View style={{ gap: SPACE.sm, marginBottom: SPACE.section }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.row }}>
        <IconBadge theme={theme} name={item.icon} size={INTRO_ICON} />
        <View style={{ flex: 1, gap: SPACE.xs }}>
          <Text accessibilityRole="header" style={{ ...TYPE.tabTitle, color: theme.colors.foreground }}>{item.title}</Text>
          <Text style={{ ...TYPE.lead, color: theme.colors.foreground }}>{item.summary}</Text>
        </View>
      </View>
      <View style={{ paddingLeft: compact ? 0 : INTRO_ICON + SPACE.row }}>
        <Disclosure key={tab} theme={theme} quiet label="What you can do here" openLabel="Hide what you can do here">
          <Bullets theme={theme} items={item.canDo} columns={!compact} />
        </Disclosure>
      </View>
    </View>
  );
}
