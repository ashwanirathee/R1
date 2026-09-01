import * as THREE from "three";

export const MUJOCO_MODULE_URL = "/mujoco/mujoco.js";
export const MUJOCO_WASM_URL = "/mujoco/mujoco.wasm";
export const CAR_XML_URL = "/mujoco/car.xml";
export const CAR_GLB_URL = "/mujoco/sam_model2.glb";
export const DRIVE_AUDIO_URL = "/mujoco/audio.mov";
export const DRIVE_BOUNDS = 0.46;
export const WHEEL_SPIN_RATE = 18;
export const INITIAL_CAMERA_POSITION = new THREE.Vector3(0.32, 0.3, -0.62);
export const INITIAL_CAMERA_TARGET = new THREE.Vector3(0, 0.04, 0);
