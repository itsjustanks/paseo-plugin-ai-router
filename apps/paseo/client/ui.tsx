// Primitives adapted from the 9Router Agent Link plugin's client/ui.tsx (MIT); see THIRD-PARTY-NOTICES.md.
import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

type Theme = PluginTheme;
export type Tone = "success" | "warning" | "danger" | "neutral";

export function toneColor(theme: Theme, tone: Tone): string {
  if (tone === "success") return theme.colors.statusSuccess;
  if (tone === "warning") return theme.colors.statusWarning;
  if (tone === "danger") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

export function Card({ theme, title, children }: { theme: Theme; title?: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12, marginBottom: 16 }}>
      {title ? <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Chip({ theme, label, tone = "neutral" }: { theme: Theme; label: string; tone?: Tone }) {
  const color = toneColor(theme, tone);
  return (
    <View style={{ alignSelf: "flex-start", borderColor: color, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Button({ theme, label, onPress, primary, busy, disabled }: { theme: Theme; label: string; onPress: () => void; primary?: boolean; busy?: boolean; disabled?: boolean }) {
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
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 40,
        opacity: inactive ? 0.5 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : null}
      <Text style={{ color, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ theme, label, value, onChangeText, placeholder, secure }: { theme: Theme; label: string; value: string; onChangeText: (next: string) => void; placeholder: string; secure?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: theme.colors.foreground, fontSize: 13 }}
      />
    </View>
  );
}

export function Note({ theme, children, tone = "neutral" }: { theme: Theme; children: React.ReactNode; tone?: Tone }) {
  return <Text style={{ color: toneColor(theme, tone), fontSize: 13, lineHeight: 19 }}>{children}</Text>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{children}</View>;
}

/** A quiet text action, for secondary links such as "Change in dashboard". */
export function Link({ theme, label, onPress, accessibilityLabel }: { theme: Theme; label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={{ paddingVertical: 6 }}>
      <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** The one line that says what state things are in, above everything else. */
export function Banner({ theme, tone, title, children }: { theme: Theme; tone: Tone; title: string; children?: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderLeftWidth: 4, borderLeftColor: toneColor(theme, tone), borderRadius: 12, padding: 16, gap: 6, marginBottom: 16 }}>
      <Text style={{ color: tone === "neutral" ? theme.colors.foreground : toneColor(theme, tone), fontSize: 16, fontWeight: "700" }}>{title}</Text>
      {children}
    </View>
  );
}

/** A plain label and value, such as an endpoint or a masked key. The value can be selected and copied. */
export function Fact({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, width: 120 }}>{label}</Text>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

/** Label on the left, value chip and hint on the right, and an optional link to the tab with the details. */
export function StatusLine({ theme, label, value, tone, hint, action }: { theme: Theme; label: string; value: string; tone: Tone; hint?: string | null; action?: { label: string; onPress: () => void } | null }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingVertical: 2 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, width: 120 }}>{label}</Text>
      <Chip theme={theme} label={value} tone={tone} />
      {hint ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 }}>{hint}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="link" accessibilityLabel={action.label} onPress={action.onPress}>
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>{`${action.label} →`}</Text>
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
      style={{ width: 40, height: 24, borderRadius: 12, padding: 2, backgroundColor: value ? theme.colors.accent : theme.colors.surface2, borderWidth: 1, borderColor: value ? theme.colors.accent : theme.colors.border, opacity: inactive ? 0.5 : 1, justifyContent: "center" }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: value ? theme.colors.accentForeground : theme.colors.foregroundMuted, alignSelf: value ? "flex-end" : "flex-start" }} />
    </Pressable>
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
