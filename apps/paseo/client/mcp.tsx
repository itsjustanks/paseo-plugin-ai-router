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

/**
 * The bottom of Overview: the sister plugin, as one quiet line. "Installed"
 * when this daemon's plugin sources already list paseo-mcp. Hide turns it off
 * for this daemon (Settings → In Paseo brings it back).
 */
export function McpCard({ theme, data, say }: { theme: PluginTheme; data: Status; say: (message: Message) => void }) {
  const settings = useSettings(routingSettings);
  const links = useLinks(say);
  if (settings.status !== "ready" || settings.values.mcpCard === false) return null;
  const hide = () => {
    void settings.save({ ...settings.values, mcpCard: false }, settings.revision).then((saved) => {
      if (saved) say({ text: "MCP line hidden. Settings → In Paseo brings it back.", tone: "neutral" });
    });
  };
  const installed = data.plugins.installed.includes("paseo-mcp");
  return (
    <QuietLine
      theme={theme}
      icon="Blocks"
      links={[
        { label: "View plugin", onPress: () => void links.open(MCP_PLUGIN_URL) },
        ...(installed ? [] : [{ label: "Copy install source", onPress: () => links.copy(MCP_INSTALL_SOURCE, "the install source") }]),
        { label: "Hide", accessibilityLabel: "Hide the MCP line", onPress: hide },
      ]}
    >
      {installed ? "MCP plugin installed: manage MCP servers for all your agents in one place." : "Also try MCP: manage MCP servers for Claude Code, Codex and your other agents in one place."}
    </QuietLine>
  );
}
