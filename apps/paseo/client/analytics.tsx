import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ANALYTICS_RANGES, usage, usageKey, type AnalyticsRangeId, type Usage } from "../shared/contracts";
import { compactNumber as compact, errorWords } from "../shared/routers/omniroute/parsers";
import { localYmd, usageRequest } from "../shared/logic";
import { Breakdown, Gate, Notes, money } from "./insights";
import { Accordion, AccordionItem, Banner, Button, Card, Chip, Field, HostIcon, Link, Meta, Note, Row, TYPE, SPACE } from "./ui";

type Theme = PluginTheme;
const RANGE_WORDS: Record<AnalyticsRangeId, string> = { today: "Today", "7d": "7 days", "30d": "30 days", custom: "Custom" };
type Request = { range: AnalyticsRangeId; start?: string; end?: string };

/**
 * A categorical palette validated for colour-blind separation and contrast on
 * light and dark surfaces (five slots, fixed order), and its dark-mode steps.
 * Codex and Claude always keep their slots, so a range change never repaints them.
 */
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
} as const;
const FIXED_SLOTS: Record<string, number> = { Codex: 0, Claude: 1 };

/** Dark theme when the card surface is dark; anything unparseable reads as light. */
function isDark(theme: Theme): boolean {
  const color = String(theme.colors.surface1 ?? "").trim();
  let rgb: number[] | null = null;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = color.match(/^rgba?\(([^)]+)\)$/i);
    if (fn) rgb = fn[1].split(",").slice(0, 3).map((n) => Number.parseFloat(n));
  }
  if (!rgb || rgb.some((n) => !Number.isFinite(n))) return false;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5;
}

/** A colour per series name: fixed slots first, then free slots in legend order; "Other" and overflow in muted ink. */
export function seriesColors(theme: Theme, names: readonly string[]): Map<string, string> {
  const palette = SERIES[isDark(theme) ? "dark" : "light"];
  const colors = new Map<string, string>();
  const used = new Set<number>();
  for (const name of names) {
    if (name in FIXED_SLOTS) {
      colors.set(name, palette[FIXED_SLOTS[name]]);
      used.add(FIXED_SLOTS[name]);
    }
  }
  let next = 0;
  for (const name of names) {
    if (colors.has(name)) continue;
    if (name === "Other") {
      colors.set(name, theme.colors.foregroundMuted);
      continue;
    }
    while (used.has(next)) next += 1;
    colors.set(name, next < palette.length ? palette[next] : theme.colors.foregroundMuted);
    used.add(next);
  }
  return colors;
}

