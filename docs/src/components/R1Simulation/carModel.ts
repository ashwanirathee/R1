import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export async function loadCarObject(glbUrl: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(glbUrl);
  const group = gltf.scene;

  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);

  if (maxAxis > 0) {
    group.scale.multiplyScalar(0.26 / maxAxis);
  }

  const centeredBounds = new THREE.Box3().setFromObject(group);
  const center = centeredBounds.getCenter(new THREE.Vector3());
  group.position.sub(center);
  group.position.y = 0.05;

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return group;
}

export function spinWheels(wheels: THREE.Object3D[], radians: number) {
  if (radians === 0) return;
  wheels.forEach((wheel) => wheel.rotateX(-radians));
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => item.dispose());
}
