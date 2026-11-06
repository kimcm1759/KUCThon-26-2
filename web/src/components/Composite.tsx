"use client";

import { Stats } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Alignment, Box } from "@/lib/types";
import { poseCamera } from "./placement";
import { PlacedModel, type ScreenFx, type SmashProps } from "./Smashable";

export type { SmashProps } from "./Smashable";

/**
 * Model composited onto the inpainted photo. The model is stood on a ground
 * plane and moved/scaled until its silhouette lines up with the original
 * mask's box, so it reads as the object sitting where it was photographed.
 */

interface Props {
  backgroundUrl: string;
  photoUrl: string;
  modelUrl?: string;
  width: number;
  height: number;
  bbox: Box;
  alignment: Alignment;
  /** 0-1 opacity of the original photo drawn on top, for checking the fit. */
  overlay: number;
  smash?: SmashProps;
  /** Show an FPS meter. */
  stats?: boolean;
  /** Size to fit inside the nearest size container (full-screen view) instead of filling the width. */
  fit?: boolean;
}

export default function Composite(props: Props) {
  const { backgroundUrl, photoUrl, width, height, overlay, stats, fit } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPolylineElement>(null);

  // Screen shake moves photo and 3D together; flash covers both.
  const fx = useMemo<ScreenFx>(
    () => ({
      shake(strength, ms = 300) {
        const px = 14 * strength;
        const frames = Array.from({ length: 8 }, (_, i) => {
          const k = 1 - i / 8;
          const dx = (Math.random() - 0.5) * 2 * px * k;
          const dy = (Math.random() - 0.5) * 2 * px * k;
          return { transform: `translate(${dx}px, ${dy}px)` };
        });
        frameRef.current?.animate([...frames, { transform: "translate(0, 0)" }], { duration: ms });
      },
      flash(color, ms = 200) {
        const el = flashRef.current;
        if (!el) return;
        el.style.background = color;
        el.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: ms, easing: "ease-out" });
      },
      path(points) {
        // Set directly on the element: this updates on every pointer move.
        const el = pathRef.current;
        if (!el) return;
        el.setAttribute("points", points ? points.map((p) => `${p.x},${p.y}`).join(" ") : "");
      },
    }),
    [],
  );

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-black ${fit ? "" : "w-full"}`}
      style={{
        aspectRatio: `${width} / ${height}`,
        // Largest box with the photo's aspect that fits the container (cq units).
        width: fit ? `min(100cqw, calc(100cqh * ${width / height}))` : undefined,
      }}
    >
      <div ref={frameRef} className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={backgroundUrl} alt="" className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0">
          <Canvas
            flat
            frameloop="demand"
            // Phones report 3x; rendering above ~1.75x costs a lot and looks the same.
            dpr={[1, 1.75]}
            gl={{ alpha: true, antialias: true }}
            style={{ touchAction: "none" }}
          >
            <Scene {...props} fx={fx} />
            {stats && <Stats />}
          </Canvas>
        </div>
        {overlay > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ opacity: overlay }}
          />
        )}
        {/* Laser path being drawn / followed, in 0-1 screen coordinates. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          <polyline
            ref={pathRef}
            fill="none"
            stroke="#ff3b3b"
            strokeWidth={3}
            strokeDasharray="6 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.85}
          />
        </svg>
      </div>
      <div ref={flashRef} className="pointer-events-none absolute inset-0 opacity-0" />
    </div>
  );
}

function Scene({ modelUrl, bbox, alignment, smash, fx }: Props & { fx: ScreenFx }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  // Neutral studio lighting for reflections; built locally so nothing is fetched.
  const environment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => () => environment.dispose(), [environment]);

  useLayoutEffect(() => {
    poseCamera(camera, size.width / size.height, alignment);
    invalidate();
  }, [camera, size, alignment, invalidate]);

  return (
    <>
      <primitive object={environment} attach="environment" />
      <ambientLight intensity={0.25 * alignment.light} />
      {modelUrl && (
        <Suspense fallback={null}>
          {/* Remounting is the reset: fresh, unbroken object at its saved spot. */}
          <PlacedModel
            key={smash?.resetSignal ?? 0}
            url={modelUrl}
            bbox={bbox}
            alignment={alignment}
            smash={smash}
            fx={fx}
          />
        </Suspense>
      )}
    </>
  );
}
