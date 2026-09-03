import * as THREE from "three";

export type MoonEnvironment = {
  grid: THREE.GridHelper;
  debugGroup: THREE.Group;
  obstacleGroup: THREE.Group;
  terrain: THREE.Mesh;
  getSurfaceHeight: (x: number, z: number) => number;
};

type PhysicsHfield = {
  xHalfSize: number;
  yHalfSize: number;
  height: number;
  base: number;
  rows: number;
  columns: number;
  elevations: number[];
};

const SURFACE_COLOR = 0x6d6a63;
const ROCK_COLOR = 0x58554f;
const TERRAIN_SEGMENTS = 96;
const DEBUG_HFIELD_LINE_OFFSET = 0.001;
const DEBUG_HFIELD_POINT_OFFSET = 0.002;
const MUJOCO_TO_THREE_VECTOR = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0)
);

export function parseMujocoHfield(xml: string): PhysicsHfield {
  // Parse the hfield directly from car.xml so the rendered terrain and the
  // MuJoCo collision terrain stay tied to the same data source.
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

// Adds terrain, lighting, debug groups, obstacle groups, and procedural sky.
export function addMoonEnvironment(
  scene: THREE.Scene,
  hfield: PhysicsHfield
): MoonEnvironment {
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 14, 36);

  const ambient = new THREE.AmbientLight(0xffffff, 1.15);
  scene.add(ambient);

  const skyFill = new THREE.HemisphereLight(0xdce7ff, 0x2f2c27, 0.75);
  scene.add(skyFill);

  const sunLight = new THREE.DirectionalLight(0xf5f2df, 2.4);
  sunLight.position.set(-8, 12, -5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 32;
  sunLight.shadow.camera.left = -12;
  sunLight.shadow.camera.right = 12;
  sunLight.shadow.camera.top = 12;
  sunLight.shadow.camera.bottom = -12;
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(0x8db3ff, 0.8);
  rimLight.position.set(8, 7, 9);
  scene.add(rimLight);

  const groundMaterial = new THREE.MeshStandardMaterial({
    color: SURFACE_COLOR,
    roughness: 1,
    metalness: 0,
  });
  // Shared height lookup used by terrain, debug overlays, and rock placement.
  const getSurfaceHeight = (x: number, z: number) =>
    getHfieldSurfaceHeight(hfield, x, z);
  // The terrain mesh is dense for nicer shading, but every vertex height comes
  // from bilinear sampling of the same 17x17 MuJoCo hfield.
  const groundGeometry = createUndulatingTerrainGeometry(
    hfield,
    getSurfaceHeight
  );
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(1.4, 20, 0x8a877f, 0x55524d);
  grid.position.y = 0.002;
  grid.material.opacity = 0.28;
  grid.material.transparent = true;
  scene.add(grid);

  const obstacleGroup = new THREE.Group();
  obstacleGroup.name = "obstacles";
  scene.add(obstacleGroup);

  const debugGroup = new THREE.Group();
  debugGroup.name = "physics-debug";
  debugGroup.visible = false;
  debugGroup.add(createPhysicsHfieldDebug(hfield, getSurfaceHeight));
  scene.add(debugGroup);

  return {
    grid,
    debugGroup,
    obstacleGroup,
    terrain: ground,
    getSurfaceHeight,
  };
}

// Creates the wireframe box that shows the MuJoCo obstacle collision bounds.
export function createObstacleDebugBox(size: number): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(size * 1.0, size * 1.0, size * 1.0)
  );
  const material = new THREE.LineBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const box = new THREE.LineSegments(geometry, material);
  box.renderOrder = 10;

  return box;
}

// Creates a wireframe copy of the MJCF car geoms for in-scene physics debugging.
export function createMujocoCarModelDebug(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x55f0ff,
    wireframe: true,
    transparent: true,
    opacity: 0.78,
    depthTest: false,
  });
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.084, 0.208125),
    material
  );
  // Matches the chassis box in car.xml after MuJoCo-to-Three axis conversion.
  chassis.position.copy(mujocoVectorToThree(-0.0028125, 0, 0.047));
  chassis.renderOrder = 10;
  group.add(chassis);

  const wheelGeometry = new THREE.CylinderGeometry(
    0.030375,
    0.030375,
    0.02025,
    24
  );
  wheelGeometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      mujocoVectorToThree(0, 1, 0).normalize()
    )
  );
  [
    [0.04455, 0.0675, 0],
    [0.04455, -0.0675, 0],
    [-0.0495, 0.0675, 0],
    [-0.0495, -0.0675, 0],
  ].forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeometry.clone(), material);
    wheel.position.copy(mujocoVectorToThree(x, y, z));
    wheel.renderOrder = 10;
    group.add(wheel);
  });

  return group;
}

export function getHfieldSurfaceHeight(
  hfield: PhysicsHfield,
  x: number,
  z: number
) {
  // Convert Three.js world x/z back into MuJoCo hfield row/column space.
  const mujocoX = -z;
  const mujocoY = -x;
  const row =
    ((mujocoX + hfield.xHalfSize) / (hfield.xHalfSize * 2)) *
    (hfield.rows - 1);
  const column =
    ((mujocoY + hfield.yHalfSize) / (hfield.yHalfSize * 2)) *
    (hfield.columns - 1);

  return sampleHfieldHeight(hfield, row, column) * hfield.height;
}

