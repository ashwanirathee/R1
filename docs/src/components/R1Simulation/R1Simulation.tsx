import React, { useEffect, useRef, useState, type ReactNode } from "react";

import {
  CAR_GLB_URLS,
  MAP_CELLS,
  MAP_METERS,
} from "./constants";
import { createMujocoSimulation } from "./mujocoRuntime";
import { renderCarScene } from "./renderCarScene";
import styles from "./R1Simulation.module.css";
import type {
  GuiInstance,
  MapEditorCell,
  MujocoSimulation,
  ThreeSceneHandle,
} from "./types";

const DEFAULT_MAP_OBSTACLE_SIDE_CELLS = 8;

// Mounts the path-planning canvas, control panel, MuJoCo runtime, and Three.js scene.
export function R1Simulation(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapEditorDialogRef = useRef<HTMLDialogElement | null>(null);
  const guiContainerRef = useRef<HTMLDivElement | null>(null);
  const guiRef = useRef<GuiInstance | null>(null);
  const loadingRef = useRef(false);
  const disposedRef = useRef(false);
  const mujocoRef = useRef<MujocoSimulation | null>(null);
  const sceneHandleRef = useRef<ThreeSceneHandle | null>(null);
  const [mapObstacles, setMapObstacles] = useState<Set<string>>(
    createDefaultMapObstacles
  );
  const isPaintingMapRef = useRef(false);
  const mapPaintValueRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    disposedRef.current = false;

    async function setupGui() {
      const { default: GUI } = await import("lil-gui");
      if (cancelled || !guiContainerRef.current || guiRef.current) return;

      guiContainerRef.current.replaceChildren();
      guiRef.current = new GUI({
        container: guiContainerRef.current,
        title: "R1 Race Simulation",
        injectStyles: true,
        width: 280,
      });
      void loadSimulation();
    }

    void setupGui();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      sceneHandleRef.current?.dispose();
      sceneHandleRef.current = null;
      mujocoRef.current?.dispose();
      mujocoRef.current = null;
      guiRef.current?.destroy();
      guiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stopPainting = () => {
      isPaintingMapRef.current = false;
      mapPaintValueRef.current = null;
    };

    window.addEventListener("pointerup", stopPainting);
    window.addEventListener("pointercancel", stopPainting);
    return () => {
      window.removeEventListener("pointerup", stopPainting);
      window.removeEventListener("pointercancel", stopPainting);
    };
  }, []);

  async function loadSimulation() {
    if (loadingRef.current || sceneHandleRef.current) return;

    loadingRef.current = true;
    let pendingMujoco: MujocoSimulation | null = null;
    let pendingSceneHandle: ThreeSceneHandle | null = null;

    try {
      pendingMujoco = await createMujocoSimulation();
      if (disposedRef.current) {
        pendingMujoco.dispose();
        pendingMujoco = null;
        return;
      }

      pendingSceneHandle = await renderCarScene(
        CAR_GLB_URLS,
        canvasRef.current,
        guiRef.current,
        pendingMujoco,
        mapEditorDialogRef.current
      );
      if (disposedRef.current) {
        pendingSceneHandle.dispose();
        pendingMujoco.dispose();
        pendingSceneHandle = null;
        pendingMujoco = null;
        return;
      }

      mujocoRef.current = pendingMujoco;
      sceneHandleRef.current = pendingSceneHandle;
      pendingSceneHandle.setMapObstacles(mapObstacleSetToCells(mapObstacles));
      pendingSceneHandle = null;
      pendingMujoco = null;
    } catch (error) {
      pendingSceneHandle?.dispose();
      pendingMujoco?.dispose();
      mujocoRef.current?.dispose();
      mujocoRef.current = null;
      console.error("Failed to load path-planning simulation:", error);
    } finally {
      loadingRef.current = false;
    }
  }

  const toggleMapObstacle = (row: number, col: number) => {
    const key = mapCellKey(row, col);
    setMapObstacles((current) => {
      const next = new Set(current);
      const shouldAdd = mapPaintValueRef.current ?? !next.has(key);

      if (shouldAdd) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  };

  const handleMapPointerDown = (row: number, col: number) => {
    const key = mapCellKey(row, col);
    isPaintingMapRef.current = true;
    mapPaintValueRef.current = !mapObstacles.has(key);
    toggleMapObstacle(row, col);
  };

  const handleMapPointerEnter = (row: number, col: number) => {
    if (!isPaintingMapRef.current) return;
    toggleMapObstacle(row, col);
  };

  const applyMapObstaclesToScene = (obstacles = mapObstacles) => {
    sceneHandleRef.current?.setMapObstacles(mapObstacleSetToCells(obstacles));
  };

  const clearMapObstacles = () => {
    const nextObstacles = new Set<string>();
    setMapObstacles(nextObstacles);
    applyMapObstaclesToScene(nextObstacles);
  };

  const mapCells = [];
  for (let row = 0; row < MAP_CELLS; row += 1) {
    for (let col = 0; col < MAP_CELLS; col += 1) {
      const key = mapCellKey(row, col);
      const isObstacle = mapObstacles.has(key);
      mapCells.push(
        <button
          aria-label={`Map cell ${row + 1}, ${col + 1}`}
          className={isObstacle ? styles.mapObstacleCell : styles.mapCell}
          key={key}
          onPointerDown={() => handleMapPointerDown(row, col)}
          onPointerEnter={() => handleMapPointerEnter(row, col)}
          type="button"
        />
      );
    }
  }

  return (
    <main className={styles.page}>
      {/* This is main canvas viewport */}
      <section className={styles.main}>
        <div className={styles.simPanel}>
          <div className={styles.viewport}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              aria-label="R1 car simulation"
            />
            <div ref={guiContainerRef} className={styles.guiMount} />
          </div>
        </div>
      </section>

      {/* This is the map editor dialog */}
      <dialog ref={mapEditorDialogRef} className={styles.mapEditorDialog}>
        <form method="dialog" className={styles.mapEditorContent}>
          <header className={styles.mapEditorHeader}>
            <div>
              <h2>Map editor</h2>
              <p>
                {MAP_METERS} m x {MAP_METERS} m, {MAP_CELLS} x {MAP_CELLS}
              </p>
            </div>
            <div className={styles.mapEditorToolbar}>
              <dl>
                <div>
                  <dt>Resolution</dt>
                  <dd>0.33 m</dd>
                </div>
                <div>
                  <dt>Obstacles</dt>
                  <dd>{mapObstacles.size}</dd>
                </div>
              </dl>
              <button
                className={styles.mapEditorButton}
                onClick={clearMapObstacles}
                type="button"
              >
                Clear
              </button>
              <button
                className={styles.primaryMapEditorButton}
                onClick={() => applyMapObstaclesToScene()}
                type="button"
              >
                Apply to 3D
              </button>
              <button
                className={styles.closeButton}
                type="submit"
                aria-label="Close map editor"
              >
                x
              </button>
            </div>
          </header>

          <div className={styles.mapViewport}>
            <div
              className={styles.mapGrid}
              style={{
                gridTemplateColumns: `repeat(${MAP_CELLS}, minmax(0, 1fr))`,
              }}
            >
              {mapCells}
            </div>
          </div>
        </form>
      </dialog>
    </main>
  );
}

function mapCellKey(row: number, col: number) {
  return `${row}:${col}`;
}

function createDefaultMapObstacles() {
  const obstacles = new Set<string>();
  const start = Math.floor((MAP_CELLS - DEFAULT_MAP_OBSTACLE_SIDE_CELLS) / 2);
  const end = start + DEFAULT_MAP_OBSTACLE_SIDE_CELLS;

  for (let row = start; row < end; row += 1) {
    for (let col = start; col < end; col += 1) {
      if (row === start || row === end - 1 || col === start || col === end - 1) {
        obstacles.add(mapCellKey(row, col));
      }
    }
  }

  return obstacles;
}

function mapObstacleSetToCells(obstacles: Set<string>): MapEditorCell[] {
  return Array.from(obstacles, (key) => {
    const [row, col] = key.split(":").map((part) => Number.parseInt(part, 10));
    return { row, col };
  });
}
