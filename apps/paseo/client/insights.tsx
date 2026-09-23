import React from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountAction, accounts, accountsCheckAll, routerSettings, settingApply, usage, type Accounts, type Status, type Usage } from "../shared/contracts";
import { accountsHeadline, compactNumber as compact, healthLine, providerLabel } from "../server/routers/omniroute/parsers";
import { CODEX_LOGIN_PORT, dashboardLink, formatUptime, providerDashboardPage } from "../shared/logic";
import { ROUTERS } from "../server/routers/copy";
import { dashboardTarget, useLinks } from "./dashboard";
import { openInBrowser } from "./links";
import type { Message } from "./setup";
import { Banner, Button, Card, Chip, Link, Note, Row, StaleNote, toneColor, type Tone } from "./ui";

type Theme = PluginTheme;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const money = (n: number | null) => (n === null || n <= 0 ? null : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const tone = (pct: number): Tone => (pct <= 10 ? "danger" : pct <= 30 ? "warning" : "success");

function Bar({ theme, pct, color }: { theme: Theme; pct: number; color: string }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden", flexGrow: 1 }}>
      <View style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: 6, backgroundColor: color }} />
    </View>
  );
}

/** Loading, no token, or an error, said once and plainly. When the router is down, the last answer shows under a note. Null when there is data to show. */
function Gate({ theme, title, data, error, loading, refetch }: { theme: Theme; title: string; data: { state: string; message: string | null; checkedAt?: string | null; stale?: { reason: string } | null } | undefined; error: unknown; loading: boolean; refetch: () => void }) {
  if (!data) {
    return <Card theme={theme} title={title}>{error ? <Note theme={theme} tone="danger">{errorText(error)}</Note> : <Note theme={theme}>{loading ? "Asking the router…" : "No answer yet."}</Note>}</Card>;
  }
  if (data.stale) return <StaleNote theme={theme} checkedAt={data.checkedAt ?? null} reason={data.stale.reason} />;
  if (data.state === "ok") return null;
  if (data.state === "no-token") {
    return (
      <Banner theme={theme} tone="neutral" title={`${title}: read token needed`}>
        <Note theme={theme}>{data.message}</Note>
        <Note theme={theme}>Add it on the Connection tab, under More access. It is read-only and cannot change anything.</Note>
      </Banner>
    );
  }
  return (
    <Banner theme={theme} tone="danger" title={`Could not read ${title.toLowerCase()}`}>
      <Note theme={theme}>{data.message}</Note>
      <Row><Button theme={theme} label="Try again" onPress={refetch} /></Row>
    </Banner>
  );
}

/** Parts that failed while the rest worked. Small print, at the bottom. */
function Notes({ theme, notes }: { theme: Theme; notes: string[] }) {
  return notes.length ? <View style={{ gap: 4, marginTop: 4 }}>{notes.map((note) => <Note key={note} theme={theme}>{note}</Note>)}</View> : null;
}