const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
const seconds = (ms: number | null) => (ms === null ? null : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const plural = (n: number, word: string) => `${compact(n)} ${word}${n === 1 ? "" : "s"}`;

function RangePicker({ theme, range, onChange }: { theme: Theme; range: AnalyticsRangeId; onChange: (next: AnalyticsRangeId) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", alignSelf: "flex-start", gap: SPACE.xs, padding: SPACE.hair, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      {ANALYTICS_RANGES.map((id) => {
        const selected = id === range;
        return (
          <Pressable key={id} accessibilityRole="radio" accessibilityLabel={id === "today" || id === "custom" ? RANGE_WORDS[id] : `Last ${RANGE_WORDS[id]}`} accessibilityState={{ selected }} onPress={() => onChange(id)} style={{ paddingHorizontal: SPACE.row, paddingVertical: SPACE.sm, borderRadius: 8, backgroundColor: selected ? theme.colors.accent : "transparent" }}>
            <Text style={{ ...TYPE.secondary, color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontWeight: "600" }}>{RANGE_WORDS[id]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** From and To as local dates, applied together. */
function CustomDates({ theme, initial, onApply }: { theme: Theme; initial: { from: string; to: string }; onApply: (next: { from: string; to: string }) => void }) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const checked = usageRequest("custom", { from, to }, new Date());
  return (
    <View style={{ gap: SPACE.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: SPACE.sm }}>
        <View style={{ flexBasis: 150, flexGrow: 1, maxWidth: 220 }}><Field theme={theme} label="From" value={from} onChangeText={setFrom} placeholder="2026-10-01" /></View>
        <View style={{ flexBasis: 150, flexGrow: 1, maxWidth: 220 }}><Field theme={theme} label="To" value={to} onChangeText={setTo} placeholder="2026-10-05" /></View>
        <Button theme={theme} label="Show" primary disabled={"error" in checked} onPress={() => onApply({ from: from.trim(), to: to.trim() })} />
      </View>
      {"error" in checked && from.trim() && to.trim() ? <Meta theme={theme}>{checked.error}</Meta> : null}
    </View>
  );
}

function Tile({ theme, icon, label, value, sub }: { theme: Theme; icon: string; label: string; value: string; sub: string | null }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 170, gap: SPACE.xs, padding: SPACE.md, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        {HostIcon ? <HostIcon name={icon} size={16} color={theme.colors.accent} /> : null}
        <Text style={{ ...TYPE.secondary, color: theme.colors.foreground, fontWeight: "500" }}>{label}</Text>
      </View>
      <Text style={{ ...TYPE.figure, color: theme.colors.foreground }}>{value}</Text>
      {sub ? <Meta theme={theme}>{sub}</Meta> : null}
    </View>
  );
}

function Tiles({ theme, totals, value }: { theme: Theme; totals: NonNullable<Usage["totals"]>; value: number | null }) {
  const inOut = totals.promptTokens !== null && totals.completionTokens !== null ? `${compact(totals.promptTokens)} in · ${compact(totals.completionTokens)} out` : null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginBottom: SPACE.md }}>
      <Tile theme={theme} icon="ArrowLeftRight" label="Requests" value={compact(totals.requests)} sub={totals.successRatePct !== null ? `${totals.successRatePct}% succeeded` : null} />
      <Tile theme={theme} icon="Hash" label="Tokens" value={compact(totals.tokens)} sub={inOut} />
      <Tile theme={theme} icon="Coins" label="Value" value={money(value) ?? money(totals.cost) ?? "$0.00"} sub={value !== null ? `at API prices · billed ${money(totals.cost) ?? "$0.00"}` : "billed, as OmniRoute prices it"} />
      <Tile theme={theme} icon="Timer" label="Average latency" value={seconds(totals.avgLatencyMs) ?? "—"} sub={totals.fallbackRatePct !== null ? `${totals.fallbackRatePct}% fell back to another model` : null} />
    </View>
  );
}

/** A day's column: segments bottom-up with a 2 px surface gap between them, the top one rounded. */
function Column({ theme, values, colors, peak, height, selected, label, onPress }: { theme: Theme; values: number[]; colors: string[]; peak: number; height: number; selected: boolean; label: string; onPress: () => void }) {
  const total = values.reduce((sum, v) => sum + v, 0);
  const segments = values.map((v, i) => ({ v, color: colors[i] })).filter((s) => s.v > 0);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={{ flex: 1, height, justifyContent: "flex-end", opacity: selected ? 1 : 0.85 }}>
      {total === 0 ? <View style={{ height: 2, borderRadius: 1, backgroundColor: theme.colors.border }} /> : null}
      {segments
        .slice()
        .reverse()
        .map((s, i) => (
          <View
            key={i}
            style={{
              height: Math.max(2, (s.v / peak) * (height - 4) - (segments.length > 1 ? 2 : 0)),
              marginTop: i === 0 ? 0 : 2,
              backgroundColor: s.color,
              borderTopLeftRadius: i === 0 ? 4 : 0,
              borderTopRightRadius: i === 0 ? 4 : 0,
            }}
          />
        ))}
      {selected ? <View style={{ position: "absolute", left: 0, right: 0, bottom: -6, height: 2, borderRadius: 1, backgroundColor: theme.colors.foreground }} /> : null}
    </Pressable>
  );
}

