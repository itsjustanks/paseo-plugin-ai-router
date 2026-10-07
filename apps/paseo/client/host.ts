// The name of the host this copy of the plugin runs for. Paseo evaluates a
// plugin's client code once per host, so one value per copy is right. Set as
// soon as the sidebar row or the screen renders (they get the host from
// Paseo); the window title reads it.

let label: string | null = null;
export function noteHost(host: { label?: unknown } | null | undefined): void {
  if (host && typeof host.label === "string" && host.label.trim()) label = host.label.trim();
}
export const currentHost = (): string | null => label;
