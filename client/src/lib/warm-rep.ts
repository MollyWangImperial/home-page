// The daily warm-up ("warm rep"): two comfortable forward reaches that show Alira today's starting
// line before the movement check or an exercise. This file is the measurement only. It turns camera
// frames (already reduced to a few numbers by the exercise engine) into phases, short prompts and,
// at the end, a WarmRepRecord. It never scores or judges: a reach that is not held is recorded as
// null and the warm-up simply moves on.
//
// Pure: no DOM, no storage. Time comes from each frame's t, and the record's id, time and day come
// from the options, so tests are deterministic. Every number here is an engineering default that
// needs clinician review.

import type { GateKind, WarmRepReach, WarmRepRecord } from "@shared/alira-adaptation";

export type WarmRepSide = "left" | "right";

/** One camera frame as the warm-up sees it (built by the component from a pose detection). */
export type WarmRepFrame = {
  /** ms timestamp (performance.now() in the browser). */
  t: number;
  /** Everything the warm-up needs is in view (poseVisibility, upper body). */
  visible: boolean;
  /** What is missing, in the patient's words, when not visible. */
  missing?: string;
  /** The affected hand rests on the visible top of the thigh (reachLapRest). */
  lapReady: boolean;
  lapMissing?: string;
  /** Camera estimates in degrees for the affected side. */
  shoulderFlexion?: number;
  elbowExtension?: number;
  /** Normalised image y (0 top, 1 bottom) of the affected wrist and shoulder. */
  wristY?: number;
  shoulderY?: number;
  /** Compensation measures against the resting posture, once it is known. */
  trunkLeanDeg?: number;
  shoulderElevationPct?: number;
  faceApproachPct?: number;
};

export type WarmRepPhase = "position" | "rest" | "reach1" | "relax1" | "reach2" | "relax2" | "done";

/** The resting posture learned in the rest phase; from/to is the frame window it came from. */
export type WarmRepRest = {
  shoulderFlexion: number;
  elbowExtension: number;
  wristY: number | null;
  shoulderY: number | null;
  from: number;
  to: number;
};

export type WarmRepState = {
  phase: WarmRepPhase;
  /** Short, warm, plain English, for the caption and subtitles. */
  prompt: string;
  /** How far through the current hold, 0..1. */
  holdProgress: number;
  /** 0 before the first reach, then 1 or 2. */
  reachIndex: number;
  /** How far through settling at rest, 0..1 (1 once the resting posture is learned). */
  restProgress: number;
  /** True only on the push where a hold completes, so the camera view can take a still. */
  captureKeyFrame: boolean;
  rest: WarmRepRest | null;
  /** The reaches so far: null when a reach was not held within the time allowed. */
  reaches: (WarmRepReach | null)[];
  /** Set once the warm-up is done. */
  record: WarmRepRecord | null;
};

export type WarmRepOptions = {
  side: WarmRepSide;
  source: GateKind;
  /** Today's day key: learningToday() in the browser. */
  day: string;
  simulated?: boolean;
  /** ISO time for the record. */
  now?: () => string;
  /** Id for the record. */
  id?: () => string;
};

export const WARM_REP_TIMING = {
  /** Continuous time in view before settling starts. */
  positionMs: 1000,
  /** Continuous time resting on the lap, steady within the tolerance of the window median. */
  restMs: 1500,
  restToleranceDeg: 8,
  /** Shoulder movement from rest that counts as reaching. */
  movingDeg: 15,
  holdMs: 1500,
  holdToleranceDeg: 6,
  /** Time in view allowed for each reach before it is recorded as null. */
  reachTimeoutMs: 25_000,
  /** Relaxed once the movement falls below this share of the reach's movement... */
  relaxShare: 0.4,
  /** ...for this long, or after the timeout (time in view). */
  relaxMs: 800,
  relaxTimeoutMs: 8000,
  /** Gentle encouragement after this long in a reach without moving. */
  encourageMs: 12_000,
  minWindowFrames: 5,
  /** A longer pause between frames breaks continuity and does not count as time. */
  gapMs: 700,
} as const;

