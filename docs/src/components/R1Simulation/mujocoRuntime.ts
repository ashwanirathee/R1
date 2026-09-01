import {
  CAR_XML_URL,
  MUJOCO_MODULE_URL,
  MUJOCO_WASM_URL,
} from "./constants";
import type { MujocoRuntimeModule } from "./types";

async function importRuntimeModule(url: string): Promise<MujocoRuntimeModule> {
  const runtimeImport = new Function("url", "return import(url)") as (
    url: string
  ) => Promise<MujocoRuntimeModule>;

  return runtimeImport(url);
}

export async function loadMujocoCar() {
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

  try {
    mujoco.mj_step(model, data);
  } finally {
    data.delete?.();
    model.delete?.();
  }
}
