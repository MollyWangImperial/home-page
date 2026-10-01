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

export async function createTracker(tracking: Tracking): Promise<Tracker> {
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
    hand = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${BASE}/models/hand_landmarker.task` },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
  }
  return {
    detect(video, ts) {
      let poseOut: PoseInput | null = null;
      const hands: HandInput[] = [];
      if (pose) {
        const result = pose.detectForVideo(video, ts);
        if (result.landmarks?.[0] && result.worldLandmarks?.[0]) poseOut = { landmarks: result.landmarks[0], world: result.worldLandmarks[0] };
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
