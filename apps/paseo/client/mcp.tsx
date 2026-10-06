import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import type { Status } from "../shared/contracts";
import { routingSettings } from "../shared/settings";
import { useLinks } from "./dashboard";
import type { Message } from "./setup";
import { QuietLine } from "./ui";

export const MCP_PLUGIN_URL = "https://paseo.cafe/plugins/paseo-mcp";
export const MCP_INSTALL_SOURCE = "git:https://github.com/itsjustanks/paseo-mcp.git";

/** Whether this daemon already has the sister plugin, Connectors (plugin id paseo-mcp). */
export const connectorsInstalled = (data: Status) => data.plugins.installed.includes("paseo-mcp");

/**
 * The bottom of Overview: the sister plugin, Connectors, as one quiet line,
 * only while it isn't installed here. Hide turns it off for this daemon
 * (Help → "What does AI Router add to Paseo?" brings it back).
 */
export function McpCard({ theme, data, say }: { theme: PluginTheme; data: Status; say: (message: Message) => void }) {
  const settings = useSettings(routingSettings);
  const links = useLinks(say);
  if (settings.status !== "ready" || settings.values.mcpCard === false || connectorsInstalled(data)) return null;
  const hide = () => {
    void settings.save({ ...settings.values, mcpCard: false }, settings.revision).then((saved) => {
      if (saved) say({ text: "Connectors line hidden. Help → \"What does AI Router add to Paseo?\" brings it back.", tone: "neutral" });
    });
  };
  return (
    <QuietLine
      theme={theme}
      icon="Blocks"
      links={[
        { label: "View plugin", onPress: () => void links.open(MCP_PLUGIN_URL) },
        { label: "Copy install source", onPress: () => links.copy(MCP_INSTALL_SOURCE, "the install source") },
        { label: "Hide", accessibilityLabel: "Hide the Connectors line", onPress: hide },
      ]}
    >
      Also try Connectors: add the tools your agents use, such as GitHub or Linear, in one place for Claude Code, Codex and the rest.
    </QuietLine>
  );
}
