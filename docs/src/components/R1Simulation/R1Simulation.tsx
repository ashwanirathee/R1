import React, { useEffect, useRef, type ReactNode } from "react";

import { CAR_GLB_URL } from "./constants";
import { createMujocoSimulation } from "./mujocoRuntime";
import { renderCarScene } from "./renderCarScene";
import styles from "./R1Simulation.module.css";
import type { GuiInstance, MujocoSimulation, ThreeSceneHandle } from "./types";

export function R1Simulation(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const guiContainerRef = useRef<HTMLDivElement | null>(null);
  const guiRef = useRef<GuiInstance | null>(null);
  const loadingRef = useRef(false);
  const disposedRef = useRef(false);
  const mujocoRef = useRef<MujocoSimulation | null>(null);
  const sceneHandleRef = useRef<ThreeSceneHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    disposedRef.current = false;

    async function setupGui() {
      const { default: GUI } = await import("lil-gui");
      if (cancelled || !guiContainerRef.current || guiRef.current) return;

      guiContainerRef.current.replaceChildren();
      guiRef.current = new GUI({
        container: guiContainerRef.current,
        title: "Simulation Controls",
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
        CAR_GLB_URL,
        canvasRef.current,
        guiRef.current,
        pendingMujoco
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
      pendingSceneHandle = null;
      pendingMujoco = null;
    } catch (error) {
      pendingSceneHandle?.dispose();
      pendingMujoco?.dispose();
      mujocoRef.current?.dispose();
      mujocoRef.current = null;
      console.error("Failed to load MuJoCo:", error);
    } finally {
      loadingRef.current = false;
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.main}>
        <div className={styles.simPanel}>
          <div className={styles.viewport}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              aria-label="Three.js rendering of sam_model2.glb"
            />
            <div ref={guiContainerRef} className={styles.guiMount} />
          </div>
        </div>
      </section>
    </main>
  );
}
