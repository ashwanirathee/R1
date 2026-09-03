import React, { useEffect, useRef, type ReactNode } from "react";

import { CAR_GLB_URLS } from "./constants";
import { createMujocoSimulation } from "./mujocoRuntime";
import { renderCarScene } from "./renderCarScene";
import styles from "./R1Simulation.module.css";
import type { GuiInstance, MujocoSimulation, ThreeSceneHandle } from "./types";

// Mounts the simulation canvas, control panel, MuJoCo runtime, and Three.js scene.
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

    // Lazily creates lil-gui only in the browser, then starts the simulation.
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

  // Loads MuJoCo first, then builds the Three.js scene against that runtime.
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
              aria-label="Three.js rendering of moon surface rover simulation with Earth in the sky"
            />
            <iframe
              className={styles.spotifyEmbed}
              data-testid="embed-iframe"
              title="Spotify track player"
              src="https://open.spotify.com/embed/track/0rPImnH72wOroTMvIedDC3?utm_source=generator&theme=0&si=6698aaeca21a4d3d"
              width="100%"
              height="152"
              frameBorder="0"
              allowFullScreen
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
            <div ref={guiContainerRef} className={styles.guiMount} />
          </div>
        </div>
      </section>
    </main>
  );
}
