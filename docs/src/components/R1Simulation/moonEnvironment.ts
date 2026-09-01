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
const CRATER_COLOR = 0x4a4741;
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
  scene.fog = new THREE.Fog(0x07090d, 1.4, 4.2);

  const ambient = new THREE.HemisphereLight(0xdce7ff, 0x141312, 0.55);
  scene.add(ambient);

  const sunLight = new THREE.DirectionalLight(0xf5f2df, 3.2);
  sunLight.position.set(-0.8, 1.1, -0.35);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.05;
  sunLight.shadow.camera.far = 4;
  sunLight.shadow.camera.left = -1.6;
  sunLight.shadow.camera.right = 1.6;
  sunLight.shadow.camera.top = 1.6;
  sunLight.shadow.camera.bottom = -1.6;
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(0x8db3ff, 0.65);
  rimLight.position.set(0.7, 0.45, 0.8);
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

  // Keep the base environment visually flat while validating the MJCF car.
  // User-placed rocks still use real MuJoCo obstacle bodies.
  addProceduralSky(scene);

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
    new THREE.BoxGeometry(size * 1.44, size * 1.44, size * 1.16)
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

// Creates the visual rock mesh used when placing obstacle bodies.
export function createObstacleMesh(size: number): THREE.Mesh {
  const geometry = new THREE.DodecahedronGeometry(size, 0);
  const material = new THREE.MeshStandardMaterial({
    color: ROCK_COLOR,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.set(1.15, 0.75, 0.95);

  return mesh;
}

// Adds decorative crater meshes; disabled while the flat-terrain baseline is active.
function addCraters(scene: THREE.Scene) {
  const craterMaterial = new THREE.MeshStandardMaterial({
    color: CRATER_COLOR,
    roughness: 1,
    metalness: 0,
  });
  const craters = [
    { x: -0.55, z: -0.5, radius: 0.18, scaleZ: 0.58 },
    { x: 0.48, z: -0.28, radius: 0.12, scaleZ: 0.66 },
    { x: 0.12, z: 0.46, radius: 0.15, scaleZ: 0.62 },
    { x: -0.72, z: 0.38, radius: 0.1, scaleZ: 0.7 },
  ];

  craters.forEach(({ x, z, radius, scaleZ }) => {
    const crater = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.62, radius, 32),
      craterMaterial
    );
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(x, 0.006, z);
    crater.scale.z = scaleZ;
    scene.add(crater);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.64, 32),
      craterMaterial
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, 0.004, z);
    shadow.scale.z = scaleZ;
    scene.add(shadow);
  });
}

// Adds decorative static rocks; user-placed rocks are handled by obstacle bodies.
function addRocks(
  scene: THREE.Scene,
  getSurfaceHeight: (x: number, z: number) => number
) {
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: ROCK_COLOR,
    roughness: 1,
    metalness: 0,
  });
  const rocks = [
    [-0.88, -0.18, 0.025],
    [-0.34, 0.72, 0.018],
    [0.66, 0.38, 0.022],
    [0.82, -0.66, 0.015],
    [0.26, -0.82, 0.018],
  ] as const;

  rocks.forEach(([x, z, radius], index) => {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(radius, 0),
      rockMaterial
    );
    rock.position.set(x, getSurfaceHeight(x, z) + radius * 0.65, z);
    rock.rotation.set(index * 0.7, index * 1.1, index * 0.4);
    rock.scale.set(1.2, 0.72, 0.9);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  });
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

// Adds all generated sky elements: stars, Earth, and the horizon glow.
function addProceduralSky(scene: THREE.Scene) {
  addStars(scene);
  addEarth(scene);
  addHorizonGlow(scene);
}

// Builds the procedural Earth sphere and cloud/atmosphere layers.
function addEarth(scene: THREE.Scene) {
  const earthGroup = new THREE.Group();
  earthGroup.name = "procedural-earth";
  earthGroup.position.set(1.25, 1.45, -2.15);
  earthGroup.rotation.set(0.18, -0.36, -0.08);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 64, 32),
    new THREE.MeshStandardMaterial({
      map: createEarthTexture(),
      roughness: 0.88,
      metalness: 0,
      emissive: new THREE.Color(0x08142d),
      emissiveIntensity: 0.18,
    })
  );
  earthGroup.add(earth);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(0.246, 64, 32),
    new THREE.MeshBasicMaterial({
      map: createCloudTexture(),
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    })
  );
  earthGroup.add(clouds);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.265, 64, 32),
    new THREE.MeshBasicMaterial({
      color: 0x6db9ff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  earthGroup.add(atmosphere);
  scene.add(earthGroup);
}

// Draws a simple procedural Earth texture into a canvas.
function createEarthTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const ocean = context.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, "#143d78");
  ocean.addColorStop(0.55, "#0b2f66");
  ocean.addColorStop(1, "#071f47");
  context.fillStyle = ocean;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const continents = [
    { x: 105, y: 92, rx: 58, ry: 35, rotation: -0.35 },
    { x: 155, y: 142, rx: 36, ry: 62, rotation: 0.22 },
    { x: 285, y: 104, rx: 86, ry: 44, rotation: 0.12 },
    { x: 365, y: 150, rx: 58, ry: 32, rotation: -0.42 },
    { x: 452, y: 96, rx: 50, ry: 38, rotation: 0.4 },
  ];

  continents.forEach(({ x, y, rx, ry, rotation }, index) => {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.fillStyle = index % 2 === 0 ? "#2f7d4b" : "#6d8f4a";
    context.beginPath();
    context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(210, 198, 126, 0.42)";
    context.beginPath();
    context.ellipse(rx * 0.16, -ry * 0.12, rx * 0.42, ry * 0.34, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });

  context.fillStyle = "rgba(235, 245, 255, 0.88)";
  context.fillRect(0, 0, canvas.width, 18);
  context.fillRect(0, canvas.height - 20, canvas.width, 20);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
}

// Draws a transparent procedural cloud texture into a canvas.
function createCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255, 255, 255, 0.72)";

  for (let index = 0; index < 42; index += 1) {
    const x = (index * 83) % canvas.width;
    const y = 35 + ((index * 47) % 170);
    const width = 28 + ((index * 13) % 42);
    const height = 5 + ((index * 7) % 12);
    context.beginPath();
    context.ellipse(x, y, width, height, index * 0.37, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
}

// Adds a subtle ring near the ground plane to separate horizon from space.
function addHorizonGlow(scene: THREE.Scene) {
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(1.05, 1.42, 96),
    new THREE.MeshBasicMaterial({
      color: 0x8aa0b7,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.018;
  scene.add(glow);
}

// Creates procedural star points around the simulation scene.
function addStars(scene: THREE.Scene) {
  const vertices: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  for (let index = 0; index < 420; index += 1) {
    const radius = 2 + Math.random() * 2.4;
    const angle = Math.random() * Math.PI * 2;
    vertices.push(
      Math.cos(angle) * radius,
      0.8 + Math.random() * 1.8,
      Math.sin(angle) * radius
    );
    color.setHSL(0.58 + Math.random() * 0.08, 0.45, 0.78 + Math.random() * 0.22);
    colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.009,
      sizeAttenuation: true,
      vertexColors: true,
    })
  );
  scene.add(stars);
}
