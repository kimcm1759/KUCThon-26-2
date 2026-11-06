"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Burst } from "./Particles";

/**
 * The tools themselves: short scripted animations that call `onImpact` at
 * the moment of contact and `onDone` when they have left the scene. Sizes
 * are relative to `size`, the object's height in scene units.
 */

/** What a tool is aimed at: the intact object or one physics piece. */
export type Target =
  | { kind: "object"; point: THREE.Vector3; normal: THREE.Vector3; mesh: THREE.Mesh }
  | { kind: "debris"; key: string; point: THREE.Vector3; normal: THREE.Vector3 };

interface Common {
  id: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Object height in scene units. */
  size: number;
  /** Scene units per real meter. */
  upm: number;
  /** Unit vector from the point toward the camera. */
  toCamera: THREE.Vector3;
}

/** Where a screen point lands in the scene; target null = the table. */
export interface Contact {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  target: Target | null;
}

export type ToolAction =
  | (Common & {
      kind: "laserPath";
      /** Drawn path in NDC (x right, y up), followed at constant speed. */
      path: THREE.Vector2[];
      from: THREE.Vector3;
      probe: (ndc: THREE.Vector2) => Contact | null;
      /** Every frame the beam touches something. */
      onMove: (contact: Contact, beamDir: THREE.Vector3) => void;
    })
  | (Common & { kind: "hammer"; target: Target })
  | (Common & { kind: "bat"; target: Target; dir: THREE.Vector3 })
  | (Common & { kind: "laser"; target: Target; from: THREE.Vector3 })
  | (Common & { kind: "bomb" })
  | (Common & {
      kind: "press";
      /** Object footprint center on the table and its top height. */
      center: THREE.Vector3;
      top: number;
      radius: number;
      /** Lowest squash (height fraction) and where it bursts (null = never). */
      crushTo: number;
      burstAt: number | null;
      onProgress: (squash: number) => void;
      /** Plate touches the object / starts rising. */
      onPhase: (phase: "contact" | "rise") => void;
    });

export interface ActorProps<A extends ToolAction = ToolAction> {
  action: A;
  onImpact: () => void;
  onDone: () => void;
  emit: { sparks: (b: Burst) => void; smoke: (b: Burst) => void; fire: (b: Burst) => void };
}

export function ToolActor(props: ActorProps) {
  const { action } = props;
  switch (action.kind) {
    case "hammer":
      return <Hammer {...props} action={action} />;
    case "bat":
      return <Bat {...props} action={action} />;
    case "laser":
      return <Laser {...props} action={action} />;
    case "laserPath":
      return <LaserPath {...props} action={action} />;
    case "bomb":
      return <Bomb {...props} action={action} />;
    case "press":
      return <Press {...props} action={action} />;
  }
}

/** Shared timeline bookkeeping: elapsed ms, fire-once impact/done. */
function useTimeline(onImpact: () => void, onDone: () => void) {
  const invalidate = useThree((s) => s.invalidate);
  const start = useRef(0);
  const fired = useRef({ impact: false, done: false });
  return {
    elapsed() {
      const now = performance.now();
      if (!start.current) start.current = now;
      invalidate();
      return now - start.current;
    },
    impact() {
      if (fired.current.impact) return;
      fired.current.impact = true;
      onImpact();
    },
    done() {
      if (fired.current.done) return;
      fired.current.done = true;
      onDone();
    },
  };
}

const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

/** Rotation that takes local +Y to `normal` and local +Z toward the camera. */
function surfaceFrame(normal: THREE.Vector3, toCamera: THREE.Vector3) {
  const y = normal.clone().normalize();
  const z = toCamera.clone().addScaledVector(y, -toCamera.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

const STEEL = { color: "#7f858d", metalness: 0.9, roughness: 0.35 };

function Hammer({ action, onImpact, onDone }: ActorProps<Extract<ToolAction, { kind: "hammer" }>>) {
  const swing = useRef<THREE.Group>(null);
  const scaler = useRef<THREE.Group>(null);
  const tl = useTimeline(onImpact, onDone);
  const L = action.size * 0.75;
  const headR = L * 0.09;
  const quaternion = useMemo(() => surfaceFrame(action.normal, action.toCamera), [action]);

  useFrame(() => {
    const t = tl.elapsed();
    let angle = 0;
    let scale = 1;
    if (t < 140) angle = 75 * (1 - easeIn(t / 140));
    else if (t < 320) angle = 22 * Math.sin(((t - 140) / 180) * Math.PI);
    else scale = Math.max(0, 1 - (t - 320) / 160);
    if (t >= 140) tl.impact();
    if (scale <= 0) tl.done();
    swing.current!.rotation.x = THREE.MathUtils.degToRad(angle);
    scaler.current!.scale.setScalar(scale);
  });

  // Grip sits toward the camera; at angle 0 the head's face touches the hit point.
  return (
    <group position={action.point} quaternion={quaternion}>
      <group ref={scaler}>
        <group position={[0, headR, L]}>
          <group ref={swing}>
            <mesh position={[0, 0, -L / 2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[L * 0.028, L * 0.034, L, 10]} />
              <meshStandardMaterial color="#9c6b3c" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0, -L]}>
              <boxGeometry args={[L * 0.34, headR * 2, headR * 2]} />
              <meshStandardMaterial {...STEEL} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Aluminum bat: lathe profile along -Z from the knob. */
function batGeometry(L: number) {
  const profile: [number, number][] = [
    [0, 0],
    [0.032, 0],
    [0.034, 0.012],
    [0.016, 0.03],
    [0.015, 0.4],
    [0.024, 0.62],
    [0.038, 0.78],
    [0.039, 0.97],
    [0.03, 0.995],
    [0, 1],
  ];
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r * L, y * L)),
    24,
  );
  g.rotateX(-Math.PI / 2);
  return g;
}

