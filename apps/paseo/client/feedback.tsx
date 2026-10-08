import React, { useCallback, useState, type ComponentType, type ReactNode } from "react";
import { Clipboard, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import * as HostRN from "@getpaseo/plugin/client/react-native";
import type { Message } from "./setup";
import { Button, Note, Row, SPACE, TYPE } from "./ui";

/**
 * Paseo's own toasts, clipboard and dialogs (0.22.0), looked up at runtime so
 * an app without them keeps today's behaviour: the message bar at the top of
 * the page, react-native's Clipboard, and the ask-first rows in place.
 */
type ToastVariant = "default" | "info" | "success" | "warning" | "error";
type ToastApi = { show(message: string, options?: { variant?: ToastVariant; durationMs?: number }): void; error(message: string): void };
type ModalComponent = ComponentType<{ title: string; open: boolean; onOpenChange(open: boolean): void; children: ReactNode }> & { Content?: ComponentType<{ children: ReactNode }> };
const host = HostRN as unknown as { useToast?: () => ToastApi; copyText?: (text: string) => Promise<void>; Modal?: ModalComponent };

const isComponent = (value: unknown) => typeof value === "function" || (typeof value === "object" && value !== null);
const hostModal = (): ModalComponent | null => (isComponent(host.Modal) ? (host.Modal as ModalComponent) : null);
/** The app's toast, or null. An app either has it or not, so the hook order never changes within one. */
export function useHostToast(): ToastApi | null {
  const use = host.useToast;
  return typeof use === "function" ? use() : null;
}

/** Long or failing messages stay up longer: about a second per 16 characters, 4 to 10 seconds. */
export const toastDuration = (text: string) => Math.min(10_000, Math.max(4_000, Math.round(text.length * 60)));

export function showToast(toast: ToastApi, message: NonNullable<Message>): void {
  if (message.tone === "danger") {
    toast.show(message.text, { variant: "error", durationMs: toastDuration(message.text) });
    return;
  }
  const variant: ToastVariant = message.tone === "success" ? "success" : message.tone === "warning" ? "warning" : "default";
  toast.show(message.text, { variant, durationMs: toastDuration(message.text) });
}

/**
 * The page's "say": a toast where the app has them, else the message bar
 * (`message`, shown by the caller). Never both.
 */
export function useSay(): [Message, (message: Message) => void] {
  const toast = useHostToast();
  const [message, setMessage] = useState<Message>(null);
  const say = useCallback(
    (next: Message) => {
      if (next && toast) {
        showToast(toast, next);
        setMessage(null);
      } else setMessage(next);
    },
    [toast],
  );
  return [message, say];
}

/** Copies with the app's clipboard where it has one, else react-native's. False when neither could. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof host.copyText === "function") await host.copyText(text);
    else Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}

/** True on apps with Paseo's dialog. */
export const hasDialog = () => hostModal() !== null;

/**
 * Ask first. On the AI Router screen, in Paseo's dialog where the app has
 * one; in a popover or chat card (`inPlace`), or on an older app, as a
 * warning and two buttons right where the question came from.
 */
export function Confirm({ theme, open, title, text, confirmLabel, busy, inPlace, onConfirm, onCancel }: {
  theme: PluginTheme;
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  busy?: boolean;
  inPlace?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const buttons = (
    <Row>
      <Button theme={theme} label={confirmLabel} primary busy={busy} onPress={onConfirm} />
      <Button theme={theme} label="Cancel" onPress={onCancel} />
    </Row>
  );
  const HostModal = hostModal();
  if (!HostModal || inPlace) {
    if (!open) return null;
    return (
      <>
        <Note theme={theme} tone="warning">{text}</Note>
        {buttons}
      </>
    );
  }
  const Content = HostModal.Content;
  const body = (
    <View style={{ gap: SPACE.md }}>
      <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>{text}</Text>
      {buttons}
    </View>
  );
  return (
    <HostModal title={title} open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      {Content ? <Content>{body}</Content> : body}
    </HostModal>
  );
}
