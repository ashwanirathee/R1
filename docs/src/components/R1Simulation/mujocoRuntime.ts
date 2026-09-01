import {
  CAR_XML_URL,
  MUJOCO_MODULE_URL,
  MUJOCO_WASM_URL,
} from "./constants";
import type {
  MujocoDataWithAccessors,
  MujocoModelWithAccessors,
  MujocoRuntimeModule,
  MujocoSimulation,
} from "./types";

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

  forwardActuator.delete?.();
  turnActuator.delete?.();
  mujoco.mj_forward(model, data);

  return {
    setControls: (forward, turn) => {
      data.ctrl[forwardActuatorId] = forward;
      data.ctrl[turnActuatorId] = turn;
    },
    step: (deltaSeconds) => {
      const steps = Math.max(1, Math.min(25, Math.round(deltaSeconds / timestep)));

      for (let index = 0; index < steps; index += 1) {
        mujoco.mj_step(model, data);
      }
    },
    reset: () => {
      mujoco.mj_resetData(model, data);
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
    dispose: () => {
      data.delete?.();
      model.delete?.();
    },
  };
}