/** Dates under a day chart: first, middle and last only, in muted ink. */
function Axis({ theme, dates }: { theme: Theme; dates: string[] }) {
  if (!dates.length) return null;
  const picks = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
  return (
    <View style={{ flexDirection: "row", justifyContent: picks.length > 1 ? "space-between" : "flex-start", marginTop: SPACE.sm }}>
      {picks.map((i) => <Text key={i} style={{ ...TYPE.small, color: theme.colors.foregroundMuted }}>{day(dates[i])}</Text>)}
    </View>
  );
}

function Swatch({ color }: { color: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />;
}

function RequestsPerDay({ theme, trend }: { theme: Theme; trend: Usage["trend"] }) {
  const [picked, setPicked] = useState(trend.length - 1);
  const index = Math.min(picked, trend.length - 1);
  const peak = Math.max(1, ...trend.map((d) => d.requests));
  const color = seriesColors(theme, ["series"]).get("series")!;
  const chosen = trend[index];
  return (
    <Card theme={theme} title="Requests per day" icon="ChartColumn">
      <Meta theme={theme}>{`Busiest day: ${plural(peak, "request")}`}</Meta>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: SPACE.hair, height: 96, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        {trend.map((d, i) => (
          <Column key={d.date} theme={theme} values={[d.requests]} colors={[color]} peak={peak} height={96} selected={i === index} label={`${day(d.date)}: ${plural(d.requests, "request")}`} onPress={() => setPicked(i)} />
        ))}
      </View>
      <Axis theme={theme} dates={trend.map((d) => d.date)} />
      {chosen ? (
        <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>
          {[`${day(chosen.date)}: ${plural(chosen.requests, "request")}`, chosen.tokens ? `${compact(chosen.tokens)} tokens` : null, money(chosen.cost)].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
      <Meta theme={theme}>Tap a day for its numbers. Days are UTC, as the router counts them.</Meta>
    </Card>
  );
}

function TokensByProvider({ theme, trend, colors }: { theme: Theme; trend: Usage["providerTrend"]; colors: Map<string, string> }) {
  const [picked, setPicked] = useState(trend.days.length - 1);
  if (!trend.providers.length) return null;
  const index = Math.min(picked, trend.days.length - 1);
  const totals = trend.providers.map((_, i) => trend.days.reduce((sum, d) => sum + (d.values[i] ?? 0), 0));
  const all = totals.reduce((sum, v) => sum + v, 0) || 1;
  const peak = Math.max(1, ...trend.days.map((d) => d.values.reduce((sum, v) => sum + v, 0)));
  const palette = trend.providers.map((name) => colors.get(name) ?? theme.colors.foregroundMuted);
  const chosen = trend.days[index];
  return (
    <Card theme={theme} title="Tokens per day, by provider" icon="ChartColumnStacked">
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: SPACE.hair, height: 110, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        {trend.days.map((d, i) => (
          <Column
            key={d.date}
            theme={theme}
            values={d.values}
            colors={palette}
            peak={peak}
            height={110}
            selected={i === index}
            label={`${day(d.date)}: ${trend.providers.map((name, j) => `${name} ${compact(d.values[j] ?? 0)}`).join(", ")} tokens`}
            onPress={() => setPicked(i)}
          />
        ))}
      </View>
      <Axis theme={theme} dates={trend.days.map((d) => d.date)} />
      {chosen ? (
        <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>
          {`${day(chosen.date)}: ${trend.providers.map((name, j) => ((chosen.values[j] ?? 0) > 0 ? `${name} ${compact(chosen.values[j])}` : null)).filter(Boolean).join(" · ") || "no tokens"}`}
        </Text>
      ) : null}
      <View style={{ gap: SPACE.xs }}>
        {trend.providers.map((name, i) => (
          <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
            <Swatch color={palette[i]} />
            <Text style={{ ...TYPE.body, color: theme.colors.foreground, flex: 1 }}>{name}</Text>
            <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{`${compact(totals[i])} tokens · ${Math.round((totals[i] / all) * 100)}%`}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

function ProviderSplit({ theme, rows, colors }: { theme: Theme; rows: Usage["byProvider"]; colors: Map<string, string> }) {
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + row.requests, 0) || 1;
  return (
    <Card theme={theme} title="Provider split" icon="ChartPie">
      <View accessibilityLabel={rows.map((row) => `${row.label} ${Math.round((row.requests / total) * 100)}%`).join(", ")} style={{ flexDirection: "row", height: 12, gap: SPACE.hair }}>
        {rows.filter((row) => row.requests > 0).map((row, i, shown) => (
          <View key={row.label} style={{ flex: row.requests, backgroundColor: colors.get(row.label) ?? theme.colors.foregroundMuted, borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0, borderTopRightRadius: i === shown.length - 1 ? 4 : 0, borderBottomRightRadius: i === shown.length - 1 ? 4 : 0 }} />
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.label} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
          <Swatch color={colors.get(row.label) ?? theme.colors.foregroundMuted} />
          <Text style={{ ...TYPE.body, color: theme.colors.foreground, flexGrow: 1 }}>{row.label}</Text>
          <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>
            {[plural(row.requests, "request"), `${Math.round((row.requests / total) * 100)}%`, row.successRatePct !== null && row.successRatePct !== undefined ? `${row.successRatePct}% succeeded` : null, seconds(row.avgLatencyMs ?? null), money(row.cost)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function TopModels({ theme, rows, colors }: { theme: Theme; rows: Usage["byModel"]; colors: Map<string, string> }) {
  if (!rows.length) return null;
  const top = Math.max(1, ...rows.map((row) => row.requests));
  return (
    <Card theme={theme} title="Top models" icon="Boxes">
      {rows.map((row) => {
        const failed = row.failedPct ?? 0;
        return (
          <View key={`${row.provider}/${row.label}`} style={{ gap: SPACE.xs }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
              <Swatch color={colors.get(row.provider ?? "") ?? theme.colors.foregroundMuted} />
              <Text style={{ ...TYPE.body, color: theme.colors.foreground, flexGrow: 1 }}>{row.label}</Text>
              <Text style={{ ...TYPE.secondary, color: failed >= 5 ? theme.colors.statusDanger : theme.colors.foregroundMuted }}>
                {[row.tokens !== null ? `${compact(row.tokens)} tokens` : null, row.value ? `worth ${money(row.value)}` : null, plural(row.requests, "request"), failed > 0 ? `${failed}% failed` : null, seconds(row.avgLatencyMs ?? null)].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
              <View style={{ width: `${Math.max(2, (row.requests / top) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.get(row.provider ?? "") ?? theme.colors.foregroundMuted }} />
            </View>
          </View>
        );
      })}
      <Meta theme={theme}>Swatch colour = the model's provider.</Meta>
    </Card>
  );
}

/** A year-style grid: one column per week (Sunday first), one cell per UTC day, one hue light to dark by tokens. */
function Activity({ theme, activity, weeks, streak, busiest }: { theme: Theme; activity: Usage["activity"]; weeks: number; streak: number | null; busiest: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const tokens = new Map(activity.map((d) => [d.date, d.tokens]));
  const today = new Date();
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  // The Sunday that starts this week, then back `weeks - 1` whole weeks.
  const firstSunday = end - (new Date(end).getUTCDay() + (weeks - 1) * 7) * 86_400_000;
  const columns: Array<Array<{ date: string; value: number; future: boolean }>> = [];
  for (let w = 0; w < weeks; w += 1) {
    const column = [];
    for (let d = 0; d < 7; d += 1) {
      const ms = firstSunday + (w * 7 + d) * 86_400_000;
      const date = new Date(ms).toISOString().slice(0, 10);
      column.push({ date, value: tokens.get(date) ?? 0, future: ms > end });
    }
    columns.push(column);
  }
  const shown = columns.flat().filter((c) => c.value > 0).map((c) => c.value).sort((a, b) => a - b);
  const cut = (q: number) => shown[Math.min(shown.length - 1, Math.floor(q * shown.length))] ?? 0;
  const edges = [cut(0.25), cut(0.5), cut(0.75)];
  const level = (v: number) => (v <= 0 ? 0 : v <= edges[0] ? 1 : v <= edges[1] ? 2 : v <= edges[2] ? 3 : 4);
  const hue = seriesColors(theme, ["series"]).get("series")!;
  const OPACITY = [1, 0.3, 0.5, 0.75, 1];
  const cell = (lvl: number, key: string, onPress?: () => void, label?: string, empty = false) => (
    <Pressable key={key} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label} onPress={onPress} disabled={!onPress} style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: empty ? "transparent" : lvl === 0 ? theme.colors.surface2 : hue, opacity: OPACITY[lvl] }} />
  );
  const chosen = picked ? { date: picked, value: tokens.get(picked) ?? 0 } : null;
  return (
    <Card theme={theme} title={`Activity, last ${weeks} weeks`} icon="CalendarDays">
      <View style={{ flexDirection: "row", gap: SPACE.hair }}>
        {columns.map((column, w) => (
          <View key={w} style={{ gap: SPACE.hair }}>
            {column.map((c) => cell(level(c.value), c.date, c.future ? undefined : () => setPicked(c.date), `${day(c.date)}: ${compact(c.value)} tokens`, c.future))}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
        <Text style={{ ...TYPE.small, color: theme.colors.foregroundMuted, marginRight: SPACE.hair }}>Fewer tokens</Text>
        {[0, 1, 2, 3, 4].map((lvl) => cell(lvl, `legend-${lvl}`))}
        <Text style={{ ...TYPE.small, color: theme.colors.foregroundMuted, marginLeft: SPACE.hair }}>More</Text>
      </View>
      <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>
        {chosen ? `${day(chosen.date)}: ${compact(chosen.value)} tokens` : [streak ? `${plural(streak, "day")} in a row with traffic` : null, busiest ? `busiest weekday: ${busiest}` : null].filter(Boolean).join(" · ") || "Tap a day for its tokens."}
      </Text>
    </Card>
  );
}

function Errors({ theme, errors }: { theme: Theme; errors: Usage["errors"] }) {
  if (!errors.length) return null;
  const total = errors.reduce((sum, e) => sum + e.count, 0);
  return (
    <Card theme={theme} title="Failed requests by kind" icon="CircleX" tone="danger">
      {errors.map((e) => (
        <View key={e.type} style={{ flexDirection: "row", justifyContent: "space-between", gap: SPACE.sm }}>
          <Text style={{ ...TYPE.body, color: theme.colors.foreground, flexShrink: 1 }}>{errorWords(e.type)}</Text>
          <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{`${compact(e.count)} · ${Math.round((e.count / total) * 100)}%`}</Text>
        </View>
      ))}
    </Card>
  );
}

type KeyRowData = Usage["byKey"][number];

/** One API key: its share of tokens, what it was worth and was billed; open it for its models. */
function KeyRow({ theme, row, top, request, open, onToggle }: { theme: Theme; row: KeyRowData; top: number; request: Request; open: boolean; onToggle: () => void }) {
  const call = useRpc(usageKey);
  const models = useQuery({ queryKey: ["ai-router", "usage-key", row.id, request], queryFn: () => call({ keyId: row.id!, ...request }), enabled: open && row.id !== null, staleTime: 5 * 60_000 });
  const figures = [row.tokens !== null ? `${compact(row.tokens)} tokens` : null, row.value ? `worth ${money(row.value)}` : null, row.cost ? `billed ${money(row.cost)}` : null, plural(row.requests, "request")].filter(Boolean).join(" · ");
  return (
    <View style={{ gap: SPACE.xs }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${row.label}: ${figures}`} accessibilityState={{ expanded: open }} disabled={row.id === null} onPress={onToggle} style={{ gap: SPACE.xs }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: SPACE.sm, rowGap: SPACE.hair }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, flexShrink: 1 }}>
            {HostIcon && row.id !== null ? <HostIcon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.colors.foregroundMuted} /> : null}
            <Text style={{ ...TYPE.body, color: theme.colors.foreground, fontWeight: row.thisDaemon ? "700" : "500", flexShrink: 1 }}>{row.label}</Text>
            {row.thisDaemon ? <Chip theme={theme} label="this daemon" tone="success" /> : null}
          </View>
          <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{figures}</Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
          <View style={{ width: `${Math.max(2, ((row.tokens ?? 0) / top) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: row.thisDaemon ? theme.colors.accent : theme.colors.foregroundMuted }} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ gap: SPACE.xs, paddingLeft: SPACE.md }}>
          {!models.data ? <Meta theme={theme}>{models.error ? String(models.error) : "Reading its models…"}</Meta> : null}
          {models.data && models.data.state !== "ok" ? <Meta theme={theme}>{models.data.message}</Meta> : null}
          {models.data?.state === "ok" && !models.data.models.length ? <Meta theme={theme}>No models in this window.</Meta> : null}
          {models.data?.models.map((model) => (
            <View key={`${model.provider}/${model.label}`} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: SPACE.sm }}>
              <Text style={{ ...TYPE.secondary, color: theme.colors.foreground, flexShrink: 1 }}>{model.provider ? `${model.label} · ${model.provider}` : model.label}</Text>
              <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>{[model.tokens !== null ? `${compact(model.tokens)} tokens` : null, model.value ? `worth ${money(model.value)}` : null].filter(Boolean).join(" · ")}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Who in Paseo uses the router most: one row per API key, and each daemon has its own key. */
function TopUsers({ theme, rows, request, words }: { theme: Theme; rows: Usage["byKey"]; request: Request; words: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const top = Math.max(1, ...rows.map((row) => row.tokens ?? 0));
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Card theme={theme} title="Who uses the most" icon="Trophy">
      <Meta theme={theme}>{`One key per daemon, most tokens first, ${words}. Worth = at API prices; billed = what OmniRoute charges. Tap a row for its models.`}</Meta>
      {shown.map((row) => (
        <KeyRow key={row.id ?? row.label} theme={theme} row={row} top={top} request={request} open={open === (row.id ?? row.label)} onToggle={() => setOpen(open === (row.id ?? row.label) ? null : row.id ?? row.label)} />
      ))}
      {rows.length > 8 ? <Link theme={theme} label={all ? "Show fewer" : `Show all ${rows.length}`} onPress={() => setAll(!all)} /> : null}
    </Card>
  );
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "today", "the last 7 days", "Oct 1 – Oct 3". */
function windowWords(request: Request): string {
  if (request.range === "today") return "today";
  if (request.range === "custom" && request.start && request.end) return `${shortDay(request.start)} – ${shortDay(request.end)}`;
  return `the last ${RANGE_WORDS[request.range]}`;
}

/**
 * Usage & analytics, after OmniRoute's own analytics page: headline numbers,
 * who uses the most (one API key per daemon), requests and tokens over time,
 * the provider split, top models and accounts, a year of activity, and what
 * failed. Two `/api/usage/analytics` reads per window (billed and at API
 * prices), cached on the daemon for 5 minutes; a key's models only on tap.
 */
export function UsageTab({ theme, compact: narrow, initialRange = "7d" }: { theme: Theme; compact: boolean; initialRange?: AnalyticsRangeId }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<AnalyticsRangeId>(initialRange);
  const [custom, setCustom] = useState(() => {
    const now = new Date();
    return { from: localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13)), to: localYmd(now) };
  });
  const call = useRpc(usage);
  const asked = usageRequest(range, custom, new Date());
  const request: Request = "error" in asked ? { range: "7d" } : asked;
  const key = ["ai-router", "usage", request];
  const query = useQuery({ queryKey: key, queryFn: () => call(request), refetchInterval: 5 * 60_000, enabled: !("error" in asked) });
  const refresh = useMutation({ mutationFn: () => call({ ...request, refresh: true }), onSuccess: (next) => queryClient.setQueryData(key, next) });
  const data = query.data;
  const gate = <Gate theme={theme} title="Usage" data={data} error={query.error} loading={query.isLoading} refetch={() => void query.refetch()} />;
  const picker = (
    <View style={{ gap: SPACE.row, marginBottom: SPACE.md }}>
      <RangePicker theme={theme} range={range} onChange={setRange} />
      {range === "custom" ? <CustomDates theme={theme} initial={custom} onApply={setCustom} /> : null}
      {data?.state === "ok" && data.checkedAt ? (
        <Row>
          <Meta theme={theme}>{`Updated ${hhmm(data.checkedAt)} · every 5 minutes`}</Meta>
          <Link theme={theme} label={refresh.isPending ? "Refreshing…" : "Refresh"} onPress={() => { if (!refresh.isPending) refresh.mutate(); }} />
        </Row>
      ) : null}
    </View>
  );
  if (!data || data.state !== "ok") return <>{picker}{gate}</>;
  const words = windowWords(request);
  const names = [...data.providerTrend.providers, ...data.byProvider.map((row) => row.label), ...data.byModel.map((row) => row.provider ?? "")].filter((name, i, all) => name && all.indexOf(name) === i);
  const colors = seriesColors(theme, names);
  const empty = data.totals !== null && data.totals.requests === 0;
  const daily = data.window.days > 2;
  return (
    <>
      {picker}
      {data.stale ? gate : null}
      {data.totals ? <Tiles theme={theme} totals={data.totals} value={data.valueTotal} /> : <Note theme={theme}>The router reported no totals for this window.</Note>}
      {empty ? (
        <Banner theme={theme} tone="neutral" title={`No requests ${words}`}>
          <Meta theme={theme}>Nothing went through the router in this window. New use shows here within 5 minutes.</Meta>
        </Banner>
      ) : (
        <TopUsers theme={theme} rows={data.byKey} request={request} words={words} />
      )}
      <Accordion theme={theme}>
        {!empty && daily ? (
          <AccordionItem theme={theme} id="usage-days" icon="ChartColumn" title="Day by day" summary={`Requests and tokens each day, ${words}`}>
            <RequestsPerDay key={`requests-${JSON.stringify(request)}`} theme={theme} trend={data.trend} />
            <TokensByProvider key={`tokens-${JSON.stringify(request)}`} theme={theme} trend={data.providerTrend} colors={colors} />
          </AccordionItem>
        ) : null}
        {!empty && (data.byProvider.length || data.byModel.length) ? (
          <AccordionItem theme={theme} id="usage-split" icon="ChartPie" title="Which providers and models" summary={data.byModel[0] ? `Most used: ${data.byModel[0].label}` : "The share each provider and model served"}>
            <ProviderSplit theme={theme} rows={data.byProvider} colors={colors} />
            <TopModels theme={theme} rows={data.byModel} colors={colors} />
          </AccordionItem>
        ) : null}
        {!empty && data.byAccount.length ? (
          <AccordionItem theme={theme} id="usage-accounts" icon="Users" title="Which account answered" summary={`${plural(data.byAccount.length, "account")} served requests ${words}`}>
            <Breakdown theme={theme} title="By account" why={`Which subscription served the requests, ${words}.`} rows={data.byAccount} />
          </AccordionItem>
        ) : null}
        {!empty && data.errors.length ? (
          <AccordionItem theme={theme} id="usage-errors" icon="CircleX" title="What failed" summary={`${plural(data.errors.reduce((sum, e) => sum + e.count, 0), "failed request")}, by kind`} tone="warning">
            <Errors theme={theme} errors={data.errors} />
          </AccordionItem>
        ) : null}
        {data.activity.length ? (
          <AccordionItem theme={theme} id="usage-year" icon="CalendarDays" title="The last year" summary="Which days had traffic, as a calendar">
            <Activity theme={theme} activity={data.activity} weeks={narrow ? 17 : 52} streak={data.totals?.streak ?? null} busiest={data.busiestWeekday} />
          </AccordionItem>
        ) : null}
      </Accordion>
      <Notes theme={theme} notes={data.notes} />
    </>
  );
}
