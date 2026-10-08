// "Show me once": a small side-view ghost that performs the movement. p runs 0 (rest) to 1 (target).

import type { Ghost } from "./config";
import { drawHandGhost } from "./hand-target";

const RAD = Math.PI / 180;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
type P = [number, number];

function line(ctx: CanvasRenderingContext2D, pts: P[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

/** Point `len` away from `from`, at `deg` measured from straight down, positive = forward (+x). */
const fromDown = (from: P, len: number, deg: number): P => [from[0] + len * Math.sin(deg * RAD), from[1] + len * Math.cos(deg * RAD)];

/** Reach hand and target use exactly the same arm geometry (300 x 270 drawing space). */
export function reachGhostPose(p: number) {
  const shoulder = lerp(8, 72, p);
  const elbow = lerp(100, 152, p);
  const upperArmEnd = fromDown([110, 88], 62, shoulder);
  return { shoulder, elbow, wrist: fromDown(upperArmEnd, 56, shoulder + (180 - elbow)) };
}

/** Inverse arm geometry puts the hand at the lips, rather than above the face. */
export function mouthGhostPose(p: number) {
  const wrist: P = [lerp(154, 130, p), lerp(174, 60, p)];
  const dx = wrist[0] - 110, dy = wrist[1] - 88;
  const distance = Math.hypot(dx, dy);
  const along = (62 * 62 - 56 * 56 + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, 62 * 62 - along * along));
  const elbow: P = [110 + along * dx / distance - height * dy / distance, 88 + along * dy / distance + height * dx / distance];
  return { wrist, elbow };
}

export function drawGhost(ctx: CanvasRenderingContext2D, kind: Ghost, p: number, width: number, height: number, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  ctx.clearRect(0, 0, width, height);
  // Active Hand Opening is shown front-on, palm to the camera, as the patient sets up (hand-target.ts).
  if (kind === "hand_open") { drawHandGhost(ctx, p, width, height, colors); return; }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "pinch") {
    drawHand(ctx, kind, p, width, height, colors);
    ctx.restore();
    return;
  }
  const s = Math.min(width / 300, height / 270);
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);

  const S: P = [110, 88];
  const H: P = [106, 172];
  const K: P = [186, 176];
  // chair
  ctx.strokeStyle = colors.soft;
  ctx.lineWidth = 6;
  line(ctx, [[84, 120], [84, 182], [200, 182], [200, 252]]);
  // body
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(112, 52, 18, 0, Math.PI * 2);
  ctx.stroke();
  line(ctx, [S, H]);

  let shoulder = 6;
  let elbow = 100;
  let knee = 92;
  let toe = 0;
  let hand: P | null = null;
  if (kind === "reach") { ({ shoulder, elbow } = reachGhostPose(p)); }
  if (kind === "raise") { shoulder = lerp(10, 96, p); elbow = 140; }
  if (kind === "mouth") { shoulder = lerp(14, 38, p); elbow = lerp(150, 50, p); }
  if (kind === "grasp") { shoulder = lerp(8, 60, p); elbow = lerp(100, 140, p); }
  if (kind === "knee") knee = lerp(92, 160, p);
  if (kind === "toe") toe = lerp(0, 26, p);

  // leg
  const A: P = [K[0] + 64 * -Math.cos(knee * RAD), K[1] + 64 * Math.sin(knee * RAD)];
  ctx.strokeStyle = colors.line;
  line(ctx, [H, K, A]);
  const F: P = [A[0] + 34 * Math.cos(toe * RAD), A[1] - 34 * Math.sin(toe * RAD)];
  ctx.strokeStyle = kind === "toe" ? colors.accent : colors.line;
  line(ctx, [A, F]);

  // arm
  const mouthArm = kind === "mouth" ? mouthGhostPose(p) : null;
  const E = mouthArm?.elbow ?? fromDown(S, 62, shoulder);
  const W = mouthArm?.wrist ?? fromDown(E, 56, shoulder + (180 - elbow));
  ctx.strokeStyle = kind === "knee" || kind === "toe" ? colors.line : colors.accent;
  line(ctx, [S, E, W]);
  hand = W;
  if (kind === "reach") {
    ctx.beginPath(); ctx.arc(W[0], W[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent; ctx.fill();
  }
  if (kind === "mouth") {
    ctx.strokeStyle = colors.soft;
    ctx.lineWidth = 5;
    ctx.strokeRect(hand[0], hand[1] - 10, 18, 20);
    ctx.beginPath(); ctx.arc(hand[0] + 20, hand[1], 6, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  }
  if (kind === "grasp") {
    ctx.strokeStyle = colors.soft;
    ctx.lineWidth = 5;
    ctx.strokeRect(hand[0] + 4, hand[1] - 10, 18, 22);
  }
  ctx.restore();
}

function drawHand(ctx: CanvasRenderingContext2D, kind: Ghost, p: number, width: number, height: number, colors: { line: string; accent: string; soft: string }) {
  const s = Math.min(width / 300, height / 240);
  ctx.translate((width - 300 * s) / 2, (height - 240 * s) / 2);
  ctx.scale(s, s);
  // forearm + palm, side view
  ctx.strokeStyle = colors.soft;
  ctx.lineWidth = 16;
  line(ctx, [[30, 150], [110, 150]]);
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 12;
  line(ctx, [[110, 150], [170, 150]]);
  const lens = [44, 34, 26];
  const finger = (base: P, curl: number, color: string, width2: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width2;
    const pts: P[] = [base];
    let angle = 0;
    lens.forEach((len, i) => {
      angle += curl * (i === 0 ? 0.9 : 1);
      const prev = pts[pts.length - 1];
      pts.push([prev[0] + len * Math.cos(angle * RAD), prev[1] + len * Math.sin(angle * RAD)]);
    });
    line(ctx, pts);
    return pts[pts.length - 1];
  };
  // pinch: the index curls down while the thumb comes up to meet it
  void kind;
  const tip = finger([170, 146], lerp(2, 38, p), colors.line, 10);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 10;
  const base: P = [128, 164];
  const target: P = [tip[0] - 6, tip[1] + 6];
  const thumbTip: P = [lerp(base[0] + 54, target[0], p), lerp(base[1] + 44, target[1], p)];
  line(ctx, [base, [lerp(base[0] + 30, (base[0] + target[0]) / 2, p), lerp(base[1] + 28, (base[1] + target[1]) / 2 + 6, p)], thumbTip]);
}
