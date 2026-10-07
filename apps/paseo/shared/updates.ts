/**
 * Versions and "what's new" for the Overview: the router's release and this
 * plugin's, from each project's GitHub releases. Pure (its one import is pure
 * too), so the tests load it on its own; the daemon fetches (server/updates.ts).
 */
import { compareVersions } from "./clis";

/** This plugin's version. A test keeps it equal to package.json. */
export const PLUGIN_VERSION = "0.21.1";

export const RELEASE_SOURCES = {
  router: { label: "OmniRoute", repo: "diegosouzapw/OmniRoute" },
  plugin: { label: "AI Router", repo: "itsjustanks/paseo-plugin-ai-router" },
} as const;
export type ReleaseSourceId = keyof typeof RELEASE_SOURCES;

export const releasesApiUrl = (repo: string) => `https://api.github.com/repos/${repo}/releases?per_page=10`;
export const releasesPageUrl = (repo: string) => `https://github.com/${repo}/releases`;

export type Release = { version: string; tag: string; publishedAt: string | null; url: string; highlights: string[] };
export type UpdateState = "current" | "behind" | "ahead" | "unknown";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** "v3.8.51" or "3.8.51-rc.1" → the version; tags that are not versions ("radar-export-latest") → null. */
export function versionOf(tag: string | null | undefined): string | null {
  return tag?.trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)?.[1] ?? null;
}

export function updateState(running: string | null, latest: string | null): UpdateState {
  const have = versionOf(running);
  const want = versionOf(latest);
  if (!have || !want) return "unknown";
  const order = compareVersions(have, want);
  return order === 0 ? "current" : order < 0 ? "behind" : "ahead";
}

/** Markdown down to plain words: links keep their text, code and emphasis marks go. */
function plain(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).replace(/[\s,;:—-]+\S*$/, "")}…` : text);

/** Top-level bullets, with their wrapped continuation lines joined. */
function bullets(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const item = line.match(/^[-*+] (.*)$/);
    if (item) out.push(item[1]);
    else if (out.length && /^\s{2,}\S/.test(line) && !/^\s*[-*+] /.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** "**Routing and resilience**: hierarchical …" → "Routing and resilience: hierarchical …"; a bold sentence stands alone. */
function bulletWords(raw: string, max: number): string {
  const bold = raw.match(/^\*\*(.+?)\*\*[:.]?\s*(.*)$/);
  if (bold && /[.!?]$/.test(bold[1].trim())) return clip(plain(bold[1]), max);
  return clip(plain(raw), max);
}

/**
 * A release body (often 100 KB of markdown) down to at most `limit` short
 * lines: the bullets under a "Highlights" or "What's new" heading, else the
 * first bullets, else the opening sentence. Tables, headings and badges are
 * skipped. Only these lines are kept; the body itself is never stored.
 */
export function releaseHighlights(body: string | null | undefined, limit = 3, max = 140): string[] {
  if (!body) return [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const heading = lines.findIndex((line) => /^#{1,4}\s.*\b(highlights|what'?s new|what changed)\b/i.test(line));
  if (heading >= 0) {
    const section: string[] = [];
    for (const line of lines.slice(heading + 1)) {
      if (/^#{1,4}\s/.test(line)) break;
      section.push(line);
    }
    const found = bullets(section).map((item) => bulletWords(item, max)).filter(Boolean);
    if (found.length) return found.slice(0, limit);
  }
  const found = bullets(lines).map((item) => bulletWords(item, max)).filter((item) => item.length > 3);
  if (found.length) return found.slice(0, limit);
  const paragraph = lines.find((line) => line.trim() && !/^\s*(#|\||>|!\[|<|---|📄|🤖)/.test(line));
  return paragraph ? [clip(plain(paragraph), max)] : [];
}

/** GitHub's releases list → the newest published release with a version tag (drafts and pre-releases skipped). */
export function pickLatestRelease(body: unknown): Release | null {
  const releases = Array.isArray(body) ? body.map(rec) : [];
  const candidates = releases
    .filter((release) => release.draft !== true && release.prerelease !== true)
    .map((release) => ({ release, version: versionOf(str(release.tag_name)) }))
    .filter((entry): entry is { release: Rec; version: string } => entry.version !== null)
    .sort((a, b) => compareVersions(b.version, a.version));
  const top = candidates[0];
  if (!top) return null;
  return {
    version: top.version,
    tag: str(top.release.tag_name)!,
    publishedAt: str(top.release.published_at),
    url: str(top.release.html_url) ?? "",
    highlights: releaseHighlights(str(top.release.body)),
  };
}

export type ProductUpdate = {
  label: string;
  running: string | null;
  latest: Release | null;
  state: UpdateState;
  changelogUrl: string;
  /** Why the latest release is unknown, in a few words; null when it is known. */
  error: string | null;
};

/**
 * One line for the Overview's "Versions" row: a short value, its tone and a
 * hint. An update anywhere makes it a warning; anything unknown stays quiet.
 */
export function versionsLine(router: ProductUpdate, plugin: ProductUpdate): { value: string; tone: "success" | "warning" | "neutral"; hint: string } {
  const named = (product: ProductUpdate) => (product.running ? `${product.label} ${product.running}` : null);
  const behind = [router, plugin].filter((product) => product.state === "behind");
  const hint = [named(router) ?? `${router.label} version needs a read token`, named(plugin)].filter(Boolean).join(" · ");
  if (behind.length) {
    const value = behind.length === 2 ? "2 updates available" : `${behind[0].label} ${behind[0].latest!.version} available`;
    return { value, tone: "warning", hint };
  }
  const known = [router, plugin].filter((product) => product.state !== "unknown");
  if (!known.length) return { value: "Not checked yet", tone: "neutral", hint };
  return { value: known.length === 2 ? "Up to date" : `${known[0].label} up to date`, tone: "success", hint };
}

/** What the "What's new" panel says under each product's heading, in one line. */
export function updateLine(product: ProductUpdate): string {
  const latest = product.latest;
  if (!latest) return product.error ? `Couldn't check for ${product.label} releases (${product.error}).` : `No ${product.label} release found yet.`;
  if (product.state === "behind") return `${latest.version} is out; you run ${product.running}.`;
  if (product.state === "current") return `You run ${latest.version}, the newest release.`;
  if (product.state === "ahead") return `You run ${product.running}, newer than the latest release (${latest.version}): a preview or custom build.`;
  return `Newest release: ${latest.version}.`;
}
