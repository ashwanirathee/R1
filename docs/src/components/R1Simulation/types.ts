type ClassHandle = {
  delete?: () => void;
};

export type MujocoModel = ClassHandle & Record<string, unknown>;
export type MujocoData = ClassHandle & Record<string, unknown>;

export type LoadMujoco = (options?: {
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

export type MujocoRuntimeModule = {
  default: LoadMujoco;
};

export type ThreeSceneHandle = {
  dispose: () => void;
};

export type GuiConstructor = typeof import("lil-gui").default;
export type GuiInstance = InstanceType<GuiConstructor>;
