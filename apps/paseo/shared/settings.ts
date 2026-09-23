import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { ROUTING_DEFAULTS, ROUTING_SETTINGS_VERSION } from "./logic";

/**
 * The non-secret switches. Host-scoped: every client of this daemon shares
 * it, and the session_open hook reads the same document from disk. Off until
 * a person turns it on; environment variables never touch it.
 */
export const RoutingSettingsSchema = z.object({
  /** Put the connection's URL and key into Claude sessions Paseo opens, leaving ~/.claude alone. */
  routeAgents: z.boolean().default(ROUTING_DEFAULTS.routeAgents),
  /** Keep one Paseo agent profile per OmniRoute combo (ids start with "ai-router:"). */
  comboProfiles: z.boolean().default(ROUTING_DEFAULTS.comboProfiles),
});

export type RoutingSettings = z.infer<typeof RoutingSettingsSchema>;

export const ROUTING_SETTINGS_ID = "routing";

export const routingSettings = defineSettings({
  id: ROUTING_SETTINGS_ID,
  scope: "host",
  version: ROUTING_SETTINGS_VERSION,
  schema: RoutingSettingsSchema,
});
