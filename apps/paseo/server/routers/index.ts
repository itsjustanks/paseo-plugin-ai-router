import type { Access, Accounts, Compression, RouterSettings, Tunnels, Usage } from "../../shared/contracts";
import type { Connection, HealthProbe, RouterId } from "../../shared/logic";
import { omniroute } from "./omniroute";
import type { CatalogModel, Tunnel } from "../../shared/routers/omniroute/parsers";

type Result = { ok: boolean; message: string };
export type Health = {
  checkedAt: string;
  up: boolean;
  latencyMs: number | null;
  error: string | null;
  version: string | null;
  uptimeSeconds: number | null;
  monitoringError: string | null;
  paused: string[];
};

/**
 * Everything the panel and the hooks need from a router. The UI never talks
 * to a router directly; it gets these answers through the RPCs, so adding a
 * router means one more folder here (adapter, parsers, copy) and its id in
 * shared/logic.ts. There is no plugin loader: the registry below is it.
 */
export interface RouterAdapter {
  /** Test & save: reachable, key accepted, optional credentials checked. */
  test(candidate: Connection): Promise<Result>;
  health(connection: Pick<Connection, "endpoint" | "token">, maxAgeMs: number): Promise<(HealthProbe & Health) | null>;
  /** The panel's view: never waits long, falls back to the last answer. */
  healthForPanel(connection: Pick<Connection, "endpoint" | "token">, maxAgeMs: number): Promise<{ health: Health | null; checking: boolean }>;
  /** Set when a recent check found the router down, so callers answer at once. */
  recentlyDown(connection: Pick<Connection, "endpoint" | "token">): string | null;
  lastSeenAt(endpoint: string | null): string | null;
  /** Models for the AI Router provider, limited to connected accounts (with a plain key when the router can). */
  models(connection: Connection): Promise<{ ok: true; list: CatalogModel[] } | { ok: false; error: string }>;
  testModel(connection: Connection, model: string): Promise<Result>;
  /** What this key itself may see about itself: name, spend and limit, account quotas. */
  access(connection: Connection, refresh: boolean): Promise<Access>;
  accounts(connection: Connection, refresh: boolean): Promise<Accounts>;
  usage(connection: Connection, refresh: boolean): Promise<Usage>;
  settings(connection: Connection, refresh: boolean): Promise<RouterSettings>;
  applySetting(connection: Connection, id: string, on: boolean | undefined): Promise<Result>;
  compression(connection: Connection, refresh: boolean): Promise<Compression>;
  applyRecommendedCompression(connection: Connection): Promise<Result>;
  accountAction(connection: Connection, action: "test" | "refresh", id: string, name: string): Promise<Result>;
  checkAllAccounts(connection: Connection): Promise<Result>;
  tunnels(connection: Connection, refresh: boolean): Promise<Tunnels>;
  setTunnel(connection: Connection, id: "cloudflared" | "ngrok" | "tailscale", on: boolean): Promise<Result>;
  /** The running tunnel from the last read only; never waits. */
  knownTunnel(connection: Connection): Tunnel | null;
}

const ADAPTERS: Record<RouterId, RouterAdapter> = { omniroute };

export function adapterFor(router: RouterId): RouterAdapter {
  return ADAPTERS[router];
}
