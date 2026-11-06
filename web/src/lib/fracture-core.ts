import { DestructibleMesh, FractureOptions } from "@dgreenheck/three-pinata";
import { MeshoptSimplifier } from "meshoptimizer";
import * as THREE from "three";

/**
 * Geometry-only fracture, safe to run in a Web Worker (no DOM, no textures).
 *
 * Closed meshes get real Voronoi cells with capped interiors (three-pinata).
 * Meshes with holes would send three-pinata's triangulator into a runaway
 * loop, so they get a "shell" split instead: surface triangles grouped by
 * nearest seed — hollow pieces, but they never fail.
 */

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
}

export interface FragmentData extends MeshData {
  /** Fragment center in the source mesh's space; geometry is centered on it. */
  center: [number, number, number];
  /** materialIndex 0 = outer surface, 1 = freshly exposed inside. */
  groups: { start: number; count: number; materialIndex: number }[];
}

export interface FractureRequest {
  mesh: MeshData;
  fragmentCount: number;
  targetTriangles: number;
  seed: number;
  /** Skip the open-edge check and split the surface only (the safe retry). */
  forceShell?: boolean;
  /** Concentrate small pieces around this point (mesh space). */
  impact?: { point: [number, number, number]; radius: number };
}

/** Cut a mesh in two along a plane (mesh space). */
export interface SliceRequest {
  op: "slice";
  mesh: MeshData;
  /** Outer/inside groups of an existing piece; absent for a whole model. */
  groups?: FragmentData["groups"];
  plane: { normal: [number, number, number]; origin: [number, number, number] };
  targetTriangles: number;
}

export interface FractureResponse {
  fragments: FragmentData[];
  method: "voronoi" | "shell" | "slice";
  openRatio: number;
  triangles: number;
  ms: number;
}

export function toGeometry(m: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  return g;
}

function toData(g: THREE.BufferGeometry): MeshData {
  const arr = (name: string, size: number) => {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (!a) return new Float32Array(g.attributes.position.count * size);
    return a.array instanceof Float32Array ? a.array : Float32Array.from(a.array);
  };
  const index = g.index
    ? Uint32Array.from(g.index.array)
    : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
  return { position: arr("position", 3), normal: arr("normal", 3), uv: arr("uv", 2), index };
}

/** Keep only vertices the index uses. */
function compact(m: MeshData, index: Uint32Array): MeshData {
  const remap = new Int32Array(m.position.length / 3).fill(-1);
  let next = 0;
  for (const i of index) if (remap[i] < 0) remap[i] = next++;
  const pick = (src: Float32Array, size: number) => {
    const out = new Float32Array(next * size);
    for (let v = 0; v < remap.length; v++) {
      if (remap[v] >= 0) out.set(src.subarray(v * size, v * size + size), remap[v] * size);
    }
    return out;
  };
  return {
    position: pick(m.position, 3),
    normal: pick(m.normal, 3),
    uv: pick(m.uv, 2),
    index: Uint32Array.from(index, (i) => remap[i]),
  };
}

async function simplify(m: MeshData, targetTriangles: number) {
  if (m.index.length / 3 <= targetTriangles) return m;
  await MeshoptSimplifier.ready;
  const [index] = MeshoptSimplifier.simplify(m.index, m.position, 3, targetTriangles * 3, 0.02);
  return compact(m, index);
}

/**
 * Share of edges not shared by exactly two triangles, once UV seams are
 * welded. 0 = perfectly closed.
 */
