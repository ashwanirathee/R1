import {
  CAR_XML_URL,
  MUJOCO_MODULE_URL,
  MUJOCO_WASM_URL,
} from "./constants";
import type {
  MujocoDataWithAccessors,
  MujocoGeomAccessor,
  MujocoModelBodyAccessor,
  MujocoModelWithAccessors,
  MujocoRuntimeModule,
  MujocoSimulation,
} from "./types";

const OBSTACLE_COUNT = 5;
const HIDDEN_OBSTACLE_POSITION: [number, number, number] = [4, 4, 0.06];

async function importRuntimeModule(url: string): Promise<MujocoRuntimeModule> {
  // MuJoCo is served as a browser ESM bundle from /static, so keep the import
  // dynamic and URL-based instead of bundling it into the Docusaurus build.
  const runtimeImport = new Function("url", "return import(url)") as (
    url: string
  ) => Promise<MujocoRuntimeModule>;

  return runtimeImport(url);
}

// Creates the MuJoCo model/data pair and exposes a small simulation API to Three.js.
export async function createMujocoSimulation(): Promise<MujocoSimulation> {
  const xmlResponse = await fetch(CAR_XML_URL);

  if (!xmlResponse.ok) {
    throw new Error(`Failed to fetch car.xml: ${xmlResponse.status}`);
  }

  const xml = await xmlResponse.text();
  const { default: loadMujoco } = await importRuntimeModule(MUJOCO_MODULE_URL);
  // The JS loader asks for mujoco.wasm separately; route that request to the
  // static asset URL so browser and build paths stay predictable.
  const mujoco = await loadMujoco({
    locateFile: (path) =>
      path.endsWith(".wasm") ? MUJOCO_WASM_URL : `/mujoco/${path}`,
  });
  const model = mujoco.MjModel.from_xml_string(xml) as MujocoModelWithAccessors;
  const data = new mujoco.MjData(model) as MujocoDataWithAccessors;
  const forwardActuator = model.actuator("forward");
  const turnActuator = model.actuator("turn");
  const forwardActuatorId = forwardActuator.id;
  const turnActuatorId = turnActuator.id;
  const timestep = model.opt?.timestep ?? 0.002;
  const obstacleBodies = Array.from({ length: OBSTACLE_COUNT }, (_, index) =>
    model.body(`obstacle_body_${index}`)
  );
  const obstacleGeoms = Array.from({ length: OBSTACLE_COUNT }, (_, index) =>
    model.geom(`obstacle_${index}`)
  );
  let disposed = false;

  // The obstacle bodies exist in the MJCF from startup. Moving/resizing them is
  // cheaper and more reliable than rebuilding the MuJoCo model for each click.
  forwardActuator.delete?.();
  turnActuator.delete?.();
  obstacleBodies.forEach((body, index) => {
    moveObstacleBody(body, [
      HIDDEN_OBSTACLE_POSITION[0] + index * 0.2,
      HIDDEN_OBSTACLE_POSITION[1],
      HIDDEN_OBSTACLE_POSITION[2],
    ]);
  });
  obstacleGeoms.forEach((geom) => {
    resizeObstacleGeom(geom, [0.08, 0.08, 0.06]);
  });
  mujoco.mj_setConst(model, data);
  mujoco.mj_forward(model, data);

  return {
    xml,
    setControls: (forward, turn) => {
      if (disposed) return;
      // Actuators map high-level drive/turn controls onto all wheel joints via
      // fixed tendons declared in car.xml.
      data.ctrl[forwardActuatorId] = forward;
      data.ctrl[turnActuatorId] = turn;
    },
    step: (deltaSeconds) => {
      if (disposed) return;
      const steps = Math.max(1, Math.min(25, Math.round(deltaSeconds / timestep)));

      for (let index = 0; index < steps; index += 1) {
        mujoco.mj_step(model, data);
        dampFreeJointAngularVelocity(data.qvel);
      }
    },
    reset: () => {
      if (disposed) return;
      mujoco.mj_resetData(model, data);
      mujoco.mj_setConst(model, data);
      mujoco.mj_forward(model, data);
    },
    getCarPose: () => {
      if (disposed) {
        return {
          position: [0, 0, 0],
          quaternion: [1, 0, 0, 0],
        };
      }

      const carBody = data.body("car");
      const position: [number, number, number] = [
        carBody.xpos[0],
        carBody.xpos[1],
        carBody.xpos[2],
      ];
      const quaternion: [number, number, number, number] = [
        carBody.xquat[0],
        carBody.xquat[1],
        carBody.xquat[2],
        carBody.xquat[3],
      ];

      carBody.delete?.();

      return {
        position,
        quaternion,
      };
    },
    getContactCount: () => (disposed ? 0 : data.ncon),
    setObstacle: (index, obstacle) => {
      if (disposed) return;
      const body = obstacleBodies[index];
      const geom = obstacleGeoms[index];
      if (!body || !geom) return;

      moveObstacleBody(
        body,
        obstacle?.position ?? [
          HIDDEN_OBSTACLE_POSITION[0] + index * 0.2,
          HIDDEN_OBSTACLE_POSITION[1],
          HIDDEN_OBSTACLE_POSITION[2],
        ]
      );
      resizeObstacleGeom(geom, obstacle?.size ?? [0.08, 0.08, 0.06]);
      mujoco.mj_setConst(model, data);
      mujoco.mj_forward(model, data);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      obstacleBodies.forEach((body) => body.delete?.());
      obstacleGeoms.forEach((geom) => geom.delete?.());
      data.delete?.();
      model.delete?.();
    },
  };
}

function dampFreeJointAngularVelocity(qvel: Float64Array) {
  // The rover has a freejoint on bumpy hfield terrain. A little angular damping
  // keeps numerical roll/pitch spikes from dominating the visual motion.
  qvel[3] *= 0.88;
  qvel[4] *= 0.88;
  qvel[5] *= 0.94;
}

// Moves a predeclared MJCF obstacle body to either an active or hidden position.
function moveObstacleBody(
  body: MujocoModelBodyAccessor,
  position: [number, number, number]
) {
  body.pos[0] = position[0];
  body.pos[1] = position[1];
  body.pos[2] = position[2];
}

// Updates the MuJoCo obstacle box half-extents to match the visual rock size.
function resizeObstacleGeom(
  geom: MujocoGeomAccessor,
  size: [number, number, number]
) {
  geom.size[0] = size[0];
  geom.size[1] = size[1];
  geom.size[2] = size[2];
}
