import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connectionTest, type Status } from "../shared/contracts";
import { ENDPOINT_EXAMPLES, ROUTER_IDS, type RouterId } from "../shared/logic";
import { ROUTERS } from "../shared/routers/copy";
import { Button, Card, Chip, Field, Meta, Note, Row, TYPE, type Tone } from "./ui";

type Theme = PluginTheme;
export type Message = { text: string; tone: Tone } | null;
export const STATUS_KEY = ["ai-router", "status"] as const;
export const PUBLIC_ADDRESS_WHY = "Your daemons use the endpoint above; people and browsers outside your network use this address.";
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Step({ theme, title, why }: { theme: Theme; title: string; why: string }) {
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      <Text style={{ ...TYPE.item, color: theme.colors.foreground }}>{title}</Text>
      <Note theme={theme}>{why}</Note>
    </View>
  );
}

/** Save through Test & save: the server re-tests the key and reports on any new credential. */
function useSave(onSaved: (message: Message) => void) {
  const queryClient = useQueryClient();
  const call = useRpc(connectionTest);
  const [result, setResult] = useState<Message>(null);
  const save = useMutation({
    mutationFn: call,
    onSuccess: (outcome) => {
      const message = { text: outcome.message, tone: outcome.ok ? "success" : "danger" } as const;
      setResult(message);
      if (outcome.saved) {
        void queryClient.invalidateQueries({ queryKey: ["ai-router"] });
        onSaved(message);
      }
    },
    onError: (error) => setResult({ text: errorText(error), tone: "danger" }),
  });
  return { save, result };
}

/** Steps 1–4, and the edit form once connected. A blank key keeps the saved one. */
export function ConnectionForm({ theme, data, onDone }: { theme: Theme; data: Status | undefined; onDone: (message: Message, saved: boolean) => void }) {
  const [router, setRouter] = useState<RouterId>(data?.connection.router ?? "omniroute");
  const [endpoint, setEndpoint] = useState(data?.connection.endpoint ?? "");
  const [apiKey, setApiKey] = useState("");
  const [consoleUrl, setConsoleUrl] = useState(data?.connection.consoleUrl ?? "");
  const [sshTarget, setSshTarget] = useState(data?.connection.sshTarget ?? "");
  const { save, result } = useSave((message) => {
    setApiKey("");
    onDone(message, true);
  });
  const key = data?.connection.apiKey;
  const info = ROUTERS[router];
  return (
    <>
      {data?.connection.source === "env" ? (
        <Note theme={theme}>Pre-filled from the AI_ROUTER_* variables on this daemon. That works without saving; saving here makes the panel's copy win from now on.</Note>
      ) : null}
      <Step theme={theme} title="1. Choose your router" why="AI Router drives one router on your network. Pick the kind you run." />
      <Row>
        {ROUTER_IDS.map((id) => <Button key={id} theme={theme} label={ROUTERS[id].label} primary={id === router} onPress={() => setRouter(id)} />)}
      </Row>
      <Note theme={theme}>{info.summary}</Note>
      <Step theme={theme} title="2. Endpoint URL" why="Where this daemon sends agent requests. Use an address this daemon can reach, which may differ from your laptop's." />
      <Field theme={theme} label="Endpoint URL" value={endpoint} onChangeText={setEndpoint} placeholder={ENDPOINT_EXAMPLES[0]} />
      <Meta theme={theme}>{`Local: ${ENDPOINT_EXAMPLES[0]} · Remote: ${ENDPOINT_EXAMPLES[1]}`}</Meta>
      <Step theme={theme} title="3. API key" why={`Proves this daemon may use the router. Make one per daemon (${info.keyWhere}), named after it, so usage shows per daemon.`} />
      <Field theme={theme} label={`API key (${info.keyHint})`} value={apiKey} onChangeText={setApiKey} placeholder={key?.present ? `saved …${key.last4} — leave blank to keep` : info.keyHint} secure />
      <Step theme={theme} title="Optional: public address (custom domain)" why={PUBLIC_ADDRESS_WHY} />
      <Field theme={theme} label="Public address (custom domain)" value={consoleUrl} onChangeText={setConsoleUrl} placeholder="https://ai-router.example.com" />
      <Field theme={theme} label="SSH target that can reach the router (for the dashboard on a private network)" value={sshTarget} onChangeText={setSshTarget} placeholder="root@router.example.com" />
      <Step theme={theme} title="4. Test connection & save" why="Checks the router answers and accepts the key. Nothing is saved until it does." />
      <Row>
        <Button
          theme={theme}
          label="Test connection & save"
          primary
          busy={save.isPending}
          disabled={!endpoint.trim()}
          onPress={() => save.mutate({ router, endpoint, apiKey: apiKey || undefined, consoleUrl: consoleUrl || null, sshTarget: sshTarget || null })}
        />
        {data?.problem === null ? <Button theme={theme} label="Cancel" onPress={() => onDone(null, false)} /> : null}
      </Row>
      {result ? <Note theme={theme} tone={result.tone}>{result.text}</Note> : null}
    </>
  );
}

