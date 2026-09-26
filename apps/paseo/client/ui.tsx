// Primitives adapted from the 9Router Agent Link plugin's client/ui.tsx (MIT); see THIRD-PARTY-NOTICES.md.
import React, { useState } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import * as HostRN from "@getpaseo/plugin/client/react-native";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

type Theme = PluginTheme;
export type Tone = "success" | "warning" | "danger" | "neutral";

/**
 * One type scale for the whole panel, so sentences stay readable: nothing
 * below 13 px, descriptions at 15, section titles at 17, tab titles at 20 and
 * the page title at 22; headline numbers get 26. Spread one into a style:
 * `{ ...TYPE.body, color }`.
 */
export const TYPE = {
  page: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  tabTitle: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  section: { fontSize: 17, lineHeight: 23, fontWeight: "600" },
  lead: { fontSize: 16, lineHeight: 24 },
  item: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22 },
  secondary: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 13, lineHeight: 18 },
  mono: { fontSize: 13, lineHeight: 19, fontFamily: "monospace" },
  /** A headline number, such as a usage total. */
  figure: { fontSize: 26, lineHeight: 32, fontWeight: "700" },
} as const;

/** The app's icon component, when the host provides one (Paseo 0.9 does). Lucide names. */
export const HostIcon = (HostRN as unknown as { Icon?: React.ComponentType<{ name: string; size?: number; color?: string }> }).Icon;

export function toneColor(theme: Theme, tone: Tone): string {
  if (tone === "success") return theme.colors.statusSuccess;
  if (tone === "warning") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

/** A theme colour at `alpha` opacity, for soft fills; null when the colour is not hex or rgb(), so callers fall back to a surface. */
export function tint(color: string, alpha: number): string | null {
  const value = String(color ?? "").trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let rgb: number[] | null = null;
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  } else {
    const fn = value.match(/^rgba?\(([^)]+)\)$/i);
    if (fn) rgb = fn[1].split(",").slice(0, 3).map((n) => Number.parseFloat(n));
  }
  if (!rgb || rgb.length !== 3 || rgb.some((n) => !Number.isFinite(n))) return null;
  return `rgba(${rgb.join(", ")}, ${alpha})`;
}

/** The colour an accent-or-tone element is drawn in: the theme accent unless a status tone is asked for. */
function inkOf(theme: Theme, tone: Tone | "accent"): string {
  return tone === "accent" ? theme.colors.accent : toneColor(theme, tone);
}

