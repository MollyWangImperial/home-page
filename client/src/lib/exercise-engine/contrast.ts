import type { Side } from "./config";
import { inView, poseJoints, type PoseInput } from "./metrics";

// Clothing against the background, for set-up: whether the part of the body an exercise tracks stands out from what
// is just beside it in the picture. A top the colour of the wall behind it, or trousers the colour of the chair, make
// the pose points wander. It samples a few small patches on the limb and just outside it in the lighting check's own
// small copy of the frame (lighting.ts LightingProbe), so the camera loop does no extra work, and compares their
// median colours in CIELAB (a perceptual colour difference). Positions are raw (unmirrored) image coordinates.

/** Which part of the body an exercise tracks: the upper arm, the lower leg, or the hand. */
export type ContrastPart = "arm" | "leg" | "hand";
export type Contrast = { ok: boolean; part: ContrastPart; deltaE: number; hint?: string };
type P2 = { x: number; y: number };
/** Points on the tracked part (`inside`) and on the background just beside it (`outside`), normalized. */
export type ContrastRegions = { part: ContrastPart; inside: P2[]; outside: P2[] };

/** Colours closer than this (CIELAB ΔE) are hard for the camera to tell apart: the earlier assessment runner's limit. */
export const SIMILAR_DELTA_E = 12;
/** Each side needs at least this many pixels sampled to judge. */
const MIN_PIXELS = 12;

export const CONTRAST_HINTS: Record<ContrastPart, string> = {
  arm: "Your top is a similar colour to the background behind your arm. If you can, wear a top that stands out from it, or sit in front of a different background.",
  leg: "Your trousers are a similar colour to what is behind your legs. If you can, wear trousers that stand out from it, or change the background.",
  hand: "Your hand is hard to see against the background. If you can, sit in front of a plainer background of a different colour.",
};

/** The part each exercise tracks. */
export function contrastPart(exerciseId: string): ContrastPart {
  if (exerciseId === "ex_handopen" || exerciseId === "ex_pinch") return "hand";
  if (exerciseId === "ex_lower_selective" || exerciseId === "ex_ankle_dorsiflexion") return "leg";
  return "arm";
}

/**
 * Where to sample, from the pose: along the affected upper arm (shoulder to elbow) or lower leg (knee to ankle), and
 * the same points moved out from the body by about half the limb's length (past the sleeve or trouser leg); or the
 * hand's points and a ring round the hand, away from the forearm. null when the part is out of view.
 */
export function contrastRegions(pose: PoseInput | null, side: Side, part: ContrastPart, aspect: number): ContrastRegions | null {
  const lm = pose?.landmarks;
  if (!lm) return null;
  const j = poseJoints(side);
  const keep = (points: P2[]) => points.filter(p => p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98);
  if (part === "hand") {
    const indices = side === "left" ? [15, 17, 19, 21] : [16, 18, 20, 22];
    const points = indices.map(index => lm[index]).filter(p => inView(p));
    const elbow = lm[j.elbow];
    if (points.length < 3) return null;
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length, cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const size = Math.max(0.02, ...points.map(p => Math.hypot((p.x - cx) * aspect, p.y - cy)));
    // The forearm's direction from the hand: no ring points that way (they would land on the sleeve).
    const toElbow = inView(elbow) ? Math.atan2(elbow.y - cy, (elbow.x - cx) * aspect) : null;
    const ring: P2[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (toElbow !== null && Math.abs(Math.atan2(Math.sin(a - toElbow), Math.cos(a - toElbow))) < Math.PI / 3) continue;
      const r = Math.max(2.2 * size, 0.06);
      ring.push({ x: cx + (Math.cos(a) * r) / aspect, y: cy + Math.sin(a) * r });
    }
    const inside = keep([...points, { x: cx, y: cy }]), outside = keep(ring);
    return inside.length >= 3 && outside.length >= 3 ? { part, inside, outside } : null;
  }
  const [a, b, midA, midB, reach] = part === "arm"
    ? [lm[j.shoulder], lm[j.elbow], lm[j.shoulder], lm[j.shoulderOther], 0.5]
    : [lm[j.knee], lm[j.ankle], lm[j.hip], lm[j.hipOther], 0.4];
  if (![a, b, midA, midB].every(p => inView(p))) return null;
  const dx = (b.x - a.x) * aspect, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < 0.03) return null;
  // Out from the body: the limb's normal pointing away from the middle of the body.
  let nx = -dy / length, ny = dx / length;
  if (nx * ((a.x - (midA.x + midB.x) / 2) * aspect) < 0) { nx = -nx; ny = -ny; }
  const inside: P2[] = [], outside: P2[] = [];
  for (const t of [0.25, 0.4, 0.55, 0.7]) {
    const px = a.x * aspect + dx * t, py = a.y + dy * t;
    inside.push({ x: px / aspect, y: py });
    outside.push({ x: (px + nx * reach * length) / aspect, y: py + ny * reach * length });
  }
  const keptIn = keep(inside), keptOut = keep(outside);
  return keptIn.length >= 3 && keptOut.length >= 3 ? { part, inside: keptIn, outside: keptOut } : null;
}

const linear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** sRGB (0-255) to CIELAB, D65. */
export function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const R = linear(r), G = linear(g), B = linear(b);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The median colour of 3 x 3 patches round the points in one small RGBA frame, or null with too few pixels. */
function medianColour(pixels: Uint8ClampedArray, width: number, height: number, points: P2[]): [number, number, number] | null {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (const p of points) {
    const cx = Math.round(p.x * width - 0.5), cy = Math.round(p.y * height - 0.5);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        r.push(pixels[i]); g.push(pixels[i + 1]); b.push(pixels[i + 2]);
      }
    }
  }
  if (r.length < MIN_PIXELS) return null;
  const median = (values: number[]) => values.sort((m, n) => m - n)[Math.floor(values.length / 2)];
  return [median(r), median(g), median(b)];
}

/** Judge one small RGBA frame: the part's colour against the background beside it. null when it cannot tell. */
export function judgeContrast(pixels: Uint8ClampedArray, width: number, height: number, regions: ContrastRegions): Contrast | null {
  const inside = medianColour(pixels, width, height, regions.inside), outside = medianColour(pixels, width, height, regions.outside);
  if (!inside || !outside) return null;
  const [l1, a1, b1] = toLab(inside), [l2, a2, b2] = toLab(outside);
  const deltaE = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  const ok = deltaE >= SIMILAR_DELTA_E;
  return { ok, part: regions.part, deltaE, hint: ok ? undefined : CONTRAST_HINTS[regions.part] };
}
