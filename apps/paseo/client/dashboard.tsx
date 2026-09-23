import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { tunnelKind } from "../shared/logic";
import { ROUTERS } from "../shared/routers/copy";
import { copyLink, openInBrowser } from "./links";
import type { Message } from "./setup";
import { Banner, Button, Chip, Note, Row } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;

/** Opens a URL, falling back to the clipboard; shared by every tab. */
export function useLinks(say: Say) {
  return {
    open: async (url: string) => {
      if ((await openInBrowser(url)) === "copied") say({ text: `Could not open a browser; copied ${url}`, tone: "warning" });
    },
    copy: (value: string, label: string) => {
      copyLink(value);
      say({ text: `Copied ${label}`, tone: "neutral" });
    },
  };
}

/**
 * Where "Open dashboard" goes: a running OmniRoute tunnel an admin's manage
 * key can see, else the dashboard address from the connection settings or
 * AI_ROUTER_CONSOLE_URL, which is how everyone else gets a tunnel address.
 */
export function dashboardTarget(data: Status): { url: string | null; via: string | null } {
  const tunnel = data.connection.tunnel;
  if (tunnel) return { url: tunnel.dashboardUrl, via: `via ${tunnel.label}` };
  const url = data.connection.dashboardUrl;
  return { url, via: tunnelKind(url) };
}

export function OpenDashboardButton({ theme, data, say, primary, label }: { theme: Theme; data: Status; say: Say; primary?: boolean; label?: string }) {
  const links = useLinks(say);
  const { url, via } = dashboardTarget(data);
  if (!url) return null;
  return (
    <>
      <Button theme={theme} label={label ?? `Open ${ROUTERS[data.connection.router].label} dashboard`} primary={primary} onPress={() => void links.open(url)} />
      {via ? <Chip theme={theme} label={via} tone="success" /> : null}
    </>
  );
}

/** Top of Providers and Settings: the rest of routing is the router's own dashboard's job. */
export function AdvancedBanner({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const name = ROUTERS[data.connection.router].label;
  return (
    <Banner theme={theme} tone="neutral" title={`Advanced routing (combos, fallbacks, per-provider rules) lives in the ${name} dashboard`}>
      <Row>
        <OpenDashboardButton theme={theme} data={data} say={say} label="Open dashboard" />
      </Row>
      <Note theme={theme}>Dashboard login: ask your router admin.</Note>
    </Banner>
  );
}