/** A soft circle with an icon in it: the visual anchor of cards, steps and status. Nothing without the app's icons. */
export function IconBadge({ theme, name, tone = "accent", size = 32 }: { theme: Theme; name: string; tone?: Tone | "accent"; size?: number }) {
  if (!HostIcon) return null;
  const color = inkOf(theme, tone);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint(color, 0.14) ?? theme.colors.surface2, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <HostIcon name={name} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

export function Card({ theme, title, icon, tone = "accent", subtitle, children }: { theme: Theme; title?: string; icon?: string; tone?: Tone | "accent"; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 16, padding: 18, gap: 14, marginBottom: 16 }}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {icon ? <IconBadge theme={theme} name={icon} tone={tone} size={34} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...TYPE.section, color: theme.colors.foreground }}>{title}</Text>
            {subtitle ? <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{subtitle}</Text> : null}
          </View>
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Chip({ theme, label, tone = "neutral" }: { theme: Theme; label: string; tone?: Tone }) {
  const color = toneColor(theme, tone);
  return (
    <View style={{ alignSelf: "flex-start", borderColor: tint(color, 0.55) ?? color, borderWidth: 1, backgroundColor: tint(color, 0.1) ?? "transparent", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}>
      <Text style={{ ...TYPE.small, color: tone === "neutral" ? theme.colors.foreground : color, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Button({ theme, label, onPress, primary, busy, disabled, icon }: { theme: Theme; label: string; onPress: () => void; primary?: boolean; busy?: boolean; disabled?: boolean; icon?: string }) {
  const inactive = disabled || busy;
  const color = primary ? theme.colors.accentForeground : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={!!inactive}
      onPress={inactive ? undefined : onPress}
      style={{
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: primary ? 0 : 1,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 44,
        opacity: inactive ? 0.5 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : icon && HostIcon ? <HostIcon name={icon} size={16} color={color} /> : null}
      <Text style={{ ...TYPE.body, color, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ theme, label, value, onChangeText, placeholder, secure }: { theme: Theme; label: string; value: string; onChangeText: (next: string) => void; placeholder: string; secure?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...TYPE.secondary, color: theme.colors.foreground, fontWeight: "500" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: theme.colors.foreground, fontSize: TYPE.body.fontSize }}
      />
    </View>
  );
}

/** A sentence of body text. Neutral notes use the full foreground colour, so what matters is never faint. */
export function Note({ theme, children, tone = "neutral" }: { theme: Theme; children: React.ReactNode; tone?: Tone }) {
  return <Text style={{ ...TYPE.body, color: tone === "neutral" ? theme.colors.foreground : toneColor(theme, tone) }}>{children}</Text>;
}

/** Secondary detail: times, ids, where something is stored. Muted, and never below 14 px. */
export function Meta({ theme, children, selectable }: { theme: Theme; children: React.ReactNode; selectable?: boolean }) {
  return <Text selectable={selectable} style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{children}</Text>;
}

/** A heading for one item inside a card, such as a provider or an account. */
export function ItemTitle({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <Text style={{ ...TYPE.item, color: theme.colors.foreground, flexShrink: 1 }}>{children}</Text>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{children}</View>;
}

/** A quiet text action, for secondary links such as "Change in dashboard". */
export function Link({ theme, label, onPress, accessibilityLabel }: { theme: Theme; label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={{ paddingVertical: 6 }}>
      <Text style={{ ...TYPE.body, color: theme.colors.accent, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

const BANNER_ICON: Record<Tone, string> = { success: "CircleCheck", warning: "TriangleAlert", danger: "CircleAlert", neutral: "Info" };

/** The one line that says what state things are in, above everything else. Neutral banners use the accent. */
export function Banner({ theme, tone, title, children }: { theme: Theme; tone: Tone; title: string; children?: React.ReactNode }) {
  const color = tone === "neutral" ? theme.colors.accent : toneColor(theme, tone);
  return (
    <View style={{ backgroundColor: tint(color, 0.07) ?? theme.colors.surface1, borderColor: tint(color, 0.35) ?? theme.colors.border, borderWidth: 1, borderLeftWidth: 4, borderLeftColor: color, borderRadius: 14, padding: 16, gap: 10, marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        {HostIcon ? <View style={{ paddingTop: 2 }}><HostIcon name={BANNER_ICON[tone]} size={20} color={color} /></View> : null}
        <Text style={{ ...TYPE.section, fontWeight: "700", color: tone === "neutral" ? theme.colors.foreground : color, flex: 1 }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * The big status card at the top of Overview: a coloured band with an icon
 * and the state in words, then whatever details and actions follow.
 * Neutral uses the accent, so "one step left" does not read as a warning.
 */
export function HeroCard({ theme, tone, icon, title, lead, children }: { theme: Theme; tone: Tone; icon: string; title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  const color = tone === "neutral" ? theme.colors.accent : toneColor(theme, tone);
  return (
    <View style={{ backgroundColor: theme.colors.surface1, borderColor: tint(color, 0.4) ?? theme.colors.border, borderWidth: 1, borderRadius: 18, overflow: "hidden", marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: 18, backgroundColor: tint(color, 0.09) ?? theme.colors.surface2 }}>
        <IconBadge theme={theme} name={icon} tone={tone === "neutral" ? "accent" : tone} size={52} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text accessibilityRole="header" style={{ ...TYPE.tabTitle, color: tone === "danger" ? color : theme.colors.foreground }}>{title}</Text>
          {lead ? <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>{lead}</Text> : null}
        </View>
      </View>
      {children ? <View style={{ padding: 18, gap: 12 }}>{children}</View> : null}
    </View>
  );
}

/** A plain label and value, such as an endpoint or a masked key. The value can be selected and copied. */
export function Fact({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 2 }}>
      <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted, width: 140 }}>{label}</Text>
      <Text selectable style={{ ...TYPE.body, color: theme.colors.foreground, flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

/** Label on the left, value chip and hint on the right, and an optional link to the tab with the details. */
export function StatusLine({ theme, label, value, tone, hint, action }: { theme: Theme; label: string; value: string; tone: Tone; hint?: string | null; action?: { label: string; onPress: () => void } | null }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4, paddingVertical: 3 }}>
      <Text style={{ ...TYPE.body, color: theme.colors.foreground, fontWeight: "500", width: 160 }}>{label}</Text>
      <Chip theme={theme} label={value} tone={tone} />
      {hint ? <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted, flexShrink: 1 }}>{hint}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="link" accessibilityLabel={action.label} onPress={action.onPress}>
          <Text style={{ ...TYPE.secondary, color: theme.colors.accent, fontWeight: "600" }}>{`${action.label} →`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** An on/off switch. `label` is what it switches, for screen readers. */
export function Toggle({ theme, label, value, onChange, busy, disabled }: { theme: Theme; label: string; value: boolean; onChange: (next: boolean) => void; busy?: boolean; disabled?: boolean }) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!inactive, busy: !!busy }}
      disabled={!!inactive}
      onPress={inactive ? undefined : () => onChange(!value)}
      style={{ width: 44, height: 26, borderRadius: 13, padding: 2, backgroundColor: value ? theme.colors.accent : theme.colors.surface2, borderWidth: 1, borderColor: value ? theme.colors.accent : theme.colors.border, opacity: inactive ? 0.5 : 1, justifyContent: "center" }}
    >
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: value ? theme.colors.accentForeground : theme.colors.foregroundMuted, alignSelf: value ? "flex-end" : "flex-start" }} />
    </Pressable>
  );
}

/** A switch with its words beside it, at body size. */
export function ToggleRow({ theme, label, text, value, onChange, busy, disabled }: { theme: Theme; label: string; text: string; value: boolean; onChange: (next: boolean) => void; busy?: boolean; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Toggle theme={theme} label={label} value={value} onChange={onChange} busy={busy} disabled={disabled} />
      <Text style={{ ...TYPE.body, color: theme.colors.foreground, fontWeight: "500", flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

/** A thin rule between the parts of a card. */
export function Divider({ theme }: { theme: Theme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.border }} />;
}

/** Short lines, each with a check mark in the accent colour. `columns` lays them out two across when there is room. */
export function Bullets({ theme, items, columns, icon = "Check" }: { theme: Theme; items: readonly string[]; columns?: boolean; icon?: string }) {
  return (
    <View style={{ flexDirection: columns ? "row" : "column", flexWrap: columns ? "wrap" : "nowrap", columnGap: 20, rowGap: 8 }}>
      {items.map((line) => (
        <View key={line} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, ...(columns ? { flexBasis: "45%", minWidth: 240, flexGrow: 1, flexShrink: 1 } : {}) }}>
          {HostIcon ? <View style={{ paddingTop: 3 }}><HostIcon name={icon} size={16} color={theme.colors.accent} /></View> : <Text style={{ ...TYPE.body, color: theme.colors.accent }}>•</Text>}
          <Text style={{ ...TYPE.body, color: theme.colors.foreground, flex: 1 }}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

/** A "Learn more" style toggle: a chevron and a label; the children show while it is open. */
export function Disclosure({ theme, label, openLabel, initiallyOpen = false, children }: { theme: Theme; label: string; openLabel?: string; initiallyOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const shown = open && openLabel ? openLabel : label;
  return (
    <View style={{ gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={shown} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, alignSelf: "flex-start" }}>
        {HostIcon ? <HostIcon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.accent} /> : null}
        <Text style={{ ...TYPE.body, color: theme.colors.accent, fontWeight: "600" }}>{shown}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** A reply to a button press, just under the tabs: an icon and the sentence, on a soft fill of its tone. */
export function MessageBar({ theme, tone, text }: { theme: Theme; tone: Tone; text: string }) {
  const color = tone === "neutral" ? theme.colors.accent : toneColor(theme, tone);
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12, marginBottom: 14, backgroundColor: tint(color, 0.08) ?? theme.colors.surface1, borderWidth: 1, borderColor: tint(color, 0.3) ?? theme.colors.border }}>
      {HostIcon ? <View style={{ paddingTop: 3 }}><HostIcon name={BANNER_ICON[tone]} size={16} color={color} /></View> : null}
      <Text style={{ ...TYPE.body, color: tone === "neutral" ? theme.colors.foreground : color, flex: 1 }}>{text}</Text>
    </View>
  );
}

/** The router did not answer just now: say so above an earlier answer, with its time. */
export function StaleNote({ theme, checkedAt, reason }: { theme: Theme; checkedAt: string | null; reason: string }) {
  const at = checkedAt ? new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "earlier";
  return (
    <Banner theme={theme} tone="warning" title={`Router unreachable — showing its answer as of ${at}`}>
      <Note theme={theme}>{reason}</Note>
    </Banner>
  );
}
