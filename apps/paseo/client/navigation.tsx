import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import * as HostRN from "@getpaseo/plugin/client/react-native";
import type { AccessTier } from "../shared/logic";
import { Note } from "./ui";

type Theme = PluginTheme;
const RANK: Record<AccessTier, number> = { none: 0, basic: 1, operator: 2, admin: 3 };

/**
 * Seven tabs, one job each, in one row. Icons are Lucide names, drawn by the
 * Paseo app. Accounts, Usage and Settings need a read token, so they are not
 * shown without one.
 */
export const TABS = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard", minTier: "none", heading: "Is traffic going through the router, and what to do next." },
  { id: "models", label: "Models", icon: "Boxes", minTier: "none", heading: "The models this key can use through the router, and a quick test for any of them." },
  { id: "providers", label: "Providers", icon: "Plug", minTier: "none", heading: "Every agent provider on this daemon, and which ones can go through OmniRoute." },
  { id: "accounts", label: "Accounts", icon: "Users", minTier: "operator", heading: "Each connected subscription, how much it has left, and the router's health." },
  { id: "usage", label: "Usage", icon: "Activity", minTier: "operator", heading: "Usage & analytics: requests, tokens, cost and failures across the router, by day, provider, model, daemon and account." },
  { id: "settings", label: "Settings", icon: "SlidersHorizontal", minTier: "operator", heading: "How the router compresses prompts, a few settings worth knowing, and what else it can do." },
  { id: "connection", label: "Connection", icon: "Link", minTier: "none", heading: "Which router this daemon uses, the keys it holds, and how to reach the dashboard." },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function visibleTabs(tier: AccessTier): TabId[] {
  return TABS.filter((tab) => RANK[tier] >= RANK[tab.minTier]).map((tab) => tab.id);
}

/** The app's icon component, when the host provides one (Paseo 0.9 does). */
const HostIcon = (HostRN as unknown as { Icon?: React.ComponentType<{ name: string; size?: number; color?: string }> }).Icon;

/**
 * An underline tab bar in one row. Narrow screens show every tab's icon and
 * the active tab's label beside its icon, so nothing is hidden. Without app
 * icons, the labels scroll sideways instead.
 */
export function TabBar({ theme, compact, tabs, active, onSelect }: { theme: Theme; compact: boolean; tabs: readonly TabId[]; active: TabId; onSelect: (id: TabId) => void }) {
  const iconsOnly = compact && !!HostIcon;
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
          paddingHorizontal: compact ? 10 : 12,
          paddingVertical: 10,
          marginBottom: -1,
          borderBottomWidth: 2,
          borderColor: selected ? theme.colors.accent : "transparent",
          ...(iconsOnly && !selected ? { flexGrow: 1 } : {}),
        }}
      >
        {HostIcon ? <HostIcon name={tab.icon} size={16} color={color} /> : null}
        {!iconsOnly || selected ? <Text numberOfLines={1} style={{ color: selected ? theme.colors.accent : theme.colors.foreground, fontSize: 13, fontWeight: selected ? "700" : "500" }}>{tab.label}</Text> : null}
      </Pressable>
    );
  });
  const bar = { flexDirection: "row" as const, borderBottomWidth: 1, borderColor: theme.colors.border, marginTop: 12, marginBottom: 12 };
  if (compact && !HostIcon) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" style={{ ...bar, flexGrow: 0 }}>
        {items}
      </ScrollView>
    );
  }
  return <View accessibilityRole="tablist" style={bar}>{items}</View>;
}

/** One line under the tabs saying what the tab is for. The tab bar already names it. */
export function SectionHeading({ theme, tab }: { theme: Theme; tab: TabId }) {
  const item = TABS.find((entry) => entry.id === tab)!;
  return (
    <View style={{ marginBottom: 12 }}>
      <Note theme={theme}>{item.heading}</Note>
    </View>
  );
}
