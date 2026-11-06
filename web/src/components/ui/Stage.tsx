"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const W = 402;
const H = 874;

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const scale = () => Math.min(window.innerWidth / W, window.innerHeight / H);

/**
 * A 402×874 Figma frame scaled to fit the screen, for fixed-layout screens
 * (onboarding) whose pieces are placed absolutely as in the design.
 */
export default function Stage({ className, children }: { className?: string; children: ReactNode }) {
  const s = useSyncExternalStore(subscribe, scale, () => 1);
  return (
    <div className={`fixed inset-0 flex items-center justify-center overflow-hidden ${className ?? ""}`}>
      <div className="relative shrink-0" style={{ width: W, height: H, transform: `scale(${s})` }}>
        {children}
      </div>
    </div>
  );
}