/** "session (5h)" → "5-hour limit", "spark 5h" → "Spark · 5-hour limit". */
function quotaName(name: string): string {
  const lower = name.toLowerCase();
  const window = /5h|session/.test(lower) ? "5-hour limit" : /7d|weekly/.test(lower) ? "weekly limit" : null;
  if (!window) return name;
  const extra = lower.replace(/session|weekly|\(?5h\)?|\(?7d\)?/g, "").trim();
  const text = extra ? `${extra} · ${window}` : window;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Version and uptime from the status poll, the rest from `/api/monitoring/health` and `/api/provider-stats`. */
function RouterHealth({ theme, router, version, uptime }: { theme: Theme; router: Accounts["router"]; version: string | null; uptime: number | null }) {
  if (!router && !version) return null;
  return (
    <Card theme={theme} title="Router health">
      <Row>
        {router?.breakers ? <Chip theme={theme} label={router.breakers.text} tone={router.breakers.tone} /> : null}
        {version ? <Chip theme={theme} label={`version ${version}`} /> : null}
        {uptime !== null ? <Chip theme={theme} label={`running ${formatUptime(uptime)}`} /> : null}
        {router?.p95Ms ? <Chip theme={theme} label={`95% answer within ${seconds(router.p95Ms)}`} /> : null}
      </Row>
      {router?.providers.map((p) => (
        <Note key={p.name} theme={theme} tone={p.errorPct ? "warning" : "neutral"}>
          {`${providerLabel(p.name)}: ${p.requests} requests · ${p.errorPct === null ? "error rate unknown" : p.errorPct === 0 ? "no errors" : `${p.errorPct}% failed`}${p.avgLatencyMs !== null ? ` · ${seconds(p.avgLatencyMs)} on average` : ""}`}
        </Note>
      ))}
      {router?.failingModels.map((m) => (
        <Note key={`${m.provider}/${m.model}`} theme={theme} tone="danger">{`${m.model} (${providerLabel(m.provider)}): ${m.failed} of ${m.requests} requests failed`}</Note>
      ))}
    </Card>
  );
}

const EXPIRY_WORDS = { expired: "Sign-in expired", expiring_soon: "Sign-in expires soon", active: "", unknown: "" } as const;

/**
 * Accounts for operators (read token). With a manage key: Check now, Check
 * all and Refresh token. Re-login and Add account are the dashboard's pages,
 * which ask for their own login.
 */
export function AccountsTab({ theme, data: status, say }: { theme: Theme; data: Status; say: (message: Message) => void }) {
  const queryClient = useQueryClient();
  const call = useRpc(accounts);
  const callAction = useRpc(accountAction);
  const callAll = useRpc(accountsCheckAll);
  const links = useLinks(say);
  const query = useQuery({ queryKey: ["ai-router", "accounts"], queryFn: () => call({}), refetchInterval: 30_000 });
  const done = (result: { ok: boolean; message: string }) => {
    say({ text: result.message, tone: result.ok ? "success" : "danger" });
    void queryClient.invalidateQueries({ queryKey: ["ai-router", "accounts"] });
  };
  const fail = (error: unknown) => say({ text: errorText(error), tone: "danger" });
  const action = useMutation({ mutationFn: (input: { action: "test" | "refresh"; id: string; name: string }) => callAction(input), onSuccess: done, onError: fail });
  const all = useMutation({ mutationFn: () => callAll({}), onSuccess: done, onError: fail });
  const data = query.data;
  const version = status.health?.version ?? null;
  const uptime = status.health?.uptimeSeconds ?? null;
  const dashboard = dashboardTarget(status).url;
  const copy = ROUTERS[status.connection.router];
  const gate = <Gate theme={theme} title="Accounts" data={data} error={query.error} loading={query.isLoading} refetch={() => void query.refetch()} />;
  const paused = data?.router?.paused ?? [];
  const head = data?.state === "ok" ? accountsHeadline(data.accounts, time) : null;
  const busy = (id: string, kind: "test" | "refresh") => action.isPending && action.variables?.id === id && action.variables.action === kind;
  const hasCodex = data?.accounts.some((account) => account.provider === "codex") ?? false;
  const addPage = dashboardLink(dashboard, copy.providersPage);
  return (
    <>
      {gate}
      {paused.map((p) => (
        <Banner key={p.provider} theme={theme} tone="danger" title={`${providerLabel(p.provider)} traffic paused by OmniRoute's circuit breaker`}>
          <Note theme={theme}>{`Last error: ${p.lastError ?? "not recorded"}`}</Note>
          <Note theme={theme}>{`${providerLabel(p.provider)} requests fail until OmniRoute tries again${p.retryAfterMs ? ` in ${Math.ceil(p.retryAfterMs / 1000)} s` : ""}. Other providers keep working.${data?.canAct ? " The Settings tab can reset it." : ""}`}</Note>
        </Banner>
      ))}
      {data && head && !paused.length ? <Banner theme={theme} tone={head.tone === "success" ? "success" : head.tone === "neutral" ? "neutral" : "warning"} title={head.text} /> : null}
      {data && head ? (
        <Card theme={theme} title="Accounts">
          <Row>
            {data.canAct ? <Button theme={theme} label="Check all" busy={all.isPending} onPress={() => all.mutate()} /> : null}
            {addPage ? <Link theme={theme} label="Add account" onPress={() => void links.open(addPage)} /> : null}
          </Row>
          {hasCodex ? <Note theme={theme}>{`Codex sign-in in the dashboard calls back to port ${CODEX_LOGIN_PORT} on the computer with the browser. If the dashboard runs elsewhere, forward that port too: ssh -L ${CODEX_LOGIN_PORT}:127.0.0.1:${CODEX_LOGIN_PORT} <router-host>.`}</Note> : null}
          {data.accounts.map((account, index) => {
            const isPaused = paused.some((p) => p.provider === account.provider);
            const relogin = providerDashboardPage(dashboard, account.provider);
            const expiry = account.expiry && EXPIRY_WORDS[account.expiry.status];
            return (
            <View key={account.id} style={{ gap: 6, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12, marginTop: index ? 0 : 4 }}>
              <Row>
                <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{account.shortName}</Text>
                {isPaused ? <Chip theme={theme} label="Paused" tone="danger" /> : <Chip theme={theme} label={account.state === "healthy" ? "Healthy" : account.state === "disabled" ? "Disabled" : "Needs attention"} tone={account.state === "healthy" ? "success" : account.state === "disabled" ? "neutral" : "warning"} />}
                {account.label ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{account.label}</Text> : null}
              </Row>
              {account.problem ? <Note theme={theme} tone={account.state === "disabled" ? "neutral" : "warning"}>{account.problem.charAt(0).toUpperCase() + account.problem.slice(1)}</Note> : null}
              {account.coolingUntil ? <Note theme={theme} tone="warning">{`Cooling down until ${time(account.coolingUntil)}`}</Note> : null}
              {expiry ? <Note theme={theme} tone={account.expiry!.status === "expired" ? "danger" : "warning"}>{`${expiry}${account.expiry!.expiresAt ? ` (${account.expiry!.expiresAt.slice(0, 10)})` : ""}${account.expiry!.note ? `: ${account.expiry!.note}` : ""}`}</Note> : null}
              {account.quotas.map((quota) => (
                <View key={quota.name} style={{ gap: 3 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 }}>{quotaName(quota.name)}</Text>
                    <Text style={{ color: toneColor(theme, tone(quota.remainingPct) === "success" ? "neutral" : tone(quota.remainingPct)), fontSize: 12 }}>{`${quota.remainingPct}% left${quota.resetAt ? ` · resets ${time(Date.parse(quota.resetAt))}` : ""}`}</Text>
                  </View>
                  <Bar theme={theme} pct={quota.remainingPct} color={toneColor(theme, tone(quota.remainingPct))} />
                </View>
              ))}
              {account.quotas.length === 0 && account.state !== "disabled" ? <Note theme={theme}>No quota reported for this account yet.</Note> : null}
              {account.health ? <Note theme={theme} tone={account.health.state === "healthy" ? "neutral" : "warning"}>{healthLine(account.health)}</Note> : null}
              <Row>
                {data.canAct ? <Button theme={theme} label="Check now" busy={busy(account.id, "test")} onPress={() => action.mutate({ action: "test", id: account.id, name: account.shortName })} /> : null}
                {data.canAct && account.authType === "oauth" ? <Button theme={theme} label="Refresh token" busy={busy(account.id, "refresh")} onPress={() => action.mutate({ action: "refresh", id: account.id, name: account.shortName })} /> : null}
                {relogin && (account.problem === "re-login required" || account.expiry?.status === "expired" || account.expiry?.status === "expiring_soon") ? <Link theme={theme} label="Re-login in dashboard" onPress={() => void links.open(relogin)} /> : null}
              </Row>
            </View>
            );
          })}
          <Notes theme={theme} notes={data.notes} />
        </Card>
      ) : null}
      <RouterHealth theme={theme} router={data?.router ?? null} version={version} uptime={uptime} />
    </>
  );
}

function Totals({ theme, title, totals }: { theme: Theme; title: string; totals: Usage["day"] }) {
  const figures = totals
    ? [totals.tokens !== null ? `${compact(totals.tokens)} tokens` : null, money(totals.cost), totals.successRatePct !== null && totals.requests > 0 ? `${totals.successRatePct}% succeeded` : null].filter(Boolean).join(" · ")
    : "";
  return (
    <View style={{ flexGrow: 1, flexBasis: 150, gap: 2 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{title}</Text>
      {!totals ? <Note theme={theme}>Not reported.</Note> : null}
      {totals ? <Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "700" }}>{totals.requests === 0 ? "No requests" : `${compact(totals.requests)} request${totals.requests === 1 ? "" : "s"}`}</Text> : null}
      {totals && totals.requests > 0 && figures ? <Note theme={theme}>{figures}</Note> : null}
    </View>
  );
}

function Breakdown({ theme, title, why, rows }: { theme: Theme; title: string; why: string; rows: Usage["byAccount"] }) {
  if (!rows.length) return null;
  const top = Math.max(1, ...rows.map((row) => row.requests));
  return (
    <Card theme={theme} title={title}>
      <Note theme={theme}>{why}</Note>
      {rows.map((row) => (
        <View key={row.label} style={{ gap: 3 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: row.thisDaemon ? "700" : "400", flexShrink: 1 }}>{row.label}</Text>
              {row.thisDaemon ? <Chip theme={theme} label="this daemon" tone="success" /> : null}
            </View>
            <Text style={{ color: row.failedPct ? toneColor(theme, "danger") : theme.colors.foregroundMuted, fontSize: 12 }}>
              {[`${row.requests} req`, row.tokens !== null ? `${compact(row.tokens)} tokens` : null, money(row.cost), row.failedPct ? `${row.failedPct}% failed` : null].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Bar theme={theme} pct={(row.requests / top) * 100} color={row.thisDaemon ? theme.colors.accent : theme.colors.border} />
        </View>
      ))}
    </Card>
  );
}

export function UsageTab({ theme }: { theme: Theme }) {
  const call = useRpc(usage);
  const query = useQuery({ queryKey: ["ai-router", "usage"], queryFn: () => call({}), refetchInterval: 60_000 });
  const data = query.data;
  const gate = <Gate theme={theme} title="Usage" data={data} error={query.error} loading={query.isLoading} refetch={() => void query.refetch()} />;
  if (!data || data.state !== "ok") return gate;
  const stale = data.stale ? gate : null;
  if (data.week && data.week.requests === 0) {
    return (
      <Banner theme={theme} tone="neutral" title="No requests in the last 7 days">
        <Note theme={theme}>Nothing has gone through the router with any key this week. Once an agent uses it, usage shows here within a minute.</Note>
        <Notes theme={theme} notes={data.notes} />
      </Banner>
    );
  }
  const peak = Math.max(1, ...data.trend.map((day) => day.requests));
  return (
    <>
      {stale}
      <Card theme={theme} title="Usage">
        <Row>
          <Totals theme={theme} title="Last 24 hours" totals={data.day} />
          <Totals theme={theme} title="Last 7 days" totals={data.week} />
        </Row>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, height: 70 }}>
          {data.trend.map((day) => (
            <View key={day.date} style={{ flex: 1, alignItems: "center", gap: 2 }}>
              <View style={{ width: "100%", height: Math.max(2, (day.requests / peak) * 48), borderRadius: 3, backgroundColor: day.requests ? theme.colors.accent : theme.colors.surface2 }} />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{day.date.slice(5)}</Text>
            </View>
          ))}
        </View>
        <Note theme={theme}>Requests per day. Days run midnight to midnight UTC, as the router counts them.</Note>
        <Notes theme={theme} notes={data.notes} />
      </Card>
      <Breakdown theme={theme} title="By daemon" why="One API key per daemon, so each row is one Paseo machine. Last 7 days." rows={data.byDaemon} />
      <Breakdown theme={theme} title="By account" why="Which subscription served the requests. Last 7 days." rows={data.byAccount} />
      <Breakdown theme={theme} title="Top models" why="The five most-used models. Last 7 days." rows={data.topModels} />
    </>
  );
}

