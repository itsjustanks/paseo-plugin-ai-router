import React, { useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { AccessTier } from "../shared/logic";
import { Bullets, Disclosure, HostIcon, IconBadge, TYPE } from "./ui";

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
    summary: "Whether AI Router is working right now, what to do next, and a short guide to how it all fits together.",
    canDo: ["See at a glance whether the shared router is answering", "Open the router's dashboard, or refresh the list of models", "Learn what AI Router is and how to use it in a chat"],
  },
  {
    id: "activity", label: "Traffic", icon: "ArrowLeftRight", minTier: "none",
    title: "Traffic through the router",
    summary: "A log of the chats and requests that went through the router, so you can see what was sent where, and why.",
    canDo: ["See each chat started on this computer, and whether it used the router", "With a read token, see every request: which model and account answered, and how long it took", "Tap a request to see why the router sent it where it did", "Show only errors, one model or one provider"],
  },
  {
    id: "models", label: "Models", icon: "Boxes", minTier: "none",
    title: "Models you can use",
    summary: "The AI models your chats can use through the router. Syncing puts them in Paseo's model picker, and a test checks that one answers.",
    canDo: ["Add every model from your team's accounts to Paseo in one step", "Turn the router's combos into ready-made agent profiles", "Send a tiny test message to check a model works", "See how much of this key's spending limit is used"],
  },
  {
    id: "providers", label: "Providers", icon: "Plug", minTier: "none",
    title: "Providers and re-routing",
    summary: "A provider is what you choose when you start a chat, such as Claude, Codex or AI Router. Here you choose which ones go through the router; each one's own on/off switch stays in Paseo's Settings → Providers.",
    canDo: ["See which providers always use the router, and which can be switched", "Send the built-in Claude provider through the router instead of its own sign-in (it asks first)", "Add a Codex provider that runs on the router's accounts", "Turn off, in one go, the providers that can't work on this computer"],
  },
  {
    id: "accounts", label: "Accounts", icon: "Users", minTier: "operator",
    title: "Your team's AI accounts",
    summary: "The AI subscriptions signed in on the router, whether each is healthy, and how much each has left before it hits its limit.",
    canDo: ["See which accounts are healthy and which need attention", "Check each account's remaining allowance and when it resets", "With a manage key, re-check an account or refresh its sign-in", "See the router's own health: version, uptime and failures"],
  },
  {
    id: "usage", label: "Usage", icon: "Activity", minTier: "operator",
    title: "Usage and cost",
    summary: "How much the router has been used: requests, tokens (the units AI use is counted in) and estimated cost, by day, provider, model, computer and account.",
    canDo: ["Switch between the last 24 hours, 7 days and 30 days", "See which providers and models do the most work", "Compare use across computers and accounts", "Spot which kinds of request fail most"],
  },
  {
    id: "settings", label: "Settings", icon: "SlidersHorizontal", minTier: "none",
    title: "Settings",
    summary: "Switches for what AI Router adds to Paseo and, with a read token, the router settings that matter most for coding agents.",
    canDo: ["Show or hide the Breakdown chip on each chat, and the MCP card", "See how the router shrinks long prompts, and the setting we recommend", "Check a few router settings, and change them with a manage key"],
  },
  {
    id: "connection", label: "Connection", icon: "Link", minTier: "none",
    title: "Connection and keys",
    summary: "Which router this computer talks to, the keys it uses, and how to reach the router's dashboard. Setting up AI Router starts here.",
    canDo: ["Set up or change the router's address and API key", "Add a read token or a manage key to see and do more", "Share the router with others through its public address", "Open the dashboard, even when it's on a private network"],
  },
  {
    id: "tips", label: "Tips", icon: "Lightbulb", minTier: "none",
    title: "Plugins worth adding",
    summary: "Other Paseo plugins that work well alongside AI Router, picked from Paseo Cafe, Paseo's plugin directory.",
    canDo: ["See which recommended plugins this computer already has", "Open a plugin's page, or copy its install command"],
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
          gap: 6,
          paddingHorizontal: compact ? 8 : 11,
          paddingVertical: 11,
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
  const bar = { flexDirection: "row" as const, borderBottomWidth: 1, borderColor: theme.colors.border, marginTop: 14, marginBottom: 20 };
  if (tight && !HostIcon) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" onLayout={onLayout} style={{ ...bar, flexGrow: 0 }}>
        {items}
      </ScrollView>
    );
  }
  return <View accessibilityRole="tablist" onLayout={onLayout} style={bar}>{items}</View>;
}

/**
 * The top of each tab: its icon, a clear title, one or two plain sentences on
 * what it is for, and "What you can do here". On a phone that list folds away
 * behind a "Learn more" toggle, so the tab's own content stays near the top.
 */
export function TabIntro({ theme, tab, compact }: { theme: Theme; tab: TabId; compact: boolean }) {
  const item = TABS.find((entry) => entry.id === tab)!;
  const list = (
    <View style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border }}>
      {!compact ? <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted, fontWeight: "600" }}>What you can do here</Text> : null}
      <Bullets theme={theme} items={item.canDo} columns={!compact} />
    </View>
  );
  return (
    <View style={{ gap: 14, marginBottom: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
        <IconBadge theme={theme} name={item.icon} size={compact ? 40 : 46} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text accessibilityRole="header" style={{ ...TYPE.tabTitle, color: theme.colors.foreground }}>{item.title}</Text>
          <Text style={{ ...TYPE.lead, color: theme.colors.foreground }}>{item.summary}</Text>
        </View>
      </View>
      {compact ? (
        <Disclosure key={tab} theme={theme} label="Learn more: what you can do here" openLabel="Hide what you can do here">
          {list}
        </Disclosure>
      ) : (
        list
      )}
    </View>
  );
}
