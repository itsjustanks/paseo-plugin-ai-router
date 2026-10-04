// Plugins worth adding next to AI Router, as Paseo Cafe (paseo.cafe) lists them.
// `install` is the command Paseo Cafe publishes, verbatim, except paseo-mcp:
// its Cafe entry pins an older commit, so it follows the repository instead.

/** `blocked`: why it cannot be installed on the Paseo this plugin targets; the panel shows that instead of the command. */
export type RecommendedPlugin = { id: string; name: string; by: string; what: string; install: string; blocked?: string };

export const PASEO_CAFE_URL = "https://paseo.cafe/plugins/";
export const paseoCafeUrl = (id: string) => `${PASEO_CAFE_URL}${id}/`;

export const RECOMMENDED_PLUGINS: readonly RecommendedPlugin[] = [
  {
    id: "paseo-mcp",
    name: "Paseo MCP",
    by: "itsjustanks",
    what: "Manage MCP servers for Claude Code, Codex and your other agents in one place — sign-ins, tools and per-workspace switches.",
    install: "paseo plugin add git:https://github.com/itsjustanks/paseo-mcp.git",
  },
  {
    id: "activity",
    name: "Activity",
    by: "koinzhang",
    what: "Local usage analytics and agent ops: tools, agents, messages, models, a fleet list and terminals.",
    install: "paseo plugin add npm:@koinzhang/paseo-plugin-activity@0.6.0",
  },
  {
    id: "remote-editor",
    name: "Remote Editor",
    by: "Al-Hassan Abdel-Raouf",
    what: "An Editor pill that opens the agent's workspace in VS Code, Cursor or Zed, over SSH when the daemon runs elsewhere.",
    install: "paseo plugin add alhassanaraouf/paseo-remote-editor --ref 56bc4056630ebd766395ba3e71c6d92268e95f59",
  },
  {
    id: "tell-agent",
    name: "Tell Agent",
    by: "Omer Cohen",
    what: "Send messages to agents in other workspaces on the same Paseo host.",
    // 1.2.0 builds and loads on Paseo 0.11.0-beta.3 (checked 2026-10-04 on the Mac); 0.3.0 failed on 0.9.1.
    install: "paseo plugin add npm:@omercnet/paseo-tell-agent@1.2.0",
  },
];
