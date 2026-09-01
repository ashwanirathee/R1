export type PhysicsHfield = {
  xHalfSize: number;
  yHalfSize: number;
  height: number;
  base: number;
  rows: number;
  columns: number;
  elevations: number[];
};

export function parseMujocoHfield(xml: string): PhysicsHfield {
  const hfieldTag = xml.match(/<hfield\b[^>]*name="lunar_hfield"[^>]*>/)?.[0];
  if (!hfieldTag) {
    throw new Error("Missing lunar_hfield in car.xml.");
  }

  const rows = Number.parseInt(readXmlAttribute(hfieldTag, "nrow"), 10);
  const columns = Number.parseInt(readXmlAttribute(hfieldTag, "ncol"), 10);
  const [xHalfSize, yHalfSize, height, base] = readNumberListAttribute(
    hfieldTag,
    "size"
  );
  const elevations = readNumberListAttribute(hfieldTag, "elevation");

  if (elevations.length !== rows * columns) {
    throw new Error(
      `lunar_hfield expected ${rows * columns} elevation values, got ${elevations.length}.`
    );
  }

  return {
    xHalfSize,
    yHalfSize,
    height,
    base,
    rows,
    columns,
    elevations,
  };
}

export function getProceduralMoonHeight(hfield: PhysicsHfield, x: number, z: number) {
  const ridge =
    valueNoise2D(x * 1.9, z * 1.9) * 0.032 +
    valueNoise2D(x * 4.8 + 19.2, z * 4.8 - 8.4) * 0.018 +
    valueNoise2D(x * 11.5 - 2.1, z * 11.5 + 5.7) * 0.008;
  const craterDip =
    crater(x, z, 0.9, 2.1, 0.32, 0.028) +
    crater(x, z, -1.35, -0.65, 0.24, 0.022) +
    crater(x, z, 2.2, -1.45, 0.42, 0.035) +
    crater(x, z, -2.4, 1.7, 0.36, 0.03);
  const height = 0.032 + ridge - craterDip;

  return clamp(height, 0, hfield.height);
}

export function createHfieldElevationsForCenter(
  hfield: PhysicsHfield,
  centerMujocoX: number,
  centerMujocoY: number
) {
  const elevations: number[] = [];

  for (let row = 0; row < hfield.rows; row += 1) {
    for (let column = 0; column < hfield.columns; column += 1) {
      const localMujocoX =
        -hfield.xHalfSize +
        (row / (hfield.rows - 1)) * hfield.xHalfSize * 2;
      const localMujocoY =
        -hfield.yHalfSize +
        (column / (hfield.columns - 1)) * hfield.yHalfSize * 2;
      const worldMujocoX = centerMujocoX + localMujocoX;
      const worldMujocoY = centerMujocoY + localMujocoY;
      const worldThreeX = -worldMujocoY;
      const worldThreeZ = -worldMujocoX;

      elevations.push(getProceduralMoonHeight(hfield, worldThreeX, worldThreeZ) / hfield.height);
    }
  }

  return elevations;
}

export function snapMujocoHfieldCenter(
  hfield: PhysicsHfield,
  centerMujocoX: number,
  centerMujocoY: number
): [number, number] {
  const xStep = (hfield.xHalfSize * 2) / (hfield.rows - 1);
  const yStep = (hfield.yHalfSize * 2) / (hfield.columns - 1);

  return [
    Math.round(centerMujocoX / xStep) * xStep,
    Math.round(centerMujocoY / yStep) * yStep,
  ];
}

export function snapThreeHfieldCenter(
  hfield: PhysicsHfield,
  centerX: number,
  centerZ: number
): [number, number] {
  const [mujocoX, mujocoY] = snapMujocoHfieldCenter(
    hfield,
    -centerZ,
    -centerX
  );

  return [-mujocoY, -mujocoX];
}

function crater(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radius: number,
  depth: number
) {
  const distance = Math.hypot(x - centerX, z - centerZ);
  if (distance >= radius) return 0;

  const edge = distance / radius;
  return (1 - edge * edge) * depth;
}

function valueNoise2D(x: number, z: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xT = smoothstep(x - x0);
  const zT = smoothstep(z - z0);
  const h00 = hash2D(x0, z0);
  const h10 = hash2D(x0 + 1, z0);
  const h01 = hash2D(x0, z0 + 1);
  const h11 = hash2D(x0 + 1, z0 + 1);
  const h0 = lerp(h00, h10, xT);
  const h1 = lerp(h01, h11, xT);

  return lerp(h0, h1, zT) * 2 - 1;
}

function hash2D(x: number, z: number) {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;

  return value - Math.floor(value);
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readXmlAttribute(tag: string, name: string) {
  const value = tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
  if (!value) {
    throw new Error(`Missing ${name} on lunar_hfield.`);
  }

  return value;
}

function readNumberListAttribute(tag: string, name: string) {
  return readXmlAttribute(tag, name)
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
}