export function openEdgeRatio(m: MeshData) {
  const weld = new Map<string, number>();
  const id = new Uint32Array(m.position.length / 3);
  for (let v = 0; v < id.length; v++) {
    const k = `${m.position[v * 3].toFixed(5)},${m.position[v * 3 + 1].toFixed(5)},${m.position[v * 3 + 2].toFixed(5)}`;
    let w = weld.get(k);
    if (w === undefined) weld.set(k, (w = weld.size));
    id[v] = w;
  }
  const edges = new Map<number, number>();
  const n = weld.size;
  for (let t = 0; t < m.index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = id[m.index[t + e]];
      const b = id[m.index[t + ((e + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * n + b : b * n + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  if (edges.size === 0) return 1;
  let open = 0;
  for (const c of edges.values()) if (c !== 2) open++;
  return open / edges.size;
}

/**
 * How open a mesh may be and still go through three-pinata. Generated models
 * usually have a few stray edges and fracture fine; truly open shells (like a
 * cup modeled without thickness) make it run away.
 */
const MAX_OPEN_RATIO = 0.05;

function seededRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function centered(m: MeshData, groups: FragmentData["groups"]): FragmentData {
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(m.position, 3));
  const c = box.getCenter(new THREE.Vector3());
  const position = m.position.slice();
  for (let i = 0; i < position.length; i += 3) {
    position[i] -= c.x;
    position[i + 1] -= c.y;
    position[i + 2] -= c.z;
  }
  return { ...m, position, center: [c.x, c.y, c.z], groups };
}

function voronoi(m: MeshData, count: number, seed: number, impact?: FractureRequest["impact"]): FragmentData[] {
  const outer = new THREE.MeshBasicMaterial();
  const inner = new THREE.MeshBasicMaterial();
  const mesh = new DestructibleMesh(toGeometry(m), outer, inner);
  const fragments = mesh.fracture(
    new FractureOptions({
      fractureMethod: "voronoi",
      fragmentCount: count,
      voronoiOptions: impact
        ? { mode: "3D", impactPoint: new THREE.Vector3(...impact.point), impactRadius: impact.radius }
        : { mode: "3D" },
      seed,
    }),
  );
  return fragments.map((f) => {
    const g = f.geometry;
    const data = toData(g);
    // three-pinata already centers each fragment and stores the center in position.
    return {
      ...data,
      center: [f.position.x, f.position.y, f.position.z],
      groups: g.groups.map((gr) => ({
        start: gr.start,
        count: gr.count,
        materialIndex: gr.materialIndex ?? 0,
      })),
    };
  });
}

function shell(m: MeshData, count: number, seed: number, impact?: FractureRequest["impact"]): FragmentData[] {
  const rand = seededRandom(seed);
  const triangles = m.index.length / 3;
  const centroid = (t: number, out: number[]) => {
    out[0] = out[1] = out[2] = 0;
    for (let k = 0; k < 3; k++) {
      const v = m.index[t * 3 + k] * 3;
      out[0] += m.position[v] / 3;
      out[1] += m.position[v + 1] / 3;
      out[2] += m.position[v + 2] / 3;
    }
    return out;
  };
  const seeds = Array.from({ length: count }, () => centroid(Math.floor(rand() * triangles), [0, 0, 0]));
  if (impact) {
    // Pull half the seeds toward the impact so pieces are smaller there.
    const [ix, iy, iz] = impact.point;
    for (let s = 0; s < seeds.length; s += 2) {
      const t = 0.5 + rand() * 0.4;
      seeds[s][0] += (ix - seeds[s][0]) * t;
      seeds[s][1] += (iy - seeds[s][1]) * t;
      seeds[s][2] += (iz - seeds[s][2]) * t;
    }
  }
  const buckets: number[][] = seeds.map(() => []);
  const c = [0, 0, 0];
  for (let t = 0; t < triangles; t++) {
    centroid(t, c);
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const d = (c[0] - seeds[s][0]) ** 2 + (c[1] - seeds[s][1]) ** 2 + (c[2] - seeds[s][2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    buckets[best].push(t);
  }
  return buckets
    .filter((b) => b.length > 0)
    .map((b) => {
      const index = new Uint32Array(b.length * 3);
      b.forEach((t, i) => index.set(m.index.subarray(t * 3, t * 3 + 3), i * 3));
      const part = compact(m, index);
      return centered(part, [{ start: 0, count: part.index.length, materialIndex: 0 }]);
    });
}

export async function computeFragments(req: FractureRequest): Promise<FractureResponse> {
  const t = performance.now();
  const proxy = await simplify(req.mesh, req.targetTriangles);
  const openRatio = openEdgeRatio(proxy);
  const closed = !req.forceShell && openRatio <= MAX_OPEN_RATIO;
  const fragments = closed
    ? voronoi(proxy, req.fragmentCount, req.seed, req.impact)
    : shell(proxy, req.fragmentCount, req.seed, req.impact);
  return {
    fragments,
    method: closed ? "voronoi" : "shell",
    openRatio,
    triangles: proxy.index.length / 3,
    ms: performance.now() - t,
  };
}

export async function computeSlice(req: SliceRequest): Promise<FractureResponse> {
  const t = performance.now();
  // Simplifying would scramble an existing piece's outer/inside groups, so
  // only whole models are simplified first.
  const m = req.groups?.length ? req.mesh : await simplify(req.mesh, req.targetTriangles);
  const geometry = toGeometry(m);
  for (const g of req.groups ?? []) geometry.addGroup(g.start, g.count, g.materialIndex);
  const mesh = new DestructibleMesh(geometry, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
  const pieces = mesh.slice(new THREE.Vector3(...req.plane.normal), new THREE.Vector3(...req.plane.origin));
  // Unlike fracture(), slice() leaves geometry uncentered.
  const fragments = pieces.map((p) =>
    centered(
      toData(p.geometry),
      p.geometry.groups.map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 })),
    ),
  );
  return { fragments, method: "slice", openRatio: 0, triangles: m.index.length / 3, ms: performance.now() - t };
}