function Credential({ theme, data, field, title, why, hint, warning, problem, onMessage }: {
  theme: Theme;
  data: Status;
  field: "token" | "manageKey";
  title: string;
  why: string;
  hint: string;
  warning?: string;
  problem?: string | null;
  onMessage: (message: Message) => void;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const { save, result } = useSave((message) => {
    setValue("");
    setOpen(false);
    onMessage(message);
  });
  const saved = data.connection[field];
  const submit = (next: string | null) => save.mutate({ router: data.connection.router, endpoint: data.connection.endpoint ?? "", [field]: next });
  return (
    <View style={{ gap: 6 }}>
      <Step theme={theme} title={title} why={why} />
      {warning ? <Note theme={theme} tone="warning">{warning}</Note> : null}
      {problem && saved.present ? <Note theme={theme} tone="warning">{`Last check failed: ${problem}`}</Note> : null}
      <Row>
        <Chip theme={theme} label={saved.present ? `Saved …${saved.last4}` : "Not set"} tone={saved.present ? "success" : "neutral"} />
        {!open ? <Button theme={theme} label={saved.present ? "Replace" : "Add"} onPress={() => setOpen(true)} /> : null}
        {!open && saved.present && data.connection.source === "saved" ? <Button theme={theme} label="Remove" busy={save.isPending} onPress={() => submit(null)} /> : null}
      </Row>
      {open ? (
        <>
          <Field theme={theme} label={title.replace(" (optional)", "")} value={value} onChangeText={setValue} placeholder={hint} secure />
          <Row>
            <Button theme={theme} label="Test & save" primary busy={save.isPending} disabled={!value.trim()} onPress={() => submit(value)} />
            <Button theme={theme} label="Cancel" onPress={() => setOpen(false)} />
          </Row>
        </>
      ) : null}
      {result ? <Note theme={theme} tone={result.tone}>{result.text}</Note> : null}
    </View>
  );
}

/**
 * The optional credentials, each with what it unlocks. The API key alone
 * covers routing, models and this key's own spend; these add the fleet view
 * and the admin actions. `tokenProblem` is the router's last complaint about the read token.
 */
export function KeysCard({ theme, data, tokenProblem, onMessage }: { theme: Theme; data: Status; tokenProblem?: string | null; onMessage: (message: Message) => void }) {
  const info = ROUTERS[data.connection.router];
  return (
    <Card theme={theme} title="More access (optional)" icon="KeyRound" subtitle="Extra keys that let this computer see and do more">
      <Note theme={theme}>The API key is enough to route agents, list models and see this key's own spend. Router operators can add:</Note>
      <Credential
        theme={theme}
        data={data}
        field="token"
        title="Read token (optional)"
        why={`Adds every account's health and quota, usage across all keys, and the router's settings. Read-only. ${info.tokenWhere}.`}
        hint={info.tokenHint}
        problem={tokenProblem ?? null}
        onMessage={onMessage}
      />
      <Credential
        theme={theme}
        data={data}
        field="manageKey"
        title="Manage key (optional)"
        why={`Adds account checks and token refresh, OmniRoute's tunnels, and changing router settings. ${info.manageWhere}.`}
        warning="Anyone who can run commands on this daemon can use this key to change the router."
        hint={info.keyHint}
        onMessage={onMessage}
      />
    </Card>
  );
}
