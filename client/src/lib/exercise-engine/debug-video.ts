import type { Compensation } from "./config";
import type { Frame } from "./metrics";
import type { RepResult, Snapshot } from "./session";

const API = "/api/exercise-debug";
export type DebugVideoSession = { id: string; directory: string; simulated: boolean; exerciseId: string };
export type DebugClip = { name: string; label: string; url: string; bytes: number; complete: boolean };
type Sample = { ms: number; values: Frame["values"]; compensations: Frame["comps"]; visible: boolean; targetContact?: boolean; targetArmed: boolean; holdProgress: number };

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Local debug recording failed.");
  return data;
}
export async function beginDebugVideos(exerciseId: string, simulated: boolean): Promise<DebugVideoSession> {
  return { ...await request(`${API}/begin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exerciseId, simulated }) }), exerciseId };
}

/** Composite the local camera/ghost and target overlay. No microphone or audio track is recorded. */
export class DebugVideoRecorder {
  private canvas = document.createElement("canvas");
  private segment: { key: string; stop: (result?: RepResult, complete?: boolean) => void; sample: (snapshot: Snapshot, frame: Frame) => void } | null = null;
  private pending: Promise<void>[] = [];
  private practice = 0;
  private unsupported = false;

  constructor(private session: DebugVideoSession, private rules: Compensation[], private baseline: () => Frame["geo"] | null, private onClip: (clip: DebugClip) => void, private onError: (message: string) => void) {}

  capture(source: HTMLVideoElement | HTMLCanvasElement | null, overlay: HTMLCanvasElement | null, snapshot: Snapshot, frame: Frame) {
    const key = (snapshot.phase === "warm" || snapshot.phase === "reps") && !snapshot.review ? `${snapshot.phase}:${snapshot.repIndex}` : null;
    if (this.segment?.key !== key) {
      const oldIndex = this.segment ? Number(this.segment.key.split(":")[1]) : undefined;
      const result = snapshot.reps.find(rep => rep.index === oldIndex);
      this.segment?.stop(result, Boolean(result) || (this.segment.key.startsWith("warm:") && snapshot.phase === "reps"));
      this.segment = null;
      if (key && source && !this.unsupported) this.start(key, source, snapshot, frame.t);
    }
    if (!this.segment || !source) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    if (source instanceof HTMLVideoElement) { ctx.translate(this.canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    if (overlay) ctx.drawImage(overlay, 0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "rgba(0,0,0,.72)";
    ctx.fillRect(0, this.canvas.height - 86, this.canvas.width, 86);
    ctx.fillStyle = "#fff";
    ctx.font = "15px sans-serif";
    const measured = (value: number | undefined, unit: string) => value === undefined ? "unknown" : `${value.toFixed(1)}${unit}`;
    ctx.fillText(`${this.session.simulated ? "SIMULATED · " : ""}${snapshot.phase === "warm" ? "Practice" : `Repetition ${snapshot.repIndex}`} · ${snapshot.caption} · hold ${Math.round(snapshot.holdProgress * 100)}%`, 14, this.canvas.height - 63);
    if (this.session.exerciseId === "ex_h2m") {
      // Head lean is in % of shoulder width (down and toward the camera, beyond any trunk lean).
      ctx.fillText(`Shoulder lift ${measured(frame.values.shoulder_flexion, "°")} · Elbow bend ${measured(frame.values.elbow_flexion, "°")} · Head forward ${measured(frame.comps.head_forward_pct, "%")} (down ${measured(frame.comps.head_drop_pct, "%")}, closer ${measured(frame.comps.head_approach_pct, "%")})`, 14, this.canvas.height - 39);
      ctx.fillText(`Trunk forward ${measured(frame.comps.trunk_approach_pct, "%")} · Shoulder hike ${measured(frame.comps.shoulder_hike_rel_delta, "°")} (tilt ${measured(frame.comps.shoulder_hike_delta, "°")}) · Hand ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    } else if (this.session.exerciseId === "ex_grasp") {
      // Carry is the hand's travel across the body in shoulder widths; openness in palm lengths (grasp-target.ts).
      const fixed = (value: number | undefined) => (value === undefined ? "unknown" : value.toFixed(2));
      ctx.fillText(`Elbow ${measured(frame.values.elbow_extension, "°")} · Reach ${measured(frame.values.shoulder_flexion, "°")} · Openness ${fixed(frame.values.hand_openness)} · Carry ${fixed(frame.values.carry_across)} · Lean ${measured(frame.comps.trunk_approach_pct, "%")} · Side ${measured(frame.comps.trunk_side_lean_delta, "°")}`, 14, this.canvas.height - 39);
      ctx.fillText(`Shoulder hike ${measured(frame.comps.shoulder_hike_rel_delta, "°")} · Elbow out ${measured(frame.comps.elbow_out_deg, "°")} · Wrist ${measured(frame.comps.wrist_bend_deg, "°")} · Cup tilt ${measured(frame.comps.cup_tilt_deg, "°")} · Hand ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    } else if (this.session.exerciseId === "ex_lower_selective") {
      // The knee's 3D angle; the lean, thigh and other-leg checks in % of the set-up posture (knee-target.ts).
      ctx.fillText(`Knee ${measured(frame.values.knee_extension, "°")} · Lean forward ${measured(frame.comps.trunk_approach_pct, "%")} · Lean back ${measured(frame.comps.trunk_retreat_pct, "%")} · Side ${measured(frame.comps.trunk_side_lean_delta, "°")}`, 14, this.canvas.height - 39);
      ctx.fillText(`Hip lift ${measured(frame.comps.hip_hike_delta, "°")} · Thigh lift ${measured(frame.comps.thigh_lift_pct, "%")} · Other leg ${measured(frame.comps.other_leg_pct, "%")} (knee ${measured(frame.comps.other_knee_delta, "°")}) · Foot ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    } else if (this.session.exerciseId === "ex_wallslide") {
      // How far the hand has moved out (shoulder widths, in the picture) and the shoulder's elevation (3D); the hand
      // checks in % of the shoulder span or of their limit (slide-target.ts).
      ctx.fillText(`Out ${frame.values.slide_out === undefined ? "unknown" : frame.values.slide_out.toFixed(2)} · Shoulder ${measured(frame.values.shoulder_flexion, "°")} · Lean forward ${measured(frame.comps.trunk_approach_pct, "%")} · Side ${measured(frame.comps.trunk_side_lean_delta, "°")}`, 14, this.canvas.height - 39);
      ctx.fillText(`Shoulder hike ${measured(frame.comps.shoulder_hike_rel_delta, "°")} (ear gap ${measured(frame.comps.shoulder_elevation_pct, "%")}) · Hand lift ${measured(frame.comps.hand_lift_pct, "%")} · Other hand ${measured(frame.comps.other_hand_pct, "%")} · Hand ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    } else if (this.session.exerciseId === "ex_pinch") {
      // Closure: how far the thumb has closed on each fingertip, 0-100 (75 touching); curl in hundredths of a palm length (pinch-target.ts).
      ctx.fillText(`Thumb to first ${measured(frame.values.pinch_index, "")} · to middle ${measured(frame.values.pinch_middle, "")} · Wrist bend ${measured(frame.comps.wrist_flexion_deg, "°")} · Palm turn ${measured(frame.comps.forearm_turn_deg, "°")} · Fingers curl ${measured(frame.comps.mass_flexion_pct, "")}`, 14, this.canvas.height - 39);
      ctx.fillText(`Trunk forward ${measured(frame.comps.trunk_approach_pct, "%")} · Shoulder hike ${measured(frame.comps.shoulder_hike_rel_delta, "°")} · Other hand ${measured(frame.comps.other_hand_near, "×")} · Pinch ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    } else if (this.session.exerciseId === "ex_handopen") {
      // Openness is the fingertips' mean distance from the palm's centre, in palm lengths (hand-target.ts).
      ctx.fillText(`Finger straightness ${measured(frame.values.finger_extension, "°")} · Openness ${frame.values.hand_openness === undefined ? "unknown" : frame.values.hand_openness.toFixed(2)} · Wrist bend ${measured(frame.comps.wrist_flexion_deg, "°")} · Palm turn ${measured(frame.comps.forearm_turn_deg, "°")}`, 14, this.canvas.height - 39);
      ctx.fillText(`Trunk forward ${measured(frame.comps.trunk_approach_pct, "%")} · Shoulder hike ${measured(frame.comps.shoulder_hike_rel_delta, "°")} · Fingers ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    } else {
      ctx.fillText(`Shoulder ${measured(frame.values.shoulder_flexion, "°")} · Elbow ${measured(frame.values.elbow_extension, "°")} · Face ${measured(frame.comps.face_approach_pct, "%")} · Shoulder width ${measured(frame.comps.shoulder_approach_pct, "%")}`, 14, this.canvas.height - 39);
      ctx.fillText(`Shoulder tilt ${measured(frame.comps.shoulder_hike_delta, "°")} · Shoulder-to-ear reduction ${measured(frame.comps.shoulder_elevation_pct, "%")} · Hand ${frame.targetContact ? "on target" : "off target"}`, 14, this.canvas.height - 15);
    }
    this.segment.sample(snapshot, frame);
  }

  private start(key: string, source: HTMLVideoElement | HTMLCanvasElement, snapshot: Snapshot, startedAt: number) {
    try {
      if (typeof MediaRecorder === "undefined" || typeof this.canvas.captureStream !== "function") throw new Error("This browser cannot record debug video.");
      const mimeType = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("No supported video recording format is available.");
      this.canvas.width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
      this.canvas.height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
      const stream = this.canvas.captureStream(20);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
      const chunks: Blob[] = [];
      const samples: Sample[] = [];
      let lastSample = -Infinity;
      let result: RepResult | undefined;
      let complete = false;
      let durationMs = 0;
      const practice = snapshot.phase === "warm";
      const number = practice ? ++this.practice : snapshot.repIndex;
      const name = `${practice ? "practice" : "rep"}-${number}.${mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`;
      const label = practice ? `Practice ${number}` : `Repetition ${number}`;
      const baseline = this.baseline();
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const saved = new Promise<void>(resolve => {
        const report = (message: string) => { this.onError(message); resolve(); };
        recorder.onerror = () => { report(`Could not record ${label.toLowerCase()}.`); };
        recorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) { report(`No video frames were recorded for ${label.toLowerCase()}.`); return; }
          const url = `${API}/${this.session.id}/clips/${name}`;
          void (async () => {
            const uploaded = await request(url, { method: "POST", headers: { "Content-Type": mimeType }, body: blob });
            await request(`${url}/metadata`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, simulated: this.session.simulated, rung: snapshot.rung, durationMs, complete, result, baseline, thresholds: this.rules, samples }) });
            this.onClip({ name, label, url, bytes: uploaded.bytes, complete });
            resolve();
          })().catch(error => report(error instanceof Error ? error.message : "Could not save debug video."));
        };
      });
      this.pending.push(saved);
      recorder.start(250);
      this.segment = {
        key,
        stop: (completed, finished = false) => { result = completed; complete = finished; if (recorder.state !== "inactive") recorder.stop(); },
        sample: (next, frame) => {
          durationMs = Math.max(0, frame.t - startedAt);
          if (frame.t - lastSample >= 100) {
            lastSample = frame.t;
            samples.push({ ms: durationMs, values: { ...frame.values }, compensations: { ...frame.comps }, visible: frame.visible, targetContact: frame.targetContact, targetArmed: next.targetArmed, holdProgress: next.holdProgress });
          }
        },
      };
    } catch (error) {
      this.unsupported = true;
      this.onError(error instanceof Error ? error.message : "Debug video recording failed.");
    }
  }

  async finish() {
    this.segment?.stop();
    this.segment = null;
    await Promise.all(this.pending);
  }
}
