// What the connected Paseo app can do, looked for at runtime: the plugin
// builds against the 0.8.0-beta.1 SDK and `requirements.paseo` stays >=0.8.0.

const isFn = (value: unknown) => typeof value === "function";

/**
 * Paseo 0.8.0 stable: composer chips are buttons ({ title, icon, label,
 * behavior }, returning { update, remove }). `addHeaderButton` shipped with
 * them; the 0.8.0-beta.1 SDK has neither, and its chip is a React component.
 * True means use the button shape. (The same test as paseo-mcp 0.18.1.)
 */
export function supportsButtonPills(client: unknown): boolean {
  return isFn(((client ?? {}) as Record<string, unknown>).addHeaderButton);
}

/**
 * Paseo 0.9: `agents.subscribe()` only hears an observation the plugin opened
 * itself with `agents.list({ subscribe: {} })`; `observeEvents` shipped with
 * those observations (0.9.0-beta.1). On a 0.8 app the plugin must not send
 * `subscribe`: it would replace the app's own agent subscription.
 */
export function canObserveAgents(paseo: unknown): boolean {
  return isFn(((paseo ?? {}) as Record<string, unknown>).observeEvents);
}
