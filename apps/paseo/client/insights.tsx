import React from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { access, accountAction, accountReset, accounts, accountsCheckAll, routerSettings, settingApply, type Accounts, type Status, type Usage } from "../shared/contracts";
import { accountsHeadline, compactNumber as compact, healthLine, providerLabel, quotaName } from "../shared/routers/omniroute/parsers";
import { CODEX_LOGIN_PORT, dashboardLink, formatUptime, formatUsd, providerDashboardPage, resetLabel, resetQuestion, type ResetKind } from "../shared/logic";
import { ROUTERS } from "../shared/routers/copy";
import { dashboardTarget, useLinks } from "./dashboard";
import { openInBrowser } from "./links";
import type { Message } from "./setup";
import { Accordion, AccordionItem, Banner, Button, Card, Chip, Disclosure, Fact, ItemTitle, Link, Meta, Note, Row, StaleNote, TYPE, toneColor, type Tone, SPACE } from "./ui";

type Theme = PluginTheme;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** A positive amount in dollars, or null when there is nothing to show. */
export const money = (n: number | null) => (n === null || n <= 0 ? null : formatUsd(n));
const tone = (pct: number): Tone => (pct <= 10 ? "danger" : pct <= 30 ? "warning" : "success");

export function Bar({ theme, pct, color }: { theme: Theme; pct: number; color: string }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surface2, overflow: "hidden", flexGrow: 1 }}>
      <View style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

