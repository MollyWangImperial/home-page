import { judgeContrast, type Contrast, type ContrastRegions } from "./contrast";
import type { PoseInput } from "./metrics";

// Lighting check for set-up: a small grey copy of the camera frame, its brightness overall and on the face (from
// the pose's face points), so the patient can fix the light before tracking suffers. Luma is 0-255. The same copy
// also tells whether the tracked part of the body stands out from the background (contrast.ts).

export type LightingIssue = "dark" | "bright" | "backlit" | "flat";
export type Lighting = { ok: boolean; issue?: LightingIssue; hint?: string; mean: number; faceMean?: number };

/** Below this the picture is too dark for the hand and face points to stay steady. */
const DARK_MEAN = 55, DARK_FACE = 50;
/** Above this, or this share of clipped pixels, it is washed out. */
const BRIGHT_MEAN = 215, CLIPPED_SHARE = 0.3;
/** A face this much darker than a bright background is lit from behind. */
const BACKLIT_RATIO = 0.6, BACKLIT_BRIGHT_SHARE = 0.2;
/** Too little contrast to tell a hand from what is behind it. */
const FLAT_SPREAD = 18;

export const LIGHTING_HINTS: Record<LightingIssue, string> = {
  dark: "It's a little dark. Turn on a light in front of you.",
  bright: "The picture is too bright. Move out of direct sunlight.",
  backlit: "There's bright light behind you. Turn so the light is in front of you, or close the curtain behind you.",
  flat: "The picture is washed out. Add some light in front of you.",
};

/** The face's box in normalized image coordinates, from the nose, eyes and ears. */
export function faceBox(pose: PoseInput | null): { x0: number; y0: number; x1: number; y1: number } | null {
  const points = [0, 2, 5, 7, 8].map(index => pose?.landmarks[index]).filter(p => p && (p.visibility ?? 1) >= 0.5) as { x: number; y: number }[];
  if (points.length < 3) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  return { x0: Math.min(...xs) - 0.15 * w, x1: Math.max(...xs) + 0.15 * w, y0: Math.min(...ys) - 0.5 * w, y1: Math.max(...ys) + 0.6 * w };
}

/** Judge the lighting of one small RGBA frame (and the face's box in it, when known). */
export function judgeLighting(pixels: Uint8ClampedArray, width: number, height: number, face: { x0: number; y0: number; x1: number; y1: number } | null): Lighting {
  let sum = 0, sumSq = 0, clipped = 0, n = 0, faceSum = 0, faceN = 0, bgSum = 0, bgN = 0, bgBright = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sum += luma; sumSq += luma * luma; n++;
      if (luma >= 250) clipped++;
      const u = (x + 0.5) / width, v = (y + 0.5) / height;
      if (face && u >= face.x0 && u <= face.x1 && v >= face.y0 && v <= face.y1) { faceSum += luma; faceN++; }
      else { bgSum += luma; bgN++; if (luma >= 200) bgBright++; }
    }
  }
  const mean = n ? sum / n : 0;
  const spread = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
  const faceMean = faceN >= 4 ? faceSum / faceN : undefined;
  const bgMean = bgN ? bgSum / bgN : mean;
  const result = (issue?: LightingIssue): Lighting => ({ ok: !issue, issue, hint: issue ? LIGHTING_HINTS[issue] : undefined, mean, faceMean });
  if (faceMean !== undefined && faceMean < BACKLIT_RATIO * bgMean && bgN && bgBright / bgN >= BACKLIT_BRIGHT_SHARE) return result("backlit");
  if (mean < DARK_MEAN || (faceMean !== undefined && faceMean < DARK_FACE)) return result("dark");
  if (mean > BRIGHT_MEAN || clipped / Math.max(1, n) >= CLIPPED_SHARE) return result("bright");
  if (spread < FLAT_SPREAD) return result("flat");
  return result();
}

/** The small copy of the frame: this wide (enough pixels across a sleeve or a shin for the contrast check). */
const SAMPLE_WIDTH = 128;