/**
 * A few router settings, read with the read token. With a manage key saved,
 * the switches and the breaker reset work from here; otherwise each links to
 * its page in the router's dashboard.
 */
export function RouterSettingsCard({ theme, dashboardUrl, onMessage }: { theme: Theme; dashboardUrl: string | null; onMessage: (message: Message) => void }) {
  const queryClient = useQueryClient();
  const call = useRpc(routerSettings);
  const callApply = useRpc(settingApply);
  const query = useQuery({ queryKey: ["ai-router", "settings"], queryFn: () => call({}), refetchInterval: 60_000 });
  const [confirming, setConfirming] = React.useState(false);
  const apply = useMutation({
    mutationFn: callApply,
    onSuccess: (result) => {
      setConfirming(false);
      onMessage({ text: result.message, tone: result.ok ? "success" : "danger" });
      void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
    },
    onError: (error) => onMessage({ text: error instanceof Error ? error.message : String(error), tone: "danger" }),
  });
  const data = query.data;
  if (!data || data.state !== "ok") return <Gate theme={theme} title="Router settings" data={data} error={query.error} loading={query.isLoading} refetch={() => void query.refetch()} />;
  return (
    <>
    {data.stale ? <StaleNote theme={theme} checkedAt={data.checkedAt} reason={data.stale.reason} /> : null}
    <Card theme={theme} title="Router settings">
      <Note theme={theme}>{data.canEdit ? "Your manage key lets you change these here." : "Read-only here; each links to its page in the dashboard."}</Note>
      {data.items.map((item) => {
        const link = dashboardLink(dashboardUrl, item.dashboardPath);
        const editable = data.canEdit && item.id !== "routing";
        return (
          <View key={item.id} style={{ gap: 4, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12 }}>
            <Row>
              <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{item.label}</Text>
              <Chip theme={theme} label={item.value} tone={item.tone} />
            </Row>
            <Note theme={theme}>{item.why}</Note>
            {item.detail ? <Note theme={theme}>{item.detail}</Note> : null}
            <Row>
              {editable && item.toggle !== null && (item.id === "compression" || item.id === "preferClaudeCode") ? (
                <Button theme={theme} label={item.toggle ? "Turn off" : "Turn on"} busy={apply.isPending} onPress={() => apply.mutate({ id: item.id === "compression" ? "compression" : "preferClaudeCode", on: !item.toggle })} />
              ) : null}
              {editable && item.action ? (
                confirming ? (
                  <Button theme={theme} label="Confirm reset" busy={apply.isPending} onPress={() => apply.mutate({ id: "breakers" })} />
                ) : (
                  <Button theme={theme} label={item.action} onPress={() => setConfirming(true)} />
                )
              ) : null}
              {link ? <Link theme={theme} label={editable ? "Open in dashboard" : "Change in dashboard"} onPress={() => void openInBrowser(link)} /> : null}
            </Row>
          </View>
        );
      })}
      <Notes theme={theme} notes={data.notes} />
    </Card>
    </>
  );
}
