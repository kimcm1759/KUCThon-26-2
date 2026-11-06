"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  interactionGroups,
  Physics,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { breakProfile } from "@/lib/breakage";
import {
  insideMaterial,
  prepareFracture,
  sliceModel,
  slicePiece,
  type Fragment,
  type PreparedFracture,
} from "@/lib/fracture";
import { addCrack, addDent, chipGeometry } from "@/lib/hitEffects";
import { sound, type SoundObject } from "@/lib/sound/engine";
import { TOOL_DAMAGE, type SmashEvent, type ToolId } from "@/lib/tools";
import type { Alignment, Box } from "@/lib/types";
import { Particles, type ParticlesHandle } from "./fx/Particles";
import { ToolActor, type Contact, type Target, type ToolAction } from "./fx/ToolActors";
import { poseCamera, solvePlacement } from "./placement";

/**
 * The generated model placed in the photo: hand manipulation, tools, damage,
 * fracture and physics debris.
 */

export interface SmashProps {
  /** Claude's material / fragility labels; drive durability and how it breaks. */
  material?: string;
  fragility?: string;
  /** Real object height, to scale gravity and speeds to the photo. */
  realHeightCm?: number;
  /** Change to put the object back together. */
  resetSignal?: number;
  tool?: ToolId;
  onBreak?: () => void;
  /** After each blow: hits left before it breaks, and the total. */
  onHit?: (remaining: number, total: number) => void;
  /** Moments a sound layer can react to. */
  onEvent?: (e: SmashEvent) => void;
  /** Which demo object's sound set to use (laptop / book / can). */
  soundObject?: SoundObject;
}

/** Effects drawn outside the 3D canvas (they also cover the photo). */
export interface ScreenFx {
  shake: (strength: number, ms?: number) => void;
  flash: (color: string, ms?: number) => void;
  /** Show (or clear with null) the laser path, in 0-1 screen coordinates, y down. */
  path: (points: { x: number; y: number }[] | null) => void;
}

/** What the viewer's hands have done on top of the solved placement. */
interface Manipulation {
  /** Slide along the ground, world units. */
  offset: THREE.Vector3;
  /** Spin/tilt around the object's middle. */
  rotation: THREE.Quaternion;
  scale: number;
}

/** One physics body (a fragment or a chip), already placed in world space. */
interface Piece {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  restitution: number;
  /** Bounding radius, picks a small or large landing sound. */
  radius: number;
}

/** How the final blow throws the pieces. */
type BreakStyle =
  | { kind: "hammer"; normal: THREE.Vector3 }
  | { kind: "bat"; dir: THREE.Vector3 }
  | { kind: "bomb" }
  | { kind: "press"; center: THREE.Vector3 };

// Debris collides with the table but not with other debris. Voronoi pieces
// spawn face-to-face, and non-convex pieces get convex hulls that overlap
// their neighbors; letting them collide made the pile jitter forever.
const TABLE_GROUP = interactionGroups(0, [1]);
const DEBRIS_GROUP = interactionGroups(1, [0]);

/**
 * Physics pauses (and rendering stops) once debris is nearly still, checked
 * from SETTLE_MS after the last hit; touching pieces otherwise keep jittering.
 * SETTLE_MAX_MS is the cutoff for pieces still flying or rolling.
 */
const SETTLE_MS = 1000;
const SETTLE_MAX_MS = 5000;
const SETTLE_CHECK_MS = 200;
/** Below this speed (m/s) a piece counts as resting. */
const REST_SPEED = 0.2;
const WOBBLE_MS = 300;
/** Laser cuts stop here to keep phones smooth. */
const MAX_PIECES = 120;
/** Freshly cut faces glow and cool down over this long. */
const COOL_MS = 2200;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Whether Rapier can build a convex hull for this piece. Laser cuts through
 * thin fragments leave slivers that are flat or have NaNs; for those
 * ColliderDesc.convexHull returns null, @react-three/rapier passes that on to
 * createCollider, and Rapier panics ("unreachable"), after which every
 * physics step fails. Such slivers are too small to see, so they're dropped.
 */
function hullable(geometry: THREE.BufferGeometry, rapier: Rapier | null) {
  const pos = geometry.attributes.position;
  if (!pos || pos.count < 4) return false;
  const points = Float32Array.from(pos.array as ArrayLike<number>);
  if (!points.every(Number.isFinite)) return false;
  // Ask the same Rapier build the physics uses (it's loaded once pieces exist).
  return !rapier || rapier.ColliderDesc.convexHull(points) !== null;
}

type Rapier = ReturnType<typeof useRapier>["rapier"];

/** Timestamp for event-handler code (kept out of render-time lint checks). */
const now = () => performance.now();

/** Steps physics ourselves so time can be slowed for big hits; also hands out the loaded Rapier module. */
function PhysicsDriver({
  active,
  timeScale,
  rapierRef,
}: {
  active: boolean;
  timeScale: RefObject<number>;
  rapierRef: RefObject<Rapier | null>;
}) {
  const { step, rapier } = useRapier();
  useEffect(() => {
    rapierRef.current = rapier;
  }, [rapier, rapierRef]);
  useFrame((_, delta) => {
    if (active) step(Math.min(delta, 1 / 30) * timeScale.current);
  });
  return null;
}

