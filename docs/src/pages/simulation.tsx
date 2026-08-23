import React, { useEffect, useRef, type ReactNode } from "react";
import Layout from "@theme/Layout";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
const DRIVE_BOUNDS = 0.46;

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
      sceneHandleRef.current = renderCarScene(
        xml,
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
                aria-label="Three.js rendering of car.xml"
              />
              <div ref={guiContainerRef} className={styles.guiMount} />
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

function renderCarScene(
  xml: string,
  canvas: HTMLCanvasElement | null,
  gui: GuiInstance | null
): ThreeSceneHandle {
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

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x14191f, 0.6, 2.8);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10);
  camera.position.set(0.35, -0.55, 0.34);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0.04);
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.set(0, 0, 0.04);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 0.12;
  orbitControls.maxDistance = 2.5;
  orbitControls.update();

  const ambient = new THREE.HemisphereLight(0xeaf6ff, 0x17202a, 1.2);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(0.35, -0.35, 0.8);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x88ccff, 1.1, 3);
  fillLight.position.set(-0.5, 0.45, 0.35);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(1.3, 18, 0x365064, 0x253342);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshStandardMaterial({
      color: 0x1b2630,
      roughness: 0.9,
      metalness: 0,
    })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const car = buildCarObject(xml);
  scene.add(car);

  const keyState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  };
  const settings = {
    keyboard: false,
    driveSpeed: 0.28,
    steeringRate: 2.8,
    idleRotation: true,
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
      camera.position.set(0.35, -0.55, 0.34);
      orbitControls.target.set(0, 0, 0.04);
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
      const steering = Number(keyState.left) - Number(keyState.right);

      if (throttle !== 0) {
        settings.heading +=
          steering * throttle * deltaSeconds * settings.steeringRate;
        settings.x +=
          Math.cos(settings.heading) * throttle * deltaSeconds * settings.driveSpeed;
        settings.y +=
          Math.sin(settings.heading) * throttle * deltaSeconds * settings.driveSpeed;
      } else if (steering !== 0) {
        settings.heading += steering * deltaSeconds * settings.steeringRate * 0.42;
      }

      settings.x = THREE.MathUtils.clamp(settings.x, -DRIVE_BOUNDS, DRIVE_BOUNDS);
      settings.y = THREE.MathUtils.clamp(settings.y, -DRIVE_BOUNDS, DRIVE_BOUNDS);
      applyPose();
    } else if (settings.idleRotation) {
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
    car.position.set(settings.x, settings.y, 0.03);
    car.rotation.z = settings.heading;
  }

  return {
    dispose: () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
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

function buildCarObject(xml: string): THREE.Group {
  const group = new THREE.Group();
  group.position.z = 0.03;

  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  const mesh = documentXml.querySelector('mesh[name="chasis"]');
  const meshScale = parseNumberList(mesh?.getAttribute("scale") ?? "1 1 1");
  const vertices = parseNumberList(mesh?.getAttribute("vertex") ?? "");
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];

  for (let index = 0; index < vertices.length; index += 3) {
    positions.push(
      vertices[index] * (meshScale[0] ?? 1),
      vertices[index + 1] * (meshScale[1] ?? 1),
      vertices[index + 2] * (meshScale[2] ?? 1)
    );
  }

  const indices = [
    0, 1, 2, 0, 3, 1, 0, 2, 4, 1, 5, 2, 2, 7, 4, 1, 6, 5, 6, 7, 5, 2, 5, 7,
    0, 4, 3, 0, 8, 1, 0, 2, 8, 1, 8, 6, 2, 7, 8, 6, 8, 7,
  ];

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const chassis = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x9fb7d9,
      roughness: 0.42,
      metalness: 0.18,
      side: THREE.DoubleSide,
    })
  );
  chassis.castShadow = true;
  group.add(chassis);

  group.add(createFrontWheel());
  group.add(createRearWheel(-0.07, 0.06));
  group.add(createRearWheel(-0.07, -0.06));
  group.add(createHeadlight());

  return group;
}

function createFrontWheel(): THREE.Mesh {
  const wheel = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0xe7eaf0,
      roughness: 0.35,
      metalness: 0.1,
    })
  );
  wheel.position.set(0.08, 0, -0.015);
  wheel.castShadow = true;
  return wheel;
}

function createRearWheel(x: number, y: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, 0);

  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.02, 36),
    new THREE.MeshStandardMaterial({
      color: 0x7f94ff,
      roughness: 0.48,
      metalness: 0.08,
    })
  );
  wheel.rotation.x = Math.PI / 2;
  wheel.castShadow = true;
  group.add(wheel);

  const spokeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8e1ff,
    roughness: 0.5,
  });

  const spokeA = new THREE.Mesh(
    new THREE.BoxGeometry(0.006, 0.052, 0.012),
    spokeMaterial
  );
  const spokeB = new THREE.Mesh(
    new THREE.BoxGeometry(0.052, 0.006, 0.012),
    spokeMaterial
  );
  group.add(spokeA, spokeB);

  return group;
}

function createHeadlight(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(0.1, 0, 0.02);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  group.add(bulb);

  const light = new THREE.SpotLight(0xffffff, 6, 1.2, 0.35, 0.4, 1.4);
  light.position.set(0, 0, 0);
  light.target.position.set(0.5, 0, -0.2);
  group.add(light, light.target);

  return group;
}

function parseNumberList(value: string): number[] {
  return value
    .trim()
    .split(/\s+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}
