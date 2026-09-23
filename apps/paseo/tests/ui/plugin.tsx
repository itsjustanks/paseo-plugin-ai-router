// The preview uses the same stand-in SDK and fixtures as the hook-order test,
// plus real Lucide icons, which the Paseo app draws for `Icon` in the plugin.
import React from "react";
import * as Lucide from "lucide-react";
export * from "../hook-order/stubs/plugin";

export function Icon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  const Glyph = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[name];
  return Glyph ? <Glyph size={size} color={color} /> : null;
}