export function PlacedModel({
  url,
  bbox,
  alignment,
  smash: smashProps,
  fx,
}: {
  url: string;
  bbox: Box;
  alignment: Alignment;
  smash?: SmashProps;
  fx: ScreenFx;
}) {
  const { scene: source } = useGLTF(url);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const material = smashProps?.material;
  const fragility = smashProps?.fragility;
  const realHeightCm = smashProps?.realHeightCm;
  const profile = useMemo(() => breakProfile(material, fragility), [material, fragility]);

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [intact, setIntact] = useState(true);
  const [physicsOn, setPhysicsOn] = useState(false);
  const [unitsPerMeter, setUnitsPerMeter] = useState(1);
  const [action, setAction] = useState<ToolAction | null>(null);
  const actionRef = useRef<ToolAction | null>(null);
  const piecesRef = useRef<Piece[]>([]);
  const bodies = useRef(new Map<string, RapierRigidBody>());
  /**
   * Bodies still in the physics world. A cut replaces a piece and its body is
   * removed from the world before React drops it from `bodies`; touching such
   * a handle makes Rapier panic ("unreachable") and breaks all later steps.
   */
  const liveBodies = () => {
    const live: RapierRigidBody[] = [];
    for (const [key, b] of bodies.current) {
      if (b.isValid()) live.push(b);
      else bodies.current.delete(key);
    }
    return live;
  };
  const meshes = useRef(new Map<string, THREE.Mesh>());
  const upmRef = useRef(1);
  const seq = useRef(0);
  const damage = useRef({ hits: 0, breaking: false, broken: false });
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slowTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const timeScale = useRef(1);
  const rapierRef = useRef<Rapier | null>(null);
  const wobbleStart = useRef(0);
  const knock = useRef<{ from: THREE.Vector3; to: THREE.Vector3; start: number } | null>(null);
  const hot = useRef<{ material: THREE.MeshStandardMaterial; start: number }[]>([]);
  const squash = useRef({ sy: 1, cx: 0, cz: 0 });
  const lastRumble = useRef(0);
  const pressCrunched = useRef(false);
  const uniformFracture = useRef<Promise<PreparedFracture> | null>(null);
  /** Fractures concentrated where the next break will likely happen. */
  const nearCut = useRef<{ point: THREE.Vector3; result?: PreparedFracture } | null>(null);
  const bombCut = useRef<{ point: THREE.Vector3; result?: PreparedFracture } | null>(null);
  const sparks = useRef<ParticlesHandle>(null);
  const fire = useRef<ParticlesHandle>(null);
  const smoke = useRef<ParticlesHandle>(null);
  const live = useRef({ ...smashProps, fx });
  useEffect(() => {
    live.current = { ...smashProps, fx };
  });

  const squashRef = useRef<THREE.Group>(null);
  const outerRef = useRef<THREE.Group>(null);
  const pivotRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const base = useRef({ position: new THREE.Vector3(), yaw: 0, scale: 1 });
  const user = useRef<Manipulation>({
    offset: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: 1,
  });

  // Normalize the model: centered on x/z, resting on y=0, largest side = 1.
  // Keep a vertex sample for measuring its projected silhouette.
  const { object, samples, height } = useMemo(() => {
    const model = source.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const dims = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = 1 / Math.max(dims.x, dims.y, dims.z);
    model.scale.setScalar(k);
    model.position.set(-center.x * k, -box.min.y * k, -center.z * k);

    const wrapper = new THREE.Group();
    wrapper.add(model);
    wrapper.updateMatrixWorld(true);
    const points: THREE.Vector3[] = [];
    wrapper.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? mesh.geometry.attributes.position : undefined;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 2000));
      for (let i = 0; i < pos.count; i += step) {
        points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
      }
    });
    return { object: wrapper, samples: points, height: dims.y * k };
  }, [source]);

  /** Squash about the table plane (y=0) under the object, for the press. */
  const applySquash = useMemo(
    () => () => {
      const g = squashRef.current;
      if (!g) return;
      const { sy, cx, cz } = squash.current;
      const bulge = 1 + (1 - sy) * 0.4;
      g.position.set(cx * (1 - bulge), 0, cz * (1 - bulge));
      g.scale.set(bulge, sy, bulge);
      g.updateMatrixWorld(true);
      invalidate();
    },
    [invalidate],
  );

  // Push base placement + manipulation into the scene graph.
  const apply = useMemo(() => {
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    return () => {
      const outer = outerRef.current;
      const pivot = pivotRef.current;
      const light = lightRef.current;
      const sq = squashRef.current;
      if (!outer || !pivot || !light || !sq) return;
      const b = base.current;
      const u = user.current;
      const scale = b.scale * u.scale;
      outer.position.copy(b.position).add(u.offset).setY(0);
      outer.rotation.set(0, b.yaw, 0);
      outer.scale.setScalar(scale);
      pivot.quaternion.copy(u.rotation);
      sq.updateMatrixWorld(true);

      // Keep it resting on the table however it is turned (measured without the press squash).
      m.copy(sq.matrixWorld).invert().multiply(object.matrixWorld);
      let minY = Infinity;
      for (const p of samples) minY = Math.min(minY, v.copy(p).applyMatrix4(m).y);
      outer.position.y = -minY;
      if (squash.current.sy < 1) {
        squash.current.cx = outer.position.x;
        squash.current.cz = outer.position.z;
        applySquash();
      }
      sq.updateMatrixWorld(true);

      // Key light above and slightly in front of the object. No shadows on
      // purpose: the object is moved and spun freely, and a rendered shadow
      // never matches the photo's own lighting.
      const at = outer.position;
      light.position.set(at.x + scale * 1.2, scale * 3, at.z + scale * 1.5);
      light.target.position.set(at.x, 0, at.z);
      light.target.updateMatrixWorld();
      invalidate();
    };
  }, [object, samples, invalidate, applySquash]);

  useLayoutEffect(() => {
    poseCamera(camera, size.width / size.height, alignment);
    base.current = solvePlacement(camera, samples, bbox, alignment);
    apply();
  }, [camera, size, samples, bbox, alignment, apply]);

  // Cut the model into fragments in a worker as soon as it is loaded, so a
  // breaking blow never waits.
  useEffect(() => {
    const job = prepareFracture(object, { material, fragmentCount: profile.pieces });
    job
      .then((r) =>
        console.info(
          `[fracture] ${r.method}: ${r.fragments.length} pieces from ${r.triangles} triangles in ${r.ms.toFixed(0)}ms`,
        ),
      )
      .catch((e) => console.error("[fracture]", e));
    uniformFracture.current = job;
    return () => {
      job.then((r) => r.fragments.forEach((f) => f.geometry.dispose())).catch(() => {});
    };
  }, [object, material, profile]);

  const soundObject = smashProps?.soundObject;
  useEffect(() => sound.preload(soundObject), [soundObject]);

  // Free debris copies and stop continuous rendering on reset/unmount.
  useEffect(
    () => () => {
      sound.stopAll();
      sound.setTimeScale(1);
      clearTimeout(settleTimer.current);
      clearTimeout(slowTimer.current);
      piecesRef.current.forEach((p) => p.geometry.dispose());
      setFrameloop("demand");
    },
    [setFrameloop],
  );

  // Per-frame bits that are not physics: hit wobble, bat knock-back, cooling cut faces.
  useFrame(() => {
    const now = performance.now();
    const pivot = pivotRef.current;
    let busy = false;

    if (pivot && wobbleStart.current) {
      const t = (now - wobbleStart.current) / WOBBLE_MS;
      if (t >= 1) {
        wobbleStart.current = 0;
        pivot.scale.setScalar(1);
      } else {
        const amp = profile.hitEffect === "squash" ? 0.25 : 0.06;
        const k = Math.sin(t * Math.PI * 3) * (1 - t) * amp;
        pivot.scale.set(1 + k * 0.5, 1 - k, 1 + k * 0.5);
        busy = true;
      }
    }

    const kb = knock.current;
    if (kb) {
      const t = Math.min(1, (now - kb.start) / 260);
      user.current.offset.lerpVectors(kb.from, kb.to, 1 - (1 - t) * (1 - t));
      apply();
      if (t >= 1) knock.current = null;
      busy = true;
    }

    if (hot.current.length) {
      hot.current = hot.current.filter((h) => {
        const t = (now - h.start) / COOL_MS;
        h.material.emissiveIntensity = t >= 1 ? 0 : 3 * (1 - t) * (1 - t);
        return t < 1;
      });
      busy = true;
    }
    if (busy) invalidate();
  });

  const measure = useMemo(
    () => () => {
      const worldHeight = height * (outerRef.current?.scale.x ?? 1);
      return { worldHeight, upm: worldHeight / ((realHeightCm || 20) / 100) };
    },
    [height, realHeightCm],
  );

  /** Play a tool sound for the current object and tell the onEvent listener. */
  const sfx = (tool: string, event: string, volume = 1) => {
    const object = live.current.soundObject;
    void sound.play(event, { object, tool, volume });
    live.current.onEvent?.({ tool, event, object, material, strength: volume });
  };
  const loopOn = (tool: string, event: string, volume = 1) => {
    const object = live.current.soundObject;
    void sound.loop(`${tool}-${event}`, event, { object, tool, volume });
    live.current.onEvent?.({ tool, event, object, material, strength: volume, loop: "start" });
  };
  const loopOff = (tool: string, event: string) => {
    sound.stop(`${tool}-${event}`);
    live.current.onEvent?.({ tool, event, object: live.current.soundObject, material, strength: 0, loop: "stop" });
  };
  const lastDebrisSound = useRef(0);

  /** Run physics (and continuous rendering) until things have had time to settle. */
  const wake = useMemo(
    () => (upm: number) => {
      upmRef.current = upm;
      setUnitsPerMeter(upm);
      setPhysicsOn(true);
      setFrameloop("always");
      clearTimeout(settleTimer.current);
      const deadline = now() + SETTLE_MAX_MS;
      const check = () => {
        const moving = liveBodies().some((b) => {
          const v = b.linvel();
          return Math.hypot(v.x, v.y, v.z) / upmRef.current > REST_SPEED;
        });
        if (moving && now() < deadline) {
          settleTimer.current = setTimeout(check, SETTLE_CHECK_MS);
          return;
        }
        setPhysicsOn(false);
        setFrameloop("demand");
        invalidate();
      };
      settleTimer.current = setTimeout(check, SETTLE_MS);
    },
    [setFrameloop, invalidate],
  );

  const addPieces = useMemo(
    () => (added: Piece[], removeKey?: string) => {
      let list = piecesRef.current;
      if (removeKey) {
        list.find((p) => p.key === removeKey)?.geometry.dispose();
        list = list.filter((p) => p.key !== removeKey);
      }
      piecesRef.current = [...list, ...added];
      setPieces(piecesRef.current);
    },
    [],
  );

  const slowMo = (scale: number, ms: number) => {
    timeScale.current = scale;
    sound.setTimeScale(scale);
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => {
      timeScale.current = 1;
      sound.setTimeScale(1);
    }, ms);
  };

  /** Place fragments (centered, in `matrix`'s space) in the world as physics pieces. */
  const toPieces = (
    fragments: Fragment[],
    matrix: THREE.Matrix4,
    opts: {
      material: Piece["material"];
      velocity: (p: THREE.Vector3) => THREE.Vector3;
      spin: number;
    },
  ): Piece[] => {
    const prefix = `p${seq.current++}`;
    const m = new THREE.Matrix4();
    return fragments.filter((f) => hullable(f.geometry, rapierRef.current)).map((f, i) => {
      const world = matrix.clone().multiply(m.makeTranslation(f.center));
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      world.decompose(p, q, s);
      // Physics bodies have no scale, so bake it into a copy of the geometry.
      const geometry = f.geometry.clone().scale(s.x, s.y, s.z);
      geometry.computeBoundingSphere();
      const spin = () => (Math.random() - 0.5) * opts.spin;
      return {
        key: `${prefix}-${i}`,
        geometry,
        material: opts.material,
        position: p.toArray(),
        quaternion: q,
        linearVelocity: opts.velocity(p).toArray(),
        angularVelocity: [spin(), spin(), spin()],
        restitution: profile.restitution,
        radius: geometry.boundingSphere!.radius,
      };
    });
  };

  /** Kick physics pieces near `center`; `dv` gives the velocity change by position and distance. */
  const pushDebris = (
    center: THREE.Vector3,
    radius: number,
    dv: (pos: THREE.Vector3, dist: number) => THREE.Vector3,
  ) => {
    let touched = false;
    for (const body of liveBodies()) {
      const t = body.translation();
      const pos = new THREE.Vector3(t.x, t.y, t.z);
      const d = pos.distanceTo(center);
      if (d > radius) continue;
      const v = dv(pos, d).multiplyScalar(body.mass());
      body.applyImpulse({ x: v.x, y: v.y, z: v.z }, true);
      touched = true;
    }
    if (touched) wake(upmRef.current);
  };

  /** Precompute a fracture with small pieces around a world point. */
  const preCut = (point: THREE.Vector3, count: number, radius: number) => {
    object.updateMatrixWorld(true);
    const local = object.worldToLocal(point.clone());
    const pending: { point: THREE.Vector3; result?: PreparedFracture } = { point: local };
    prepareFracture(object, { material, fragmentCount: count, impact: { point: local, radius } })
      .then((r) => (pending.result = r))
      .catch((e) => console.warn("[fracture] impact pre-cut failed", e));
    return pending;
  };

  /** Swap the object for fragments thrown according to `style`. */
  const breakApart = async (point: THREE.Vector3, style: BreakStyle, preferred?: PreparedFracture) => {
    const d = damage.current;
    if (d.broken || d.breaking) return;
    d.breaking = true;
    object.updateMatrixWorld(true);
    const local = object.worldToLocal(point.clone());
    const near = nearCut.current;
    let fracture =
      preferred ?? (near?.result && near.point.distanceTo(local) < 0.35 ? near.result : undefined);
    if (!fracture) {
      try {
        fracture = await uniformFracture.current!;
      } catch {
        d.breaking = false;
        return;
      }
    }

    object.updateMatrixWorld(true);
    const { worldHeight, upm } = measure();
    const speed = upm * profile.speed;
    const r = Math.random;
    const velocity = (p: THREE.Vector3) => {
      const away = p.clone().sub(point);
      const dist = away.length();
      away.normalize();
      const falloff = 1 / (1 + dist / (worldHeight * 0.5));
      switch (style.kind) {
        case "hammer":
          return away
            .multiplyScalar(speed * (0.8 + 1.6 * r()) * falloff)
            .addScaledVector(style.normal, -speed * 0.35)
            .add(new THREE.Vector3(0, speed * 0.5 * r(), 0));
        case "bat":
          return style.dir
            .clone()
            .multiplyScalar(speed * 1.3 * (0.7 + 0.6 * r()))
            .addScaledVector(away, speed * 0.4 * falloff)
            .add(new THREE.Vector3(0, speed * 0.35 * r(), 0));
        case "bomb":
          return away
            .multiplyScalar(speed * 3.2 * (0.6 + 0.8 * r()) / (1 + dist / (worldHeight * 0.8)))
            .add(new THREE.Vector3(0, speed * 1.6 * (0.3 + 0.7 * r()), 0));
        case "press": {
          const radial = p.clone().sub(style.center).setY(0).normalize();
          return radial.multiplyScalar(speed * 2.2 * (0.6 + 0.8 * r())).setY(speed * 0.3 * r());
        }
      }
    };
    const added = toPieces(fracture.fragments, object.matrixWorld, {
      material: fracture.materials,
      velocity,
      spin: profile.spin * (style.kind === "bomb" ? 1.6 : 1),
    });
    d.broken = true;
    setIntact(false);
    addPieces(added);
    wake(upm);
    live.current.onBreak?.();
    if (style.kind === "press") {
      loopOff("press", "crush");
      sfx("press", "burst");
    } else if (style.kind === "hammer" || style.kind === "bat") sfx(style.kind, "break");
  };

  /** Durability hit from a hammer or bat; breaks on the last one. */
  const damageObject = (hit: Extract<Target, { kind: "object" }>, amount: number, style: BreakStyle) => {
    const d = damage.current;
    if (d.broken || d.breaking) return false;
    d.hits += amount;
    live.current.onHit?.(Math.max(0, profile.hp - d.hits), profile.hp);
    if (d.hits >= profile.hp) {
      breakApart(hit.point, style);
      return true;
    }

    if (style.kind === "hammer" || style.kind === "bat") sfx(style.kind, "damage");
    const { worldHeight, upm } = measure();
    if (profile.hitEffect === "crack") addCrack(hit.mesh, hit.point, hit.normal, worldHeight * 0.45);
    if (profile.hitEffect === "dent") addDent(hit.mesh, hit.point, hit.normal, worldHeight * 0.18);
    wobbleStart.current = now();
    invalidate();

    if (profile.chips > 0) {
      const chipMaterial = insideMaterial(material);
      const prefix = `c${seq.current++}`;
      const added = Array.from({ length: profile.chips }, (_, i): Piece => {
        const r = worldHeight * 0.025 * (0.6 + Math.random());
        const dir = hit.normal
          .clone()
          .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2))
          .normalize();
        const v = dir.multiplyScalar(upm * profile.speed * (0.5 + Math.random() * 0.8));
        v.y += upm * 0.6;
        const spin = () => (Math.random() - 0.5) * profile.spin;
        return {
          key: `${prefix}-${i}`,
          geometry: chipGeometry(r),
          material: chipMaterial,
          position: hit.point.clone().addScaledVector(hit.normal, r * 1.5).toArray(),
          quaternion: new THREE.Quaternion().random(),
          linearVelocity: v.toArray(),
          angularVelocity: [spin(), spin(), spin()],
          restitution: profile.restitution,
          radius: r,
        };
      });
      addPieces(added);
      wake(upm);
    }
    // The final blow usually lands near the last one; have that fracture ready.
    nearCut.current = preCut(hit.point, profile.pieces, 0.25);
    return false;
  };

  /** A glowing material for freshly cut faces; it cools in useFrame. */
  const hotMaterial = () => {
    const m = insideMaterial(material);
    m.emissive.set("#ff5a14");
    m.emissiveIntensity = 3;
    hot.current.push({ material: m, start: now() });
    return m;
  };

  /** Pieces with a laser cut in flight (a sweep and a tap can hit the same one). */
  const cutting = useRef(new Set<string>());

  /** Laser: cut the object or a piece along the plane through its hit point with `normal`. */
  const cut = async (target: Target, normal: THREE.Vector3, apartScale = 1) => {
    if (piecesRef.current.length >= MAX_PIECES) return;
    const point = target.point;
    const { upm } = measure();
    const apart = (p: THREE.Vector3, base: THREE.Vector3) => {
      const side = Math.sign(p.clone().sub(point).dot(normal)) || 1;
      return base
        .clone()
        .addScaledVector(normal, side * upm * 0.35 * apartScale)
        .addScaledVector(UP, upm * 0.15 * apartScale);
    };

    if (target.kind === "object") {
      const d = damage.current;
      if (d.broken || d.breaking) return;
      d.breaking = true;
      object.updateMatrixWorld(true);
      const inv = object.matrixWorld.clone().invert();
      try {
        const { fragments, material: outer } = await sliceModel(object, {
          origin: point.clone().applyMatrix4(inv),
          normal: normal.clone().transformDirection(inv),
        });
        if (fragments.length < 2) throw new Error("cut missed");
        object.updateMatrixWorld(true);
        const added = toPieces(fragments, object.matrixWorld, {
          material: [outer, hotMaterial()],
          velocity: (p) => apart(p, new THREE.Vector3()),
          spin: 1.5,
        });
        if (added.length < 2) throw new Error("cut left only slivers");
        d.broken = true;
        setIntact(false);
        addPieces(added);
        wake(upm);
        live.current.onBreak?.();
        sfx("laser", "cut");
      } catch (e) {
        console.warn("[laser] cut failed", e);
        d.breaking = false;
      }
      return;
    }

    const key = target.key;
    const mesh = meshes.current.get(key);
    const piece = piecesRef.current.find((p) => p.key === key);
    if (!mesh || !piece || cutting.current.has(key)) return;
    cutting.current.add(key);
    mesh.updateMatrixWorld(true);
    const inv = mesh.matrixWorld.clone().invert();
    const body = bodies.current.get(key);
    const v = body?.isValid() ? body.linvel() : undefined;
    const lv = new THREE.Vector3(v?.x ?? 0, v?.y ?? 0, v?.z ?? 0);
    try {
      const fragments = await slicePiece(mesh.geometry, {
        origin: point.clone().applyMatrix4(inv),
        normal: normal.clone().transformDirection(inv),
      });
      // Reset or another cut may have taken this piece away while we waited.
      if (fragments.length < 2 || meshes.current.get(key) !== mesh || !piecesRef.current.includes(piece)) return;
      const outer = Array.isArray(piece.material) ? piece.material[0] : piece.material;
      mesh.updateMatrixWorld(true);
      const added = toPieces(fragments, mesh.matrixWorld, {
        material: [outer, hotMaterial()],
        velocity: (p) => apart(p, lv),
        spin: 1.5,
      });
      if (added.length < 2) {
        added.forEach((p) => p.geometry.dispose());
        return;
      }
      addPieces(added, key);
      wake(upmRef.current);
      sfx("laser", "cut", 0.8);
    } catch (e) {
      console.warn("[laser] piece cut failed", e);
    } finally {
      cutting.current.delete(key);
    }
  };

  const explode = (point: THREE.Vector3) => {
    const { worldHeight: s, upm } = measure();
    const screen = live.current.fx;
    screen.flash("#fff1d0", 220);
    screen.shake(1.3, 550);
    fire.current?.emit({
      position: point,
      count: 70,
      colors: ["#fff6c2", "#ffc23d", "#ff7a1a", "#e2360b"],
      speed: s * 2.6,
      size: s * 0.11,
      life: 0.55,
      gravity: -upm * 0.6,
      drag: 3,
      grow: 1.8,
    });
    smoke.current?.emit({
      position: point,
      count: 45,
      colors: ["#5d5853", "#77716a", "#3f3b37"],
      speed: s * 1.3,
      size: s * 0.14,
      life: 1.7,
      gravity: -upm * 0.25,
      drag: 1.6,
      grow: 3,
    });
    sparks.current?.emit({
      position: point,
      count: 60,
      colors: ["#ffffff", "#ffe08a", "#ff9a3d"],
      speed: s * 5,
      size: s * 0.012,
      life: 0.7,
      gravity: upm * 9.8,
    });
    slowMo(0.4, 550);
    loopOff("bomb", "fuse");
    sfx("bomb", "explode");

    if (!damage.current.broken) {
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      if (center.distanceTo(point) < s * 1.3) {
        breakApart(point, { kind: "bomb" }, bombCut.current?.result);
      } else {
        const away = center.sub(point).setY(0).normalize();
        knock.current = {
          from: user.current.offset.clone(),
          to: user.current.offset.clone().addScaledVector(away, s * 0.4),
          start: now(),
        };
      }
    }
    const radius = s * 2.2;
    pushDebris(point, radius, (pos, dist) => {
      const k = 1 - dist / radius;
      return pos.clone().sub(point).normalize().multiplyScalar(upm * 4 * k).add(new THREE.Vector3(0, upm * 2 * k, 0));
    });
  };

  /** A tool reached its moment of contact. */
  const onImpact = (a: ToolAction) => {
    const screen = live.current.fx;
    switch (a.kind) {
      case "hammer": {
        screen.shake(0.6, 220);
        if (material === "metal" || material === "electronics") {
          sparks.current?.emit({
            position: a.point,
            count: 18,
            colors: ["#ffffff", "#ffd27a"],
            speed: a.size * 2.5,
            size: a.size * 0.01,
            life: 0.35,
            direction: a.normal,
            spread: 0.6,
            gravity: a.upm * 9.8,
          });
        }
        smoke.current?.emit({
          position: a.point,
          count: 12,
          colors: ["#d9d2c5", "#bdb4a6"],
          speed: a.size * 1.1,
          size: a.size * 0.05,
          life: 0.7,
          direction: a.normal,
          spread: 0.8,
          drag: 2.5,
          grow: 2.2,
        });
        sfx("hammer", "hit");
        if (a.target.kind === "object") {
          damageObject(a.target, TOOL_DAMAGE.hammer, { kind: "hammer", normal: a.normal });
        } else {
          const radius = a.size * 0.5;
          pushDebris(a.point, radius, (pos, dist) =>
            pos.clone().sub(a.point).setY(0).normalize().multiplyScalar(a.upm * 2 * (1 - dist / radius)),
          );
        }
        break;
      }
      case "bat": {
        screen.shake(0.8, 260);
        sfx("bat", "hit");
        if (a.target.kind === "object") {
          const broke = damageObject(a.target, TOOL_DAMAGE.bat, { kind: "bat", dir: a.dir });
          if (broke) slowMo(0.35, 650);
          else {
            sfx("bat", "knock", 0.8);
            knock.current = {
              from: user.current.offset.clone(),
              to: user.current.offset.clone().addScaledVector(a.dir, a.size * 0.5),
              start: now(),
            };
          }
        } else {
          const radius = a.size * 0.8;
          pushDebris(a.point, radius, (_, dist) =>
            a.dir.clone().multiplyScalar(a.upm * 2.5 * (1 - dist / radius)).add(new THREE.Vector3(0, a.upm * 0.6, 0)),
          );
        }
        break;
      }
      case "laser": {
        // A tap cuts along the vertical plane that contains the beam.
        const n = new THREE.Vector3().crossVectors(a.point.clone().sub(a.from).normalize(), UP);
        if (n.lengthSq() < 1e-4) n.set(1, 0, 0).applyQuaternion(camera.quaternion);
        cut(a.target, n.normalize());
        break;
      }
      case "laserPath":
        break;
      case "bomb":
        explode(a.point);
        break;
      case "press":
        screen.shake(0.9, 300);
        smoke.current?.emit({
          position: new THREE.Vector3(a.center.x, a.size * 0.05, a.center.z),
          count: 24,
          colors: ["#d9d2c5", "#bdb4a6"],
          speed: a.size * 1.6,
          size: a.size * 0.06,
          life: 0.8,
          direction: UP,
          spread: 1,
          drag: 2.5,
          grow: 2.4,
        });
        breakApart(new THREE.Vector3(a.center.x, a.top * (a.burstAt ?? 0.5) * 0.5, a.center.z), {
          kind: "press",
          center: a.center,
        });
        break;
    }
  };

  const start = (a: ToolAction) => {
    actionRef.current = a;
    setAction(a);
    switch (a.kind) {
      case "hammer":
      case "bat":
        sfx(a.kind, "swing");
        break;
      case "press":
        loopOn("press", "motor");
        break;
      case "laser":
      case "laserPath":
        sfx("laser", "start");
        loopOn("laser", "beam");
        if (a.kind === "laser") loopOn("laser", "burn");
        break;
      case "bomb":
        sfx("bomb", "place");
        loopOn("bomb", "fuse");
        break;
    }
  };
  const finish = () => {
    const a = actionRef.current;
    actionRef.current = null;
    setAction(null);
    live.current.fx.path(null);
    if (a?.kind === "laser" || a?.kind === "laserPath") {
      loopOff("laser", "beam");
      loopOff("laser", "burn");
      sfx("laser", "end");
    }
    if (a?.kind === "press") {
      loopOff("press", "motor");
      loopOff("press", "crush");
    }
  };

  /** What a screen point (NDC) lands on: the intact model, a piece, or the table. */
  const pick = useMemo(() => {
    const raycaster = new THREE.Raycaster();
    const table = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const normalOf = (h: THREE.Intersection) =>
      h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : UP.clone();
    return (ndc: THREE.Vector2): Contact | null => {
      raycaster.setFromCamera(ndc, camera);
      // Crack decals sit on the surface; aim through them at the model.
      const onObj = damage.current.broken
        ? undefined
        : raycaster.intersectObject(object, true).find((h) => !h.object.userData.decal);
      const onDebris = raycaster.intersectObjects([...meshes.current.values()], false)[0];
      if (onObj && (!onDebris || onObj.distance <= onDebris.distance)) {
        const point = onObj.point.clone();
        const normal = normalOf(onObj);
        return { point, normal, target: { kind: "object", point, normal, mesh: onObj.object as THREE.Mesh } };
      }
      if (onDebris) {
        const point = onDebris.point.clone();
        const normal = normalOf(onDebris);
        return { point, normal, target: { kind: "debris", key: onDebris.object.userData.key as string, point, normal } };
      }
      const ground = raycaster.ray.intersectPlane(table, new THREE.Vector3());
      return ground ? { point: ground, normal: UP.clone(), target: null } : null;
    };
  }, [camera, object]);

  /**
   * While the swept beam touches something, keep cutting it every short
   * stretch along the plane that contains the beam and its direction of
   * travel, so a curved path cuts as a chain of straight cuts.
   */
  const laserCut = useRef<{
    prev: THREE.Vector3 | null;
    tangent: THREE.Vector3 | null;
    lastAt: number;
    lastPoint: THREE.Vector3 | null;
    busy: boolean;
  }>({ prev: null, tangent: null, lastAt: 0, lastPoint: null, busy: false });

  const onLaserMove = (c: Contact, beamDir: THREE.Vector3) => {
    const ls = laserCut.current;
    const { worldHeight: s } = measure();
    if (ls.prev) {
      const d = c.point.clone().sub(ls.prev);
      if (d.lengthSq() > (s * 0.01) ** 2) ls.tangent = d.normalize();
    }
    ls.prev = c.point.clone();
    if (c.target) loopOn("laser", "burn");
    else loopOff("laser", "burn");
    if (!c.target || ls.busy || !ls.tangent) return;
    const t = now();
    if (t - ls.lastAt < 150) return;
    if (ls.lastPoint && ls.lastPoint.distanceTo(c.point) < s * 0.12) return;
    const normal = new THREE.Vector3().crossVectors(beamDir, ls.tangent);
    if (normal.lengthSq() < 1e-4) return;
    ls.busy = true;
    ls.lastAt = t;
    ls.lastPoint = c.point.clone();
    cut(c.target, normal.normalize(), 0.35).finally(() => (ls.busy = false));
  };

  const startLaserPath = (path: THREE.Vector2[]) => {
    const { worldHeight: s, upm } = measure();
    const anchor = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    // One fixed emitter up and to the right, outside the photo.
    const from = anchor.clone().addScaledVector(right.multiplyScalar(0.7).add(UP).normalize(), s * 5);
    laserCut.current = { prev: null, tangent: null, lastAt: 0, lastPoint: null, busy: false };
    start({
      id: seq.current++,
      kind: "laserPath",
      point: anchor,
      normal: UP.clone(),
      size: s,
      upm,
      toCamera: camera.position.clone().sub(anchor).normalize(),
      path,
      from,
      probe: pick,
      onMove: onLaserMove,
    });
  };

  /** A tap with the selected tool. */
  const applyTool = (target: Target | null, ground: THREE.Vector3 | null) => {
    const tool = live.current.tool ?? "hammer";
    const { worldHeight: s, upm } = measure();
    const id = seq.current++;
    const toCamera = (p: THREE.Vector3) => camera.position.clone().sub(p).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

    if (tool === "hammer" || tool === "bat" || tool === "laser") {
      if (!target) return;
      const common = { id, point: target.point, normal: target.normal, size: s, upm, toCamera: toCamera(target.point) };
      if (tool === "hammer") start({ ...common, kind: "hammer", target });
      else if (tool === "bat") {
        // Swing in from the side that was tapped, sending things toward the other side.
        const center = pivotRef.current?.getWorldPosition(new THREE.Vector3()) ?? target.point;
        const side = Math.sign(target.point.clone().sub(center).dot(right)) || (Math.random() < 0.5 ? 1 : -1);
        const dir = right.clone().setY(0).normalize().multiplyScalar(-side);
        start({ ...common, kind: "bat", target, dir });
      }
      else {
        // Beam comes in from the upper right, outside the photo.
        const from = target.point.clone().addScaledVector(right.clone().multiplyScalar(0.7).add(UP).normalize(), s * 5);
        start({ ...common, kind: "laser", target, from });
      }
      return;
    }

    if (tool === "bomb") {
      const point = target?.point ?? ground;
      if (!point) return;
      if (!damage.current.broken) bombCut.current = preCut(point, Math.round(profile.pieces * 1.5), 0.35);
      start({ id, kind: "bomb", point, normal: target?.normal ?? UP.clone(), size: s, upm, toCamera: toCamera(point) });
      return;
    }

    // Press: always comes down on the object itself.
    if (damage.current.broken) return;
    const sq = squashRef.current!;
    sq.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3()).setY(0);
    const dims = box.getSize(new THREE.Vector3());
    squash.current.cx = center.x;
    squash.current.cz = center.z;
    const metal = profile.hitEffect === "dent";
    const squishy = profile.hitEffect === "squash";
    pressCrunched.current = false;
    start({
      id,
      kind: "press",
      point: center,
      normal: UP.clone(),
      size: s,
      upm,
      toCamera: toCamera(center),
      center,
      top: box.max.y,
      radius: Math.max(dims.x, dims.z) / 2,
      crushTo: metal ? 0.22 : 0.1,
      burstAt: metal ? null : squishy ? 0.3 : material === "glass" ? 0.85 : 0.6,
      onPhase: (phase) => {
        if (phase === "contact") {
          sfx("press", "contact");
          loopOn("press", "crush", 0.3);
        } else {
          loopOff("press", "crush");
          sfx("press", "release");
        }
      },
      onProgress: (sy) => {
        squash.current.sy = Math.min(squash.current.sy, sy);
        applySquash();
        // Louder as it gets flatter; metal ends in a crunch instead of bursting.
        const crushTo = metal ? 0.22 : 0.1;
        sound.loopVolume("press-crush", 0.3 + 0.7 * Math.min(1, (1 - sy) / (1 - crushTo)));
        if (metal && sy <= crushTo + 0.005 && !pressCrunched.current) {
          pressCrunched.current = true;
          loopOff("press", "crush");
          sfx("press", "crunch");
        }
        const now = performance.now();
        if (sy < 1 && now - lastRumble.current > 180) {
          lastRumble.current = now;
          live.current.fx.shake(0.15, 140);
        }
      },
    });
  };

  // Gestures: tap uses the selected tool; drag the object to slide it, drag
  // empty space to turn it; two fingers (or wheel) resize and twist.
  const handlers = useRef({ applyTool, apply, pick, startLaserPath });
  useEffect(() => {
    handlers.current = { applyTool, apply, pick, startLaserPath };
  });
  useEffect(() => {
    const el = gl.domElement;
    const u = user.current;
    const pointers = new Map<number, { x: number; y: number }>();
    const raycaster = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const startHit = new THREE.Vector3();
    const startOffset = new THREE.Vector3();
    const hit = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(1, 0, 0);
    const q = new THREE.Quaternion();
    const st: {
      mode: "move" | "rotate" | "path" | null;
      /** Laser path being drawn, NDC. */
      path: THREE.Vector2[];
      last: { x: number; y: number };
      pinch: { dist: number; angle: number } | null;
      /** Pointer-down position/time, to tell a tap from a drag. */
      down: { x: number; y: number; at: number };
      moved: boolean;
      target: Target | null;
      ground: THREE.Vector3 | null;
    } = {
      mode: null,
      path: [],
      last: { x: 0, y: 0 },
      pinch: null,
      down: { x: 0, y: 0, at: 0 },
      moved: false,
      target: null,
      ground: null,
    };

    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
    };
    const groundAt = (e: PointerEvent, out: THREE.Vector3) => {
      raycaster.setFromCamera(ndc(e), camera);
      return raycaster.ray.intersectPlane(ground, out) !== null;
    };
    const twoFinger = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const toScreen = (path: THREE.Vector2[]) => path.map((p) => ({ x: (p.x + 1) / 2, y: (1 - p.y) / 2 }));
    const pathLength = (path: THREE.Vector2[]) =>
      path.reduce((sum, p, i) => (i ? sum + p.distanceTo(path[i - 1]) : 0), 0);

    const onDown = (e: PointerEvent) => {
      sound.unlock();
      if (actionRef.current) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const broken = damage.current.broken;
      if (pointers.size === 1) {
        st.target = handlers.current.pick(ndc(e))?.target ?? null;
        st.ground = groundAt(e, hit) ? hit.clone() : null;
        if (live.current.tool === "laser") {
          st.mode = "path";
          st.path = [ndc(e)];
        } else {
          const onObj = st.target?.kind === "object";
          st.mode = broken ? null : onObj && groundAt(e, startHit) ? "move" : "rotate";
        }
        st.down = { x: e.clientX, y: e.clientY, at: performance.now() };
        st.moved = false;
        startOffset.copy(u.offset);
        st.last = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2 && !broken) {
        st.mode = null;
        st.path = [];
        live.current.fx.path(null);
        st.pinch = twoFinger();
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Ignore finger jitter until it is clearly a drag, so taps stay taps.
      if (!st.moved && Math.hypot(e.clientX - st.down.x, e.clientY - st.down.y) > 8) {
        st.moved = true;
        st.last = { x: e.clientX, y: e.clientY };
      }
      if (st.mode === "path") {
        const p = ndc(e);
        if (st.moved && p.distanceTo(st.path[st.path.length - 1]) > 0.012) {
          st.path.push(p);
          live.current.fx.path(toScreen(st.path));
        }
        return;
      }
      if (damage.current.broken) return;
      if (pointers.size === 2 && st.pinch) {
        const now = twoFinger();
        u.scale = Math.min(4, Math.max(0.2, (u.scale * now.dist) / st.pinch.dist));
        u.rotation.premultiply(q.setFromAxisAngle(up, -(now.angle - st.pinch.angle)));
        st.pinch = now;
      } else if (!st.moved) {
        return;
      } else if (st.mode === "move") {
        if (groundAt(e, hit)) u.offset.copy(startOffset).add(hit.sub(startHit));
      } else if (st.mode === "rotate") {
        const dx = e.clientX - st.last.x;
        const dy = e.clientY - st.last.y;
        st.last = { x: e.clientX, y: e.clientY };
        u.rotation.premultiply(q.setFromAxisAngle(up, dx * 0.01));
        u.rotation.premultiply(q.setFromAxisAngle(right, dy * 0.01));
      } else return;
      handlers.current.apply();
    };

    const onUp = (e: PointerEvent) => {
      // iOS only counts touch *end* as a gesture that may start audio.
      sound.unlock();
      const tap = pointers.size === 1 && !st.moved && performance.now() - st.down.at < 350;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) st.pinch = null;
      const drewPath = st.mode === "path" && st.moved && pathLength(st.path) > 0.06;
      // Lifting one finger of a pinch shouldn't turn into a rotate jump.
      st.mode = null;
      if (actionRef.current) return;
      if (drewPath) handlers.current.startLaserPath(st.path);
      else {
        live.current.fx.path(null);
        if (tap) handlers.current.applyTool(st.target, st.ground);
      }
      st.path = [];
    };

    const onWheel = (e: WheelEvent) => {
      if (damage.current.broken) return;
      e.preventDefault();
      u.scale = Math.min(4, Math.max(0.2, u.scale * Math.exp(-e.deltaY * 0.001)));
      handlers.current.apply();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [gl, camera, object]);

  return (
    <>
      <directionalLight ref={lightRef} intensity={2 * alignment.light} />
      <Suspense fallback={null}>
        <Physics
          gravity={[0, -9.81 * unitsPerMeter, 0]}
          lengthUnit={unitsPerMeter}
          timeStep="vary"
          // Stepped by PhysicsDriver so big hits can run in slow motion.
          paused
        >
          <PhysicsDriver active={physicsOn} timeScale={timeScale} rapierRef={rapierRef} />
          {/* The table: an endless floor at y=0 (top face). */}
          <RigidBody type="fixed" colliders={false} collisionGroups={TABLE_GROUP}>
            <CuboidCollider args={[50, 0.5, 50]} position={[0, -0.5, 0]} friction={0.8} restitution={0.2} />
          </RigidBody>
          {pieces.map((p) => (
            <RigidBody
              key={p.key}
              ref={(b) => {
                if (b) bodies.current.set(p.key, b);
                else bodies.current.delete(p.key);
              }}
              colliders="hull"
              position={p.position}
              quaternion={p.quaternion}
              linearVelocity={p.linearVelocity}
              angularVelocity={p.angularVelocity}
              collisionGroups={DEBRIS_GROUP}
              friction={0.7}
              restitution={p.restitution}
              linearDamping={0.3}
              angularDamping={0.8}
              ccd
              onCollisionEnter={({ target }) => {
                // Clink/thud when a piece lands; throttled so a burst doesn't turn into noise.
                const v = target.rigidBody?.linvel();
                if (!v) return;
                const speed = Math.hypot(v.x, v.y, v.z) / upmRef.current;
                const t = performance.now();
                if (speed < 0.25 || t - lastDebrisSound.current < 35) return;
                lastDebrisSound.current = t;
                const large = p.radius > measure().worldHeight * 0.15;
                sfx("debris", large ? "large" : "small", Math.min(1, speed / 2.5));
              }}
            >
              <mesh
                ref={(m) => {
                  if (m) {
                    m.userData.key = p.key;
                    meshes.current.set(p.key, m);
                  } else meshes.current.delete(p.key);
                }}
                geometry={p.geometry}
                material={p.material}
              />
            </RigidBody>
          ))}
        </Physics>
      </Suspense>
      <group ref={squashRef}>
        <group ref={outerRef} visible={intact}>
          {/* Rotate around the object's middle, not its base. */}
          <group ref={pivotRef} position={[0, height / 2, 0]}>
            <group position={[0, -height / 2, 0]}>
              <primitive object={object} />
            </group>
          </group>
        </group>
      </group>
      <Particles ref={sparks} additive max={300} />
      <Particles ref={fire} additive max={200} />
      <Particles ref={smoke} opacity={0.6} max={250} />
      {action && (
        <ToolActor
          key={action.id}
          action={action}
          onImpact={() => onImpact(action)}
          onDone={finish}
          emit={{
            sparks: (b) => sparks.current?.emit(b),
            smoke: (b) => smoke.current?.emit(b),
            fire: (b) => fire.current?.emit(b),
          }}
        />
      )}
    </>
  );
}
