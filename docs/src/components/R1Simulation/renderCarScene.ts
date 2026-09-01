import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { disposeMaterial, loadCarObject, spinWheels } from "./carModel";
import {
  INITIAL_CAMERA_POSITION,
  INITIAL_CAMERA_TARGET,
  WHEEL_SPIN_RATE,
} from "./constants";
import {
  createMotorAudioState,
  loadMotorSound,
  updateMotorSound,
} from "./motorSound";
import type { GuiInstance, MujocoSimulation, ThreeSceneHandle } from "./types";

const MUJOCO_TO_THREE_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0)
  )
);
const THREE_TO_MUJOCO_QUATERNION = MUJOCO_TO_THREE_QUATERNION.clone().invert();

export async function renderCarScene(
  glbUrl: string,
  canvas: HTMLCanvasElement | null,
  gui: GuiInstance | null,
  mujoco: MujocoSimulation
): Promise<ThreeSceneHandle> {
  if (!canvas) {
    throw new Error("Simulation canvas is not mounted.");
  }

  const renderer = createRenderer(canvas);
  const scene = createScene();
  const camera = createCamera();
  const audioListener = new THREE.AudioListener();
  camera.add(audioListener);

  const orbitControls = createOrbitControls(camera, renderer.domElement);
  const grid = addLightingAndGround(scene);
  const rawCar = await loadCarObject(glbUrl);
  const car = new THREE.Group();
  car.add(rawCar);

  const motorSound = await loadMotorSound(audioListener);
  const motorAudioState = createMotorAudioState();
  if (motorSound) {
    car.add(motorSound);
  }

  const driveWheels = {
    left: ["wheel_fl", "wheel_bl"]
      .map((name) => rawCar.getObjectByName(name))
      .filter((wheel): wheel is THREE.Object3D => Boolean(wheel)),
    right: ["wheel_fr", "wheel_br"]
      .map((name) => rawCar.getObjectByName(name))
      .filter((wheel): wheel is THREE.Object3D => Boolean(wheel)),
  };

  scene.add(car);

  const keyState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  };
  const settings = {
    keyboard: true,
    drivePower: 0.8,
    turnPower: 0.65,
    idleRotation: false,
    showGrid: true,
    resetPose: () => {
      mujoco.reset();
      mujoco.setControls(0, 0);
      applyPose();
    },
    resetCamera: () => {
      camera.position.copy(INITIAL_CAMERA_POSITION);
      orbitControls.target.copy(INITIAL_CAMERA_TARGET);
      orbitControls.update();
    },
  };
  let lastFrameTime = performance.now();
  let animationFrame = 0;

  const clearKeys = () => {
    keyState.forward = false;
    keyState.backward = false;
    keyState.left = false;
    keyState.right = false;
  };

  const isDriveInputActive = () =>
    keyState.forward || keyState.backward || keyState.left || keyState.right;

  const applyPose = () => {
    const { position, quaternion } = mujoco.getCarPose();
    car.position.set(-position[1], position[2], -position[0]);
    car.quaternion
      .set(quaternion[1], quaternion[2], quaternion[3], quaternion[0])
      .premultiply(MUJOCO_TO_THREE_QUATERNION)
      .multiply(THREE_TO_MUJOCO_QUATERNION);
  };

  const updateKey = (event: KeyboardEvent, active: boolean) => {
    if (!settings.keyboard) return;

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d"].includes(key)) return;

    event.preventDefault();

    if (key === "w") keyState.forward = active;
    if (key === "s") keyState.backward = active;
    if (key === "a") keyState.left = active;
    if (key === "d") keyState.right = active;
    updateMotorSound(motorSound, motorAudioState, 0, 0, isDriveInputActive());
  };

  const keyDown = (event: KeyboardEvent) => updateKey(event, true);
  const keyUp = (event: KeyboardEvent) => updateKey(event, false);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const animate = () => {
    const frameTime = performance.now();
    const deltaSeconds = Math.min((frameTime - lastFrameTime) / 1000, 0.05);
    lastFrameTime = frameTime;

    if (settings.keyboard) {
      const throttle = Number(keyState.forward) - Number(keyState.backward);
      const steering = Number(keyState.left) - Number(keyState.right);
      const idleTurn = throttle === 0 && steering === 0 && settings.idleRotation;
      const turn = idleTurn ? 0.2 : steering;
      const isMoving = throttle !== 0 || steering !== 0 || idleTurn;
      const leftWheelInput =
        throttle !== 0 ? throttle - turn * 0.35 : -turn;
      const rightWheelInput =
        throttle !== 0 ? throttle + turn * 0.35 : turn;

      mujoco.setControls(
        throttle * settings.drivePower,
        turn * settings.turnPower
      );
      mujoco.step(deltaSeconds);
      spinWheels(driveWheels.left, leftWheelInput * deltaSeconds * WHEEL_SPIN_RATE);
      spinWheels(
        driveWheels.right,
        rightWheelInput * deltaSeconds * WHEEL_SPIN_RATE
      );
      updateMotorSound(
        motorSound,
        motorAudioState,
        leftWheelInput,
        rightWheelInput,
        isMoving
      );
      applyPose();
    } else if (settings.idleRotation) {
      mujoco.setControls(0, settings.turnPower * 0.2);
      mujoco.step(deltaSeconds);
      updateMotorSound(motorSound, motorAudioState, -0.2, 0.2, true);
      applyPose();
    }

    orbitControls.update();
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(animate);
  };

  resize();
  animate();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);

  const controlsFolder = gui?.addFolder("Drive");
  controlsFolder
    ?.add(settings, "keyboard")
    .name("WASD drive")
    .onChange((enabled: boolean) => {
      if (!enabled) {
        clearKeys();
        updateMotorSound(motorSound, motorAudioState, 0, 0, false);
      }
    });
  controlsFolder?.add(settings, "drivePower", 0.05, 1, 0.01).name("Drive power");
  controlsFolder?.add(settings, "turnPower", 0.05, 1, 0.01).name("Turn power");
  controlsFolder?.add(settings, "idleRotation").name("Idle rotation");
  controlsFolder
    ?.add(settings, "showGrid")
    .name("Show grid")
    .onChange((visible: boolean) => {
      grid.visible = visible;
    });
  controlsFolder?.add(settings, "resetPose").name("Reset pose");
  controlsFolder?.add(settings, "resetCamera").name("Reset camera");

  return {
    dispose: () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      mujoco.setControls(0, 0);
      updateMotorSound(motorSound, motorAudioState, 0, 0, false);
      audioListener.context.close().catch(() => undefined);
      orbitControls.dispose();
      controlsFolder?.destroy();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      renderer.dispose();
    },
  };
}

