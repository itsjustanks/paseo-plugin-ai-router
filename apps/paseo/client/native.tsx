import React, { type ComponentType, type ReactNode } from "react";
import * as HostUI from "@getpaseo/plugin/client/ui";
import type { PluginClientContext, PluginHostProps, PluginSurfaceProps } from "@getpaseo/plugin/client";

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
};
type SidebarRowProps = { icon?: string; label?: string; onPress(): void; active?: boolean; trailing?: ReactNode };
type NativeClient = {
  addScreen?: (contribution: { id: string; title: string; Component: ComponentType<PluginSurfaceProps> }) => () => void;
  addSidebarHeaderItem?: (contribution: { id: string; title: string; Component: ComponentType<SidebarItemProps> }) => () => void;
};

/** The app's own sidebar row component (0.11+), or null. */
export function hostSidebarRow(): ComponentType<SidebarRowProps> | null {
  const row = (HostUI as unknown as Record<string, unknown>).SidebarRow;
  return typeof row === "function" || (typeof row === "object" && row !== null) ? (row as ComponentType<SidebarRowProps>) : null;
}

export type MainScreen = { id: string; title: string; icon: string; Component: ComponentType<PluginSurfaceProps> };
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
  if (hasScreens) native.addScreen!({ id: screen.id, title: screen.title, Component: screen.Component });
  else client.addSurface(screen.id, screen.Component);
  const Row = hostSidebarRow();
  if (hasScreens && Row && typeof native.addSidebarHeaderItem === "function") {
    native.addSidebarHeaderItem({ id: screen.id, title: screen.title, Component: sidebarEntry(Row, screen) });
    return { screen: "screen", sidebar: "row" };
  }
  client.addSidebarItem({ id: screen.id, title: screen.title, icon: screen.icon, surface: screen.id });
  return { screen: hasScreens ? "screen" : "surface", sidebar: "item" };
}

function sidebarEntry(Row: ComponentType<SidebarRowProps>, screen: MainScreen): ComponentType<SidebarItemProps> {
  return function MainScreenSidebarEntry({ currentScreen, openScreen }: SidebarItemProps) {
    return <Row icon={screen.icon} active={currentScreen?.screenId === screen.id} onPress={() => openScreen({ screenId: screen.id })} />;
  };
}

/** Opens a screen with `openScreen` on a 0.11 app, `openSurface` before. */
export function openMainScreen(capabilities: { openSurface(id: string): void; openScreen?: unknown }, id: string): void {
  if (typeof capabilities.openScreen === "function") (capabilities as { openScreen(input: ScreenInput): void }).openScreen({ screenId: id });
  else capabilities.openSurface(id);
}
