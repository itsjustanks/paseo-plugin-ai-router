// The agent apps a daemon runs (Claude Code and Codex): how each copy was
// installed, whether it is behind, and how to update it. Pure, so the rules
// are tested without touching a real install; server/clis.ts does the I/O.

export const AGENT_CLIS = [
  { id: "claude", label: "Claude Code", bin: "claude", pkg: "@anthropic-ai/claude-code" },
  { id: "codex", label: "Codex", bin: "codex", pkg: "@openai/codex" },
] as const;
export type CliId = (typeof AGENT_CLIS)[number]["id"];
export const cliInfo = (id: CliId) => AGENT_CLIS.find((cli) => cli.id === id)!;

/**
 * How a copy got there, from where its binary really lives:
 * - `npm`: a global npm install (`<prefix>/lib/node_modules/<pkg>`), as in the
 *   fleet containers (/opt/npm-global) and Codex on a Mac (~/.npm-global);
 * - `claude-native`: Claude Code's own installer (~/.local/share/claude/versions);
 * - `homebrew`: a formula or cask;
 * - `codex-standalone`: Codex's own installer (~/.codex/packages/standalone);
 * - `unknown`: anything else, such as a copy baked into an image.
 */
export type InstallMethod =
  | { kind: "npm"; prefix: string }
  | { kind: "claude-native"; root: string }
  | { kind: "homebrew" }
  | { kind: "codex-standalone" }
  | { kind: "unknown" };

export function detectInstall(id: CliId, realPath: string): InstallMethod {
  const path = realPath.replace(/\\/g, "/");
  const marker = `/lib/node_modules/${cliInfo(id).pkg}/`;
  const at = path.indexOf(marker);
  if (at > 0) return { kind: "npm", prefix: path.slice(0, at) };
  if (/^\/(opt\/homebrew|usr\/local\/(Cellar|Caskroom)|home\/linuxbrew\/\.linuxbrew)\//.test(path) || /\/(Cellar|Caskroom)\//.test(path)) return { kind: "homebrew" };
  const native = path.match(/^(.*\/\.local\/share\/claude)\/versions\//);
  if (id === "claude" && native) return { kind: "claude-native", root: native[1] };
  if (id === "codex" && /\/\.codex\/packages\/standalone\//.test(path)) return { kind: "codex-standalone" };
  return { kind: "unknown" };
}

/** What the card shows and the button runs. `run` is null when only the command can be shown. */
export type UpdatePlan = { method: string; command: string | null; run: { file: string; args: string[] } | null; why: string | null };

/**
 * The update for one copy. A button only when the method is known and the
 * daemon's own user can write where it lives; otherwise the exact command, or
 * why there is none.
 */
export function updatePlan(id: CliId, method: InstallMethod, facts: { binPath: string; writable: boolean; npm: string | null }): UpdatePlan {
  const { pkg } = cliInfo(id);
  if (method.kind === "npm") {
    const command = `npm install -g ${pkg}@latest --prefix ${method.prefix}`;
    const why = !facts.npm ? "npm isn't on this daemon's PATH, so run this where it is." : !facts.writable ? `The daemon's user can't write to ${method.prefix}, so run this as its owner.` : null;
    return { method: `npm, in ${method.prefix}`, command, run: why ? null : { file: facts.npm!, args: ["install", "-g", `${pkg}@latest`, "--prefix", method.prefix] }, why };
  }
  if (method.kind === "claude-native") {
    const why = facts.writable ? null : `The daemon's user can't write to ${method.root}, so run this as its owner.`;
    return { method: "Claude Code's own installer", command: "claude update", run: why ? null : { file: facts.binPath, args: ["update"] }, why };
  }
  if (method.kind === "homebrew") {
    return { method: "Homebrew", command: id === "claude" ? "brew upgrade --cask claude-code" : "brew upgrade codex", run: null, why: "Homebrew copies are updated with brew; run this on the daemon's machine." };
  }
  if (method.kind === "codex-standalone") {
    return { method: "Codex's own installer", command: null, run: null, why: "Installed with Codex's own installer: run that installer again to update it." };
  }
  return { method: "not known", command: `npm install -g ${pkg}@latest`, run: null, why: `AI Router can't tell how ${facts.binPath} was installed. If it came from npm, this updates it.` };
}

/** The first x.y.z in a `--version` answer ("2.1.289 (Claude Code)", "codex-cli 0.160.0"). */
export function parseVersion(text: string): string | null {
  return text.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

/** Semver order on the numeric parts; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre.localeCompare(y.pre);
}

export type VersionState = "missing" | "current" | "behind" | "ahead" | "unknown";
export function versionState(installed: string | null, latest: string | null, found: boolean): VersionState {
  if (!found) return "missing";
  if (!installed || !latest) return "unknown";
  const order = compareVersions(installed, latest);
  return order === 0 ? "current" : order < 0 ? "behind" : "ahead";
}

/** The last lines of an update's output, without colour codes, for the card. */
export function tailLines(previous: readonly string[], chunk: string, keep = 40): string[] {
  const clean = chunk.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n|\r/).map((line) => line.trimEnd()).filter(Boolean);
  return [...previous, ...clean].slice(-keep);
}
