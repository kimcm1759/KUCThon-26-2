"use client";

import { useEffect, useState } from "react";

/**
 * Splash logo and shards, animated like the Figma prototype: 온보딩 holds for
 * 1s, then Smart Animate (Bouncy, 3.59s) turns it into 온보딩2 — "빠각"
 * cracks ("빠" tilts, "각" breaks off up and right) and three shards drift
 * and turn. Each piece is a box (left, top, width, height) with its content
 * centred and rotated, so both states come straight from the Figma layout.
 */

type Box = [left: number, top: number, width: number, height: number];
type Piece = { from: Box; to: Box; rot: [number, number] };

/** Damped spring (ζ 0.3) sampled for CSS, settling at the end of the transition. */
const BOUNCY =
  "linear(0, 0.027, 0.103, 0.216, 0.355, 0.51, 0.671, 0.827, 0.972, 1.099, 1.204, 1.283, 1.337, 1.366, 1.372, 1.357, 1.325, 1.28, 1.226, 1.167, 1.107, 1.05, 0.998, 0.952, 0.916, 0.888, 0.871, 0.862, 0.862, 0.87, 0.883, 0.901, 0.921, 0.943, 0.966, 0.987, 1.005, 1.022, 1.034, 1.044, 1.049, 1.052, 1.051, 1.047, 1.042, 1.035, 1.027, 1.019, 1.011, 1.003, 0.996, 0.991, 0.986, 0.983, 0.981, 0.981, 0.981, 0.983, 0.985, 0.988, 0.991, 0.994, 0.997, 1, 1)";
const HOLD_MS = 1000;
const DURATION_S = 3.59;

const LETTERS: (Piece & { char: string })[] = [
  { char: "빠", from: [98, 221, 111, 153], to: [75, 222, 123.098, 161.536], rot: [0, 4.67] },
  { char: "각", from: [209, 221, 111, 153], to: [171, 189, 164.28, 185.185], rot: [0, 24.39] },
];
const DOT: Piece = { from: [325, 340, 21, 16], to: [302.71, 359.1, 22.234, 17.658], rot: [0, 4.67] };

const SHARDS: (Piece & { src: string; size: [number, number]; inset: string })[] = [
  { src: "shard-1", from: [88.55, 361.43, 277.435, 292.394], to: [103, 348, 244.999, 274.257], rot: [-58.77, -72.74], size: [229.649, 185.2], inset: "-5.4% 2.34% 19.6% 2.34%" },
  { src: "shard-4", from: [16.99, 465.93, 58.602, 70.953], to: [16.99, 465.93, 58.602, 70.953], rot: [-93.34, -93.34], size: [67.882, 54.744], inset: "-7.31% 0.81% 17.69% 0.81%" },
  { src: "shard-5", from: [258.21, 550.69, 54.791, 59.632], to: [258.21, 550.69, 54.791, 59.632], rot: [-106.98, -106.98], size: [49.468, 42.181], inset: "-4.74% 2.66% 20.26% 2.66%" },
  { src: "shard-2", from: [18.67, 439.86, 257.561, 253.948], to: [62, 496, 193.302, 228.997], rot: [-41.71, -79.49], size: [203.431, 158.856], inset: "-1.26% 5.72% 23.74% 5.72%" },
  { src: "shard-3", from: [-53, 526.41, 213.656, 187.357], to: [-51.64, 518.35, 210.935, 203.484], rot: [-60.21, -49.26], size: [111.483, 182.369], inset: "0 6.7% 25% 6.7%" },
];

export default function SplashArt() {
  const [cracked, setCracked] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCracked(true), HOLD_MS);
    return () => clearTimeout(t);
  }, []);
  const at = (p: Piece) => {
    const [left, top, width, height] = cracked ? p.to : p.from;
    return { left, top, width, height };
  };
  const turn = (p: Piece) => ({ transform: `rotate(${cracked ? p.rot[1] : p.rot[0]}deg)` });

  return (
    <div className="splash-art pointer-events-none absolute inset-0" style={{ "--ease": BOUNCY, "--dur": `${DURATION_S}s` } as React.CSSProperties}>
      {LETTERS.map((l) => (
        <div key={l.char} className="absolute flex items-center justify-center" style={at(l)}>
          <p className="flex-none text-[128px] leading-[normal] font-black whitespace-nowrap text-[#edf2f9]" style={turn(l)}>
            {l.char}
          </p>
        </div>
      ))}
      <div className="absolute flex items-center justify-center" style={at(DOT)}>
        <div className="h-4 w-[21px] flex-none bg-primary" style={turn(DOT)} />
      </div>
      {SHARDS.map((s) => (
        <div key={s.src} className="absolute flex items-center justify-center" style={at(s)}>
          <div className="flex-none" style={turn(s)}>
            <div className="relative" style={{ width: s.size[0], height: s.size[1] }}>
              <div className="absolute" style={{ inset: s.inset }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/figma/${s.src}.svg`} alt="" className="block size-full max-w-none" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
