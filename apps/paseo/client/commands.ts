import type { PluginClientContext } from "@getpaseo/plugin/client";
import { aiProvider, status, type Status } from "../shared/contracts";
import { ROUTERS } from "../shared/routers/copy";
import type { Message } from "./setup";

/**
 * "Sync models" and "Check router" without opening the panel first (0.18.0):
 * Command Center items everywhere, and a `/ai-router` slash command in chats
 * where the app offers slash commands. Each runs the job, then opens AI
 * Router, which shows the reply at the top.
 */

/** A reply waiting for the AI Router screen; the surface shows it and clears it. */
let pending: Message = null;
const listeners = new Set<() => void>();
export function setPendingMessage(message: Message): void {
  pending = message;
  for (const listener of listeners) listener();
}
export function takePendingMessage(): Message {
  const message = pending;
  pending = null;
  return message;
}
export function subscribePendingMessage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const peekPendingMessage = (): Message => pending;

/** What "Check router" says: the same line in the panel and from a command. */
export function checkReply(next: Status): NonNullable<Message> {
  const name = ROUTERS[next.connection.router].label;
  const health = next.health;
  if (next.problem) return { text: `Not connected yet: ${next.problem}.`, tone: "warning" };
  if (next.checking) return { text: `${name} is slow to answer; still checking.`, tone: "warning" };
  if (health?.up) return { text: `${name} answered${health.latencyMs !== null ? ` in ${health.latencyMs} ms` : ""}.`, tone: "success" };
  return { text: `${name} did not answer: ${health?.error ?? "no reason given"}`, tone: "danger" };
}

type Capabilities = { rpc: PluginClientContext["rpc"] };
export type RouterJob = "sync" | "check";

export async function runRouterJob(job: RouterJob, { rpc }: Capabilities): Promise<NonNullable<Message>> {
  try {
    if (job === "sync") {
      const result = await rpc(aiProvider, { enabled: true });
      return { text: result.message, tone: result.ok ? "success" : "danger" };
    }
    return checkReply(await rpc(status, { refresh: true }));
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), tone: "danger" };
  }
}

/** `/ai-router sync`, `/ai-router check`; anything else opens AI Router. */
export function slashJob(args: string): RouterJob | null {
  const word = args.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (word === "sync" || word === "models") return "sync";
  if (word === "check" || word === "status" || word === "health") return "check";
  return null;
}

type SlashClient = {
  addSlashCommand?: (contribution: {
    name: string;
    description: string;
    argumentHint: string;
    context: "agent";
    onSubmit(context: Capabilities & { args: string }): void | Promise<void>;
  }) => () => void;
};

/** The two commands and the slash command; `open` opens the AI Router screen. Returns their cleanups. */
export function registerRouterCommands(client: PluginClientContext, open: (capabilities: unknown) => void): Array<() => void> {
  const run = async (job: RouterJob, capabilities: Capabilities) => {
    setPendingMessage(await runRouterJob(job, capabilities));
    open(capabilities);
  };
  const cleanups: Array<() => void> = [
    client.addCommandCenterItem({
      id: "ai-router-sync",
      title: "Sync AI Router models to Paseo",
      icon: "RefreshCw",
      keywords: ["ai router", "omniroute", "sync", "models", "refresh"],
      context: "global",
      onSelect: (command) => run("sync", command),
    }),
    client.addCommandCenterItem({
      id: "ai-router-check",
      title: "Check the AI Router connection",
      icon: "Stethoscope",
      keywords: ["ai router", "omniroute", "check", "health", "status", "router down"],
      context: "global",
      onSelect: (command) => run("check", command),
    }),
  ];
  const slash = client as unknown as SlashClient;
  if (typeof slash.addSlashCommand === "function") {
    try {
      cleanups.push(
        slash.addSlashCommand({
          name: "ai-router",
          description: "Sync AI Router's models, or check the router",
          argumentHint: "sync | check",
          context: "agent",
          onSubmit: (command) => {
            const job = slashJob(command.args);
            return job ? run(job, command) : open(command);
          },
        }),
      );
    } catch {
      // An app that refuses the slash command still has the Command Center items.
    }
  }
  return cleanups;
}
