import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";

/** What a non-final hit leaves on the intact object. Browser-only (canvas). */

let crackMaterial: THREE.MeshStandardMaterial | null = null;

/** Radial crack pattern drawn once on a canvas, transparent elsewhere. */
function getCrackMaterial() {
  if (crackMaterial) return crackMaterial;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const crack = (x: number, y: number, angle: number, length: number, width: number, depth: number) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let px = x;
    let py = y;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 0.7;
      px += (Math.cos(angle) * length) / steps;
      py += (Math.sin(angle) * length) / steps;
      ctx.lineTo(px, py);
      if (depth > 0 && rand() < 0.25) {
        crack(px, py, angle + (rand() - 0.5) * 1.6, length * 0.4, width * 0.6, depth - 1);
        ctx.beginPath();
        ctx.moveTo(px, py);
      }
    }
    ctx.stroke();
  };

  ctx.strokeStyle = "rgba(15,15,15,0.9)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const arms = 9;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rand() * 0.5;
    crack(c, c, a, c * (0.55 + rand() * 0.4), 5, 2);
  }
  // Crushed spot at the impact.
  ctx.fillStyle = "rgba(20,20,20,0.75)";
  ctx.beginPath();
  ctx.arc(c, c, 10, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  crackMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    roughness: 0.9,
  });
  return crackMaterial;
}

/**
 * Project a crack decal onto `mesh` at a world-space hit, parented to the
 * mesh so it follows when the object is moved or spun.
 */
export function addCrack(mesh: THREE.Mesh, point: THREE.Vector3, normal: THREE.Vector3, size: number) {
  const orientation = new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(point, point.clone().add(normal), THREE.Object3D.DEFAULT_UP),
  );
  orientation.z = Math.random() * Math.PI * 2;
  const geometry = new DecalGeometry(mesh, point, orientation, new THREE.Vector3(size, size, size));
  // DecalGeometry is built in world space; move it into the mesh's space.
  geometry.applyMatrix4(mesh.matrixWorld.clone().invert());
  const decal = new THREE.Mesh(geometry, getCrackMaterial());
  decal.userData.decal = true;
  decal.renderOrder = 1;
  mesh.add(decal);
  return decal;
}

/** Push surface vertices near a world-space hit inward, with a smooth falloff. */
export function addDent(mesh: THREE.Mesh, point: THREE.Vector3, normal: THREE.Vector3, radius: number) {
  // GlTF geometries are shared with the loader cache; deform a private copy.
  if (!mesh.userData.ownGeometry) {
    mesh.geometry = mesh.geometry.clone();
    mesh.userData.ownGeometry = true;
  }
  const toLocal = mesh.matrixWorld.clone().invert();
  const center = point.clone().applyMatrix4(toLocal);
  const dir = normal.clone().transformDirection(toLocal).normalize();
  const scale = mesh.matrixWorld.getMaxScaleOnAxis();
  const r = radius / scale;
  const depth = r * 0.35;

  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.distanceTo(center);
    if (d >= r) continue;
    const f = (1 - d / r) ** 2;
    v.addScaledVector(dir, -depth * f);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

/** Irregular little rock shape for chips knocked off by a hit. */
export function chipGeometry(size: number) {
  const g = new THREE.IcosahedronGeometry(size, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Faces don't share vertices here, so jitter by corner position to keep it closed.
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = jitter.get(key);
    if (k === undefined) jitter.set(key, (k = 0.6 + Math.random() * 0.8));
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.6, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