function Bat({ action, onImpact, onDone }: ActorProps<Extract<ToolAction, { kind: "bat" }>>) {
  const spin = useRef<THREE.Group>(null);
  const tl = useTimeline(onImpact, onDone);
  const L = action.size * 1.2;
  const geometry = useMemo(() => batGeometry(L), [L]);
  const grip = useMemo(() => {
    const g = new THREE.CylinderGeometry(L * 0.018, L * 0.018, L * 0.28, 12);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -L * 0.17);
    return g;
  }, [L]);

  // The batter stands toward the camera; the bat points at the hit point at
  // contact and sweeps through it in `dir`.
  const { pivot, yaw, sign } = useMemo(() => {
    const flatCam = action.toCamera.clone().setY(0).normalize();
    const p = action.point.clone().addScaledVector(flatCam, L * 0.88);
    const d = action.point.clone().sub(p).setY(0).normalize();
    const a = Math.atan2(-d.x, -d.z);
    const tangent = new THREE.Vector3(-Math.cos(a), 0, Math.sin(a));
    return { pivot: p, yaw: a, sign: tangent.dot(action.dir) >= 0 ? 1 : -1 };
  }, [action, L]);

  useFrame(() => {
    const t = tl.elapsed();
    let phi;
    let scale = 1;
    if (t < 150) phi = -75 * (1 - easeIn(t / 150));
    else if (t < 330) phi = 75 * easeOut((t - 150) / 180);
    else {
      phi = 75;
      scale = Math.max(0, 1 - (t - 330) / 150);
    }
    if (t >= 150) tl.impact();
    if (scale <= 0) tl.done();
    const g = spin.current!;
    g.rotation.y = yaw + sign * THREE.MathUtils.degToRad(phi);
    g.scale.setScalar(scale);
  });

  return (
    <group position={pivot}>
      <group ref={spin}>
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#d6dbe2" metalness={1} roughness={0.22} />
        </mesh>
        <mesh geometry={grip}>
          <meshStandardMaterial color="#1c1c1e" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

function Laser({ action, onImpact, onDone, emit }: ActorProps<Extract<ToolAction, { kind: "laser" }>>) {
  const beam = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const tl = useTimeline(onImpact, onDone);
  const { mid, quaternion, length } = useMemo(() => {
    const d = action.point.clone().sub(action.from);
    return {
      mid: action.from.clone().add(action.point).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
      length: d.length(),
    };
  }, [action]);
  const r = action.size * 0.012;

  useFrame(() => {
    const t = tl.elapsed();
    let width = 1;
    if (t < 70) width = t / 70;
    else if (t > 460) width = Math.max(0, 1 - (t - 460) / 100);
    if (t >= 70 && t < 460) {
      emit.sparks({
        position: action.point,
        count: 4,
        colors: ["#ffffff", "#ffd27a", "#ff7a2a"],
        speed: action.size * 2.2,
        size: action.size * 0.012,
        life: 0.35,
        direction: action.normal,
        spread: 0.7,
        gravity: action.upm * 9.8,
      });
    }
    if (t >= 260) tl.impact();
    if (t >= 560) tl.done();
    beam.current!.scale.set(width, 1, width);
    glow.current!.scale.set(0.85 + Math.random() * 0.3, 1, 0.85 + Math.random() * 0.3);
  });

  return (
    <group position={mid} quaternion={quaternion}>
      <group ref={beam}>
        <mesh renderOrder={3}>
          <cylinderGeometry args={[r, r, length, 8, 1, true]} />
          <meshBasicMaterial color="#fff2f2" toneMapped={false} />
        </mesh>
        <mesh ref={glow} renderOrder={3}>
          <cylinderGeometry args={[r * 3.5, r * 3.5, length, 12, 1, true]} />
          <meshBasicMaterial
            color="#ff1f1f"
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/** Laser that sweeps along a drawn path; the caller does the cutting in onMove. */
function LaserPath({ action, onImpact, onDone, emit }: ActorProps<Extract<ToolAction, { kind: "laserPath" }>>) {
  const beam = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const tl = useTimeline(onImpact, onDone);
  const { cumulative, total } = useMemo(() => {
    const c = [0];
    for (let i = 1; i < action.path.length; i++) c.push(c[i - 1] + action.path[i].distanceTo(action.path[i - 1]));
    return { cumulative: c, total: c[c.length - 1] };
  }, [action]);
  // Longer paths take longer, within limits that keep it snappy.
  const duration = Math.min(2600, Math.max(600, total * 900));
  const r = action.size * 0.012;
  const tmp = useMemo(
    () => ({ ndc: new THREE.Vector2(), dir: new THREE.Vector3(), mid: new THREE.Vector3(), q: new THREE.Quaternion() }),
    [],
  );

  const pointAt = (d: number) => {
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < d) i++;
    const seg = cumulative[i] - cumulative[i - 1] || 1;
    return tmp.ndc.lerpVectors(action.path[i - 1], action.path[i], Math.min(1, (d - cumulative[i - 1]) / seg));
  };

  useFrame(() => {
    const t = tl.elapsed();
    tl.impact();
    const k = Math.min(1, t / duration);
    const contact = action.probe(pointAt(k * total));
    let width = t < 80 ? t / 80 : 1;
    if (t > duration) width = Math.max(0, 1 - (t - duration) / 140);
    if (width <= 0 && t > duration) tl.done();

    const g = beam.current!;
    g.visible = contact !== null;
    if (!contact) return;
    tmp.dir.copy(contact.point).sub(action.from);
    const length = tmp.dir.length();
    tmp.dir.normalize();
    g.position.copy(tmp.mid.copy(action.from).add(contact.point).multiplyScalar(0.5));
    g.quaternion.copy(tmp.q.setFromUnitVectors(UP_Y, tmp.dir));
    g.scale.set(width, length, width);
    glow.current!.scale.set(0.85 + Math.random() * 0.3, 1, 0.85 + Math.random() * 0.3);

    if (t > duration) return;
    const onSomething = contact.target !== null;
    emit.sparks({
      position: contact.point,
      count: onSomething ? 4 : 2,
      colors: ["#ffffff", "#ffd27a", "#ff7a2a"],
      speed: action.size * 2.2,
      size: action.size * 0.011,
      life: 0.35,
      direction: contact.normal,
      spread: 0.7,
      gravity: action.upm * 9.8,
    });
    // Embers hang in the air along the trail, so the path reads as burnt.
    emit.fire({
      position: contact.point,
      count: 2,
      colors: ["#ff8a2a", "#ff4d12", "#ffc35c"],
      speed: action.size * 0.15,
      size: action.size * 0.022,
      life: 0.9,
      gravity: -action.upm * 0.15,
      drag: 2,
    });
    action.onMove(contact, tmp.dir.clone());
  });

  return (
    <group ref={beam} visible={false}>
      <mesh renderOrder={3}>
        <cylinderGeometry args={[r, r, 1, 8, 1, true]} />
        <meshBasicMaterial color="#fff2f2" toneMapped={false} />
      </mesh>
      <mesh ref={glow} renderOrder={3}>
        <cylinderGeometry args={[r * 3.5, r * 3.5, 1, 12, 1, true]} />
        <meshBasicMaterial
          color="#ff1f1f"
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

const UP_Y = new THREE.Vector3(0, 1, 0);

const FUSE_MS = 1600;

function Bomb({ action, onImpact, onDone, emit }: ActorProps<Extract<ToolAction, { kind: "bomb" }>>) {
  const body = useRef<THREE.Group>(null);
  const shell = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const tl = useTimeline(onImpact, onDone);
  const r = action.size * 0.14;
  const position = useMemo(() => action.point.clone().addScaledVector(action.normal, r), [action, r]);
  const fuseTip = useMemo(() => position.clone().add(new THREE.Vector3(r * 0.35, r * 1.55, 0)), [position, r]);

  useFrame(() => {
    const t = tl.elapsed();
    const g = body.current!;
    if (t < FUSE_MS) {
      // Pop in, then pulse faster and glow redder as the fuse burns down.
      const k = t / FUSE_MS;
      const pop = t < 180 ? easeOut(t / 180) * 1.1 : 1 + Math.sin(t * (0.02 + k * 0.05)) * 0.04 * (1 + k);
      g.scale.setScalar(pop);
      shell.current!.emissiveIntensity = k * k * 1.5 * (0.6 + 0.4 * Math.sin(t * 0.05));
      emit.sparks({
        position: fuseTip,
        count: 2,
        colors: ["#fff6c2", "#ffb347"],
        speed: action.size * 0.8,
        size: action.size * 0.01,
        life: 0.25,
        direction: new THREE.Vector3(0, 1, 0),
        spread: 0.9,
        gravity: action.upm * 4,
      });
    } else {
      tl.impact();
      g.visible = false;
      // Shockwave ring across the table.
      const k = Math.min(1, (t - FUSE_MS) / 450);
      ring.current!.visible = true;
      ring.current!.scale.setScalar(r + easeOut(k) * action.size * 2.6);
      ringMat.current!.opacity = 0.65 * (1 - k);
      if (k >= 1) tl.done();
    }
  });

  return (
    <>
      <group ref={body} position={position}>
        <mesh>
          <sphereGeometry args={[r, 24, 16]} />
          <meshStandardMaterial ref={shell} color="#1b1b1d" metalness={0.3} roughness={0.35} emissive="#ff2200" />
        </mesh>
        <mesh position={[0, r * 0.95, 0]}>
          <cylinderGeometry args={[r * 0.3, r * 0.3, r * 0.3, 12]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[r * 0.18, r * 1.3, 0]} rotation={[0, 0, -0.5]}>
          <cylinderGeometry args={[r * 0.05, r * 0.05, r * 0.55, 6]} />
          <meshStandardMaterial color="#c8b48a" roughness={1} />
        </mesh>
      </group>
      <mesh ref={ring} position={[action.point.x, 0.001, action.point.z]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.85, 1, 48]} />
        <meshBasicMaterial ref={ringMat} color="#fff1d6" transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

function Press({ action, onImpact, onDone }: ActorProps<Extract<ToolAction, { kind: "press" }>>) {
  const plate = useRef<THREE.Group>(null);
  const tl = useTimeline(onImpact, onDone);
  const st = useRef({ burstAt: 0, holdFrom: 0, contact: false, rising: false });
  const W = action.radius * 2.6;
  const T = action.size * 0.16;
  const rod = action.size * 6;
  const { top, crushTo, burstAt } = action;

  useFrame(() => {
    const t = tl.elapsed();
    const s = st.current;
    let bottom: number;
    if (t < 450) {
      bottom = top + action.size * 1.3 * (1 - easeIn(t / 450));
    } else if (!s.burstAt && !s.holdFrom) {
      if (!s.contact) {
        s.contact = true;
        action.onPhase("contact");
      }
      // Crushing: slow and steady, like a real press.
      const k = Math.min(1, (t - 450) / 1500);
      bottom = top * (1 - (1 - crushTo) * k);
      const squash = bottom / top;
      action.onProgress(squash);
      if (burstAt !== null && squash <= burstAt) {
        s.burstAt = t;
        tl.impact();
      } else if (k >= 1) s.holdFrom = t;
    } else if (s.burstAt) {
      // Object gone: slam to the table, hold, rise.
      const k = (t - s.burstAt) / 160;
      const crushed = top * burstAt!;
      if (k < 1) bottom = crushed + (0.002 - crushed) * easeIn(k);
      else {
        bottom = 0.002;
        if (!s.holdFrom) s.holdFrom = t;
      }
    } else {
      bottom = top * crushTo;
    }
    if (s.holdFrom && t > s.holdFrom + 450) {
      if (!s.rising) {
        s.rising = true;
        action.onPhase("rise");
      }
      const k = Math.min(1, (t - s.holdFrom - 450) / 650);
      const from = s.burstAt ? 0.002 : top * crushTo;
      bottom = from + (top + action.size * 2 - from) * easeIn(k);
      if (k >= 1) tl.done();
    }
    plate.current!.position.y = bottom;
  });

  return (
    <group ref={plate} position={[action.center.x, top + action.size * 1.3, action.center.z]}>
      <mesh position={[0, T / 2, 0]}>
        <boxGeometry args={[W, T, W]} />
        <meshStandardMaterial color="#3b4047" metalness={0.8} roughness={0.4} />
      </mesh>
      <mesh position={[0, T * 0.15, W / 2 + 0.0005]}>
        <boxGeometry args={[W, T * 0.3, T * 0.02]} />
        <meshStandardMaterial color="#f2c230" roughness={0.6} />
      </mesh>
      <mesh position={[0, T + rod / 2, 0]}>
        <cylinderGeometry args={[action.size * 0.13, action.size * 0.13, rod, 20]} />
        <meshStandardMaterial color="#cfd4da" metalness={1} roughness={0.15} />
      </mesh>
    </group>
  );
}
