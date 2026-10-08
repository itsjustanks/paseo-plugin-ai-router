import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { Status } from "../shared/contracts";
import { tunnelKind } from "../shared/logic";
import { ROUTERS } from "../shared/routers/copy";
import { copyToClipboard } from "./feedback";
import { openInBrowser } from "./links";
import type { Message } from "./setup";
import { Button, Chip, QuietLine } from "./ui";

type Theme = PluginTheme;
type Say = (message: Message) => void;

/** Opens a URL, falling back to the clipboard; and copies, saying so. Shared by every tab. */
export function useLinks(say: Say) {
  return {
    open: async (url: string) => {
      const result = await openInBrowser(url);
      if (result === "copied") say({ text: `Could not open a browser; copied ${url}`, tone: "warning" });
      if (result === "failed") say({ text: `Could not open a browser or copy the link: ${url}`, tone: "danger" });
    },
    copy: async (value: string, label: string) => {
      say((await copyToClipboard(value)) ? { text: `Copied ${label}`, tone: "success" } : { text: `Couldn't copy ${label}. Select it and copy it instead.`, tone: "danger" });
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

/** Bottom of Providers and Settings, in one line: the rest of routing is the router's own dashboard's job. */
export function AdvancedBanner({ theme, data, say }: { theme: Theme; data: Status; say: Say }) {
  const links = useLinks(say);
  const name = ROUTERS[data.connection.router].label;
  const { url } = dashboardTarget(data);
  return (
    <QuietLine theme={theme} icon="SlidersHorizontal" links={url ? [{ label: "Open dashboard", accessibilityLabel: `Open the ${name} dashboard`, onPress: () => void links.open(url) }] : []}>
      {`Combos (named groups of models), fallbacks and per-provider rules live in the ${name} dashboard.`}
    </QuietLine>
  );
}
