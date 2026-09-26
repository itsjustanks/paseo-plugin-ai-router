import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { tunnelKind } from "../shared/logic";
import { ROUTERS } from "../shared/routers/copy";
import { copyLink, openInBrowser } from "./links";
import type { Message } from "./setup";
import { Banner, Button, Chip, Meta, Note, Row } from "./ui";

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
 * Where "Open dashboard" goes: the public address (custom domain) once it
 * answers as OmniRoute; else a running OmniRoute tunnel an admin's manage key
 * can see; else the private endpoint, where the SSH help applies.
 */
export function dashboardTarget(data: Status): { url: string | null; via: string | null } {
  const { publicUrl, publicCheck, tunnel, dashboardUrl } = data.connection;
  if (publicUrl && publicCheck?.state === "ok") return { url: dashboardUrl, via: "via custom domain" };
  if (tunnel) return { url: tunnel.dashboardUrl, via: `via ${tunnel.label}` };
  return { url: dashboardUrl, via: tunnelKind(dashboardUrl) };
}

export function OpenDashboardButton({ theme, data, say, primary, label }: { theme: Theme; data: Status; say: Say; primary?: boolean; label?: string }) {
  const links = useLinks(say);
  const { url, via } = dashboardTarget(data);
  if (!url) return null;
  return (
    <>
      <Button theme={theme} label={label ?? `Open ${ROUTERS[data.connection.router].label} dashboard`} icon="ExternalLink" primary={primary} onPress={() => void links.open(url)} />
      {via ? <Chip theme={theme} label={via} tone="success" /> : null}
    </>
  );
}

/** Top of Providers and Settings: the rest of routing is the router's own dashboard's job. */
export function AdvancedBanner({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const name = ROUTERS[data.connection.router].label;
  return (
    <Banner theme={theme} tone="neutral" title={`Advanced routing (combos, fallbacks, per-provider rules) lives in the ${name} dashboard`}>
      <Note theme={theme}>That is where an admin sets up combos (named groups of models), fallbacks (what to try when a model fails) and rules for each provider.</Note>
      <Row>
        <OpenDashboardButton theme={theme} data={data} say={say} label="Open dashboard" />
      </Row>
      <Meta theme={theme}>Dashboard login: ask your router admin.</Meta>
    </Banner>
  );
}