/** Captions. Short, warm, never about passing or failing. */
export const WARM_REP_PROMPTS = {
  findYou: "Sit in front of the camera so I can see you.",
  stayThere: "That's it. Stay there a moment.",
  restHand: "Rest your hand on your lap, and sit tall.",
  settle: "Let your arm rest, nice and still.",
  still: "Nice and still. Just like that.",
  reachFirst: "Reach forward as far as feels comfortable.",
  reachAgain: "One more time. Reach forward and hold.",
  anyReach: "Reach as far as feels comfortable today. Any amount is fine.",
  hold: "Hold it there, nice and steady.",
  backInView: "Bring your arm back into view.",
  relaxHeld: "Lovely. Rest your hand back on your lap.",
  relaxFree: "That's fine. Rest your hand back on your lap.",
  done: "That's it. Thank you.",
} as const;

type Sample = {
  t: number;
  shoulder: number;
  elbow: number;
  wristY?: number;
  shoulderY?: number;
  trunk?: number;
  elevation?: number;
  face?: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianOrNull(values: (number | undefined)[]): number | null {
  const clean = values.filter(finite);
  return clean.length ? median(clean) : null;
}

/** A frame the warm-up can measure: in view, with both angles. */
function sampleOf(frame: WarmRepFrame, t: number): Sample | null {
  const shoulder = frame.shoulderFlexion;
  const elbow = frame.elbowExtension;
  if (!frame.visible || !finite(shoulder) || !finite(elbow)) return null;
  return {
    t, shoulder, elbow, wristY: frame.wristY, shoulderY: frame.shoulderY,
    trunk: frame.trunkLeanDeg, elevation: frame.shoulderElevationPct, face: frame.faceApproachPct,
  };
}

/** Whether every sample sits within the tolerance of the window's median shoulder angle, and when the steady tail began. */
function steadiness(window: Sample[], tolerance: number, t: number): { steady: boolean; since: number } {
  if (!window.length) return { steady: false, since: t };
  const centre = median(window.map(sample => sample.shoulder));
  let first = window.length;
  while (first > 0 && Math.abs(window[first - 1].shoulder - centre) <= tolerance) first -= 1;
  return { steady: first === 0, since: first < window.length ? window[first].t : t };
}

/** Highest movement-check reach target at or below the wrist height: 0 low (0.8), 1 middle (1.2), 2 high (1.6). */
export function suggestedRungFor(wristHeight: number | null | undefined): number | null {
  if (!finite(wristHeight)) return null;
  return wristHeight >= 1.6 ? 2 : wristHeight >= 1.2 ? 1 : 0;
}

/** Wrist height from the lap (0) to shoulder height (1), against the resting posture; null when the rest is too compressed to tell. */
export function wristHeightFrom(rest: { wristY: number | null; shoulderY: number | null }, wristY: number | null): number | null {
  if (wristY === null || rest.wristY === null || rest.shoulderY === null) return null;
  const span = rest.wristY - rest.shoulderY;
  if (!(span >= 0.05)) return null;
  return round((rest.wristY - wristY) / span, 2);
}

function reachFrom(window: Sample[], rest: WarmRepRest, heldMs: number): WarmRepReach {
  const angle = (values: number[]) => round(median(values), 1);
  const measure = (values: (number | undefined)[]) => {
    const value = medianOrNull(values);
    return value === null ? null : round(value, 1);
  };
  return {
    shoulderFlexion: angle(window.map(sample => sample.shoulder)),
    elbowExtension: angle(window.map(sample => sample.elbow)),
    wristHeight: wristHeightFrom(rest, medianOrNull(window.map(sample => sample.wristY))),
    trunkLeanDeg: measure(window.map(sample => sample.trunk)),
    shoulderElevationPct: measure(window.map(sample => sample.elevation)),
    faceApproachPct: measure(window.map(sample => sample.face)),
    heldMs: Math.round(heldMs),
  };
}

export type WarmRepRecordInput = {
  id: string;
  day: string;
  at: string;
  source: GateKind;
  side: WarmRepSide;
  simulated: boolean;
  rest: { shoulderFlexion: number; elbowExtension: number };
  reaches: (WarmRepReach | null)[];
};

/** The record: the best reach is the one with the larger shoulder movement from rest (the first on a tie). */
export function buildWarmRepRecord(input: WarmRepRecordInput): WarmRepRecord {
  const rest = { shoulderFlexion: round(input.rest.shoulderFlexion, 1), elbowExtension: round(input.rest.elbowExtension, 1) };
  let best: WarmRepReach | null = null;
  for (const reach of input.reaches) {
    if (reach && (best === null || reach.shoulderFlexion > best.shoulderFlexion)) best = reach;
  }
  return {
    id: input.id,
    day: input.day,
    at: input.at,
    source: input.source,
    side: input.side,
    simulated: input.simulated,
    rest,
    reaches: input.reaches.map(reach => (reach ? { ...reach } : null)),
    best: best ? { ...best } : null,
    bestExcursionDeg: best ? round(best.shoulderFlexion - rest.shoulderFlexion, 1) : null,
    suggestedReachRung: best ? suggestedRungFor(best.wristHeight) : null,
  };
}

const defaultNow = () => new Date().toISOString();
const defaultId = () => `warm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * The warm-up as a state machine: position (1 s in view) -> rest (1.5 s steady on the lap) -> reach1
 * -> relax1 -> reach2 -> relax2 -> done. Lost tracking pauses the timers and resets the hold.
 */
export class WarmRepTracker {
  private readonly options: WarmRepOptions;
  private phase: WarmRepPhase = "position";
  private prompt: string = WARM_REP_PROMPTS.findYou;
  private lastT: number | null = null;
  private lastUsable = false;
  /** Time with the patient in view in the current reach or relax phase. */
  private activeMs = 0;
  /** Start of the current continuous run: in view, resting, moving or relaxed, by phase. */
  private streakStart: number | null = null;
  private window: Sample[] = [];
  private holdProgress = 0;
  private restProgress = 0;
  private restValue: WarmRepRest | null = null;
  private reachList: (WarmRepReach | null)[] = [];
  private relaxBelow: number = WARM_REP_TIMING.movingDeg;
  private record: WarmRepRecord | null = null;
  private current: WarmRepState;

  constructor(options: WarmRepOptions) {
    this.options = { ...options };
    this.current = this.publish(false);
  }

  state(): WarmRepState {
    return this.current;
  }

  push(frame: WarmRepFrame): WarmRepState {
    if (this.phase === "done") return this.publish(false);
    const t = finite(frame.t) ? frame.t : (this.lastT ?? 0);
    const gap = this.lastT === null || t < this.lastT || t - this.lastT > WARM_REP_TIMING.gapMs;
    const sample = sampleOf(frame, t);
    // Timers only run between two measurable frames in a row, so lost tracking pauses them.
    const dt = !gap && sample && this.lastUsable && this.lastT !== null ? t - this.lastT : 0;
    this.lastT = t;
    this.lastUsable = sample !== null;
    if (gap) this.breakRun();
    let capture = false;
    switch (this.phase) {
      case "position": this.positionStep(frame, t); break;
      case "rest": this.restStep(frame, sample, t); break;
      case "reach1": case "reach2": capture = this.reachStep(frame, sample, t, dt); break;
      case "relax1": case "relax2": this.relaxStep(frame, sample, t, dt); break;
    }
    return this.publish(capture);
  }

  private get reachIndex(): number {
    if (this.phase === "reach1" || this.phase === "relax1") return 1;
    if (this.phase === "reach2" || this.phase === "relax2" || this.phase === "done") return 2;
    return 0;
  }

  private breakRun() {
    this.streakStart = null;
    this.window = [];
    this.holdProgress = 0;
    if (this.phase === "rest") this.restProgress = 0;
  }

  private enter(phase: WarmRepPhase) {
    this.phase = phase;
    this.activeMs = 0;
    this.streakStart = null;
    this.window = [];
    this.holdProgress = 0;
    const held = this.reachList[this.reachList.length - 1] !== null;
    switch (phase) {
      case "rest": this.prompt = WARM_REP_PROMPTS.restHand; break;
      case "reach1": this.prompt = WARM_REP_PROMPTS.reachFirst; break;
      case "reach2": this.prompt = WARM_REP_PROMPTS.reachAgain; break;
      case "relax1": case "relax2": this.prompt = held ? WARM_REP_PROMPTS.relaxHeld : WARM_REP_PROMPTS.relaxFree; break;
      case "done": this.finish(); break;
      default: break;
    }
  }

  private positionStep(frame: WarmRepFrame, t: number) {
    if (!frame.visible) {
      this.streakStart = null;
      this.prompt = frame.missing || WARM_REP_PROMPTS.findYou;
      return;
    }
    if (this.streakStart === null) this.streakStart = t;
    this.prompt = WARM_REP_PROMPTS.stayThere;
    if (t - this.streakStart >= WARM_REP_TIMING.positionMs) this.enter("rest");
  }

  private restStep(frame: WarmRepFrame, sample: Sample | null, t: number) {
    if (!sample || !frame.lapReady) {
      this.breakRun();
      this.prompt = !frame.visible ? frame.missing || WARM_REP_PROMPTS.findYou : frame.lapMissing || WARM_REP_PROMPTS.restHand;
      return;
    }
    if (this.streakStart === null) this.streakStart = t;
    this.window = this.window.filter(item => item.t >= t - WARM_REP_TIMING.restMs);
    this.window.push(sample);
    const { steady, since } = steadiness(this.window, WARM_REP_TIMING.restToleranceDeg, t);
    if (steady && t - this.streakStart >= WARM_REP_TIMING.restMs && this.window.length >= WARM_REP_TIMING.minWindowFrames) {
      const window = this.window;
      this.restValue = {
        shoulderFlexion: median(window.map(item => item.shoulder)),
        elbowExtension: median(window.map(item => item.elbow)),
        wristY: medianOrNull(window.map(item => item.wristY)),
        shoulderY: medianOrNull(window.map(item => item.shoulderY)),
        from: window[0].t,
        to: t,
      };
      this.restProgress = 1;
      this.enter("reach1");
      return;
    }
    this.restProgress = clamp01((t - (steady ? this.streakStart : since)) / WARM_REP_TIMING.restMs);
    this.prompt = steady ? WARM_REP_PROMPTS.still : WARM_REP_PROMPTS.settle;
  }

  /** Returns true when a hold completes on this frame. */
  private reachStep(frame: WarmRepFrame, sample: Sample | null, t: number, dt: number): boolean {
    const rest = this.restValue as WarmRepRest;
    const relax: WarmRepPhase = this.phase === "reach1" ? "relax1" : "relax2";
    this.activeMs += dt;
    if (!sample) {
      this.breakRun();
      this.prompt = frame.missing || WARM_REP_PROMPTS.backInView;
    } else if (sample.shoulder - rest.shoulderFlexion < WARM_REP_TIMING.movingDeg) {
      this.breakRun();
      this.prompt = this.activeMs >= WARM_REP_TIMING.encourageMs ? WARM_REP_PROMPTS.anyReach
        : this.phase === "reach1" ? WARM_REP_PROMPTS.reachFirst : WARM_REP_PROMPTS.reachAgain;
    } else {
      if (this.streakStart === null) this.streakStart = t;
      this.window = this.window.filter(item => item.t >= t - WARM_REP_TIMING.holdMs);
      this.window.push(sample);
      const { steady, since } = steadiness(this.window, WARM_REP_TIMING.holdToleranceDeg, t);
      if (steady && t - this.streakStart >= WARM_REP_TIMING.holdMs && this.window.length >= WARM_REP_TIMING.minWindowFrames) {
        const reach = reachFrom(this.window, rest, t - this.streakStart);
        this.reachList.push(reach);
        this.relaxBelow = WARM_REP_TIMING.relaxShare * (reach.shoulderFlexion - rest.shoulderFlexion);
        this.enter(relax);
        return true;
      }
      this.holdProgress = clamp01((t - (steady ? this.streakStart : since)) / WARM_REP_TIMING.holdMs);
      this.prompt = WARM_REP_PROMPTS.hold;
    }
    if (this.activeMs >= WARM_REP_TIMING.reachTimeoutMs) {
      // Not a failure: this reach is simply not recorded, and the warm-up moves on.
      this.reachList.push(null);
      this.relaxBelow = WARM_REP_TIMING.movingDeg;
      this.enter(relax);
    }
    return false;
  }

  private relaxStep(frame: WarmRepFrame, sample: Sample | null, t: number, dt: number) {
    const rest = this.restValue as WarmRepRest;
    const next: WarmRepPhase = this.phase === "relax1" ? "reach2" : "done";
    this.activeMs += dt;
    if (!sample) {
      this.streakStart = null;
      this.prompt = frame.missing || WARM_REP_PROMPTS.backInView;
    } else if (sample.shoulder - rest.shoulderFlexion < this.relaxBelow) {
      if (this.streakStart === null) this.streakStart = t;
      if (t - this.streakStart >= WARM_REP_TIMING.relaxMs) {
        this.enter(next);
        return;
      }
    } else this.streakStart = null;
    if (sample) this.prompt = this.reachList[this.reachList.length - 1] !== null ? WARM_REP_PROMPTS.relaxHeld : WARM_REP_PROMPTS.relaxFree;
    if (this.activeMs >= WARM_REP_TIMING.relaxTimeoutMs) this.enter(next);
  }

  private finish() {
    const rest = this.restValue as WarmRepRest;
    this.prompt = WARM_REP_PROMPTS.done;
    this.record = buildWarmRepRecord({
      id: (this.options.id ?? defaultId)(),
      day: this.options.day,
      at: (this.options.now ?? defaultNow)(),
      source: this.options.source,
      side: this.options.side,
      simulated: this.options.simulated === true,
      rest: { shoulderFlexion: rest.shoulderFlexion, elbowExtension: rest.elbowExtension },
      reaches: this.reachList,
    });
  }

  private publish(captureKeyFrame: boolean): WarmRepState {
    this.current = {
      phase: this.phase,
      prompt: this.prompt,
      holdProgress: this.holdProgress,
      reachIndex: this.reachIndex,
      restProgress: this.restProgress,
      captureKeyFrame,
      rest: this.restValue ? { ...this.restValue } : null,
      reaches: this.reachList.map(reach => (reach ? { ...reach } : null)),
      record: this.record,
    };
    return this.current;
  }
}

const GATE_KINDS: readonly GateKind[] = ["survey_end", "pre_assessment", "pre_exercise"];

/** A same-site path to go to next; anything else (another site, a protocol-relative or odd path) falls back. */
export function safeNextPath(value: string | null | undefined, fallback = "/alira"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

/**
 * The warm-up page's query: which gate offered it (survey_end unless one of the three), where to go
 * after, and the way back to Alira (still in onboarding when the next page is).
 */
export function warmUpRoute(search: string): { gate: GateKind; next: string; back: string } {
  const query = new URLSearchParams(search);
  const gate = query.get("gate");
  const requestedNext = safeNextPath(query.get("next"));
  const nextQuery = requestedNext.indexOf("?") >= 0 ? requestedNext.slice(requestedNext.indexOf("?") + 1).split("#")[0] : "";
  const back = new URLSearchParams(nextQuery).get("onboarding") === "1" ? "/alira?onboarding=1" : "/alira";
  // Old warm-up links also return to Alira; starting the assessment always needs the patient's choice.
  const next = requestedNext.split(/[?#]/)[0] === "/assessment"
    ? `${back}${back.includes("?") ? "&" : "?"}from=warm-up`
    : requestedNext;
  return {
    gate: GATE_KINDS.indexOf(gate as GateKind) >= 0 ? (gate as GateKind) : "survey_end",
    next,
    back,
  };
}

/** A plausible warm-up without a camera, for testing. Marked simulated so nothing mistakes it for a measurement. */
export function simulatedWarmRep(options: Omit<WarmRepOptions, "simulated">): WarmRepRecord {
  const reaches: WarmRepReach[] = [
    { shoulderFlexion: 66, elbowExtension: 158, wristHeight: 1.08, trunkLeanDeg: 4.5, shoulderElevationPct: 7, faceApproachPct: 3, heldMs: 1500 },
    { shoulderFlexion: 74, elbowExtension: 161, wristHeight: 1.26, trunkLeanDeg: 5.2, shoulderElevationPct: 8, faceApproachPct: 4, heldMs: 1620 },
  ];
  return buildWarmRepRecord({
    id: (options.id ?? defaultId)(),
    day: options.day,
    at: (options.now ?? defaultNow)(),
    source: options.source,
    side: options.side,
    simulated: true,
    rest: { shoulderFlexion: 14, elbowExtension: 152 },
    reaches,
  });
}
