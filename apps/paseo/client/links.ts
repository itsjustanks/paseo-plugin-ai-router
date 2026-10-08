import * as pluginClient from "@getpaseo/plugin/client";
import { Linking } from "react-native";
import { copyToClipboard } from "./feedback";

type Opener = (url: string) => Promise<void>;

/**
 * Paseo apps since 0.9 hand plugins `openExternalUrl` (declared in the 0.10
 * SDK), which opens the system browser; the 0.8 SDK this plugin builds
 * against does not declare it, so it is looked up at runtime. The dashboard
 * signs in with a cookie, and Paseo's own browser tab (where `Linking.openURL`
 * lands) cannot hold one, so that is only the fallback for older apps.
 */
export function hostOpener(): Opener | null {
  const open = (pluginClient as unknown as { openExternalUrl?: unknown }).openExternalUrl;
  return typeof open === "function" ? (open as Opener) : null;
}

/** Must be called straight from a press so a browser permits the new tab. Falls back to the clipboard. */
export async function openInBrowser(url: string): Promise<"opened" | "copied" | "failed"> {
  try {
    const open = hostOpener();
    if (open) await open(url);
    else await Linking.openURL(url);
    return "opened";
  } catch {
    return (await copyToClipboard(url)) ? "copied" : "failed";
  }
}
