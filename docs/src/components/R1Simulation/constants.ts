import * as THREE from "three";

export const MUJOCO_MODULE_URL = "/mujoco/mujoco.js";
export const MUJOCO_WASM_URL = "/mujoco/mujoco.wasm";
export const CAR_XML_URL = "/mujoco/car.xml";
export const CAR_GLB_URLS = [
  "https://cdn.ashwanirathee.com/models/sam_model2.glb",
  "/mujoco/sam_model2.glb",
] as const;
export const DRIVE_AUDIO_URL = "/mujoco/audio.mov";
export const MAP_METERS = 20;
export const CELLS_PER_METER = 3;
export const MAP_CELLS = MAP_METERS * CELLS_PER_METER;
export const PLANNING_BOUNDS = MAP_METERS / 2;
export const DRIVE_BOUNDS = 0.46;
export const WHEEL_SPIN_RATE = 18;
export const INITIAL_CAMERA_POSITION = new THREE.Vector3(0.32, 0.3, -0.62);
export const INITIAL_CAMERA_TARGET = new THREE.Vector3(0, 0.04, 0);
