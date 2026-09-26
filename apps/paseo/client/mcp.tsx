import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import type { Status } from "../shared/contracts";
import { routingSettings } from "../shared/settings";
import { useLinks } from "./dashboard";
import type { Message } from "./setup";
import { Button, Card, Chip, Link, Note, Row } from "./ui";

export const MCP_PLUGIN_URL = "https://paseo.cafe/plugins/paseo-mcp";
export const MCP_INSTALL_SOURCE = "git:https://github.com/itsjustanks/paseo-mcp.git";

/**
 * The bottom of Overview: the sister plugin, in one line. "Installed" when
 * this daemon's plugin sources already list paseo-mcp. Hide turns it off for
 * this daemon (Settings → In Paseo brings it back).
 */
export function McpCard({ theme, data, say }: { theme: PluginTheme; data: Status; say: (message: Message) => void }) {
  const settings = useSettings(routingSettings);
  const links = useLinks(say);
  if (settings.status !== "ready" || settings.values.mcpCard === false) return null;
  const hide = () => {
    void settings.save({ ...settings.values, mcpCard: false }, settings.revision).then((saved) => {
      if (saved) say({ text: "MCP card hidden. Settings → In Paseo brings it back.", tone: "neutral" });
    });
  };
  return (
    <Card theme={theme} title="Check out MCP" icon="Blocks">
      <Note theme={theme}>Manage MCP servers for Claude Code, Codex and your other agents in one place — sign-ins, tools and per-workspace switches.</Note>
      <Row>
        <Button theme={theme} label="View plugin" icon="ExternalLink" onPress={() => void links.open(MCP_PLUGIN_URL)} />
        {data.plugins.installed.includes("paseo-mcp") ? (
          <Chip theme={theme} label="Installed" tone="success" />
        ) : (
          <Button theme={theme} label="Copy install source" onPress={() => links.copy(MCP_INSTALL_SOURCE, "the install source")} />
        )}
        <Link theme={theme} label="Hide" accessibilityLabel="Hide the MCP card" onPress={hide} />
      </Row>
    </Card>
  );
}
