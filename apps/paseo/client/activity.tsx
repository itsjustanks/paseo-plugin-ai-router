import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { activity, activityDetail, type Activity, type RequestRowView, type Status } from "../shared/contracts";
import { plainReason, paseoProviderName } from "../shared/logic";
import { compactNumber as compact } from "../shared/routers/omniroute/parsers";
import { errorText } from "./setup";
import { Banner, Card, Chip, Link, Note, Row, StaleNote, Toggle, toneColor } from "./ui";

type Theme = PluginTheme;
/** Paseo's own "go to this agent"; null on hosts that do not offer it. */
export type OpenAgent = ((agentId: string) => void) | null;
type Filter = { scope: "daemon" | "all"; errorsOnly: boolean; model: string | null; provider: string | null; limit: number };
const PAGE = 25;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const seconds = (ms: number | null) => (ms === null ? null : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);
/** `cc/claude-sonnet-5` and `claude-sonnet-5` are one model: no arrow between them. */
const bare = (id: string) => id.slice(id.lastIndexOf("/") + 1).toLowerCase();

function Segmented<T extends string>({ theme, value, options, onChange }: { theme: Theme; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (next: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected }} onPress={() => onChange(option.id)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: selected ? theme.colors.accent : "transparent" }}>
            <Text style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A filter chip: tap to pick, tap again to clear. */
function Pick({ theme, label, selected, onPress }: { theme: Theme; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${selected ? "Clear" : "Only"} ${label}`} accessibilityState={{ selected }} onPress={onPress} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: selected ? theme.colors.accent : theme.colors.border, backgroundColor: selected ? theme.colors.surface2 : "transparent" }}>
      <Text style={{ color: selected ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12, fontWeight: selected ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

/** "Open" on a row whose agent Paseo still lists (it has a title); archived agents get none. */
function OpenLink({ theme, openAgent, agentId, title }: { theme: Theme; openAgent: OpenAgent; agentId: string; title: string | null }) {
  if (!openAgent || !title) return null;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title}`} onPress={() => openAgent(agentId)} hitSlop={6}>
      <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>Open</Text>
    </Pressable>
  );
}

/** Every tier: what this daemon's hook decided for each agent session. */
function Sessions({ theme, sessions, openAgent }: { theme: Theme; sessions: Activity["sessions"]; openAgent: OpenAgent }) {
  const [all, setAll] = useState(false);
  const shown = all ? sessions : sessions.slice(0, 8);
  return (
    <Card theme={theme} title="Agent sessions on this daemon">
      <Note theme={theme}>Each time an agent starts or resumes here, AI Router decides whether it goes through the router. Kept for the last 200.</Note>
      {!sessions.length ? <Note theme={theme}>No agent has started on this daemon since AI Router was installed.</Note> : null}
      {shown.map((s, i) => (
        <View key={`${s.at}-${s.agentId}-${i}`} style={{ gap: 2, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 8 }}>
          <Row>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, width: 64 }}>{time(s.at)}</Text>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}>{s.agentTitle ?? `Agent ${shortId(s.agentId)}`}</Text>
            <Chip theme={theme} label={s.routed ? "routed" : s.kind === "claude" ? "own sign-in" : "not started"} tone={s.routed ? "success" : "warning"} />
            <OpenLink theme={theme} openAgent={openAgent} agentId={s.agentId} title={s.agentTitle} />
          </Row>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {[paseoProviderName(s.provider, null), s.routed ? (s.tagged ? "requests linked in OmniRoute's log" : null) : s.reason ? plainReason(s.reason) : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ))}
      {sessions.length > 8 ? <Link theme={theme} label={all ? "Show fewer" : `Show all ${sessions.length}`} onPress={() => setAll(!all)} /> : null}
    </Card>
  );
}

