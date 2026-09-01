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
  const runtimeImport = new Function("url", "return import(url)") as (
    url: string
  ) => Promise<MujocoRuntimeModule>;

  return runtimeImport(url);
}

export async function createMujocoSimulation(): Promise<MujocoSimulation> {
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
      data.ctrl[forwardActuatorId] = forward;
      data.ctrl[turnActuatorId] = turn;
    },
    step: (deltaSeconds) => {
      const steps = Math.max(1, Math.min(25, Math.round(deltaSeconds / timestep)));

      for (let index = 0; index < steps; index += 1) {
        mujoco.mj_step(model, data);
        dampFreeJointAngularVelocity(data.qvel);
      }
    },
    reset: () => {
      mujoco.mj_resetData(model, data);
      mujoco.mj_setConst(model, data);
      mujoco.mj_forward(model, data);
    },
    getCarPose: () => {
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
    getContactCount: () => data.ncon,
    setObstacle: (index, obstacle) => {
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
      obstacleBodies.forEach((body) => body.delete?.());
      obstacleGeoms.forEach((geom) => geom.delete?.());
      data.delete?.();
      model.delete?.();
    },
  };
}

function dampFreeJointAngularVelocity(qvel: Float64Array) {
  qvel[3] *= 0.88;
  qvel[4] *= 0.88;
  qvel[5] *= 0.94;
}

function moveObstacleBody(
  body: MujocoModelBodyAccessor,
  position: [number, number, number]
) {
  body.pos[0] = position[0];
  body.pos[1] = position[1];
  body.pos[2] = position[2];
}

function resizeObstacleGeom(
  geom: MujocoGeomAccessor,
  size: [number, number, number]
) {
  geom.size[0] = size[0];
  geom.size[1] = size[1];
  geom.size[2] = size[2];
}
