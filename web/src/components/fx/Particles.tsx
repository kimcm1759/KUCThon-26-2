"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useImperativeHandle, useMemo, useRef, type Ref } from "react";
import * as THREE from "three";

function makeState(max: number) {
  return {
    pos: new Float32Array(max * 3),
    vel: new Float32Array(max * 3),
    life: new Float32Array(max),
    maxLife: new Float32Array(max),
    size: new Float32Array(max),
    grow: new Float32Array(max),
    gravity: new Float32Array(max),
    drag: new Float32Array(max),
    next: 0,
    alive: 0,
  };
}

/** One burst of particles; sizes and speeds are in scene units. */
export interface Burst {
  position: THREE.Vector3;
  count: number;
  colors: THREE.ColorRepresentation[];
  speed: number;
  size: number;
  /** Seconds, randomized ±40%. */
  life: number;
  /** Main direction; omitted = all directions. */
  direction?: THREE.Vector3;
  /** 0 = tight jet along `direction`, 1 = full sphere. */
  spread?: number;
  gravity?: number;
  /** Velocity loss per second (0-1). */
  drag?: number;
  /** Size at end of life relative to start (smoke grows, sparks shrink). */
  grow?: number;
}

export interface ParticlesHandle {
  emit: (burst: Burst) => void;
}

/**
 * Pooled instanced particles. One component per look (additive sparks/fire,
 * plain smoke/dust); fire-and-forget bursts through the `emit` handle.
 */
export function Particles({
  ref,
  additive = false,
  opacity = 1,
  max = 400,
}: {
  ref: Ref<ParticlesHandle>;
  additive?: boolean;
  opacity?: number;
  max?: number;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Mutable simulation state lives in a ref; it changes every frame without re-rendering.
  const stateRef = useRef<ReturnType<typeof makeState> | null>(null);
  if (stateRef.current === null) stateRef.current = makeState(max);
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
      }),
    [additive, opacity],
  );

  useImperativeHandle(ref, () => ({
    emit(b) {
      const mesh = meshRef.current;
      if (!mesh) return;
      const s = stateRef.current!;
      const color = new THREE.Color();
      const dir = new THREE.Vector3();
      for (let n = 0; n < b.count; n++) {
        const i = s.next;
        s.next = (s.next + 1) % max;
        if (s.life[i] <= 0) s.alive++;
        // Random direction around `direction`, widened by `spread`.
        dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        if (b.direction) dir.lerp(b.direction, 1 - (b.spread ?? 0.4)).normalize();
        const speed = b.speed * (0.4 + Math.random() * 0.9);
        s.pos.set([b.position.x, b.position.y, b.position.z], i * 3);
        s.vel.set([dir.x * speed, dir.y * speed, dir.z * speed], i * 3);
        s.maxLife[i] = s.life[i] = b.life * (0.6 + Math.random() * 0.8);
        s.size[i] = b.size * (0.5 + Math.random());
        s.grow[i] = b.grow ?? 0;
        s.gravity[i] = b.gravity ?? 0;
        s.drag[i] = b.drag ?? 0;
        mesh.setColorAt(i, color.set(b.colors[Math.floor(Math.random() * b.colors.length)]));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      invalidate();
    },
  }));

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const s = stateRef.current!;
    if (!mesh || s.alive === 0) return;
    const dt = Math.min(delta, 1 / 30);
    let alive = 0;
    for (let i = 0; i < max; i++) {
      if (s.life[i] <= 0) continue;
      s.life[i] -= dt;
      if (s.life[i] <= 0) {
        mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      alive++;
      const k = i * 3;
      const keep = Math.max(0, 1 - s.drag[i] * dt);
      s.vel[k] *= keep;
      s.vel[k + 1] = s.vel[k + 1] * keep - s.gravity[i] * dt;
      s.vel[k + 2] *= keep;
      s.pos[k] += s.vel[k] * dt;
      s.pos[k + 1] += s.vel[k + 1] * dt;
      s.pos[k + 2] += s.vel[k + 2] * dt;
      const t = 1 - s.life[i] / s.maxLife[i];
      // grow=0: shrink to nothing; grow>1: puff up as it fades out.
      const size = s.grow[i] > 0 ? s.size[i] * (1 + (s.grow[i] - 1) * t) * (1 - t * t) : s.size[i] * (1 - t);
      mesh.setMatrixAt(i, m.compose(p.set(s.pos[k], s.pos[k + 1], s.pos[k + 2]), q, sc.setScalar(size)));
    }
    s.alive = alive;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  });

  // Start with every instance collapsed so unused slots draw nothing.
  const init = (mesh: THREE.InstancedMesh | null) => {
    meshRef.current = mesh;
    if (!mesh || mesh.userData.ready) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      mesh.setMatrixAt(i, zero);
      mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    mesh.userData.ready = true;
  };

  return <instancedMesh ref={init} args={[geometry, material, max]} frustumCulled={false} renderOrder={2} />;
}
