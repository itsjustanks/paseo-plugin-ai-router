import React from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { PASEO_CAFE_URL, RECOMMENDED_PLUGINS, paseoCafeUrl } from "../shared/plugins";
import { useLinks } from "./dashboard";
import type { Message } from "./setup";
import { Card, Chip, Link, Note, Row } from "./ui";

/**
 * Plugins that pair well with AI Router, each with its Paseo Cafe page and
 * the install command Paseo Cafe publishes. "Installed" comes from this
 * daemon's plugin sources, so no command is offered for what is already here.
 */
export function TipsTab({ theme, data, say }: { theme: PluginTheme; data: Status; say: (message: Message) => void }) {
  const links = useLinks(say);
  const installed = new Set(data.plugins.installed);
  const count = RECOMMENDED_PLUGINS.filter((plugin) => installed.has(plugin.id)).length;
  return (
    <Card theme={theme} title="Recommended plugins">
      <Note theme={theme}>{`${count} of ${RECOMMENDED_PLUGINS.length} installed on this daemon. Each installs with one command on the daemon's machine (inside the container for a Docker daemon). Plugins run with the daemon's own access, so add the ones you trust.`}</Note>
      {RECOMMENDED_PLUGINS.map((plugin) => {
        const here = installed.has(plugin.id);
        return (
          <View key={plugin.id} style={{ gap: 4, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 10 }}>
            <Row>
              <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{plugin.name}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`by ${plugin.by}`}</Text>
              {here ? <Chip theme={theme} label="Installed" tone="success" /> : null}
            </Row>
            <Note theme={theme}>{plugin.what}</Note>
            {!here ? <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>{plugin.install}</Text> : null}
            <Row>
              <Link theme={theme} label="View on Paseo Cafe" accessibilityLabel={`View ${plugin.name} on Paseo Cafe`} onPress={() => void links.open(paseoCafeUrl(plugin.id))} />
              {!here ? <Link theme={theme} label="Copy install command" accessibilityLabel={`Copy the ${plugin.name} install command`} onPress={() => links.copy(plugin.install, `the ${plugin.name} install command`)} /> : null}
            </Row>
          </View>
        );
      })}
      <Link theme={theme} label="Browse every plugin on Paseo Cafe" onPress={() => void links.open(PASEO_CAFE_URL)} />
    </Card>
  );
}
