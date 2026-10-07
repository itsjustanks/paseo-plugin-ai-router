import React, { type ComponentType, type ReactNode } from "react";
import * as HostUI from "@getpaseo/plugin/client/ui";
import type { PluginClientContext, PluginHostProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { noteHost } from "./host";

/**
 * Paseo 0.11's screens and sidebar rows, when the app has them; the surface
 * and sidebar item of older apps otherwise. Found at runtime: the 0.8 SDK
 * this plugin builds against does not declare them, and a 0.9 app does not
 * have them. The shapes below copy @getpaseo/plugin 0.11.0-beta.3.
 */
type ScreenInput = { screenId: string; params?: Record<string, string> };
type SidebarItemProps = PluginHostProps & {
  currentScreen: { screenId: string; params: Record<string, string> } | null;
  openScreen(input: ScreenInput): void;
  /** 0.11: anchored to the row on wide layouts, a bottom sheet on compact ones. */
  openPopover?: (Content: ComponentType<{ theme: PluginHostProps["theme"]; host?: PluginHostProps["host"]; close(): void; openScreen(input: ScreenInput): void }>) => void;
};
type SidebarRowProps = { icon?: string; label?: string; onPress(): void; active?: boolean; trailing?: ReactNode };
type ScreenTitle = string | ((params: Record<string, string>) => string);
type NativeClient = {
  addScreen?: (contribution: { id: string; title: ScreenTitle; Component: ComponentType<PluginSurfaceProps> }) => () => void;
  openScreen?: (input: ScreenInput) => void;
  addSidebarHeaderItem?: (contribution: { id: string; title: string; Component: ComponentType<SidebarItemProps> }) => () => void;
};

/** The app's own sidebar row component (0.11+), or null. */
export function hostSidebarRow(): ComponentType<SidebarRowProps> | null {
  const row = (HostUI as unknown as Record<string, unknown>).SidebarRow;
  return typeof row === "function" || (typeof row === "object" && row !== null) ? (row as ComponentType<SidebarRowProps>) : null;
}

/** `Trailing`: drawn at the end of the app's own sidebar row (0.11), such as a status dot that opens a popover. */
export type MainScreen = {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<PluginSurfaceProps>;
  /** 0.11: the header and window title from the screen's params ("AI Router · Accounts"). */
  screenTitle?: (params: Record<string, string>) => string;
  Trailing?: ComponentType<{ theme: PluginHostProps["theme"]; openPopover?: SidebarItemProps["openPopover"] }>;
};

/** Re-opens the main screen with new params (0.11), so its URL and title follow the tab; null on older apps. */
let reopen: ((params: Record<string, string>) => void) | null = null;

export type MainScreenApi = { screen: "screen" | "surface"; sidebar: "row" | "item" };

/**
 * The plugin's main view and its sidebar entry. On a 0.11 app: a screen
 * titled "AI Router" (an older app's surface is titled by its id) and the
 * app's own sidebar row, highlighted while the screen is open. Otherwise
 * exactly what 0.13 registered.
 */
export function registerMainScreen(client: PluginClientContext, screen: MainScreen): MainScreenApi {
  const native = client as PluginClientContext & NativeClient;
  const hasScreens = typeof native.addScreen === "function";
  if (hasScreens) native.addScreen!({ id: screen.id, title: screen.screenTitle ?? screen.title, Component: screen.Component });
  else client.addSurface(screen.id, screen.Component);
  if (hasScreens && typeof native.openScreen === "function") reopen = (params) => native.openScreen!(Object.keys(params).length ? { screenId: screen.id, params } : { screenId: screen.id });
  const Row = hostSidebarRow();
  if (hasScreens && Row && typeof native.addSidebarHeaderItem === "function") {
    native.addSidebarHeaderItem({ id: screen.id, title: screen.title, Component: sidebarEntry(Row, screen) });
    return { screen: "screen", sidebar: "row" };
  }
  client.addSidebarItem({ id: screen.id, title: screen.title, icon: screen.icon, surface: screen.id });
  return { screen: hasScreens ? "screen" : "surface", sidebar: "item" };
}

function sidebarEntry(Row: ComponentType<SidebarRowProps>, screen: MainScreen): ComponentType<SidebarItemProps> {
  const Trailing = screen.Trailing;
  return function MainScreenSidebarEntry({ theme, host, currentScreen, openScreen, openPopover }: SidebarItemProps) {
    noteHost(host);
    const trailing = Trailing ? <Trailing theme={theme} openPopover={typeof openPopover === "function" ? openPopover : undefined} /> : undefined;
    return <Row icon={screen.icon} active={currentScreen?.screenId === screen.id} onPress={() => openScreen({ screenId: screen.id })} trailing={trailing} />;
  };
}

/** Opens a screen with `openScreen` on a 0.11 app, `openSurface` before. `params` (such as `{ tab: "accounts" }`) reach 0.11 screens only. */
export function openMainScreen(capabilities: { openSurface(id: string): void; openScreen?: unknown }, id: string, params?: Record<string, string>): void {
  if (typeof capabilities.openScreen === "function") (capabilities as { openScreen(input: ScreenInput): void }).openScreen(params ? { screenId: id, params } : { screenId: id });
  else capabilities.openSurface(id);
}


/**
 * The screen's params after a tab change inside it: `{ tab }`, or none for
 * Overview. Re-opens the screen only when its params name another tab, so a
 * deep link's extra fold-outs or an old tab id do not bounce it around.
 */
export function syncScreenTab(tab: string, current: Record<string, string> | undefined, resolve: (id: string | undefined) => string): void {
  if (!reopen || !current) return;
  if (resolve(current.tab) === tab) return;
  reopen(tab === "overview" ? {} : { tab });
}
