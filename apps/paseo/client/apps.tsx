import React, { useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cliUpdate, clis, type Clis } from "../shared/contracts";
import { useLinks } from "./dashboard";
import { errorText, type Message } from "./setup";
import { Button, Card, Chip, Disclosure, ItemTitle, Link, Meta, Note, RADIUS, Row, SPACE, TYPE, type Tone } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;
type Tool = Clis["tools"][number];
const CLIS_KEY = ["ai-router", "clis"] as const;

const STATE: Record<Tool["state"], (tool: Tool) => { label: string; tone: Tone }> = {
  current: () => ({ label: "Up to date", tone: "success" }),
  behind: (tool) => ({ label: `${tool.latest} available`, tone: "warning" }),
  ahead: () => ({ label: "Newer than npm's latest", tone: "neutral" }),
  unknown: (tool) => ({ label: tool.latest ? "Version unknown" : "Latest unknown", tone: "neutral" }),
  missing: () => ({ label: "Not installed", tone: "neutral" }),
};

function Command({ theme, text }: { theme: Theme; text: string }) {
  return (
    <View style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.sm + SPACE.hair }}>
      <Text selectable style={{ ...TYPE.mono, color: theme.colors.foreground }}>{text}</Text>
    </View>
  );
}

/** One app: its version against npm's, how it was installed, and the update (asks first) or the command to run. */
function ToolRow({ theme, tool, job, asking, busy, onAsk, onCancel, onUpdate, say }: { theme: Theme; tool: Tool; job: Clis["job"]; asking: boolean; busy: boolean; onAsk: () => void; onCancel: () => void; onUpdate: () => void; say: Say }) {
  const links = useLinks(say);
  const state = STATE[tool.state](tool);
  const running = job?.state === "running" && job.id === tool.id;
  const offer = tool.state === "behind" || tool.state === "unknown";
  return (
    <View style={{ gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
      <Row>
        <ItemTitle theme={theme}>{tool.label}</ItemTitle>
        {tool.installed ? <Meta theme={theme}>{tool.installed}</Meta> : null}
        <Chip theme={theme} label={running ? "Updating…" : state.label} tone={running ? "neutral" : state.tone} />
      </Row>
      {tool.state !== "missing" ? <Meta theme={theme} selectable>{tool.path && tool.method === "not known" ? `Installed at ${tool.path}` : `Installed with ${tool.method}`}</Meta> : null}
      {tool.canUpdate && offer && !asking ? <Row><Button theme={theme} label={tool.latest && tool.state === "behind" ? `Update to ${tool.latest}` : "Update"} icon="Download" busy={running || busy} disabled={job?.state === "running"} onPress={onAsk} /></Row> : null}
      {asking ? (
        <>
          <Note theme={theme} tone="warning">{`Runs "${tool.command}" on this daemon, as the daemon's own user. New chats use the new version; running chats keep the old one until they restart.`}</Note>
          <Row>
            <Button theme={theme} label={`Update ${tool.label}`} primary busy={busy} onPress={onUpdate} />
            <Button theme={theme} label="Cancel" onPress={onCancel} />
          </Row>
        </>
      ) : null}
      {!tool.canUpdate && tool.state !== "current" && tool.state !== "ahead" ? (
        <>
          {tool.why ? <Note theme={theme}>{tool.why}</Note> : null}
          {tool.command ? (
            <>
              <Command theme={theme} text={tool.command} />
              <Link theme={theme} label="Copy command" accessibilityLabel={`Copy the ${tool.label} update command`} onPress={() => links.copy(tool.command!, "the command")} />
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * Agent apps: the Claude Code and Codex this daemon runs, their versions
 * against npm's latest, and an Update button when AI Router knows how the copy
 * was installed and the daemon's user may write there. Otherwise, the exact
 * command. The update streams its output here while it runs.
 */
export function AgentAppsCard({ theme, say }: { theme: Theme; say: Say }) {
  const queryClient = useQueryClient();
  const call = useRpc(clis);
  const callUpdate = useRpc(cliUpdate);
  const [asking, setAsking] = useState<Tool["id"] | null>(null);
  const query = useQuery({
    queryKey: CLIS_KEY,
    queryFn: () => call({}),
    refetchInterval: (current) => (current.state.data?.job?.state === "running" ? 1_500 : 5 * 60_000),
  });
  const refresh = useMutation({ mutationFn: () => call({ refresh: true }), onSuccess: (next) => queryClient.setQueryData(CLIS_KEY, next), onError: (error) => say({ text: errorText(error), tone: "danger" }) });
  const update = useMutation({
    mutationFn: (id: Tool["id"]) => callUpdate({ id }),
    onSuccess: (result) => {
      setAsking(null);
      say({ text: result.message, tone: result.ok ? "neutral" : "danger" });
      void queryClient.invalidateQueries({ queryKey: CLIS_KEY });
    },
    onError: (error) => say({ text: errorText(error), tone: "danger" }),
  });
  const data = query.data;
  const job = data?.job ?? null;
  return (
    <Card theme={theme} title="Agent apps" icon="AppWindow" subtitle="The Claude Code and Codex this daemon runs">
      {!data ? <Note theme={theme}>{query.error ? errorText(query.error) : "Checking versions…"}</Note> : null}
      {data?.tools.map((tool) => (
        <ToolRow
          key={tool.id}
          theme={theme}
          tool={tool}
          job={job}
          asking={asking === tool.id}
          busy={update.isPending && update.variables === tool.id}
          onAsk={() => setAsking(tool.id)}
          onCancel={() => setAsking(null)}
          onUpdate={() => update.mutate(tool.id)}
          say={say}
        />
      ))}
      {job ? (
        <View style={{ gap: SPACE.sm, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: SPACE.row }}>
          <Note theme={theme} tone={job.state === "failed" ? "danger" : job.state === "done" ? "success" : "neutral"}>{job.message ?? `Running "${job.command}"…`}</Note>
          {job.output.length ? (
            <Disclosure theme={theme} quiet label="Show output" openLabel="Hide output" initiallyOpen={job.state !== "done"}>
              <Command theme={theme} text={job.output.slice(-12).join("\n")} />
            </Disclosure>
          ) : null}
        </View>
      ) : null}
      <Row>
        <Meta theme={theme}>Latest versions come from npm, checked every hour.</Meta>
        <Link theme={theme} label={refresh.isPending ? "Checking…" : "Check now"} onPress={() => refresh.mutate()} />
      </Row>
    </Card>
  );
}
