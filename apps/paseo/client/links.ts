import * as pluginClient from "@getpaseo/plugin/client";
import { Clipboard, Linking } from "react-native";

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

/** Must be called straight from a press so a browser permits the new tab. */
export async function openInBrowser(url: string): Promise<"opened" | "copied"> {
  try {
    const open = hostOpener();
    if (open) await open(url);
    else await Linking.openURL(url);
    return "opened";
  } catch {
    Clipboard.setString(url);
    return "copied";
  }
}

export function copyLink(url: string): void {
  Clipboard.setString(url);
}