/** Loading, no token, or an error, said once and plainly. When the router is down, the last answer shows under a note. Null when there is data to show. */
export function Gate({ theme, title, data, error, loading, refetch }: { theme: Theme; title: string; data: { state: string; message: string | null; checkedAt?: string | null; stale?: { reason: string } | null } | undefined; error: unknown; loading: boolean; refetch: () => void }) {
  if (!data) {
    return <Card theme={theme} title={title}>{error ? <Note theme={theme} tone="danger">{errorText(error)}</Note> : <Note theme={theme}>{loading ? "Asking the router…" : "No answer yet."}</Note>}</Card>;
  }
  if (data.stale) return <StaleNote theme={theme} checkedAt={data.checkedAt ?? null} reason={data.stale.reason} />;
  if (data.state === "ok") return null;
  if (data.state === "no-token") {
    return (
      <Banner theme={theme} tone="neutral" title={`${title}: read token needed`}>
        <Note theme={theme}>{data.message}</Note>
        <Note theme={theme}>Add it in Help, under "How do I see accounts and usage?". It is read-only and cannot change anything.</Note>
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
export function Notes({ theme, notes }: { theme: Theme; notes: string[] }) {
  return notes.length ? <View style={{ gap: SPACE.xs, marginTop: SPACE.xs }}>{notes.map((note) => <Note key={note} theme={theme}>{note}</Note>)}</View> : null;
}

/** What this key itself may see: its name, spend against its limit, the accounts' quota. Nothing about other keys. */
export function YourAccess({ theme, data }: { theme: Theme; data: Status }) {
  const call = useRpc(access);
  const query = useQuery({ queryKey: ["ai-router", "access"], queryFn: () => call({}), refetchInterval: 60_000 });
  const mine = query.data;
  const models = data.aiProvider.present ? `${data.aiProvider.modelCount} models on connected accounts` : null;
  if (!mine) return <Note theme={theme}>{query.error ? errorText(query.error) : "Asking the router…"}</Note>;
  if (mine.state !== "ok") {
    return (
      <>
        {models ? <Fact theme={theme} label="Models" value={models} /> : null}
        <Note theme={theme} tone={mine.state === "error" ? "warning" : "neutral"}>{mine.message}</Note>
      </>
    );
  }
  return (
    <>
      {mine.keyName ? <Fact theme={theme} label="This key" value={mine.keyName} /> : null}
      {models ? <Fact theme={theme} label="Models" value={models} /> : null}
      {mine.spend ? (
        <Fact
          theme={theme}
          label={`Spend (${mine.spend.period})`}
          value={mine.spend.limitUsd !== null ? `${formatUsd(mine.spend.usedUsd)} of ${formatUsd(mine.spend.limitUsd)}${mine.spend.resetAt ? ` · resets ${mine.spend.resetAt.slice(0, 10)}` : ""}` : `${formatUsd(mine.spend.usedUsd)} · no limit set`}
        />
      ) : null}
      {mine.tokens !== null ? <Fact theme={theme} label="Tokens" value={`${Math.round(mine.tokens).toLocaleString()} this period`} /> : null}
      {mine.quotas.map((quota) => <Fact key={quota.provider + quota.text} theme={theme} label={`${quota.provider} quota`} value={quota.text} />)}
    </>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Version and uptime from the status poll, the rest from `/api/monitoring/health` and `/api/provider-stats`. */
function RouterHealth({ theme, router, version, uptime }: { theme: Theme; router: Accounts["router"]; version: string | null; uptime: number | null }) {
  return (
    <>
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
    </>
  );
}

/** Paseo 0.11+ daemons put each account on Paseo's own Usage page too; say where, once. */
function NativeUsageNote({ theme }: { theme: Theme }) {
  return <Meta theme={theme}>Also on Paseo's Usage page (Settings → Usage), where a limit can be pinned to the sidebar.</Meta>;
}

type ResetAsk = { kind: ResetKind | "breaker"; provider: string; id?: string; model: string | null; name: string; credits: number | null };

/** The question a reset asks before it runs, with its confirm and cancel. */
function ResetConfirm({ theme, ask, busy, onConfirm, onCancel }: { theme: Theme; ask: ResetAsk; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <View style={{ gap: SPACE.sm }}>
      <Note theme={theme} tone="warning">{resetQuestion(ask.kind, { name: ask.name, provider: providerLabel(ask.provider), model: ask.model, credits: ask.credits })}</Note>
      <Row>
        <Button theme={theme} label={resetLabel(ask.kind, ask.model)} primary busy={busy} onPress={onConfirm} />
        <Button theme={theme} label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

const EXPIRY_WORDS = { expired: "Sign-in expired", expiring_soon: "Sign-in expires soon", active: "", unknown: "" } as const;

/**
 * Accounts for operators (read token). With a manage key: Check now, Check
 * all and Refresh token. Re-login and Add account are the dashboard's pages,
 * which ask for their own login.
 */
export function AccountsTab({ theme, data: status, say, children, folds }: { theme: Theme; data: Status; say: (message: Message) => void; children?: React.ReactNode; folds?: React.ReactNode }) {
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
  const callReset = useRpc(accountReset);
  const [asking, setAsking] = React.useState<ResetAsk | null>(null);
  const reset = useMutation({
    mutationFn: (ask: ResetAsk) => callReset({ kind: ask.kind, provider: ask.provider, id: ask.id, model: ask.model, name: ask.name, confirm: true }),
    onSuccess: (result) => { setAsking(null); done(result); },
    onError: (error) => { setAsking(null); fail(error); },
  });
  const confirmFor = (match: (ask: ResetAsk) => boolean) => (asking && match(asking) ? <ResetConfirm theme={theme} ask={asking} busy={reset.isPending} onConfirm={() => reset.mutate(asking)} onCancel={() => setAsking(null)} /> : null);
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
      {paused.map((p) => {
        const name = providerLabel(p.provider);
        const ask: ResetAsk = { kind: "breaker", provider: p.provider, model: null, name, credits: null };
        return (
          <Banner key={p.provider} theme={theme} tone="danger" title={`${name} paused after errors`}>
            <Note theme={theme}>{`${name} requests fail until OmniRoute retries${p.retryAfterMs ? ` in ${Math.ceil(p.retryAfterMs / 1000)} s` : ""}; other providers work. Last error: ${p.lastError ?? "not recorded"}`}</Note>
            {data?.canAct && p.canResume && !(asking?.kind === "breaker" && asking.provider === p.provider) ? <Row><Button theme={theme} label={resetLabel("breaker")} icon="Play" onPress={() => setAsking(ask)} /></Row> : null}
            {confirmFor((a) => a.kind === "breaker" && a.provider === p.provider)}
          </Banner>
        );
      })}
      {data && head && !paused.length ? <Banner theme={theme} tone={head.tone === "success" ? "success" : head.tone === "neutral" ? "neutral" : "warning"} title={head.text} /> : null}
      {data && head ? (
        <Card theme={theme} title="Accounts" icon="Users">
          {status.nativeUsage ? <NativeUsageNote theme={theme} /> : null}
          <Row>
            {data.canAct ? <Button theme={theme} label="Check all" icon="RefreshCw" busy={all.isPending} onPress={() => all.mutate()} /> : null}
            {addPage ? <Link theme={theme} label="Add account" onPress={() => void links.open(addPage)} /> : null}
          </Row>
          {hasCodex ? (
            <Disclosure theme={theme} quiet label="Signing in Codex from another computer?">
              <Meta theme={theme}>{`Codex sign-in calls back to port ${CODEX_LOGIN_PORT} on the computer with the browser. Forward it too: ssh -L ${CODEX_LOGIN_PORT}:127.0.0.1:${CODEX_LOGIN_PORT} <router-host>`}</Meta>
            </Disclosure>
          ) : null}
          {data.accounts.map((account, index) => {
            const isPaused = paused.some((p) => p.provider === account.provider);
            const relogin = providerDashboardPage(dashboard, account.provider);
            const expiry = account.expiry && EXPIRY_WORDS[account.expiry.status];
            return (
            <View key={account.id} style={{ gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row, marginTop: index ? 0 : 4 }}>
              <Row>
                <ItemTitle theme={theme}>{account.shortName}</ItemTitle>
                {isPaused ? <Chip theme={theme} label="Paused" tone="danger" /> : <Chip theme={theme} label={account.state === "healthy" ? "Healthy" : account.state === "disabled" ? "Disabled" : "Needs attention"} tone={account.state === "healthy" ? "success" : account.state === "disabled" ? "neutral" : "warning"} />}
                {account.label ? <Meta theme={theme}>{account.label}</Meta> : null}
              </Row>
              {account.problem ? <Note theme={theme} tone={account.state === "disabled" ? "neutral" : "warning"}>{account.problem.charAt(0).toUpperCase() + account.problem.slice(1)}</Note> : null}
              {account.coolingUntil ? <Note theme={theme} tone="warning">{`Cooling down until ${time(account.coolingUntil)}`}</Note> : null}
              {expiry ? <Note theme={theme} tone={account.expiry!.status === "expired" ? "danger" : "warning"}>{`${expiry}${account.expiry!.expiresAt ? ` (${account.expiry!.expiresAt.slice(0, 10)})` : ""}${account.expiry!.note ? `: ${account.expiry!.note}` : ""}`}</Note> : null}
              {account.quotas.map((quota) => (
                <View key={quota.name} style={{ gap: SPACE.hair }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: SPACE.sm }}>
                    <Text style={{ ...TYPE.secondary, color: theme.colors.foreground, flexShrink: 1 }}>{quotaName(quota.name)}</Text>
                    <Text style={{ ...TYPE.secondary, color: tone(quota.remainingPct) === "success" ? theme.colors.foregroundMuted : toneColor(theme, tone(quota.remainingPct)) }}>{`${quota.remainingPct}% left${quota.resetAt ? ` · resets ${time(Date.parse(quota.resetAt))}` : ""}`}</Text>
                  </View>
                  <Bar theme={theme} pct={quota.remainingPct} color={toneColor(theme, tone(quota.remainingPct))} />
                </View>
              ))}
              {account.quotas.length === 0 && account.state !== "disabled" ? <Meta theme={theme}>No quota reported yet.</Meta> : null}
              {account.resetCredits ? <Meta theme={theme}>{`${account.resetCredits} usage-limit reset credit${account.resetCredits === 1 ? "" : "s"} banked`}</Meta> : null}
              {account.health ? <Meta theme={theme}>{healthLine(account.health)}</Meta> : null}
              <Row>
                {data.canAct ? <Button theme={theme} label="Check now" icon="Stethoscope" busy={busy(account.id, "test")} onPress={() => action.mutate({ action: "test", id: account.id, name: account.shortName })} /> : null}
                {data.canAct && account.authType === "oauth" ? <Button theme={theme} label="Refresh token" busy={busy(account.id, "refresh")} onPress={() => action.mutate({ action: "refresh", id: account.id, name: account.shortName })} /> : null}
                {data.canAct
                  ? account.resets.map((r) => (
                      <Button key={`${r.kind}/${r.model ?? ""}`} theme={theme} label={resetLabel(r.kind, r.model)} icon={r.kind === "credit" ? "RotateCcw" : "TimerReset"} disabled={reset.isPending} onPress={() => setAsking({ kind: r.kind, provider: account.provider, id: account.id, model: r.model, name: account.shortName, credits: account.resetCredits })} />
                    ))
                  : null}
                {relogin && (account.problem === "re-login required" || account.expiry?.status === "expired" || account.expiry?.status === "expiring_soon") ? <Link theme={theme} label="Re-login in dashboard" onPress={() => void links.open(relogin)} /> : null}
              </Row>
              {confirmFor((a) => a.kind !== "breaker" && a.id === account.id)}
            </View>
            );
          })}
          <Notes theme={theme} notes={data.notes} />
        </Card>
      ) : null}
      {children}
      <Accordion theme={theme}>
        {data?.router || version ? (
          <AccordionItem theme={theme} id="router-health" icon="HeartPulse" title="Is the router healthy?" summary={[data?.router?.breakers?.text, version ? `version ${version}` : null, uptime !== null ? `running ${formatUptime(uptime)}` : null].filter(Boolean).join(" · ")} tone={data?.router?.failingModels.length ? "warning" : undefined}>
            <RouterHealth theme={theme} router={data?.router ?? null} version={version} uptime={uptime} />
          </AccordionItem>
        ) : null}
        {folds}
      </Accordion>
    </>
  );
}

/** Rows with a proportional bar; "this daemon" highlighted. Used by the analytics view. */
export function Breakdown({ theme, title, why, rows, icon }: { theme: Theme; title: string; why: string; rows: Usage["byAccount"]; icon?: string }) {
  if (!rows.length) return null;
  const top = Math.max(1, ...rows.map((row) => row.requests));
  return (
    <Card theme={theme} title={title} icon={icon}>
      <Meta theme={theme}>{why}</Meta>
      {rows.map((row) => (
        <View key={row.label} style={{ gap: SPACE.hair }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, flexShrink: 1 }}>
              <Text style={{ ...TYPE.body, color: theme.colors.foreground, fontWeight: row.thisDaemon ? "700" : "400", flexShrink: 1 }}>{row.label}</Text>
              {row.thisDaemon ? <Chip theme={theme} label="this daemon" tone="success" /> : null}
            </View>
            <Text style={{ ...TYPE.secondary, color: row.failedPct ? toneColor(theme, "danger") : theme.colors.foregroundMuted }}>
              {[`${row.requests} req`, row.tokens !== null ? `${compact(row.tokens)} tokens` : null, money(row.cost), row.failedPct ? `${row.failedPct}% failed` : null].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Bar theme={theme} pct={(row.requests / top) * 100} color={row.thisDaemon ? theme.colors.accent : theme.colors.border} />
        </View>
      ))}
    </Card>
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
    <Card theme={theme} title="Router settings" icon="Settings2" subtitle="A few of the router's settings worth knowing">
      <Note theme={theme}>{data.canEdit ? "Your manage key lets you change these here." : "Read-only here; each links to its page in the dashboard."}</Note>
      {data.items.map((item) => {
        const link = dashboardLink(dashboardUrl, item.dashboardPath);
        const editable = data.canEdit && item.id !== "routing";
        return (
          <View key={item.id} style={{ gap: SPACE.xs, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
            <Row>
              <ItemTitle theme={theme}>{item.label}</ItemTitle>
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
