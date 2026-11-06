import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  toGeometry,
  type FractureRequest,
  type FractureResponse,
  type FragmentData,
  type MeshData,
  type SliceRequest,
} from "./fracture-core";

/**
 * Pre-fracture a loaded model for the smash effect, off the main thread.
 * Fragments come back in the model's own space with centered geometry; the
 * caller places them using the model's current world matrix.
 */

/** Color of freshly exposed inside surfaces, by material. */
const INSIDE_COLOR: Record<string, string> = {
  glass: "#cfe8ee",
  ceramic: "#f1ede4",
  metal: "#a3a8ad",
  wood: "#c79a63",
  plastic: "#e4e1dc",
  fabric: "#d9d2c5",
  paper: "#efe9dc",
  rubber: "#3a3a3a",
  stone: "#9c968c",
  electronics: "#4a4d52",
  food: "#e8c98f",
};

/** Material for freshly exposed inside surfaces (fracture faces, chips). */
export function insideMaterial(material?: string) {
  return new THREE.MeshStandardMaterial({
    color: INSIDE_COLOR[material ?? ""] ?? "#d8d4cc",
    roughness: 0.85,
  });
}

export interface Fragment {
  geometry: THREE.BufferGeometry;
  /** Center in the model's space (the space `root` was in). */
  center: THREE.Vector3;
}

export interface PreparedFracture {
  fragments: Fragment[];
  materials: [THREE.Material, THREE.Material];
  method: FractureResponse["method"];
  triangles: number;
  ms: number;
}

/** Merge every mesh under `root` into one indexed geometry in root's space. */
function extract(root: THREE.Object3D): { mesh: MeshData; material: THREE.Material } {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const parts: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  let largest = 0;

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // Crack decals ride along on the model; they are not part of its body.
    if (!mesh.isMesh || mesh.userData.decal) return;
    const src = mesh.geometry;
    const count = src.attributes.position.count;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", src.attributes.position.clone());
    if (src.attributes.normal) g.setAttribute("normal", src.attributes.normal.clone());
    // Every part needs the same attribute set to merge.
    g.setAttribute(
      "uv",
      src.attributes.uv?.clone() ?? new THREE.BufferAttribute(new Float32Array(count * 2), 2),
    );
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    parts.push(g.index ? g : mergeVertices(g));
    if (count > largest) {
      largest = count;
      material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    }
  });
  if (parts.length === 0) throw new Error("model has no meshes");
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (!merged) throw new Error("could not merge model meshes");

  const f32 = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
    Float32Array.from({ length: a.count * a.itemSize }, (_, i) =>
      a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize),
    );
  return {
    mesh: {
      position: f32(merged.attributes.position),
      normal: f32(merged.attributes.normal),
      uv: f32(merged.attributes.uv),
      index: Uint32Array.from(merged.index!.array),
    },
    material: material ?? new THREE.MeshStandardMaterial(),
  };
}

export async function prepareFracture(
  root: THREE.Object3D,
  opts: {
    material?: string;
    fragmentCount: number;
    /** Smaller pieces around this point, in root's space. */
    impact?: { point: THREE.Vector3; radius: number };
    seed?: number;
    timeoutMs?: number;
    /** Stops the worker (the model was reset or left); the promise rejects. */
    signal?: AbortSignal;
  },
): Promise<PreparedFracture> {
  const { mesh, material } = extract(root);
  const request: FractureRequest = {
    mesh,
    fragmentCount: opts.fragmentCount,
    targetTriangles: 12000,
    seed: opts.seed ?? 7,
    impact: opts.impact && { point: opts.impact.point.toArray(), radius: opts.impact.radius },
  };

  // Voronoi can run away on a badly broken mesh; the worker is killed after a
  // timeout and the safe surface split runs instead.
  let res: FractureResponse;
  try {
    res = await runWorker(request, opts.timeoutMs ?? 10000, opts.signal);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    console.warn("[fracture] voronoi failed, using shell split", e);
    res = await runWorker({ ...request, forceShell: true }, opts.timeoutMs ?? 10000, opts.signal);
  }

  // Shell pieces are hollow; show their back faces so they don't look see-through.
  const outer = res.method === "shell" ? withDoubleSide(material) : material;
  const inner = insideMaterial(opts.material);
  return {
    fragments: res.fragments.map(toFragment),
    materials: [outer, inner],
    method: res.method,
    triangles: res.triangles,
    ms: res.ms,
  };
}

function toFragment(f: FragmentData): Fragment {
  const geometry = toGeometry(f);
  for (const g of f.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeBoundingSphere();
  return { geometry, center: new THREE.Vector3(...f.center) };
}

/** A cut plane in some mesh's own space. */
export interface CutPlane {
  normal: THREE.Vector3;
  origin: THREE.Vector3;
}

/** Cut the whole model (simplified first) in two. Pieces are in root's space. */
export async function sliceModel(root: THREE.Object3D, plane: CutPlane) {
  const { mesh, material } = extract(root);
  const res = await runWorker(
    { op: "slice", mesh, plane: { normal: plane.normal.toArray(), origin: plane.origin.toArray() }, targetTriangles: 12000 },
    6000,
  );
  return { fragments: res.fragments.map(toFragment), material };
}

/** Cut one physics piece (its own centered geometry) in two. */
export async function slicePiece(geometry: THREE.BufferGeometry, plane: CutPlane) {
  const a = (name: string, size: number) => {
    const attr = geometry.attributes[name] as THREE.BufferAttribute | undefined;
    return attr ? Float32Array.from(attr.array) : new Float32Array(geometry.attributes.position.count * size);
  };
  const mesh: MeshData = {
    position: a("position", 3),
    normal: a("normal", 3),
    uv: a("uv", 2),
    index: geometry.index
      ? Uint32Array.from(geometry.index.array)
      : Uint32Array.from({ length: geometry.attributes.position.count }, (_, i) => i),
  };
  const groups = geometry.groups.map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 }));
  const res = await runWorker(
    { op: "slice", mesh, groups, plane: { normal: plane.normal.toArray(), origin: plane.origin.toArray() }, targetTriangles: 12000 },
    4000,
  );
  return res.fragments.map(toFragment);
}

function runWorker(request: FractureRequest | SliceRequest, timeoutMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new DOMException("fracture cancelled", "AbortError"));
  // Copies, not transfers: the request may be sent twice.
  const worker = new Worker(new URL("./fracture.worker.ts", import.meta.url), { type: "module" });
  return new Promise<FractureResponse>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fracture timed out")), timeoutMs);
    // Old work would otherwise keep a phone's cores busy after a reset and make the new one time out.
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("fracture cancelled", "AbortError"));
    });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; res?: FractureResponse; error?: string }>) => {
      clearTimeout(timer);
      if (e.data.ok) resolve(e.data.res!);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(e.message || "fracture worker crashed"));
    };
    worker.postMessage(request);
  }).finally(() => worker.terminate());
}

function withDoubleSide(m: THREE.Material) {
  const c = m.clone();
  c.side = THREE.DoubleSide;
  return c;
}
