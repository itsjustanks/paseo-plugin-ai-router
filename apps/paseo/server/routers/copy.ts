import type { RouterId } from "../../shared/logic";
import { COMPRESSION_ENGINES, OMNIROUTE_COPY, OMNIROUTE_MORE, RECOMMENDED_COMPRESSION } from "./omniroute/copy";

/**
 * Each router's UI copy, by id. Import-light and free of server code, so the
 * client bundles it; the adapters themselves are in ./index.ts.
 */
export const ROUTERS = {
  omniroute: { ...OMNIROUTE_COPY, engines: COMPRESSION_ENGINES, more: OMNIROUTE_MORE, recommended: RECOMMENDED_COMPRESSION },
} as const satisfies Record<RouterId, unknown>;
