type ClassHandle = {
  delete?: () => void;
};

export type MujocoModel = ClassHandle & Record<string, unknown>;
export type MujocoData = ClassHandle & Record<string, unknown>;

type MujocoNamedAccessor = ClassHandle & {
  id: number;
};

export type MujocoBodyAccessor = ClassHandle & {
  xpos: ArrayLike<number>;
  xquat: ArrayLike<number>;
};

export type LoadMujoco = (options?: {
  locateFile?: (path: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<{
  MjModel: {
    from_xml_string: (xml: string) => MujocoModel;
  };
  MjData: new (model: MujocoModel) => MujocoData;
  mj_forward: (model: MujocoModel, data: MujocoData) => void;
  mj_resetData: (model: MujocoModel, data: MujocoData) => void;
  mj_step: (model: MujocoModel, data: MujocoData) => void;
}>;

export type MujocoRuntimeModule = {
  default: LoadMujoco;
};

export type MujocoSimulation = {
  setControls: (forward: number, turn: number) => void;
  step: (deltaSeconds: number) => void;
  reset: () => void;
  getCarPose: () => {
    position: [number, number, number];
    quaternion: [number, number, number, number];
  };
  dispose: () => void;
};

export type MujocoModelWithAccessors = MujocoModel & {
  actuator: (name: string) => MujocoNamedAccessor;
  opt?: {
    timestep?: number;
  };
};

export type MujocoDataWithAccessors = MujocoData & {
  ctrl: Float64Array;
  body: (name: string) => MujocoBodyAccessor;
};

export type ThreeSceneHandle = {
  dispose: () => void;
};

export type GuiConstructor = typeof import("lil-gui").default;
export type GuiInstance = InstanceType<GuiConstructor>;
