import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PHYSICS_BODY_BOTTOM_Y = -0.030375;
const PHYSICS_FOOTPRINT_WIDTH = 0.15;
const PHYSICS_FOOTPRINT_LENGTH = 0.208125;

// Loads the detailed GLB and aligns it to the simplified MJCF physics proxy.
export async function loadCarObject(
  glbUrls: string | readonly string[]
): Promise<THREE.Group> {
  const gltf = await loadGltfWithFallback(glbUrls);
  const group = gltf.scene;

  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  // Scale the detailed GLB to the simplified MJCF footprint so the visual car
  // sits inside the wireframe physics proxy.
  const footprintScale = Math.min(
    PHYSICS_FOOTPRINT_WIDTH / size.x,
    PHYSICS_FOOTPRINT_LENGTH / size.z
  );

  if (Number.isFinite(footprintScale) && footprintScale > 0) {
    group.scale.multiplyScalar(footprintScale);
  }

  const centeredBounds = new THREE.Box3().setFromObject(group);
  const center = centeredBounds.getCenter(new THREE.Vector3());
  // Only center horizontally; vertical alignment is handled from the bottom.
  group.position.x -= center.x;
  group.position.z -= center.z;

  const alignedBounds = new THREE.Box3().setFromObject(group);
  // Align the GLB bottom with the MJCF wheel bottom in the car body's local frame.
  group.position.y += PHYSICS_BODY_BOTTOM_Y - alignedBounds.min.y;

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return group;
}

export async function loadGltfWithFallback(glbUrls: string | readonly string[]) {
  const loader = new GLTFLoader();
  const urls = typeof glbUrls === "string" ? [glbUrls] : [...glbUrls];
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      return await loader.loadAsync(url);
    } catch (error) {
      lastError = error;
      console.warn(`Failed to load GLB from ${url}`, error);
    }
  }

  throw lastError ?? new Error("No GLB URLs were provided.");
}

// Spins the visual wheel meshes; MuJoCo wheel motion is handled separately.
export function spinWheels(wheels: THREE.Object3D[], radians: number) {
  if (radians === 0) return;
  wheels.forEach((wheel) => wheel.rotateX(-radians));
}

// Disposes one material or an array of materials during scene teardown.
export function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => item.dispose());
}
