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

export type MujocoModelBodyAccessor = ClassHandle & {
  id: number;
  pos: Float64Array;
};

export type MujocoGeomAccessor = ClassHandle & {
  pos: Float64Array;
  size: Float64Array;
  rgba: Float32Array;
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
  mj_setConst: (model: MujocoModel, data: MujocoData) => void;
  mj_step: (model: MujocoModel, data: MujocoData) => void;
}>;

export type MujocoRuntimeModule = {
  default: LoadMujoco;
};

export type MujocoSimulation = {
  xml: string;
  setControls: (forward: number, turn: number) => void;
  step: (deltaSeconds: number) => void;
  reset: () => void;
  getCarPose: () => {
    position: [number, number, number];
    quaternion: [number, number, number, number];
  };
  getContactCount: () => number;
  setObstacle: (
    index: number,
    obstacle: {
      position: [number, number, number];
      size: [number, number, number];
    } | null
  ) => void;
  dispose: () => void;
};

export type MujocoModelWithAccessors = MujocoModel & {
  actuator: (name: string) => MujocoNamedAccessor;
  body: (name: string) => MujocoModelBodyAccessor;
  geom: (name: string) => MujocoGeomAccessor;
  opt?: {
    timestep?: number;
  };
};

export type MujocoDataWithAccessors = MujocoData & {
  ctrl: Float64Array;
  ncon: number;
  qvel: Float64Array;
  body: (name: string) => MujocoBodyAccessor;
};

export type ThreeSceneHandle = {
  dispose: () => void;
  setMapObstacles: (cells: MapEditorCell[]) => void;
};

export type MapEditorCell = {
  row: number;
  col: number;
};

export type GuiConstructor = typeof import("lil-gui").default;
export type GuiInstance = InstanceType<GuiConstructor>;
