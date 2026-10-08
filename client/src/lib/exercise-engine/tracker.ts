// Camera + MediaPipe wrapper. The MediaPipe bundle, wasm and models are served from
// /vendor/mediapipe (copied from the Rehyn app), so nothing loads from a CDN.

import type { Tracking } from "./config";
import type { HandInput, PoseInput } from "./metrics";

const BASE = "/vendor/mediapipe";

type Landmarker = { detectForVideo(video: HTMLVideoElement, ts: number): any; close(): void };

export type Detection = { pose: PoseInput | null; hands: HandInput[] };

export type Tracker = {
  detect(video: HTMLVideoElement, ts: number): Detection;
  close(): void;
};

export type TrackerOptions = {
  /** Run the body model only on every Nth frame and reuse its last result in between (posture changes slowly). */
  poseEvery?: number;
  /** Run the hand model on the graphics processor when the browser allows it (falls back to the processor). */
  handGpu?: boolean;
};

export async function createTracker(tracking: Tracking, options: TrackerOptions = {}): Promise<Tracker> {
  const vision: any = await import(/* @vite-ignore */ `${BASE}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  let pose: Landmarker | null = null;
  let hand: Landmarker | null = null;
  if (tracking !== "hand") {
    pose = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${BASE}/models/pose_landmarker_lite.task` },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  }
  if (tracking !== "pose") {
    const handOptions = (delegate?: "GPU") => ({
      baseOptions: { modelAssetPath: `${BASE}/models/hand_landmarker.task`, ...(delegate ? { delegate } : {}) },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    try {
      hand = await vision.HandLandmarker.createFromOptions(fileset, handOptions(options.handGpu ? "GPU" : undefined));
    } catch (error) {
      if (!options.handGpu) throw error;
      hand = await vision.HandLandmarker.createFromOptions(fileset, handOptions());
    }
  }
  const poseEvery = Math.max(1, Math.round(options.poseEvery ?? 1));
  let frame = 0;
  let lastPose: PoseInput | null = null;
  return {
    detect(video, ts) {
      let poseOut: PoseInput | null = null;
      const hands: HandInput[] = [];
      if (pose) {
        if (frame++ % poseEvery === 0) {
          const result = pose.detectForVideo(video, ts);
          lastPose = result.landmarks?.[0] && result.worldLandmarks?.[0] ? { landmarks: result.landmarks[0], world: result.worldLandmarks[0] } : null;
        }
        poseOut = lastPose;
      }
      if (hand) {
        const result = hand.detectForVideo(video, ts);
        (result.landmarks ?? []).forEach((landmarks: any, i: number) => {
          if (result.worldLandmarks?.[i]) hands.push({ landmarks, world: result.worldLandmarks[i] });
        });
      }
      return { pose: poseOut, hands };
    },
    close() {
      pose?.close();
      hand?.close();
    },
  };
}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

/** Of the hands in view, the one the exercise should use: nearest the affected wrist, else the largest. */
export function chooseHand(hands: HandInput[], wrist?: { x: number; y: number }): HandInput | null {
  if (!hands.length) return null;
  if (wrist) {
    return hands.reduce((best, h) => (Math.hypot(h.landmarks[0].x - wrist.x, h.landmarks[0].y - wrist.y) < Math.hypot(best.landmarks[0].x - wrist.x, best.landmarks[0].y - wrist.y) ? h : best));
  }
  const span = (h: HandInput) => Math.hypot(h.landmarks[0].x - h.landmarks[9].x, h.landmarks[0].y - h.landmarks[9].y);
  return hands.reduce((best, h) => (span(h) > span(best) ? h : best));
}
