import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  disposeMaterial,
  loadCarObject,
  spinWheels,
} from "./carModel";
import {
  MAP_CELLS,
  INITIAL_CAMERA_POSITION,
  INITIAL_CAMERA_TARGET,
  PLANNING_BOUNDS,
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
  parseMujocoHfield,
} from "./moonEnvironment";
import type {
  GuiInstance,
  MapEditorCell,
  MujocoSimulation,
  ThreeSceneHandle,
} from "./types";

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
const OBSTACLE_LIMIT = 180;
const OBSTACLE_BOUNDS = PLANNING_BOUNDS;
const MAP_EDITOR_CELLS = MAP_CELLS;
const EULER = new THREE.Euler(0, 0, 0, "YXZ");
const CAMERA_MODES = ["Car view", "Follow behind"] as const;
type CameraMode = (typeof CAMERA_MODES)[number];

// Builds and runs the Three.js render loop that mirrors the MuJoCo simulation.
export async function renderCarScene(
  glbUrl: string | readonly string[],
  canvas: HTMLCanvasElement | null,
  gui: GuiInstance | null,
  mujoco: MujocoSimulation,
  mapEditorDialog: HTMLDialogElement | null
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

  const mapObstacleGroup = new THREE.Group();
  mapObstacleGroup.name = "map-obstacles";
  scene.add(mapObstacleGroup);
  const mapObstacleDebugGroup = new THREE.Group();
  mapObstacleDebugGroup.name = "map-obstacle-debug";
  environment.debugGroup.add(mapObstacleDebugGroup);

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
    cameraMode: "Car view" as CameraMode,
    autoDrive: false,
    idleRotation: false,
    showGrid: true,
    showVisualCar: true,
    showVisualTerrain: true,
    showPhysicsDebug: false,
    stabilizeVisualRoll: true,
    obstacleSize: 0.065,
    obstacleDistance: 0.34,
    openMapEditor: () => {
      if (mapEditorDialog?.open) return;
      mapEditorDialog?.showModal();
    },


    // GUI action: reset MuJoCo state and immediately mirror the fresh pose.
    resetPose: () => {
      mujoco.reset();
      mujoco.setControls(0, 0);
      applyPose();
    },
    // GUI action: restore the default orbit-camera view.
    resetCamera: () => {
      if (settings.cameraMode === "Follow behind") {
        resetFollowCamera();
      } else {
        camera.position.copy(INITIAL_CAMERA_POSITION);
        orbitControls.target.copy(INITIAL_CAMERA_TARGET);
        orbitControls.update();
      }
    },
  };
  let lastFrameTime = performance.now();
  let animationFrame = 0;
  let disposed = false;
  let mapObstaclePositions: THREE.Vector3[] = [];

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

  const updateCameraMode = () => {
    orbitControls.enabled = true;
    if (settings.cameraMode === "Follow behind") {
      resetFollowCamera();
    }
  };

  const resetFollowCamera = () => {
    const cameraPosition = new THREE.Vector3(0, 0.24, 0.68);
    const cameraTarget = getFollowCameraTarget();

    car.localToWorld(cameraPosition);
    camera.position.copy(cameraPosition);
    orbitControls.target.copy(cameraTarget);
    orbitControls.update();
  };

  const getFollowCameraTarget = () => {
    const cameraTarget = new THREE.Vector3(0, 0.055, -0.35);
    car.localToWorld(cameraTarget);
    return cameraTarget;
  };

  const updateFollowCameraTarget = () => {
    const nextTarget = getFollowCameraTarget();
    const targetDelta = nextTarget.sub(orbitControls.target);

    orbitControls.target.add(targetDelta);
    camera.position.add(targetDelta);
    orbitControls.update();
  };


  const syncPhysicsObstacles = () => {
    const mapObstacleSize = getMapObstacleSize();
    const activeObstacles = mapObstaclePositions.map((position) => ({
      position,
      size: [
        mapObstacleSize * 0.5,
        mapObstacleSize * 0.5,
        mapObstacleSize * 0.5,
      ] as [number, number, number],
    }));

    for (let index = 0; index < OBSTACLE_LIMIT; index += 1) {
      const obstacle = activeObstacles[index];
      mujoco.setObstacle(
        index,
        obstacle
          ? {
            position: [-obstacle.position.z, -obstacle.position.x, obstacle.position.y],
            size: obstacle.size,
          }
          : null
      );
    }
  };

  const setMapObstacles = (cells: MapEditorCell[]) => {
    disposeGroupChildren(mapObstacleGroup);
    mapObstaclePositions = cells.map((cell) =>
      mapEditorCellToWorld(cell, environment.getSurfaceHeight)
    );

    const mapObstacleMesh = createMapObstacleMesh(mapObstaclePositions);
    if (mapObstacleMesh) {
      mapObstacleGroup.add(mapObstacleMesh);
    }

    syncPhysicsObstacles();
    rebuildObstacleDebugOverlay();
  };

  const rebuildObstacleDebugOverlay = () => {
    disposeGroupChildren(mapObstacleDebugGroup);

    if (!settings.showPhysicsDebug) return;

    const obstacleSize = getMapObstacleSize();
    mapObstaclePositions
      .slice(0, OBSTACLE_LIMIT)
      .forEach((position) => {
        const debugBox = createObstacleDebugBox(obstacleSize);

        debugBox.position.copy(position);
        mapObstacleDebugGroup.add(debugBox);
      });
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
  // Raycasts into the terrain to edit the planner goal or obstacle field.
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;

    const target = event.target;
    if (target !== canvas) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const [hit] = raycaster.intersectObject(environment.terrain);
    if (!hit) return;

    event.preventDefault();
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
    if (disposed) return;

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

    if (settings.cameraMode === "Follow behind") {
      updateFollowCameraTarget();
    } else {
      orbitControls.update();
    }
    if (settings.showPhysicsDebug) {
      debugState.contacts = mujoco.getContactCount();
    }
    renderer.render(scene, camera);
    if (!disposed) {
      animationFrame = window.requestAnimationFrame(animate);
    }
  };

  resize();
  animate();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  canvas.addEventListener("pointerdown", pointerDown);

  const controlsFolder = gui?.addFolder("Drive");
  controlsFolder
    ?.add(settings, "cameraMode", CAMERA_MODES)
    .name("Camera")
    .onChange(() => {
      updateCameraMode();
    });
  controlsFolder
    ?.add(settings, "keyboard")
    .name("WASD drive")
    .onChange((enabled: boolean) => {
      if (!enabled) {
        clearKeys();
        updateMotorSound(motorSound, motorAudioState, 0, 0, false);
      }
    });

  controlsFolder?.add(settings, "openMapEditor").name("Map editor");

  controlsFolder?.add(settings, "drivePower", 0.05, 2, 0.01).name("Drive power");
  controlsFolder?.add(settings, "turnPower", 0.05, 2, 0.01).name("Turn power");



  const debugFolder = gui?.addFolder("Debug");
  debugFolder
    ?.add(settings, "showPhysicsDebug")
    .name("Show MJCF model")
    .onChange((visible: boolean) => {
      environment.debugGroup.visible = visible;
      rebuildObstacleDebugOverlay();
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
      if (disposed) return;
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", pointerDown);
      mujoco.setControls(0, 0);
      setMapObstacles([]);
      updateMotorSound(motorSound, motorAudioState, 0, 0, false);
      audioListener.context.close().catch(() => undefined);
      orbitControls.dispose();
      controlsFolder?.destroy();
      debugFolder?.destroy();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      renderer.dispose();
    },
    setMapObstacles,
  };
}

