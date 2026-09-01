import * as THREE from "three";

import { DRIVE_AUDIO_URL } from "./constants";

type MotorAudioState = {
  volume: number;
  playbackRate: number;
};

// Creates mutable playback state for smoothing motor audio changes over time.
export function createMotorAudioState(): MotorAudioState {
  return {
    volume: 0,
    playbackRate: 0.9,
  };
}

// Loads the optional drive audio buffer and attaches it to the active listener.
export async function loadMotorSound(
  listener: THREE.AudioListener
): Promise<THREE.PositionalAudio | null> {
  const motorSound = new THREE.PositionalAudio(listener);
  motorSound.setLoop(true);
  motorSound.setRefDistance(10);
  motorSound.setRolloffFactor(0.15);
  motorSound.setVolume(0);

  try {
    const buffer = await new THREE.AudioLoader().loadAsync(DRIVE_AUDIO_URL);
    motorSound.setBuffer(buffer);
    return motorSound;
  } catch (error) {
    console.warn(`Failed to load ${DRIVE_AUDIO_URL}:`, error);
    return null;
  }
}

// Updates playback, pitch, and volume based on current wheel drive input.
export function updateMotorSound(
  motorSound: THREE.PositionalAudio | null,
  state: MotorAudioState,
  leftWheelInput: number,
  rightWheelInput: number,
  shouldPlay: boolean
) {
  if (!motorSound?.buffer) return;

  const wheelIntensity = shouldPlay
    ? THREE.MathUtils.clamp(
        Math.max(Math.abs(leftWheelInput), Math.abs(rightWheelInput)),
        0,
        1
      )
    : 0;
  const targetPlaybackRate = 1;
  const targetVolume = shouldPlay ? 0.22 + 0.38 * wheelIntensity : 0;

  state.playbackRate = THREE.MathUtils.lerp(
    state.playbackRate,
    targetPlaybackRate,
    0.18
  );
  state.volume = THREE.MathUtils.lerp(state.volume, targetVolume, 0.16);

  motorSound.setPlaybackRate(state.playbackRate);
  motorSound.setVolume(state.volume);

  if (!shouldPlay && state.volume < 0.01) {
    if (motorSound.isPlaying) motorSound.pause();
    return;
  }

  if (!motorSound.isPlaying) {
    if (motorSound.context.state === "suspended") {
      void motorSound.context.resume().catch(() => undefined);
    }
    motorSound.play();
  }
}