function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setClearColor(0x14191f, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  return renderer;
}

function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x14191f, 0.6, 2.8);
  return scene;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10);
  camera.position.copy(INITIAL_CAMERA_POSITION);
  camera.lookAt(INITIAL_CAMERA_TARGET);
  return camera;
}

function createOrbitControls(
  camera: THREE.PerspectiveCamera,
  element: HTMLElement
) {
  const orbitControls = new OrbitControls(camera, element);
  orbitControls.target.copy(INITIAL_CAMERA_TARGET);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 0.12;
  orbitControls.maxDistance = 2.5;
  orbitControls.update();
  return orbitControls;
}

function addLightingAndGround(scene: THREE.Scene) {
  const ambient = new THREE.HemisphereLight(0xffffff, 0x303844, 1.55);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(0.45, 0.8, 0.55);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.05;
  keyLight.shadow.camera.far = 2.4;
  keyLight.shadow.camera.left = -0.8;
  keyLight.shadow.camera.right = 0.8;
  keyLight.shadow.camera.top = 0.8;
  keyLight.shadow.camera.bottom = -0.8;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xb7dcff, 1.1);
  fillLight.position.set(-0.65, 0.35, -0.45);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(1.3, 18, 0x365064, 0x253342);
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshStandardMaterial({
      color: 0x1b2630,
      roughness: 0.9,
      metalness: 0,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return grid;
}
