// Which computer this panel belongs to (0.21.0). Paseo's app knows each host
// by the name the person gave it ("team-server"); the daemon knows its own
// host name and whether it's a Mac. Pure, so tests need no React.

/** The name to show: Paseo's label for the host, else the daemon's host name, else null. */
export function hostName(label: string | null | undefined, computer?: { name: string } | null): string | null {
  const given = label?.trim();
  if (given) return given;
  const own = computer?.name.trim();
  return own ? own : null;
}

/** "AI Router · team-server", or just "AI Router" when the host has no name. */
export function withHost(title: string, host: string | null): string {
  return host ? `${title} · ${host}` : title;
}

/** The not-connected line, naming this computer: "This Mac (Localhost) isn't connected to a router yet." */
export function notConnectedLine(host: string | null, computer?: { mac: boolean } | null): string {
  const which = computer?.mac ? "This Mac" : "This computer";
  return `${which}${host ? ` (${host})` : ""} isn't connected to a router yet. Each computer has its own connection, so routing stays off here until it's set up.`;
}
