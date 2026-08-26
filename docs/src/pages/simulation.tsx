import React, { useEffect, useRef, type ReactNode } from "react";
import Layout from "@theme/Layout";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import styles from "./simulation.module.css";

type ClassHandle = {
  delete?: () => void;
};

type MujocoModel = ClassHandle & Record<string, unknown>;
type MujocoData = ClassHandle & Record<string, unknown>;

type LoadMujoco = (options?: {
  locateFile?: (path: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<{
  MjModel: {
    from_xml_string: (xml: string) => MujocoModel;
  };
  MjData: new (model: MujocoModel) => MujocoData;
  mj_step: (model: MujocoModel, data: MujocoData) => void;
}>;

type MujocoRuntimeModule = {
  default: LoadMujoco;
};

type ThreeSceneHandle = {
  dispose: () => void;
};

type GuiConstructor = typeof import("lil-gui").default;
type GuiInstance = InstanceType<GuiConstructor>;

const MUJOCO_MODULE_URL = "/mujoco/mujoco.js";
const MUJOCO_WASM_URL = "/mujoco/mujoco.wasm";
const CAR_XML_URL = "/mujoco/car.xml";
const CAR_GLB_URL = "/mujoco/sam_model2.glb";
const DRIVE_AUDIO_URL = "/mujoco/audio.mov";
const DRIVE_BOUNDS = 0.46;
const WHEEL_SPIN_RATE = 18;
const INITIAL_CAMERA_POSITION = new THREE.Vector3(0.32, 0.3, -0.62);
const INITIAL_CAMERA_TARGET = new THREE.Vector3(0, 0.04, 0);

async function importRuntimeModule(url: string): Promise<MujocoRuntimeModule> {
  const runtimeImport = new Function("url", "return import(url)") as (
    url: string
  ) => Promise<MujocoRuntimeModule>;

  return runtimeImport(url);
}

export default function Simulation(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const guiContainerRef = useRef<HTMLDivElement | null>(null);
  const guiRef = useRef<GuiInstance | null>(null);
  const loadingRef = useRef(false);
  const sceneHandleRef = useRef<ThreeSceneHandle | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setupGui() {
      const { default: GUI } = await import("lil-gui");
      if (cancelled || !guiContainerRef.current || guiRef.current) return;

      guiContainerRef.current.replaceChildren();
      guiRef.current = new GUI({
        container: guiContainerRef.current,
        title: "Simulation Controls",
        injectStyles: true,
        width: 280,
      });
      void loadSimulation();
    }

    void setupGui();

    return () => {
      cancelled = true;
      sceneHandleRef.current?.dispose();
      sceneHandleRef.current = null;
      guiRef.current?.destroy();
      guiRef.current = null;
    };
  }, []);

  async function loadSimulation() {
    if (loadingRef.current || sceneHandleRef.current) return;

    loadingRef.current = true;

    try {
      const xmlResponse = await fetch(CAR_XML_URL);

      if (!xmlResponse.ok) {
        throw new Error(`Failed to fetch car.xml: ${xmlResponse.status}`);
      }

      const xml = await xmlResponse.text();
      const { default: loadMujoco } = await importRuntimeModule(MUJOCO_MODULE_URL);
      const mujoco = await loadMujoco({
        locateFile: (path) =>
          path.endsWith(".wasm") ? MUJOCO_WASM_URL : `/mujoco/${path}`,
      });
      const model = mujoco.MjModel.from_xml_string(xml);
      const data = new mujoco.MjData(model);

      mujoco.mj_step(model, data);
      sceneHandleRef.current = await renderCarScene(
        CAR_GLB_URL,
        canvasRef.current,
        guiRef.current
      );

      data.delete?.();
      model.delete?.();
    } catch (error) {
      console.error("Failed to load MuJoCo:", error);
    } finally {
      loadingRef.current = false;
    }
  }

  return (
    <Layout
      title="Simulation"
      description="Browser-based MuJoCo simulation workspace for R1">
      <main className={styles.page}>
        <section className={styles.main}>
          <div className={styles.simPanel}>
            <div className={styles.viewport}>
              <canvas
                ref={canvasRef}
                className={styles.canvas}
                aria-label="Three.js rendering of sam_model2.glb"
              />
              <div ref={guiContainerRef} className={styles.guiMount} />
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

async function renderCarScene(
  glbUrl: string,
  canvas: HTMLCanvasElement | null,
  gui: GuiInstance | null
): Promise<ThreeSceneHandle> {
  if (!canvas) {
    throw new Error("Simulation canvas is not mounted.");
  }

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

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x14191f, 0.6, 2.8);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10);
  camera.position.copy(INITIAL_CAMERA_POSITION);
  camera.lookAt(INITIAL_CAMERA_TARGET);
  const audioListener = new THREE.AudioListener();
  camera.add(audioListener);
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.copy(INITIAL_CAMERA_TARGET);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 0.12;
  orbitControls.maxDistance = 2.5;
  orbitControls.update();

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

  const rawCar = await loadCarObject(glbUrl);
  const car = new THREE.Group();
  car.add(rawCar);
  const motorSound = await loadMotorSound(audioListener);
  const motorAudioState = {
    volume: 0,
    playbackRate: 0.9,
  };
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
    driveSpeed: 0.28,
    steeringRate: 2.8,
    idleRotation: false,
    showGrid: true,
    x: 0,
    y: 0,
    heading: 0,
    resetPose: () => {
      settings.x = 0;
      settings.y = 0;
      settings.heading = 0;
      applyPose();
    },
    resetCamera: () => {
      camera.position.copy(INITIAL_CAMERA_POSITION);
      orbitControls.target.copy(INITIAL_CAMERA_TARGET);
      orbitControls.update();
    },
  };
  let lastFrameTime = performance.now();
  const clearKeys = () => {
    keyState.forward = false;
    keyState.backward = false;
    keyState.left = false;
    keyState.right = false;
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

  let animationFrame = 0;
  const animate = () => {
    const frameTime = performance.now();
    const deltaSeconds = Math.min((frameTime - lastFrameTime) / 1000, 0.05);
    lastFrameTime = frameTime;

    if (settings.keyboard) {
      const throttle =
        Number(keyState.forward) - Number(keyState.backward);
      const steering = Number(keyState.right) - Number(keyState.left);
      const isMoving = throttle !== 0 || steering !== 0;
      const leftWheelInput = throttle !== 0 ? throttle - steering * 0.35 : -steering;
      const rightWheelInput = throttle !== 0 ? throttle + steering * 0.35 : steering;

      if (throttle !== 0) {
        settings.heading +=
          steering * throttle * deltaSeconds * settings.steeringRate;
        settings.x +=
          Math.sin(settings.heading) * throttle * deltaSeconds * settings.driveSpeed;
        settings.y -=
          Math.cos(settings.heading) * throttle * deltaSeconds * settings.driveSpeed;
      } else if (steering !== 0) {
        settings.heading += steering * deltaSeconds * settings.steeringRate * 0.42;
      } else if (settings.idleRotation) {
        settings.heading += 0.006;
      }

      settings.x = THREE.MathUtils.clamp(settings.x, -DRIVE_BOUNDS, DRIVE_BOUNDS);
      settings.y = THREE.MathUtils.clamp(settings.y, -DRIVE_BOUNDS, DRIVE_BOUNDS);
      spinWheels(driveWheels.left, leftWheelInput * deltaSeconds * WHEEL_SPIN_RATE);
      spinWheels(driveWheels.right, rightWheelInput * deltaSeconds * WHEEL_SPIN_RATE);
      updateMotorSound(
        motorSound,
        motorAudioState,
        leftWheelInput,
        rightWheelInput,
        isMoving
      );
      applyPose();
    } else if (settings.idleRotation) {
      updateMotorSound(motorSound, motorAudioState, 0, 0, false);
      settings.heading += 0.006;
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
  controlsFolder?.add(settings, "keyboard").name("WASD drive").onChange((enabled: boolean) => {
    if (!enabled) {
      clearKeys();
      updateMotorSound(motorSound, motorAudioState, 0, 0, false);
    }
  });
  controlsFolder?.add(settings, "driveSpeed", 0.05, 0.8, 0.01).name("Drive speed");
  controlsFolder?.add(settings, "steeringRate", 0.4, 6, 0.1).name("Steering");
  controlsFolder?.add(settings, "idleRotation").name("Idle rotation");
  controlsFolder?.add(settings, "showGrid").name("Show grid").onChange((visible: boolean) => {
    grid.visible = visible;
  });
  controlsFolder?.add(settings, "resetPose").name("Reset pose");
  controlsFolder?.add(settings, "resetCamera").name("Reset camera");

  function applyPose() {
    car.position.set(settings.x, 0.03, settings.y);
    car.rotation.y = -settings.heading;
  }

  function isDriveInputActive() {
    return keyState.forward || keyState.backward || keyState.left || keyState.right;
  }

  return {
    dispose: () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
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

function disposeMaterial(
  material: THREE.Material | THREE.Material[]
) {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => item.dispose());
}

function spinWheels(wheels: THREE.Object3D[], radians: number) {
  if (radians === 0) return;
  wheels.forEach((wheel) => wheel.rotateX(-radians));
}

async function loadCarObject(glbUrl: string): Promise<THREE.Group> {
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

async function loadMotorSound(
  listener: THREE.AudioListener
): Promise<THREE.PositionalAudio | null> {
  const motorSound = new THREE.PositionalAudio(listener);
  motorSound.setLoop(true);
  motorSound.setRefDistance(10);
  motorSound.setRolloffFactor(0.15);
  motorSound.setVolume(0);

  try {
    const buffer = await new THREE.AudioLoader().loadAsync(DRIVE_AUDIO_URL);
    motorSound.setBuffer(buffer);
    return motorSound;
  } catch (error) {
    console.warn(`Failed to load ${DRIVE_AUDIO_URL}:`, error);
    return null;
  }
}

function updateMotorSound(
  motorSound: THREE.PositionalAudio | null,
  state: { volume: number; playbackRate: number },
  leftWheelInput: number,
  rightWheelInput: number,
  shouldPlay: boolean
) {
  if (!motorSound?.buffer) return;

  const wheelIntensity = shouldPlay
    ? THREE.MathUtils.clamp(
        Math.max(Math.abs(leftWheelInput), Math.abs(rightWheelInput)),
        0,
        1
      )
    : 0;
  const targetPlaybackRate = 1;
  const targetVolume = shouldPlay ? 0.22 + 0.38 * wheelIntensity : 0;

  state.playbackRate = THREE.MathUtils.lerp(
    state.playbackRate,
    targetPlaybackRate,
    0.18
  );
  state.volume = THREE.MathUtils.lerp(state.volume, targetVolume, 0.16);

  motorSound.setPlaybackRate(state.playbackRate);
  motorSound.setVolume(state.volume);

  if (!shouldPlay && state.volume < 0.01) {
    if (motorSound.isPlaying) motorSound.pause();
    return;
  }

  if (!motorSound.isPlaying) {
    if (motorSound.context.state === "suspended") {
      void motorSound.context.resume().catch(() => undefined);
    }
    motorSound.play();
  }
}