function createMapObstacleMesh(positions: THREE.Vector3[]) {
  if (positions.length === 0) return null;

  const obstacleSize = getMapObstacleSize();
  const geometry = new THREE.BoxGeometry(
    obstacleSize,
    obstacleSize,
    obstacleSize
  );
  const material = new THREE.MeshStandardMaterial({
    color: 0x303844,
    roughness: 0.92,
    metalness: 0,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  const matrix = new THREE.Matrix4();

  positions.forEach((position, index) => {
    matrix.makeTranslation(position.x, position.y, position.z);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}

function mapEditorCellToWorld(
  cell: MapEditorCell,
  getSurfaceHeight: (x: number, z: number) => number
) {
  const obstacleSize = getMapObstacleSize();
  const x =
    -OBSTACLE_BOUNDS +
    ((cell.col + 0.5) / MAP_EDITOR_CELLS) * OBSTACLE_BOUNDS * 2;
  const z =
    -OBSTACLE_BOUNDS +
    ((cell.row + 0.5) / MAP_EDITOR_CELLS) * OBSTACLE_BOUNDS * 2;

  return new THREE.Vector3(
    x,
    getSurfaceHeight(x, z) + obstacleSize * 0.5,
    z
  );
}

function getMapObstacleSize() {
  return (OBSTACLE_BOUNDS * 2) / MAP_EDITOR_CELLS;
}

function disposeGroupChildren(group: THREE.Group) {
  group.children.forEach((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
  group.clear();
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
  scene.fog = new THREE.Fog(0x07090d, 14, 36);
  return scene;
}

// Creates the perspective camera at the default simulation viewpoint.
function createCamera() {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 60);
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
  orbitControls.maxDistance = 24;
  orbitControls.update();
  return orbitControls;
}
