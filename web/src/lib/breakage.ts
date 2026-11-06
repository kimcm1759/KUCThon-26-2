/**
 * How an object takes hits and breaks, keyed by Claude's "fragility" label
 * (and a few material overrides). Speeds are multipliers on a base burst
 * measured in real meters per second.
 */
export interface BreakProfile {
  /** Hits it survives; the hit that brings it to 0 breaks it. */
  hp: number;
  /** Fragments on the final break. */
  pieces: number;
  speed: number;
  /** Max random spin, rad/s. */
  spin: number;
  restitution: number;
  /** What a non-final hit does to the intact object. */
  hitEffect: "crack" | "dent" | "squash";
  /** Small chips knocked off by each non-final hit. */
  chips: number;
}

const BY_FRAGILITY: Record<string, BreakProfile> = {
  shatters: { hp: 2, pieces: 40, speed: 1.2, spin: 14, restitution: 0.3, hitEffect: "crack", chips: 4 },
  cracks: { hp: 3, pieces: 12, speed: 0.8, spin: 8, restitution: 0.15, hitEffect: "crack", chips: 3 },
  dents: { hp: 4, pieces: 6, speed: 0.6, spin: 6, restitution: 0.35, hitEffect: "dent", chips: 0 },
  bends: { hp: 4, pieces: 6, speed: 0.6, spin: 6, restitution: 0.3, hitEffect: "dent", chips: 0 },
  tears: { hp: 3, pieces: 10, speed: 0.7, spin: 6, restitution: 0.05, hitEffect: "crack", chips: 2 },
  squishes: { hp: 3, pieces: 8, speed: 0.5, spin: 4, restitution: 0.5, hitEffect: "squash", chips: 0 },
};

const DEFAULT: BreakProfile = BY_FRAGILITY.cracks;

export function breakProfile(material?: string, fragility?: string): BreakProfile {
  const p = BY_FRAGILITY[fragility ?? ""] ?? DEFAULT;
  // Glass goes on the first good hit.
  if (material === "glass") return { ...p, hp: 1 };
  return p;
}
