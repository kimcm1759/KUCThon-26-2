import * as THREE from "three";
import type { Alignment, Box } from "@/lib/types";

/**
 * Camera and placement math for compositing the model onto the photo. The
 * camera sits CAMERA_HEIGHT above a ground plane (y=0), pitched down by
 * `elevation`.
 */
export const CAMERA_HEIGHT = 1;

export function poseCamera(camera: THREE.PerspectiveCamera, aspect: number, a: Alignment) {
  camera.fov = a.fov;
  camera.aspect = aspect;
  camera.near = 0.01;
  camera.far = 100;
  camera.position.set(0, CAMERA_HEIGHT, 0);
  camera.rotation.set(-THREE.MathUtils.degToRad(a.elevation), 0, 0, "YXZ");
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * Find where on the ground, how big and facing which way the model must be
 * so its projected bounds match the target box: bottom edge on the box's
 * bottom, horizontally centered, same height. A few fixed-point iterations
 * converge because projection is close to linear over the object's extent.
 */
export function solvePlacement(
  camera: THREE.PerspectiveCamera,
  samples: THREE.Vector3[],
  bbox: Box,
  a: Alignment,
) {
  // Normalized image coords (y down) → NDC (y up).
  const target = {
    cx: (bbox.x0 + bbox.x1) - 1 + a.offsetX,
    bottom: 1 - 2 * bbox.y1 + a.offsetY,
    height: 2 * (bbox.y1 - bbox.y0) * a.scale,
  };
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  const anchor = new THREE.Vector2(target.cx, target.bottom);
  const position = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const v = new THREE.Vector3();
  let scale = 0.3;
  let yaw = 0;

  const place = () => {
    raycaster.setFromCamera(anchor, camera);
    if (!raycaster.ray.intersectPlane(ground, position)) {
      // Anchor above the horizon: fall back to a point straight out along the ray.
      raycaster.ray.at(3, position);
      position.y = 0;
    }
    // Face the camera (glTF front is +Z), then apply the manual offset.
    yaw =
      Math.atan2(camera.position.x - position.x, camera.position.z - position.z) +
      THREE.MathUtils.degToRad(a.yaw);
    rotation.setFromEuler(new THREE.Euler(0, yaw, 0));
    matrix.compose(position, rotation, new THREE.Vector3(scale, scale, scale));
  };

  for (let i = 0; i < 8; i++) {
    place();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of samples) {
      v.copy(p).applyMatrix4(matrix).project(camera);
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const height = maxY - minY;
    if (height > 1e-6) scale *= target.height / height;
    anchor.x += target.cx - (minX + maxX) / 2;
    anchor.y += target.bottom - minY;
  }
  place();
  return { position: position.clone(), yaw, scale };
}