/**
 * Samples the camera every half second during set-up and reports the lighting, steadied over the last few samples
 * (a single dark or bright frame changes nothing). waived(): set-up may go on once the light has been poor for long
 * enough in all (a flickering verdict still adds up), so poor light never blocks the patient for ever. Given where to
 * look (contrast.ts contrastRegions), the same copy also judges the clothing against the background, steadied the
 * same way (contrast(), contrastWaived()).
 */
export class LightingProbe {
  private canvas: HTMLCanvasElement | null = null;
  private last = -Infinity;
  private recent: Lighting[] = [];
  private current: Lighting | null = null;
  private poorMs = 0;
  private seen: number | null = null;
  private recentContrast: Contrast[] = [];
  private currentContrast: Contrast | null = null;
  private poorContrastMs = 0;

  sample(video: HTMLVideoElement, pose: PoseInput | null, t: number, regions: ContrastRegions | null = null): Lighting | null {
    if (t - this.last >= 500 && video.videoWidth && video.videoHeight) {
      this.last = t;
      try {
        this.canvas ??= document.createElement("canvas");
        const width = SAMPLE_WIDTH, height = Math.max(16, Math.round(SAMPLE_WIDTH * video.videoHeight / video.videoWidth));
        this.canvas.width = width; this.canvas.height = height;
        const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          const pixels = ctx.getImageData(0, 0, width, height).data;
          this.add(judgeLighting(pixels, width, height, faceBox(pose)));
          const contrast = regions ? judgeContrast(pixels, width, height, regions) : null;
          if (contrast) this.addContrast(contrast);
        }
      } catch {
        this.current = null;
      }
    }
    return this.tick(t);
  }

  /** One judged contrast sample into its own vote, as for the lighting. */
  addContrast(judged: Contrast) {
    this.recentContrast = [...this.recentContrast.slice(-3), judged];
    const poor = this.recentContrast.filter(item => !item.ok).length, good = this.recentContrast.length - poor;
    // Most of the recent samples decide; a tie keeps the verdict shown (or, before any, says it is fine).
    const ok = good !== poor ? good > poor : this.currentContrast?.ok ?? true;
    this.currentContrast = this.recentContrast.filter(item => item.ok === ok).at(-1) ?? null;
  }

  /** The clothing-against-background verdict, steadied (null until judged). */
  contrast(): Contrast | null {
    return this.currentContrast;
  }

  /** The clothing has blended into the background for this long in all: a reminder only, so carry on. */
  contrastWaived(afterMs = 8000): boolean {
    return this.poorContrastMs >= afterMs;
  }

  /** One judged sample into the vote: the verdict most of the recent samples agree on; a tie keeps the one shown. */
  add(judged: Lighting) {
    this.recent = [...this.recent.slice(-3), judged];
    const counts = new Map<string, number>();
    for (const item of this.recent) counts.set(item.issue ?? "ok", (counts.get(item.issue ?? "ok") ?? 0) + 1);
    const shown = this.current ? this.current.issue ?? "ok" : undefined;
    const [issue] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || Number(b[0] === shown) - Number(a[0] === shown))[0];
    this.current = this.recent.filter(item => (item.issue ?? "ok") === issue).at(-1) ?? null;
  }

  /** The verdict at time t, adding up the time it has said the light is poor. */
  tick(t: number): Lighting | null {
    const dt = this.seen !== null ? Math.min(1000, Math.max(0, t - this.seen)) : 0;
    if (this.current && !this.current.ok) this.poorMs += dt;
    if (this.currentContrast && !this.currentContrast.ok) this.poorContrastMs += dt;
    this.seen = t;
    return this.current;
  }

  /** Poor light for this long in all: carry on anyway (the set-up check says it could be better). */
  waived(afterMs = 12000): boolean {
    return this.poorMs >= afterMs;
  }

  reset() {
    this.recent = []; this.current = null; this.poorMs = 0; this.seen = null; this.last = -Infinity;
    this.recentContrast = []; this.currentContrast = null; this.poorContrastMs = 0;
  }
}
