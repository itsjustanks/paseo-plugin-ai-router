import * as pluginClient from "@getpaseo/plugin/client";
import { Clipboard, Linking } from "react-native";

type Opener = (url: string) => Promise<void>;

/**
 * Paseo 0.9 apps hand plugins `openExternalUrl`, which opens the system
 * browser; the 0.8 SDK types do not declare it yet, so it is looked up at
 * runtime. The dashboard signs in with a cookie, and Paseo's own browser tab
 * (where `Linking.openURL` lands) cannot hold one, so that is only a fallback.
 */
const openExternalUrl = (pluginClient as unknown as { openExternalUrl?: Opener }).openExternalUrl;

/** Must be called straight from a press so a browser permits the new tab. */
export async function openInBrowser(url: string): Promise<"opened" | "copied"> {
  try {
    if (openExternalUrl) await openExternalUrl(url);
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
