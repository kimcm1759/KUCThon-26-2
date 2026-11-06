// Time the smash pre-fracture on a saved GLB without a browser.
// Usage (from web/): node scripts/bench-fracture.mjs <file.glb> [fragility]
import { readFile } from "node:fs/promises";
import { computeFragments } from "../src/lib/fracture-core.ts";

const [file, fragility = "shatters"] = process.argv.slice(2);
const buf = await readFile(file);

// Minimal GLB reader: geometry only (textures need a DOM).
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPES = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const accessor = (i) => {
  const a = gltf.accessors[i];
  const view = gltf.bufferViews[a.bufferView];
  const T = TYPES[a.componentType];
  const n = a.count * SIZES[a.type];
  const offset = binStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (view.byteStride && view.byteStride !== T.BYTES_PER_ELEMENT * SIZES[a.type]) {
    throw new Error("interleaved accessors not supported in this bench");
  }
  return new T(buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + n * T.BYTES_PER_ELEMENT));
};

// Concatenate primitives (node transforms ignored; fine for timing).
const pos = [], nrm = [], uv = [], idx = [];
for (const m of gltf.meshes) {
  for (const p of m.primitives) {
    const base = pos.length / 3;
    const P = accessor(p.attributes.POSITION);
    for (const x of P) pos.push(x);
    for (const x of (p.attributes.NORMAL !== undefined ? accessor(p.attributes.NORMAL) : new Float32Array(P.length))) nrm.push(x);
    for (const x of (p.attributes.TEXCOORD_0 !== undefined ? accessor(p.attributes.TEXCOORD_0) : new Float32Array((P.length / 3) * 2))) uv.push(x);
    const I = p.indices !== undefined ? accessor(p.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    for (const i of I) idx.push(i + base);
  }
}
const mesh = { position: Float32Array.from(pos), normal: Float32Array.from(nrm), uv: Float32Array.from(uv), index: Uint32Array.from(idx) };
console.log(`${file}: ${idx.length / 3} triangles`);
const counts = { shatters: 40, cracks: 12 };
// Optional 3rd arg "impact": concentrate pieces at the first vertex.
const impact = process.argv[4] === "impact" ? { point: [mesh.position[0], mesh.position[1], mesh.position[2]], radius: 0.25 } : undefined;
const r = await computeFragments({ mesh, fragmentCount: counts[fragility] ?? 20, targetTriangles: 12000, seed: 7, impact });
const fragTris = r.fragments.reduce((s, f) => s + f.index.length / 3, 0);
console.log(`${r.method} (open edges ${(r.openRatio * 100).toFixed(2)}%): proxy ${r.triangles} tris → ${r.fragments.length} fragments (${fragTris} tris) in ${r.ms.toFixed(0)} ms`);

// Optional 3rd arg "slice": cut the model in half, then cut one half again (laser path).
if (process.argv[4] === "slice") {
  const { computeSlice } = await import("../src/lib/fracture-core.ts");
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.position.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], mesh.position[i + k]); hi[k] = Math.max(hi[k], mesh.position[i + k]);
  }
  const mid = lo.map((v, k) => (v + hi[k]) / 2);
  const a = await computeSlice({ op: "slice", mesh, plane: { normal: [1, 0, 0], origin: mid }, targetTriangles: 12000 });
  console.log(`slice model: ${a.fragments.length} pieces in ${a.ms.toFixed(0)} ms, groups ${a.fragments.map((f) => f.groups.length).join(",")}`);
  const piece = a.fragments[0];
  const b = await computeSlice({ op: "slice", mesh: piece, groups: piece.groups, plane: { normal: [0, 0, 1], origin: [0, 0, 0] }, targetTriangles: 12000 });
  console.log(`slice piece: ${b.fragments.length} pieces in ${b.ms.toFixed(0)} ms`);
}
