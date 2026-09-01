import React, { useEffect, useRef, type ReactNode } from "react";

import { CAR_GLB_URL } from "./constants";
import { loadMujocoCar } from "./mujocoRuntime";
import { renderCarScene } from "./renderCarScene";
import styles from "./R1Simulation.module.css";
import type { GuiInstance, ThreeSceneHandle } from "./types";

export function R1Simulation(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const guiContainerRef = useRef<HTMLDivElement | null>(null);
  const guiRef = useRef<GuiInstance | null>(null);
  const loadingRef = useRef(false);
  const sceneHandleRef = useRef<ThreeSceneHandle | null>(null);

  useEffect(() => {
    let cancelled = false;

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
      sceneHandleRef.current?.dispose();
      sceneHandleRef.current = null;
      guiRef.current?.destroy();
      guiRef.current = null;
    };
  }, []);

  async function loadSimulation() {
    if (loadingRef.current || sceneHandleRef.current) return;

    loadingRef.current = true;

    try {
      await loadMujocoCar();
      sceneHandleRef.current = await renderCarScene(
        CAR_GLB_URL,
        canvasRef.current,
        guiRef.current
      );
    } catch (error) {
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
