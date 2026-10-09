import type { Frame, LapRest } from "./metrics";

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Measures that are not angles, in their own units per degree (the carry across the body is in shoulder widths). */
const UNIT_PER_DEGREE: Record<string, number> = { carry_across: 0.03 };
export const metricUnit = (metric: string) => UNIT_PER_DEGREE[metric] ?? 1;
/** How a measure's value is read out (angles are in degrees): the pinch's closure is a percentage (pinch-target.ts). */
const UNIT_NAME: Record<string, string> = { carry_across: "shoulder widths", pinch_index: "percent", pinch_middle: "percent" };
export const metricUnitName = (metric: string) => UNIT_NAME[metric] ?? "degrees";

/** A camera-projected angle may decrease during a reach; use the learned direction. unit: metricUnit(metric). */
export function reachAngleProgress(value: number | undefined, target: number, start: number, unit = 1): number {
  if (value === undefined || !Number.isFinite(value) || !Number.isFinite(target) || !Number.isFinite(start)) return 0;
  const range = target - start;
  // With no resolvable angular excursion, reproducing the target estimate is sufficient.
  if (Math.abs(range) < unit) return Math.abs(value - target) <= 3 * unit ? 1 : 0;
  return Math.max(0, (value - start) / range);
}

/** Only the active practice-target hold contributes; lap/approach/voice frames are excluded. */
export class ReachTargetCalibration {
  private samples: Frame["values"][] = [];
  constructor(private readonly metrics = ["shoulder_flexion", "elbow_extension"]) {}

  reset() { this.samples = []; }

  observe(frame: Frame) {
    if (this.metrics.map(metric => frame.values[metric]).every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 180)) {
      this.samples.push({ ...frame.values });
    }
  }

  capture(): Record<string, number> | null {
    if (this.samples.length < 5) return null;
    return Object.fromEntries(this.metrics.map(metric => [metric, median(this.samples.map(sample => sample[metric]!))]));
  }
}

/** Learn only a sustained lap-rest cluster; brief landmark outliers cannot shift the baseline. */
export class ReachRestCalibration {
  private frames: Frame[] = [];
  /**
   * drift: how far the resting point may wander, as a share of its body scale (a palm length is far smaller than a
   * torso). tolerance: how far the first measure may stray from the median, degrees (others allow 12).
   */
  constructor(private readonly metrics = ["shoulder_flexion", "elbow_extension"], private readonly drift = 0.08, private readonly tolerance = 8) {}

  observe(frame: Frame, durationMs: number): { progress: number; ready: boolean; samples: Frame[]; lapRest?: LapRest } {
    this.frames.push(frame);
    this.frames = this.frames.filter(sample => sample.t >= frame.t - durationMs - 200);
    const candidates = this.frames.filter(sample => sample.visible && sample.lapRest && this.metrics.every(metric => Number.isFinite(sample.values[metric])));
    if (!candidates.length) return { progress: 0, ready: false, samples: [] };
    const lapRest = {
      x: median(candidates.map(sample => sample.lapRest!.x)),
      y: median(candidates.map(sample => sample.lapRest!.y)),
      bodyScale: median(candidates.map(sample => sample.lapRest!.bodyScale)),
    };
    const angles = this.metrics.map(metric => median(candidates.map(sample => sample.values[metric]!)));
    const samples = candidates.filter(sample => Math.hypot(sample.lapRest!.x - lapRest.x, sample.lapRest!.y - lapRest.y) <= lapRest.bodyScale * this.drift
      && this.metrics.every((metric, index) => Math.abs(sample.values[metric]! - angles[index]) <= (index === 0 ? this.tolerance : 12)));
    const fraction = samples.length / this.frames.length;
    const span = samples.length ? frame.t - samples[0].t : 0;
    const ready = samples.length >= 8 && samples.at(-1) === frame && fraction >= 0.8 && span >= durationMs;
    return { progress: Math.min(1, span / durationMs) * Math.min(1, fraction / 0.8), ready, samples, lapRest };
  }
}
