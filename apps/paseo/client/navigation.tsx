import React, { useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TAB_IDS, type TabId } from "../shared/tabs";
import { HostIcon, TYPE, SPACE } from "./ui";

export { HostIcon } from "./ui";
export type { TabId } from "../shared/tabs";

type Theme = PluginTheme;

/**
 * Four tabs (0.18.0), by what a person comes to do: see whether it works
 * (Overview), see the team's accounts and how much they are used (Accounts),
 * choose which models and chats use the router (Models), and set it up or
 * look something up (Help). Every tier sees all four; a tab says plainly
 * when it needs a key. Icons are Lucide names, drawn by the Paseo app. No
 * intro block under the bar: each tab starts with its own content.
 */
export const TABS: ReadonlyArray<{ id: TabId; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard" },
  { id: "accounts", label: "Accounts", icon: "Users" },
  { id: "models", label: "Models", icon: "Boxes" },
  { id: "help", label: "Help", icon: "LifeBuoy" },
];
// Keep the bar and the shared ids in step.
if (TABS.map((tab) => tab.id).join() !== TAB_IDS.join()) throw new Error("AI Router: TABS and TAB_IDS differ");

/** About what one tab needs with its label (icon, name, padding); four need ~400 px. */
const LABELLED_TAB_WIDTH = 100;

/**
 * An underline tab bar in one row. When the full labels do not fit (a narrow
 * screen, or a half-width desktop window, measured here), every tab shows its
 * icon and the active tab its label beside it, so nothing is cut off. Without
 * app icons, the labels scroll sideways instead.
 */
export function TabBar({ theme, compact, active, onSelect }: { theme: Theme; compact: boolean; active: TabId; onSelect: (id: TabId) => void }) {
  const [width, setWidth] = useState<number | null>(null);
  const tight = compact || (width !== null && width < TABS.length * LABELLED_TAB_WIDTH);
  const iconsOnly = tight && !!HostIcon;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  const items = TABS.map((tab) => {
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
