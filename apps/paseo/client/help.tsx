import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { RECOMMENDED_PLUGINS } from "../shared/plugins";
import { ROUTERS } from "../shared/routers/copy";
import type { GoTarget } from "../shared/tabs";
import { ConnectionCard, DashboardCard } from "./connection";
import { dashboardTarget } from "./dashboard";
import { GuideCard } from "./guide";
import { RouterSettingsCard } from "./insights";
import { CompressionCard, InPaseoCard, MoreCard, RouterSettingsNeedToken } from "./settings";
import { KeysCard, type Message } from "./setup";
import { ShareCard } from "./share";
import { TipsTab } from "./tips";
import { Accordion, AccordionItem, Button, Note, Row } from "./ui";

type Theme = PluginTheme;

/**
 * Help (0.20.0): plain questions only, every one folded, the guide among
 * them ("How does AI Router work?"). Nothing here repeats Overview: before
 * setup, the connection question points at Overview's form instead of
 * showing it again.
 */
export function HelpTab({ theme, data, configured, compact, go, say }: { theme: Theme; data: Status; configured: boolean; compact: boolean; go: (target: GoTarget) => void; say: (message: Message) => void }) {
  const { connection } = data;
  const name = ROUTERS[connection.router].label;
  const reads = configured && (data.tier === "operator" || data.tier === "admin");
  const dashboard = dashboardTarget(data).url;
  const installed = new Set(data.plugins.installed);
  const tips = RECOMMENDED_PLUGINS.filter((plugin) => !plugin.blocked);
  const keys = [connection.token?.present ? "Read token" : null, connection.manageKey?.present ? "manage key" : null].filter(Boolean);
  return (
    <Accordion theme={theme}>
      <AccordionItem theme={theme} id="guide" icon="BookOpen" title="How does AI Router work?" summary="What it is, how a chat reaches the router, and the words you'll see">
        <GuideCard theme={theme} compact={compact} go={go} router={name} accounts={[]} synced={data.aiProvider.present} />
      </AccordionItem>
      <AccordionItem theme={theme} id="connection" icon="Server" title="How is this computer connected?" summary={configured ? `${name} at ${connection.endpoint ?? "no address"}` : "Not connected yet"} tone={data.health?.up === false ? "danger" : undefined}>
        {configured ? (
          <ConnectionCard theme={theme} data={data} configured go={go} say={say} />
        ) : (
          <>
            <Note theme={theme}>Not connected yet. Setting up takes about two minutes, on Overview.</Note>
            <Row><Button theme={theme} label="Set up" icon="Plug" primary onPress={() => go("overview")} /></Row>
          </>
        )}
      </AccordionItem>
      {configured ? (
        <AccordionItem theme={theme} id="keys" icon="KeyRound" title="How do I see accounts and usage?" summary={keys.length ? `Saved: ${keys.join(" and ")}` : "Add a read token, or a manage key to change things"}>
          <KeysCard theme={theme} data={data} tokenProblem={data.health?.monitoringError ?? null} onMessage={say} />
        </AccordionItem>
      ) : null}
      {configured ? (
        <AccordionItem theme={theme} id="share" icon="Share2" title="How do other people use this router?" summary={connection.publicUrl ? `Through ${connection.publicUrl}` : "Set a public address first"}>
          <ShareCard theme={theme} data={data} say={say} />
        </AccordionItem>
      ) : null}
      {configured && dashboard ? (
        <AccordionItem theme={theme} id="dashboard" icon="Globe" title="How do I open the router's dashboard?" summary="Its own website, for admin settings">
          <DashboardCard theme={theme} data={data} say={say} />
        </AccordionItem>
      ) : null}
      <AccordionItem theme={theme} id="in-paseo" icon="ToggleRight" title="What does AI Router add to Paseo?" summary="Warning chips when the router can't answer, and commands">
        <InPaseoCard theme={theme} data={data} say={say} />
      </AccordionItem>
      {reads ? (
        <AccordionItem theme={theme} id="compression" icon="Minimize2" title="Why are long prompts shortened?" summary="How the router compresses them, and the setting to use">
          <CompressionCard theme={theme} data={data} say={say} />
        </AccordionItem>
      ) : null}
      <AccordionItem theme={theme} id="router-settings" icon="Settings2" title="Which router settings matter?" summary={reads ? "A few worth knowing, read from the router" : configured ? "Needs a read token" : "Connect a router first"}>
        {reads ? <RouterSettingsCard theme={theme} dashboardUrl={dashboard} onMessage={say} /> : <RouterSettingsNeedToken theme={theme} configured={configured} go={go} />}
      </AccordionItem>
      {reads ? (
        <AccordionItem theme={theme} id="more" icon="Compass" title={`What else can ${name} do?`} summary="Features in its dashboard">
          <MoreCard theme={theme} data={data} say={say} />
        </AccordionItem>
      ) : null}
      <AccordionItem theme={theme} id="tips" icon="Puzzle" title="Which plugins work well with AI Router?" summary={`${tips.filter((plugin) => installed.has(plugin.id)).length} of ${tips.length} installed here`}>
        <TipsTab theme={theme} data={data} say={say} />
      </AccordionItem>
    </Accordion>
  );
}
