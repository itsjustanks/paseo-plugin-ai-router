import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { ANALYTICS_RANGES, usage, type AnalyticsRangeId, type Usage } from "../shared/contracts";
import { compactNumber as compact, errorWords } from "../shared/routers/omniroute/parsers";
import { Breakdown, Gate, Notes, money } from "./insights";
import { Banner, Card, Note } from "./ui";

type Theme = PluginTheme;
const RANGE_WORDS: Record<AnalyticsRangeId, string> = { "1d": "24 hours", "7d": "7 days", "30d": "30 days" };

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
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", alignSelf: "flex-start", gap: 4, padding: 3, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, marginBottom: 14 }}>
      {ANALYTICS_RANGES.map((id) => {
        const selected = id === range;
        return (
          <Pressable key={id} accessibilityRole="radio" accessibilityLabel={`Last ${RANGE_WORDS[id]}`} accessibilityState={{ selected }} onPress={() => onChange(id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7, backgroundColor: selected ? theme.colors.accent : "transparent" }}>
            <Text style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{RANGE_WORDS[id]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tile({ theme, label, value, sub }: { theme: Theme; label: string; value: string; sub: string | null }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 150, gap: 2, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "700" }}>{value}</Text>
      {sub ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{sub}</Text> : null}
    </View>
  );
}

function Tiles({ theme, totals }: { theme: Theme; totals: NonNullable<Usage["totals"]> }) {
  const inOut = totals.promptTokens !== null && totals.completionTokens !== null ? `${compact(totals.promptTokens)} in · ${compact(totals.completionTokens)} out` : null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
      <Tile theme={theme} label="Requests" value={compact(totals.requests)} sub={totals.successRatePct !== null ? `${totals.successRatePct}% succeeded` : null} />
      <Tile theme={theme} label="Tokens" value={compact(totals.tokens)} sub={inOut} />
      <Tile theme={theme} label="Estimated cost" value={money(totals.cost) ?? "$0.00"} sub="as OmniRoute prices it" />
      <Tile theme={theme} label="Average latency" value={seconds(totals.avgLatencyMs) ?? "—"} sub={totals.fallbackRatePct !== null ? `${totals.fallbackRatePct}% fell back to another model` : null} />
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
    <View style={{ flexDirection: "row", justifyContent: picks.length > 1 ? "space-between" : "flex-start", marginTop: 10 }}>
      {picks.map((i) => <Text key={i} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{day(dates[i])}</Text>)}
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
    <Card theme={theme} title="Requests per day">
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{`Busiest day: ${plural(peak, "request")}`}</Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 96, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        {trend.map((d, i) => (
          <Column key={d.date} theme={theme} values={[d.requests]} colors={[color]} peak={peak} height={96} selected={i === index} label={`${day(d.date)}: ${plural(d.requests, "request")}`} onPress={() => setPicked(i)} />
        ))}
      </View>
      <Axis theme={theme} dates={trend.map((d) => d.date)} />
      {chosen ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
          {[`${day(chosen.date)}: ${plural(chosen.requests, "request")}`, chosen.tokens ? `${compact(chosen.tokens)} tokens` : null, money(chosen.cost)].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
      <Note theme={theme}>Tap a day for its numbers. Days run midnight to midnight UTC, as the router counts them.</Note>
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
    <Card theme={theme} title="Tokens per day, by provider">
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 110, borderBottomWidth: 1, borderColor: theme.colors.border }}>
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
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
          {`${day(chosen.date)}: ${trend.providers.map((name, j) => ((chosen.values[j] ?? 0) > 0 ? `${name} ${compact(chosen.values[j])}` : null)).filter(Boolean).join(" · ") || "no tokens"}`}
        </Text>
      ) : null}
      <View style={{ gap: 6 }}>
        {trend.providers.map((name, i) => (
          <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Swatch color={palette[i]} />
            <Text style={{ color: theme.colors.foreground, fontSize: 13, flex: 1 }}>{name}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`${compact(totals[i])} tokens · ${Math.round((totals[i] / all) * 100)}%`}</Text>
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
    <Card theme={theme} title="Provider split">
      <View accessibilityLabel={rows.map((row) => `${row.label} ${Math.round((row.requests / total) * 100)}%`).join(", ")} style={{ flexDirection: "row", height: 12, gap: 2 }}>
        {rows.filter((row) => row.requests > 0).map((row, i, shown) => (
          <View key={row.label} style={{ flex: row.requests, backgroundColor: colors.get(row.label) ?? theme.colors.foregroundMuted, borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0, borderTopRightRadius: i === shown.length - 1 ? 4 : 0, borderBottomRightRadius: i === shown.length - 1 ? 4 : 0 }} />
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.label} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Swatch color={colors.get(row.label) ?? theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foreground, fontSize: 13, flexGrow: 1 }}>{row.label}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
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
    <Card theme={theme} title="Top models">
      {rows.map((row) => {
        const failed = row.failedPct ?? 0;
        return (
          <View key={`${row.provider}/${row.label}`} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Swatch color={colors.get(row.provider ?? "") ?? theme.colors.foregroundMuted} />
              <Text style={{ color: theme.colors.foreground, fontSize: 13, flexGrow: 1 }}>{row.label}</Text>
              <Text style={{ color: failed >= 5 ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12 }}>
                {[plural(row.requests, "request"), row.tokens !== null ? `${compact(row.tokens)} tokens` : null, failed > 0 ? `${failed}% failed` : null, seconds(row.avgLatencyMs ?? null)].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
              <View style={{ width: `${Math.max(2, (row.requests / top) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.get(row.provider ?? "") ?? theme.colors.foregroundMuted }} />
            </View>
          </View>
        );
      })}
      <Note theme={theme}>The swatch is the model's provider, as in the charts above.</Note>
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
    <Card theme={theme} title={`Activity, last ${weeks} weeks`}>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {columns.map((column, w) => (
          <View key={w} style={{ gap: 3 }}>
            {column.map((c) => cell(level(c.value), c.date, c.future ? undefined : () => setPicked(c.date), `${day(c.date)}: ${compact(c.value)} tokens`, c.future))}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginRight: 2 }}>Fewer tokens</Text>
        {[0, 1, 2, 3, 4].map((lvl) => cell(lvl, `legend-${lvl}`))}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginLeft: 2 }}>More</Text>
      </View>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
        {chosen ? `${day(chosen.date)}: ${compact(chosen.value)} tokens` : [streak ? `${plural(streak, "day")} in a row with traffic` : null, busiest ? `busiest weekday: ${busiest}` : null].filter(Boolean).join(" · ") || "Tap a day for its tokens."}
      </Text>
    </Card>
  );
}

function Errors({ theme, errors }: { theme: Theme; errors: Usage["errors"] }) {
  if (!errors.length) return null;
  const total = errors.reduce((sum, e) => sum + e.count, 0);
  return (
    <Card theme={theme} title="Failed requests by kind">
      {errors.map((e) => (
        <View key={e.type} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1 }}>{errorWords(e.type)}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`${compact(e.count)} · ${Math.round((e.count / total) * 100)}%`}</Text>
        </View>
      ))}
    </Card>
  );
}

/**
 * Usage & analytics, after OmniRoute's own analytics page: headline numbers,
 * requests and tokens over time, the provider split, top models, daemons and
 * accounts, a year of activity, and what failed. One `/api/usage/analytics`
 * call per range, read with the read token.
 */
export function UsageTab({ theme, compact: narrow, initialRange = "7d" }: { theme: Theme; compact: boolean; initialRange?: AnalyticsRangeId }) {
  const [range, setRange] = useState<AnalyticsRangeId>(initialRange);
  const call = useRpc(usage);
  const query = useQuery({ queryKey: ["ai-router", "usage", range], queryFn: () => call({ range }), refetchInterval: 60_000 });
  const data = query.data;
  const gate = <Gate theme={theme} title="Usage" data={data} error={query.error} loading={query.isLoading} refetch={() => void query.refetch()} />;
  const picker = <RangePicker theme={theme} range={range} onChange={setRange} />;
  if (!data || data.state !== "ok") return <>{picker}{gate}</>;
  const words = RANGE_WORDS[range];
  const names = [...data.providerTrend.providers, ...data.byProvider.map((row) => row.label), ...data.byModel.map((row) => row.provider ?? "")].filter((name, i, all) => name && all.indexOf(name) === i);
  const colors = seriesColors(theme, names);
  const empty = data.totals !== null && data.totals.requests === 0;
  return (
    <>
      {picker}
      {data.stale ? gate : null}
      {data.totals ? <Tiles theme={theme} totals={data.totals} /> : <Note theme={theme}>The router did not report totals for this range.</Note>}
      {empty ? (
        <Banner theme={theme} tone="neutral" title={`No requests in the last ${words}`}>
          <Note theme={theme}>Nothing has gone through the router with any key in this range. Once an agent uses it, it shows here within a minute.</Note>
        </Banner>
      ) : (
        <>
          {range === "1d" ? <Note theme={theme}>Daily charts start at 7 days; the numbers above cover the last 24 hours.</Note> : null}
          {range !== "1d" ? <RequestsPerDay key={`requests-${range}`} theme={theme} trend={data.trend} /> : null}
          {range !== "1d" ? <TokensByProvider key={`tokens-${range}`} theme={theme} trend={data.providerTrend} colors={colors} /> : null}
          <ProviderSplit theme={theme} rows={data.byProvider} colors={colors} />
          <TopModels theme={theme} rows={data.byModel} colors={colors} />
          <Breakdown theme={theme} title="By daemon" why={`One API key per daemon, so each row is one Paseo machine. Last ${words}.`} rows={data.byDaemon} />
          <Breakdown theme={theme} title="By account" why={`Which subscription served the requests. Last ${words}.`} rows={data.byAccount} />
          <Errors theme={theme} errors={data.errors} />
        </>
      )}
      {data.activity.length ? <Activity theme={theme} activity={data.activity} weeks={narrow ? 17 : 52} streak={data.totals?.streak ?? null} busiest={data.busiestWeekday} /> : null}
      <Notes theme={theme} notes={data.notes} />
    </>
  );
}
