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
  parseMujocoHfield,
} from "./moonEnvironment";
import type { GuiInstance, MujocoSimulation, ThreeSceneHandle } from "./types";

const MUJOCO_TO_THREE_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  // MuJoCo uses X-forward/Y-left/Z-up; Three.js scene uses X-right/Y-up/Z-back.
  // Keep pose conversion centralized so the GLB and MJCF debug model agree.
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0)
  )
);
const THREE_TO_MUJOCO_QUATERNION = MUJOCO_TO_THREE_QUATERNION.clone().invert();
const OBSTACLE_LIMIT = 5;
const OBSTACLE_BOUNDS = 0.68;
const EULER = new THREE.Euler(0, 0, 0, "YXZ");

// Builds and runs the Three.js render loop that mirrors the MuJoCo simulation.
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
  // Build the visible terrain from the exact hfield encoded in the loaded MJCF.
  const environment = addMoonEnvironment(scene, parseMujocoHfield(mujoco.xml));
  const grid = environment.grid;
  const rawCar = await loadCarObject(glbUrl);
  const car = new THREE.Group();
  car.add(rawCar);
  // This wireframe is the simplified MJCF body, not the detailed GLB. It is
  // useful for checking what MuJoCo is actually simulating.
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
    clickToAddRock: false,
    obstacleSize: 0.065,
    obstacleDistance: 0.34,
    // GUI action: place a rock ahead of the rover.
    addObstacle: () => {
      addObstacleInFront();
    },
    // GUI action: clear all active rock obstacles.
    clearObstacles: () => {
      clearObstacles();
    },
    // GUI action: reset MuJoCo state and immediately mirror the fresh pose.
    resetPose: () => {
      mujoco.reset();
      mujoco.setControls(0, 0);
      applyPose();
    },
    // GUI action: restore the default orbit-camera view.
    resetCamera: () => {
      camera.position.copy(INITIAL_CAMERA_POSITION);
      orbitControls.target.copy(INITIAL_CAMERA_TARGET);
      orbitControls.update();
    },
  };
  let lastFrameTime = performance.now();
  let animationFrame = 0;

  // Clears remembered keyboard state when controls are disabled or reset.
  const clearKeys = () => {
    keyState.forward = false;
    keyState.backward = false;
    keyState.left = false;
    keyState.right = false;
  };

  // Reports whether any drive key is currently active for audio gating.
  const isDriveInputActive = () =>
    keyState.forward || keyState.backward || keyState.left || keyState.right;

  // Copies the current MuJoCo car pose onto both the GLB and MJCF debug model.
  const applyPose = () => {
    const { position, quaternion } = mujoco.getCarPose();
    // Convert MuJoCo world position into the Three.js world before rendering.
    const x = -position[1];
    const z = -position[0];
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

  // Places a new obstacle a short distance ahead of the current car heading.
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

  // Adds or replaces one visual rock and syncs the matching MuJoCo obstacle.
  const placeObstacle = (obstacle: THREE.Mesh, position: THREE.Vector3) => {
    // Clamp to the finite hfield patch; MuJoCo collision only exists inside
    // the current lunar_hfield bounds.
    position.x = THREE.MathUtils.clamp(position.x, -OBSTACLE_BOUNDS, OBSTACLE_BOUNDS);
    position.z = THREE.MathUtils.clamp(position.z, -OBSTACLE_BOUNDS, OBSTACLE_BOUNDS);
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
    // Mirror the visual obstacle into one of the predeclared MuJoCo bodies.
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

  // Removes all visual rocks and parks their MuJoCo obstacle bodies off-field.
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

  // Avoids hijacking keyboard input while the user is editing GUI fields.
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

  // Converts browser keydown/keyup events into persistent WASD drive state.
  const updateKey = (event: KeyboardEvent, active: boolean) => {
    if (!settings.keyboard) return;

    if (shouldIgnoreKeyboardEvent(event)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d"].includes(key)) return;

    event.preventDefault();

    // Key naming follows the UI convention: W/S drive, A/D rotate/steer.
    // The actuator sign mapping below determines clockwise vs anticlockwise.
    if (key === "w") keyState.forward = active;
    if (key === "s") keyState.backward = active;
    if (key === "a") keyState.left = active;
    if (key === "d") keyState.right = active;
    updateMotorSound(motorSound, motorAudioState, 0, 0, isDriveInputActive());
  };

  // Marks a drive key as pressed.
  const keyDown = (event: KeyboardEvent) => updateKey(event, true);
  // Marks a drive key as released.
  const keyUp = (event: KeyboardEvent) => updateKey(event, false);
  // Raycasts into the terrain to place a rock where the user clicks.
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

  // Keeps renderer and camera projection matched to the canvas size.
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  // Advances MuJoCo, updates visual-only effects, and renders each frame.
  const animate = () => {
    const frameTime = performance.now();
    const deltaSeconds = Math.min((frameTime - lastFrameTime) / 1000, 0.05);
    lastFrameTime = frameTime;

    if (settings.keyboard) {
      // WASD controls are expressed as throttle + differential turn, then
      // passed to MuJoCo actuators. Wheel mesh spin is visual only.
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

// Creates the WebGL renderer with tone mapping and shadows enabled.
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

// Creates the base Three.js scene and fog used by the moon environment.
function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07090d, 1.4, 4.2);
  return scene;
}

// Creates the perspective camera at the default simulation viewpoint.
function createCamera() {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10);
  camera.position.copy(INITIAL_CAMERA_POSITION);
  camera.lookAt(INITIAL_CAMERA_TARGET);
  return camera;
}

// Creates orbit controls around the rover-focused starting target.
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