/** Why OmniRoute routed one request where it did, fetched when a row is opened. */
function Detail({ theme, row }: { theme: Theme; row: RequestRowView }) {
  const call = useRpc(activityDetail);
  const query = useQuery({ queryKey: ["ai-router", "activity", "detail", row.id], queryFn: () => call({ id: row.id }), staleTime: 60_000 });
  const d = query.data;
  return (
    <View style={{ gap: 6, marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border }}>
      {row.error ? <Note theme={theme} tone="danger">{`Error: ${row.error}`}</Note> : null}
      {!d ? <Note theme={theme}>{query.error ? errorText(query.error) : "Asking the router why…"}</Note> : null}
      {d && d.state !== "ok" ? <Note theme={theme} tone="warning">{d.message}</Note> : null}
      {d && d.state === "ok" ? (
        <>
          {d.summary ? <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{d.summary}</Text> : null}
          {d.account ? <Note theme={theme}>{`Account: ${d.account}`}</Note> : null}
          {d.factors.map((f) => <Note key={f.name} theme={theme} tone={f.status === "negative" ? "danger" : f.status === "warning" ? "warning" : "neutral"}>{`${f.name}: ${f.details ?? f.value}`}</Note>)}
          {d.fallbacks.length ? <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>Tried first</Text> : null}
          {d.fallbacks.map((f, i) => <Note key={i} theme={theme} tone="warning">{`${[f.provider, f.model].filter(Boolean).join(" · ")}${f.status ? ` answered ${f.status}` : ""}${f.reason ? `: ${f.reason}` : ""}`}</Note>)}
          {d.limitations.map((l) => <Text key={l} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{l}</Text>)}
        </>
      ) : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{`Request ${row.id}. Prompts and responses are never shown here.`}</Text>
    </View>
  );
}

function RequestLine({ theme, row, open, onToggle, showDaemon, openAgent }: { theme: Theme; row: RequestRowView; open: boolean; onToggle: () => void; showDaemon: boolean; openAgent: OpenAgent }) {
  const changed = !!row.requestedModel && !!row.model && bare(row.requestedModel) !== bare(row.model);
  const tokens = row.tokensIn !== null || row.tokensOut !== null ? `${compact(row.tokensIn ?? 0)} in / ${compact(row.tokensOut ?? 0)} out` : null;
  return (
    <View style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Request ${row.id}, ${row.ok ? "succeeded" : "failed"}; ${open ? "hide" : "show"} why`} accessibilityState={{ expanded: open }} onPress={onToggle} style={{ gap: 3 }}>
        <Row>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, width: 64 }}>{time(row.at)}</Text>
          <Chip theme={theme} label={row.status === null ? (row.ok ? "ok" : "error") : String(row.status)} tone={row.ok ? "success" : "danger"} />
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}>{changed ? `${row.requestedModel} → ${row.model}` : row.model ?? row.requestedModel ?? "unknown model"}</Text>
          {row.combo ? <Chip theme={theme} label={`combo ${row.combo}`} /> : null}
          {row.fallback ? <Chip theme={theme} label="fallback" tone="warning" /> : null}
        </Row>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {[row.provider, row.account, seconds(row.latencyMs), tokens].filter(Boolean).join(" · ")}
        </Text>
        {row.error && !open ? <Text numberOfLines={1} style={{ color: toneColor(theme, "danger"), fontSize: 12 }}>{row.error}</Text> : null}
        <Row>
          {showDaemon && row.daemon ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: row.thisDaemon ? "700" : "400" }}>{row.daemon}</Text> : null}
          {showDaemon && row.thisDaemon ? <Chip theme={theme} label="this daemon" tone="success" /> : null}
          {row.agent ? <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{`Agent: ${row.agent.title ?? shortId(row.agent.id)}${row.agent.match === "likely" ? " (likely)" : ""}`}</Text> : null}
          {row.agent ? <OpenLink theme={theme} openAgent={openAgent} agentId={row.agent.id} title={row.agent.title} /> : null}
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600", marginLeft: "auto" }}>{open ? "Hide" : "Why?"}</Text>
        </Row>
      </Pressable>
      {open ? <Detail theme={theme} row={row} /> : null}
    </View>
  );
}

/**
 * One chip per model: a combo by its name, anything else by its bare id, so
 * `cc/claude-sonnet-5` and `claude-sonnet-5` are one chip. OmniRoute's model
 * filter is a substring match, so the bare id finds both.
 */
export function modelChip(row: RequestRowView): { value: string; label: string } | null {
  if (row.combo) return { value: row.combo, label: row.combo };
  const id = row.requestedModel ?? row.model;
  return id ? { value: bare(id), label: bare(id) } : null;
}

/** The five most common values of a field in the loaded rows, for filter chips; a picked one always stays. */
export function topValues(rows: readonly RequestRowView[], pick: (row: RequestRowView) => { value: string; label: string } | null, keep: string | null): Array<{ value: string; label: string }> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const got = pick(row);
    if (got) counts.set(got.value, { label: got.label, count: (counts.get(got.value)?.count ?? 0) + 1 });
  }
  const top = [...counts].sort((a, b) => b[1].count - a[1].count).map(([value, { label }]) => ({ value, label })).slice(0, 5);
  return keep && !top.some((t) => t.value === keep) ? [{ value: keep, label: keep }, ...top.slice(0, 4)] : top;
}

function Requests({ theme, data, filter, setFilter, loading, openAgent }: { theme: Theme; data: Activity["requests"]; filter: Filter; setFilter: (next: Filter) => void; loading: boolean; openAgent: OpenAgent }) {
  const [open, setOpen] = useState<string | null>(null);
  const models = topValues(data.rows, modelChip, filter.model);
  const providers = topValues(data.rows, (row) => (row.providerId ? { value: row.providerId, label: row.provider ?? row.providerId } : null), filter.provider);
  const set = (patch: Partial<Filter>) => setFilter({ ...filter, ...patch, limit: PAGE });
  return (
    <Card theme={theme} title="Requests through the router">
      {data.stale ? <StaleNote theme={theme} checkedAt={data.checkedAt} reason={data.stale.reason} /> : null}
      <Row>
        <Segmented theme={theme} value={filter.scope} options={[{ id: "daemon", label: "This daemon" }, { id: "all", label: "All daemons" }]} onChange={(scope) => set({ scope })} />
        <Toggle theme={theme} label="Errors only" value={filter.errorsOnly} onChange={(errorsOnly) => set({ errorsOnly })} />
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Errors only</Text>
      </Row>
      {models.length > 1 || filter.model ? <Row>{models.map((m) => <Pick key={m.value} theme={theme} label={m.label} selected={filter.model === m.value} onPress={() => set({ model: filter.model === m.value ? null : m.value })} />)}</Row> : null}
      {providers.length > 1 || filter.provider ? <Row>{providers.map((p) => <Pick key={p.value} theme={theme} label={p.label} selected={filter.provider === p.value} onPress={() => set({ provider: filter.provider === p.value ? null : p.value })} />)}</Row> : null}
      {data.state !== "ok" && !data.stale ? <Note theme={theme} tone={data.state === "error" ? "danger" : "neutral"}>{data.message}</Note> : null}
      {data.state === "ok" && !data.rows.length ? <Note theme={theme}>{loading ? "Asking the router…" : `No requests match${filter.scope === "daemon" ? " from this daemon" : ""}${filter.errorsOnly ? " with errors" : ""}.`}</Note> : null}
      {data.rows.map((row) => <RequestLine key={row.id} theme={theme} row={row} open={open === row.id} onToggle={() => setOpen(open === row.id ? null : row.id)} showDaemon={filter.scope === "all" || !row.thisDaemon} openAgent={openAgent} />)}
      {data.hasMore && filter.limit < 200 ? <Link theme={theme} label={loading ? "Loading…" : "Show older"} onPress={() => setFilter({ ...filter, limit: Math.min(200, filter.limit + PAGE) })} /> : null}
      {data.notes.map((n) => <Note key={n} theme={theme}>{n}</Note>)}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Refreshes every 10 seconds while this tab is open. Routing details only: prompts and responses never leave the router.</Text>
    </Card>
  );
}

/**
 * Activity: what went through the router. Sessions (every tier) come from
 * this daemon's own hook; requests (read token) from OmniRoute's call log.
 */
export function ActivityTab({ theme, data, openAgent = null }: { theme: Theme; data: Status; openAgent?: OpenAgent }) {
  const [filter, setFilter] = useState<Filter>({ scope: "daemon", errorsOnly: false, model: null, provider: null, limit: PAGE });
  const call = useRpc(activity);
  const query = useQuery({ queryKey: ["ai-router", "activity", filter], queryFn: () => call(filter), refetchInterval: 10_000, placeholderData: (previous) => previous });
  const result = query.data;
  const operator = data.tier === "operator" || data.tier === "admin";
  const connected = data.tier !== "none";
  if (!result) {
    return <Card theme={theme} title="Activity">{query.error ? <Note theme={theme} tone="danger">{errorText(query.error)}</Note> : <Note theme={theme}>Reading the activity…</Note>}</Card>;
  }
  return (
    <>
      <Sessions theme={theme} sessions={result.sessions} openAgent={openAgent} />
      {operator ? (
        <Requests theme={theme} data={result.requests} filter={filter} setFilter={setFilter} loading={query.isFetching} openAgent={openAgent} />
      ) : !connected ? (
        <Card theme={theme} title="Requests through the router">
          <Note theme={theme}>Once a router is connected with a read token, every request it served shows here.</Note>
        </Card>
      ) : (
        <Banner theme={theme} tone="neutral" title="More with a read token">
          <Note theme={theme}>A read token adds every request the router served: the model and account it used, fallbacks, combos, errors, and the agent that sent it.</Note>
        </Banner>
      )}
    </>
  );
}
