import type { Alignment } from "./types";

export function defaultAlignment(width: number, height: number, elevation?: number): Alignment {
  return {
    // Phone main cameras are ~26mm equivalent: ~62° across the long side, ~48° across the short side.
    fov: height >= width ? 62 : 48,
    elevation: Math.min(80, Math.max(5, elevation ?? 30)),
    yaw: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    light: 1,
  };
}
