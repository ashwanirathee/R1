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
import {
  addMoonEnvironment,
  createMujocoCarModelDebug,
  createObstacleDebugBox,
  createObstacleMesh,
} from "./moonEnvironment";
import { parseMujocoHfield } from "./moonTerrain";
import type { GuiInstance, MujocoSimulation, ThreeSceneHandle } from "./types";

const MUJOCO_TO_THREE_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0)
  )
);
const THREE_TO_MUJOCO_QUATERNION = MUJOCO_TO_THREE_QUATERNION.clone().invert();
const OBSTACLE_LIMIT = 5;
const EULER = new THREE.Euler(0, 0, 0, "YXZ");

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
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const audioListener = new THREE.AudioListener();
  camera.add(audioListener);

  const orbitControls = createOrbitControls(camera, renderer.domElement);
  const environment = addMoonEnvironment(scene, parseMujocoHfield(mujoco.xml));
  const grid = environment.grid;
  const rawCar = await loadCarObject(glbUrl);
  const car = new THREE.Group();
  car.add(rawCar);
  const mujocoCarDebug = createMujocoCarModelDebug();
  environment.debugGroup.add(mujocoCarDebug);

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

  const obstacleSlots: Array<THREE.Mesh | null> = Array.from(
    { length: OBSTACLE_LIMIT },
    () => null
  );
  const obstacleDebugSlots: Array<THREE.LineSegments | null> = Array.from(
    { length: OBSTACLE_LIMIT },
    () => null
  );
  let nextObstacleIndex = 0;
  const debugState = {
    contacts: 0,
  };
  const keyState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  };
  const settings = {
    keyboard: true,
    drivePower: 1.2,
    turnPower: 0.9,
    idleRotation: false,
    showGrid: true,
    showVisualCar: true,
    showVisualTerrain: true,
    showPhysicsDebug: false,
    stabilizeVisualRoll: true,
    clickToAddRock: true,
    obstacleSize: 0.065,
    obstacleDistance: 0.34,
    addObstacle: () => {
      addObstacleInFront();
    },
    clearObstacles: () => {
      clearObstacles();
    },
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
    const x = -position[1];
    const z = -position[0];
    environment.updateTerrainWindow(x, z);
    car.position.set(x, position[2], z);
    car.quaternion
      .set(quaternion[1], quaternion[2], quaternion[3], quaternion[0])
      .premultiply(MUJOCO_TO_THREE_QUATERNION)
      .multiply(THREE_TO_MUJOCO_QUATERNION);
    mujocoCarDebug.position.copy(car.position);
    mujocoCarDebug.quaternion.copy(car.quaternion);

    if (settings.stabilizeVisualRoll) {
      EULER.setFromQuaternion(car.quaternion);
      car.quaternion.setFromEuler(new THREE.Euler(0, EULER.y, 0, "YXZ"));
    }
  };

  const addObstacleInFront = () => {
    const obstacle = createObstacleMesh(settings.obstacleSize);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
    forward.y = 0;

    if (forward.lengthSq() === 0) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }

    const position = car.position
      .clone()
      .addScaledVector(forward, settings.obstacleDistance);
    placeObstacle(obstacle, position);
  };

  const placeObstacle = (obstacle: THREE.Mesh, position: THREE.Vector3) => {
    position.y =
      environment.getSurfaceHeight(position.x, position.z) +
      settings.obstacleSize * 0.58;
    obstacle.position.copy(position);
    obstacle.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    obstacle.updateMatrixWorld();

    obstacleSlots[nextObstacleIndex]?.removeFromParent();
    obstacleSlots[nextObstacleIndex]?.geometry.dispose();
    disposeMaterial(obstacleSlots[nextObstacleIndex]?.material ?? []);
    obstacleDebugSlots[nextObstacleIndex]?.removeFromParent();
    obstacleDebugSlots[nextObstacleIndex]?.geometry.dispose();
    disposeMaterial(obstacleDebugSlots[nextObstacleIndex]?.material ?? []);

    const debugBox = createObstacleDebugBox(settings.obstacleSize);
    debugBox.position.copy(position);
    obstacleSlots[nextObstacleIndex] = obstacle;
    obstacleDebugSlots[nextObstacleIndex] = debugBox;
    environment.obstacleGroup.add(obstacle);
    environment.debugGroup.add(debugBox);
    mujoco.setObstacle(nextObstacleIndex, {
      position: [-position.z, -position.x, position.y],
      size: [
        settings.obstacleSize * 0.72,
        settings.obstacleSize * 0.72,
        settings.obstacleSize * 0.58,
      ],
    });
    nextObstacleIndex = (nextObstacleIndex + 1) % OBSTACLE_LIMIT;
  };

  const clearObstacles = () => {
    obstacleSlots.forEach((obstacle, index) => {
      obstacle?.removeFromParent();
      obstacle?.geometry.dispose();
      disposeMaterial(obstacle?.material ?? []);
      obstacleDebugSlots[index]?.removeFromParent();
      obstacleDebugSlots[index]?.geometry.dispose();
      disposeMaterial(obstacleDebugSlots[index]?.material ?? []);
      obstacleSlots[index] = null;
      obstacleDebugSlots[index] = null;
      mujoco.setObstacle(index, null);
    });
    nextObstacleIndex = 0;
  };

  const shouldIgnoreKeyboardEvent = (event: KeyboardEvent) => {
    const target = event.target;

    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return true;
    }

    if (!(target instanceof HTMLInputElement)) {
      return false;
    }

    return !["button", "checkbox", "radio"].includes(target.type);
  };

  const updateKey = (event: KeyboardEvent, active: boolean) => {
    if (!settings.keyboard) return;

    if (shouldIgnoreKeyboardEvent(event)) {
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
  const pointerDown = (event: PointerEvent) => {
    if (!settings.clickToAddRock || event.button !== 0) return;

    const target = event.target;
    if (target !== canvas) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const [hit] = raycaster.intersectObject(environment.terrain);
    if (!hit) return;

    event.preventDefault();
    placeObstacle(createObstacleMesh(settings.obstacleSize), hit.point.clone());
  };

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
    if (settings.showPhysicsDebug) {
      debugState.contacts = mujoco.getContactCount();
    }
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(animate);
  };

  resize();
  animate();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  canvas.addEventListener("pointerdown", pointerDown);

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
  controlsFolder?.add(settings, "drivePower", 0.05, 2, 0.01).name("Drive power");
  controlsFolder?.add(settings, "turnPower", 0.05, 2, 0.01).name("Turn power");
  controlsFolder?.add(settings, "idleRotation").name("Idle rotation");
  controlsFolder
    ?.add(settings, "showGrid")
    .name("Show grid")
    .onChange((visible: boolean) => {
      grid.visible = visible;
    });
  controlsFolder
    ?.add(settings, "showVisualCar")
    .name("Visual car")
    .onChange((visible: boolean) => {
      rawCar.visible = visible;
    });
  controlsFolder
    ?.add(settings, "showVisualTerrain")
    .name("Visual terrain")
    .onChange((visible: boolean) => {
      environment.terrain.visible = visible;
    });
  controlsFolder
    ?.add(settings, "stabilizeVisualRoll")
    .name("Stabilize roll");
  controlsFolder?.add(settings, "resetPose").name("Reset pose");
  controlsFolder?.add(settings, "resetCamera").name("Reset camera");

  const obstacleFolder = gui?.addFolder("Obstacles");
  obstacleFolder
    ?.add(settings, "obstacleSize", 0.03, 0.12, 0.005)
    .name("Rock size");
  obstacleFolder
    ?.add(settings, "obstacleDistance", 0.18, 0.58, 0.01)
    .name("Place distance");
  obstacleFolder?.add(settings, "clickToAddRock").name("Click to add");
  obstacleFolder?.add(settings, "addObstacle").name("Add obstacle");
  obstacleFolder?.add(settings, "clearObstacles").name("Clear obstacles");

  const debugFolder = gui?.addFolder("Debug");
  debugFolder
    ?.add(settings, "showPhysicsDebug")
    .name("Show MJCF model")
    .onChange((visible: boolean) => {
      environment.debugGroup.visible = visible;
      if (!visible) {
        debugState.contacts = 0;
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
  debugFolder?.add(debugState, "contacts").name("Contacts").listen();

  return {
    dispose: () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", pointerDown);
      mujoco.setControls(0, 0);
      clearObstacles();
      updateMotorSound(motorSound, motorAudioState, 0, 0, false);
      audioListener.context.close().catch(() => undefined);
      orbitControls.dispose();
      controlsFolder?.destroy();
      obstacleFolder?.destroy();
      debugFolder?.destroy();
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
  renderer.setClearColor(0x07090d, 1);
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
  scene.fog = new THREE.Fog(0x07090d, 1.4, 4.2);
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
