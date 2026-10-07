import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { claudeSignIn, codexSignIn, type OwnSignIn } from "../shared/routing";

// Whether this computer has its own Claude Code and Codex sign-in, for the
// "use this computer's own sign-in" offer while the router is down. Only
// presence and expiry are read; nothing secret leaves this file. Read at most
// once a minute.

const MAX_AGE_MS = 60_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;
let seen: { at: number; value: Promise<{ claude: OwnSignIn; codex: OwnSignIn }> } | null = null;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Claude Code keeps its login in the keychain on a Mac. Asks only whether the item exists (no `-w`: the secret is never printed). */
function macKeychainHasClaude(): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("security", ["find-generic-password", "-s", "Claude Code-credentials"], { timeout: KEYCHAIN_TIMEOUT_MS }, (error) => resolve(!error));
  });
}

async function readOwnSignIn(): Promise<{ claude: OwnSignIn; codex: OwnSignIn }> {
  const home = homedir();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const codexDir = process.env.CODEX_HOME || join(home, ".codex");
  const [claudeFile, codexFile, keychain] = await Promise.all([readJson(join(claudeDir, ".credentials.json")), readJson(join(codexDir, "auth.json")), macKeychainHasClaude()]);
  const now = Date.now();
  return {
    claude: claudeSignIn({ file: claudeFile, keychain, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }, now }),
    codex: codexSignIn({ file: codexFile, now }),
  };
}

export function ownSignIn(): Promise<{ claude: OwnSignIn; codex: OwnSignIn }> {
  if (seen && Date.now() - seen.at <= MAX_AGE_MS) return seen.value;
  const entry = { at: Date.now(), value: readOwnSignIn() };
  seen = entry;
  return entry.value;
}

/** This daemon's computer: its host name and whether it's a Mac, for "This Mac isn't connected". */
export function thisComputer(): { name: string; mac: boolean } {
  let name = "";
  try {
    name = hostname();
  } catch {
    // unnamed
  }
  return { name, mac: process.platform === "darwin" };
}