// Creates the visual obstacle mesh used when placing obstacle bodies.
export function createObstacleMesh(size: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshStandardMaterial({
    color: ROCK_COLOR,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}

// Builds the visible terrain mesh from the parsed MuJoCo hfield samples.
function createUndulatingTerrainGeometry(
  hfield: PhysicsHfield,
  getSurfaceHeight: (x: number, z: number) => number
) {
  const geometry = new THREE.PlaneGeometry(
    hfield.yHalfSize * 2,
    hfield.xHalfSize * 2,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS
  );
  const position = geometry.attributes.position;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = -position.getY(index);
    position.setZ(index, getSurfaceHeight(x, z));
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();

  return geometry;
}

// Converts a local MuJoCo vector into the Three.js scene axis convention.
function mujocoVectorToThree(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z).applyMatrix4(MUJOCO_TO_THREE_VECTOR);
}

// Creates the line/point overlay for inspecting MuJoCo hfield sample locations.
function createPhysicsHfieldDebug(
  hfield: PhysicsHfield,
  getSurfaceHeight: (x: number, z: number) => number
) {
  // Draw MuJoCo's actual hfield sample lattice. Lines show cell edges and
  // points mark the raw hfield samples used for collision.
  const group = new THREE.Group();
  const vertices: number[] = [];
  const pointVertices: number[] = [];
  const xStep = (hfield.yHalfSize * 2) / (hfield.columns - 1);
  const zStep = (hfield.xHalfSize * 2) / (hfield.rows - 1);

  for (let row = 0; row < hfield.rows; row += 1) {
    for (let column = 0; column < hfield.columns - 1; column += 1) {
      const x0 = -hfield.yHalfSize + column * xStep;
      const x1 = x0 + xStep;
      const z = -hfield.xHalfSize + row * zStep;
      vertices.push(x0, getSurfaceHeight(x0, z) + DEBUG_HFIELD_LINE_OFFSET, z);
      vertices.push(x1, getSurfaceHeight(x1, z) + DEBUG_HFIELD_LINE_OFFSET, z);
    }
  }

  for (let column = 0; column < hfield.columns; column += 1) {
    for (let row = 0; row < hfield.rows - 1; row += 1) {
      const z0 = -hfield.xHalfSize + row * zStep;
      const z1 = z0 + zStep;
      const x = -hfield.yHalfSize + column * xStep;
      vertices.push(x, getSurfaceHeight(x, z0) + DEBUG_HFIELD_LINE_OFFSET, z0);
      vertices.push(x, getSurfaceHeight(x, z1) + DEBUG_HFIELD_LINE_OFFSET, z1);
    }
  }

  for (let row = 0; row < hfield.rows; row += 1) {
    for (let column = 0; column < hfield.columns; column += 1) {
      const x = -hfield.yHalfSize + column * xStep;
      const z = -hfield.xHalfSize + row * zStep;
      pointVertices.push(x, getSurfaceHeight(x, z) + DEBUG_HFIELD_POINT_OFFSET, z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xff4d6d,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    })
  );
  lines.renderOrder = 9;
  group.add(lines);

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(pointVertices, 3)
  );
  const points = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.012,
      sizeAttenuation: true,
      depthTest: false,
    })
  );
  points.renderOrder = 10;
  group.add(points);

  return group;
}

// Bilinearly samples hfield elevation data at fractional row/column positions.
function sampleHfieldHeight(
  hfield: PhysicsHfield,
  row: number,
  column: number
) {
  const clampedRow = THREE.MathUtils.clamp(row, 0, hfield.rows - 1);
  const clampedColumn = THREE.MathUtils.clamp(column, 0, hfield.columns - 1);
  const row0 = Math.floor(clampedRow);
  const column0 = Math.floor(clampedColumn);
  const row1 = Math.min(row0 + 1, hfield.rows - 1);
  const column1 = Math.min(column0 + 1, hfield.columns - 1);
  const rowT = clampedRow - row0;
  const columnT = clampedColumn - column0;
  const h00 = hfield.elevations[row0 * hfield.columns + column0];
  const h10 = hfield.elevations[row1 * hfield.columns + column0];
  const h01 = hfield.elevations[row0 * hfield.columns + column1];
  const h11 = hfield.elevations[row1 * hfield.columns + column1];
  const h0 = THREE.MathUtils.lerp(h00, h01, columnT);
  const h1 = THREE.MathUtils.lerp(h10, h11, columnT);

  return THREE.MathUtils.lerp(h0, h1, rowT);
}

// Reads a required XML attribute from the parsed hfield tag.
function readXmlAttribute(tag: string, name: string) {
  const value = tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
  if (!value) {
    throw new Error(`Missing ${name} on lunar_hfield.`);
  }

  return value;
}

// Reads a whitespace-separated numeric XML attribute such as size or elevation.
function readNumberListAttribute(tag: string, name: string) {
  return readXmlAttribute(tag, name)
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
}
