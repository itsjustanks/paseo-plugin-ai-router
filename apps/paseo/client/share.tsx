import React from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { shareSnippets } from "../shared/logic";
import { useLinks } from "./dashboard";
import type { Message } from "./setup";
import { Card, Fact, Link, Note, Row } from "./ui";

type Theme = PluginTheme;

/**
 * How someone else uses this router through its public address. Every tier
 * sees it; it never shows a key, only `<your key>` for theirs.
 */
export function ShareCard({ theme, data, say }: { theme: Theme; data: Status; say: (message: Message) => void }) {
  const links = useLinks(say);
  const publicUrl = data.connection.publicUrl;
  if (!publicUrl) {
    return (
      <Card theme={theme} title="Share this router">
        <Note theme={theme}>Set a public address (custom domain) under Edit, and this card shows how others connect to the router from outside your network.</Note>
      </Card>
    );
  }
  const check = data.connection.publicCheck;
  return (
    <Card theme={theme} title="Share this router">
      <Fact theme={theme} label="Endpoint" value={publicUrl} />
      <Fact theme={theme} label="API key" value="Ask your router admin for your own key, one per person or machine, so usage shows per key." />
      {check && check.state !== "ok" && check.state !== "checking" ? <Note theme={theme} tone="warning">{`The public address is not ready yet: ${check.label}. These work once it is.`}</Note> : null}
      {shareSnippets(publicUrl).map((snippet) => (
        <View key={snippet.id} style={{ gap: 6, borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 12 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{snippet.title}</Text>
          <Note theme={theme}>{snippet.why}</Note>
          <View style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: 10 }}>
            <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace", lineHeight: 18 }}>{snippet.text}</Text>
          </View>
          <Row>
            <Link theme={theme} label="Copy" accessibilityLabel={`Copy the ${snippet.title} setup`} onPress={() => links.copy(snippet.text, `the ${snippet.title} setup`)} />
          </Row>
        </View>
      ))}
    </Card>
  );
}
