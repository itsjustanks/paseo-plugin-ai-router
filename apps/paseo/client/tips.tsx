import React from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { PASEO_CAFE_URL, RECOMMENDED_PLUGINS, paseoCafeUrl } from "../shared/plugins";
import { useLinks } from "./dashboard";
import type { Message } from "./setup";
import { Card, Chip, ItemTitle, Link, Meta, Note, Row, TYPE } from "./ui";

/**
 * Plugins that pair well with AI Router, each with its Paseo Cafe page and
 * the install command Paseo Cafe publishes; installing itself is Paseo's
 * (Settings → Plugins, or the CLI). "Installed" comes from this daemon's
 * plugin sources; a plugin that cannot build on this Paseo says so instead.
 */
export function TipsTab({ theme, data, say }: { theme: PluginTheme; data: Status; say: (message: Message) => void }) {
  const links = useLinks(say);
  const installed = new Set(data.plugins.installed);
  const installable = RECOMMENDED_PLUGINS.filter((plugin) => !plugin.blocked);
  const count = installable.filter((plugin) => installed.has(plugin.id)).length;
  return (
    <Card theme={theme} title="Recommended plugins" icon="Puzzle">
      <Note theme={theme}>{`${count} of ${installable.length} installed on this daemon. Install one in Paseo's Settings → Plugins by pasting its source (the part after "paseo plugin add"; a --ref pin needs the command), or run the command on the daemon's machine (inside the container for a Docker daemon). Plugins run with the daemon's own access, so add the ones you trust.`}</Note>
      {RECOMMENDED_PLUGINS.map((plugin) => {
        const here = installed.has(plugin.id);
        const blocked = !here && plugin.blocked ? plugin.blocked : null;
        return (
          <View key={plugin.id} style={{ gap: 6, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12 }}>
            <Row>
              <ItemTitle theme={theme}>{plugin.name}</ItemTitle>
              <Meta theme={theme}>{`by ${plugin.by}`}</Meta>
              {here ? <Chip theme={theme} label="Installed" tone="success" /> : null}
              {blocked ? <Chip theme={theme} label="Not on Paseo 0.9.1 yet" tone="warning" /> : null}
            </Row>
            <Note theme={theme}>{plugin.what}</Note>
            {blocked ? <Note theme={theme}>{blocked}</Note> : null}
            {!here && !blocked ? <Text selectable style={{ ...TYPE.mono, color: theme.colors.foregroundMuted }}>{plugin.install}</Text> : null}
            <Row>
              <Link theme={theme} label="View on Paseo Cafe" accessibilityLabel={`View ${plugin.name} on Paseo Cafe`} onPress={() => void links.open(paseoCafeUrl(plugin.id))} />
              {!here && !blocked ? <Link theme={theme} label="Copy install command" accessibilityLabel={`Copy the ${plugin.name} install command`} onPress={() => links.copy(plugin.install, `the ${plugin.name} install command`)} /> : null}
            </Row>
          </View>
        );
      })}
      <Link theme={theme} label="Browse every plugin on Paseo Cafe" onPress={() => void links.open(PASEO_CAFE_URL)} />
    </Card>
  );
}
