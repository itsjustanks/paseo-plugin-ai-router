import React from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { updates, type Updates } from "../shared/contracts";
import { updateLine } from "../shared/updates";
import { useLinks } from "./dashboard";
import type { Message } from "./setup";
import { Bullets, Divider, ItemTitle, Link, Meta, Row, SPACE } from "./ui";

type Theme = PluginTheme;
type Product = Updates["router"];

/** The daemon checks GitHub at most every 6 hours; the panel asks it every 30 minutes. */
export function useUpdates() {
  const call = useRpc(updates);
  return useQuery({ queryKey: ["ai-router", "updates"], queryFn: () => call({}), refetchInterval: 30 * 60_000, staleTime: 10 * 60_000 });
}

const PLUGIN_UPDATE = "paseo plugin update ai-router";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : null);

function ProductNews({ theme, product, update, extra, say }: { theme: Theme; product: Product; update: string | null; extra?: string | null; say: (message: Message) => void }) {
  const links = useLinks(say);
  const latest = product.latest;
  return (
    <View style={{ gap: SPACE.sm }}>
      <Row>
        <ItemTitle theme={theme}>{latest ? `${product.label} ${latest.version}` : product.label}</ItemTitle>
        {latest?.publishedAt ? <Meta theme={theme}>{day(latest.publishedAt)}</Meta> : null}
      </Row>
      <Meta theme={theme}>{extra ? `${updateLine(product)} ${extra}` : updateLine(product)}</Meta>
      {latest?.highlights.length ? <Bullets theme={theme} items={latest.highlights} icon="Sparkles" /> : null}
      <Row>
        <Link theme={theme} label="Full changelog" accessibilityLabel={`${product.label} full changelog`} onPress={() => void links.open(latest?.url || product.changelogUrl)} />
        {update ? <Link theme={theme} label="Copy update command" onPress={() => links.copy(update, "the update command")} /> : null}
      </Row>
    </View>
  );
}

/** Inside the Overview hero: each product's newest release in three lines or fewer, and where the rest is. */
export function WhatsNew({ theme, data, say }: { theme: Theme; data: Updates; say: (message: Message) => void }) {
  return (
    <View style={{ gap: SPACE.row }}>
      <Divider theme={theme} />
      <ProductNews theme={theme} product={data.router} update={null} extra={data.router.state === "behind" ? "Whoever runs the router updates it." : data.router.running ? "A custom build shows the release it's built from." : null} say={say} />
      <ProductNews theme={theme} product={data.plugin} update={data.plugin.state === "behind" ? PLUGIN_UPDATE : null} say={say} />
      <Divider theme={theme} />
    </View>
  );
}
