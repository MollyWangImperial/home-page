// The walking task's how-to-film demonstration (its intro canvas): a looping 9 s animation. "Set up": the room from
// behind the phone, propped sideways (landscape) on a chair at hip height, its view across the room, a dashed path
// about 3 big steps away with Start and Turn just outside the view. "What the camera sees": the landscape picture,
// where a stick figure (about 57% of the picture's height, so it shows standing well back) walks across side-on from
// edge to edge, turns and walks back, head to feet always inside, standing on both feet whenever it stops; a labelled
// helper walks with it on the far side (never between the patient and the camera). One caption per phase. Reduced
// motion: three still frames.

/** The app's colours: deep green (text, frame), green (the patient), coral (the phone's view, markers), pale green, paper. */
const C = { dark: "#285b49", green: "#3c8255", coral: "#e18e6d", pale: "#b9d3c2", paper: "#fffefa" } as const;
const FONT = "Manrope, sans-serif";

/** One loop of the demonstration. */
export const WALK_DEMO_MS = 9000;
/** Standing at the start, walking across, turning, walking back (ms into the loop); then standing again. */
const STAND_END = 1800, ACROSS_END = 4600, TURN_END = 5500, BACK_END = 8300;
/** Steps (half leg cycles) in each crossing: a whole number, so the legs come together as the walker stops. */
const CROSSING_STEPS = 5;
/** The caption of each phase. */
export const WALK_DEMO_CAPTIONS = ["Prop it sideways at hip height", "Walk across…", "…turn, and walk back"] as const;
/**
 * In the camera's picture the walker, head to feet, is this share of the picture's height (the set-up asks for
 * 35-70%): small enough to show standing well back, with floor below and room above.
 */
export const CAMERA_WALKER_SHARE = 0.57;

export type WalkDemoState = {
  phase: 0 | 1 | 2;
  /** Along the walk: 0 at the starting edge of the picture, 1 at the far edge. */
  progress: number;
  /** Which way the walker faces across the picture (+1 toward the far edge). */
  facing: 1 | -1;
  /** 0 side-on, 1 facing the camera (mid-turn). */
  turn: number;
  /** The legs' cycle, radians (one step per half cycle). */
  cycle: number;
  /** How far the legs and arms swing: 0 standing on both feet (still, turning), 1 walking; eased over the first and last half step. */
  stride: number;
  /** The way along the walk, smooth through the turn (+1 toward the far edge, −1 back): where the helper walks. */
  heading: number;
};

/** Standing still at the start of the loop (the set-up's still frame too). */
const STANDING: WalkDemoState = { phase: 0, progress: 0, facing: 1, turn: 0, cycle: 0, stride: 0, heading: 1 };

/** The demonstration at a moment of its loop. */
export function walkDemoState(elapsedMs: number): WalkDemoState {
  const t = ((elapsedMs % WALK_DEMO_MS) + WALK_DEMO_MS) % WALK_DEMO_MS;
  const walk = (from: number, to: number) => {
    const u = (t - from) / (to - from), ease = clamp(Math.min(u, 1 - u) * CROSSING_STEPS * 2, 0, 1);
    return { u, cycle: u * CROSSING_STEPS * Math.PI, stride: ease * ease * (3 - 2 * ease) };
  };
  if (t < STAND_END) return { ...STANDING };
  if (t < ACROSS_END) { const { u, cycle, stride } = walk(STAND_END, ACROSS_END); return { phase: 1, progress: u, facing: 1, turn: 0, cycle, stride, heading: 1 }; }
  if (t < TURN_END) { const u = (t - ACROSS_END) / (TURN_END - ACROSS_END); return { phase: 2, progress: 1, facing: u < 0.5 ? 1 : -1, turn: Math.sin(Math.PI * u), cycle: 0, stride: 0, heading: Math.cos(Math.PI * u) }; }
  if (t < BACK_END) { const { u, cycle, stride } = walk(TURN_END, BACK_END); return { phase: 2, progress: 1 - u, facing: -1, turn: 0, cycle, stride, heading: -1 }; }
  return { phase: 2, progress: 0, facing: -1, turn: 0, cycle: 0, stride: 0, heading: -1 };
}

export type Box = { x: number; y: number; w: number; h: number };
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** The canvas height (CSS px) the demonstration wants at this width: side by side when wide, stacked when narrow. */
export function walkDemoHeight(width: number, reducedMotion: boolean): number {
  if (reducedMotion) {
    if (width >= 620) return Math.round(width * 0.42);
    // Narrow: three full-width still frames, each with its caption underneath.
    const pad = demoPad(width), inner = width - 2 * pad;
    return Math.round(STILL_ROWS.reduce((sum, share) => sum + inner * share + STILL_CAPTION + pad, pad));
  }
  return Math.round(width >= 520 ? width * 0.5 : width * 1.4);
}
const demoPad = (width: number) => clamp(width * 0.03, 8, 18);
/** Narrow still frames: each picture's height as a share of the width (the set-up a little taller), and the caption's. */
const STILL_ROWS = [0.66, 0.56, 0.56], STILL_CAPTION = 34;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

type P = { x: number; y: number };
export type WalkerPose = {
  legs: { hip: P; knee: P; ankle: P; toe: P }[];
  arms: { shoulder: P; elbow: P; hand: P }[];
  neck: P; pelvis: P; head: P; headR: number;
};

/** The figure's height from its feet to the top of its head, as a share of `height` (the head's centre sits at 0.9). */
export const WALKER_SPAN = 0.985;

/**
 * A walking stick figure's joints, feet at (x, footY), `height` tall: side-on facing `facing`, or turning toward the
 * camera (`turn` 1 = facing it). The knee bends as each leg swings forward and straightens for the heel strike; with
 * `stride` 0 it stands on both feet, legs a little apart, arms at its sides.
 */
export function walkerPose(x: number, footY: number, height: number, facing: 1 | -1, cycle: number, turn: number, stride = 1): WalkerPose {
  const h = height;
  const hipY = footY - 0.5 * h, shoulderY = footY - 0.79 * h, headY = footY - 0.9 * h;
  const spread = turn * 0.07 * h, shoulders = turn * 0.13 * h;
  const side = 1 - turn, swing = clamp(stride, 0, 1);
  const legs = [cycle, cycle + Math.PI].map((phase, k) => {
    // Thigh swings ±24°; the knee bends while the leg comes forward, straight on landing and in stance. Standing, the
    // legs part a little (both feet on the floor, both seen).
    const thigh = (0.42 * Math.sin(phase) * swing + (1 - swing) * (k ? 0.12 : -0.12)) * side, bend = 0.8 * Math.max(0, Math.cos(phase)) * swing * side;
    const hipX = x + (k ? spread : -spread);
    const knee = { x: hipX + Math.sin(thigh) * 0.26 * h * facing, y: hipY + Math.cos(thigh) * 0.26 * h };
    const ankle = { x: knee.x + Math.sin(thigh - bend) * 0.25 * h * facing, y: knee.y + Math.cos(thigh - bend) * 0.25 * h };
    return { hip: { x: hipX, y: hipY }, knee, ankle, toe: { x: ankle.x + 0.08 * h * facing * side, y: ankle.y } };
  });
  const arms = [cycle + Math.PI, cycle].map((phase, k) => {
    const arm = 0.32 * Math.sin(phase) * swing * side, sx = x + (k ? shoulders : -shoulders) + 0.03 * h * facing * side;
    const elbow = { x: sx + Math.sin(arm) * 0.17 * h * facing, y: shoulderY + Math.cos(arm) * 0.17 * h };
    return { shoulder: { x: sx, y: shoulderY }, elbow, hand: { x: elbow.x + Math.sin(arm + 0.35) * 0.16 * h * facing, y: elbow.y + Math.cos(arm + 0.35) * 0.16 * h } };
  });
  return { legs, arms, neck: { x: x + 0.02 * h * facing * side, y: shoulderY }, pelvis: { x, y: hipY }, head: { x: x + 0.03 * h * facing * side, y: headY }, headR: 0.085 * h };
}

/** Draws a walker (see walkerPose); `halo` outlines it in paper so it stays in front of a figure behind it. */
function drawWalker(ctx: CanvasRenderingContext2D, x: number, footY: number, height: number, state: Pick<WalkDemoState, "facing" | "cycle" | "turn" | "stride">, color: string, halo: boolean, alpha = 1, thin = 1) {
  const pose = walkerPose(x, footY, height, state.facing, state.cycle, state.turn, state.stride);
  const lw = Math.max(2, height * 0.06) * thin, shoulders = state.turn * 0.13 * height;
  const strokeAll = (style: string, width: number) => {
    ctx.strokeStyle = style; ctx.lineWidth = width;
    const line = (points: P[]) => { ctx.beginPath(); points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); };
    for (const leg of pose.legs) line([leg.hip, leg.knee, leg.ankle, leg.toe]);
    line([pose.neck, pose.pelvis]);
    if (shoulders > 0.5) line([pose.arms[0].shoulder, pose.arms[1].shoulder]);
    for (const arm of pose.arms) line([arm.shoulder, arm.elbow, arm.hand]);
    ctx.beginPath(); ctx.arc(pose.head.x, pose.head.y, pose.headR, 0, Math.PI * 2); ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = alpha;
  // A paper-coloured outline keeps the near figure in front of the far one where they overlap.
  if (halo) strokeAll(C.paper, lw * 2.6);
  strokeAll(color, lw);
  ctx.restore();
}

/** The helper: another person further back, so drawn smaller, thinner and muted (not a faded copy of the walker). */
const HELPER = { color: C.dark, alpha: 0.62, thin: 0.75, phase: Math.PI / 2 } as const;

function panelTitle(ctx: CanvasRenderingContext2D, text: string, box: Box, font: number) {
  ctx.save();
  ctx.fillStyle = C.dark;
  ctx.font = `800 ${font}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, box.x + 2, box.y);
  ctx.restore();
}

/** The space under a panel's title (null: no title, but the same space, so still frames line up). */
function underTitle(ctx: CanvasRenderingContext2D, box: Box, title: string | null): Box {
  const font = clamp(box.w * 0.05, 10.5, 15);
  if (title) panelTitle(ctx, title, box, font + 1);
  const top = box.y + font * 1.9;
  return { x: box.x, y: top, w: box.w, h: box.y + box.h - top };
}

/** The largest box of this width-over-height shape inside `area`, centred. */
function fit(area: Box, aspect: number): Box {
  const w = Math.min(area.w, area.h * aspect), h = w / aspect;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** The room from behind the phone: the floor, the chair with the phone on it, its view, the path and its markers. */
function drawSetUp(ctx: CanvasRenderingContext2D, box: Box, state: WalkDemoState, now: number, reducedMotion: boolean) {
  // The room keeps a landscape shape, using the panel's width when it can.
  const space = underTitle(ctx, box, "Set up");
  const room = fit(space, clamp(space.w / Math.max(1, space.h), 1.25, 1.75));
  const font = clamp(room.w * 0.052, 10, 14), unit = room.h;
  const backY = room.y + room.h * 0.22, frontY = room.y + room.h;
  // A point on the floor: u across (−1 left .. 1 right), d into the room (0 front .. 1 back wall).
  const floor = (u: number, d: number) => ({ x: room.x + room.w / 2 + u * lerp(room.w * 0.5, room.w * 0.33, d), y: lerp(frontY, backY, d) });
  const polyline = (points: { x: number; y: number }[]) => points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // Back wall and floor.
  ctx.fillStyle = "rgba(185,211,194,.14)";
  ctx.strokeStyle = C.pale; ctx.lineWidth = 1.5;
  const wallL = floor(-1, 1), wallR = floor(1, 1);
  ctx.fillRect(wallL.x, room.y, wallR.x - wallL.x, backY - room.y);
  ctx.strokeRect(wallL.x, room.y, wallR.x - wallL.x, backY - room.y);
  ctx.beginPath(); polyline([floor(-1, 1), floor(1, 1), floor(1, 0), floor(-1, 0)]); ctx.closePath();
  ctx.fillStyle = "rgba(185,211,194,.28)"; ctx.fill(); ctx.stroke();

  // The phone's view on the floor, from below the phone to the back wall.
  const apexD = 0.03, spread = 0.78, pathD = 0.62;
  const edge = (sign: number) => Array.from({ length: 9 }, (_, k) => { const s = k / 8; return floor(sign * spread * s, apexD + (1 - apexD) * s); });
  ctx.beginPath(); polyline([...edge(-1), ...edge(1).reverse()]); ctx.closePath();
  ctx.fillStyle = "rgba(225,142,109,.14)"; ctx.fill();
  ctx.setLineDash([5, 5]); ctx.strokeStyle = C.coral; ctx.lineWidth = 1.5;
  for (const sign of [-1, 1]) { ctx.beginPath(); polyline(edge(sign)); ctx.stroke(); }
  ctx.setLineDash([]);

  // The walking path across the view, about 3 big steps from the phone; Start and Turn just outside the view.
  const viewU = spread * (pathD - apexD) / (1 - apexD), path = floor(0, pathD);
  ctx.setLineDash([7, 6]); ctx.strokeStyle = C.green; ctx.lineWidth = 2.2;
  ctx.beginPath(); polyline([floor(-0.98, pathD), floor(0.98, pathD)]); ctx.stroke(); ctx.setLineDash([]);
  const marker = (u: number, label: string) => {
    const x = floor(u, pathD).x, poleH = unit * 0.13;
    ctx.strokeStyle = C.dark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, path.y); ctx.lineTo(x, path.y - poleH); ctx.stroke();
    ctx.fillStyle = C.coral;
    ctx.beginPath(); ctx.moveTo(x, path.y - poleH); ctx.lineTo(x + poleH * 0.5, path.y - poleH * 0.8); ctx.lineTo(x, path.y - poleH * 0.6); ctx.closePath(); ctx.fill();
    // The label above its flag, clear of the path and the footprints below it.
    ctx.fillStyle = C.dark; ctx.font = `700 ${font}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(label, x, path.y - poleH - 3);
  };
  marker(-(viewU + 0.22), "Start");
  marker(viewU + 0.2, "Turn");

  // "3 big steps": three footprints from in front of the chair out to the path.
  ctx.fillStyle = C.green;
  for (let k = 0; k < 3; k++) {
    const p = floor(k % 2 ? 0.1 : 0.17, 0.24 + (pathD - 0.32) * (k / 2));
    ctx.beginPath(); ctx.ellipse(p.x, p.y, unit * 0.018, unit * 0.034, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = C.dark; ctx.font = `700 ${font}px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const stepsLabel = floor(0.24, 0.47);
  ctx.fillText("3 big steps", stepsLabel.x, stepsLabel.y);

  // The walker on the path, and the helper further back on the far side, as in the camera's picture.
  const walkU = lerp(-(viewU - 0.1), viewU - 0.1, state.progress);
  const helper = floor(walkU + state.heading * 0.1, pathD + 0.17);
  drawWalker(ctx, helper.x, helper.y, unit * 0.21, { ...state, cycle: state.cycle + HELPER.phase }, HELPER.color, false, HELPER.alpha, HELPER.thin);
  drawWalker(ctx, floor(walkU, pathD).x, path.y, unit * 0.27, state, C.green, true);

  // The chair in front (seat and legs), the phone propped on it sideways, and how high it sits.
  const chair = floor(0, 0.02), seatY = chair.y - unit * 0.15, seatW = room.w * 0.18;
  const phoneW = room.w * 0.13, phoneH = phoneW * 0.52;
  const phone = { x: chair.x - phoneW / 2, y: seatY - phoneH, w: phoneW, h: phoneH };
  const lens = { x: phone.x + phone.w / 2, y: phone.y + phone.h / 2 };
  ctx.strokeStyle = C.pale; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(chair.x - seatW / 2, seatY); ctx.lineTo(chair.x + seatW / 2, seatY);
  ctx.moveTo(chair.x - seatW * 0.42, seatY); ctx.lineTo(chair.x - seatW * 0.42, chair.y);
  ctx.moveTo(chair.x + seatW * 0.42, seatY); ctx.lineTo(chair.x + seatW * 0.42, chair.y);
  ctx.stroke();
  if (state.phase === 0) {
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
    ctx.strokeStyle = `rgba(225,142,109,${0.35 + 0.45 * pulse})`; ctx.lineWidth = 3;
    roundRect(ctx, phone.x - 5 - pulse * 3, phone.y - 5 - pulse * 3, phone.w + 10 + pulse * 6, phone.h + 10 + pulse * 6, 8); ctx.stroke();
  }
  ctx.fillStyle = C.dark;
  roundRect(ctx, phone.x, phone.y, phone.w, phone.h, Math.max(3, phone.h * 0.16)); ctx.fill();
  ctx.fillStyle = C.coral;
  ctx.beginPath(); ctx.arc(lens.x, lens.y, Math.max(2, phone.h * 0.14), 0, Math.PI * 2); ctx.fill();
  // Hip height: a bracket from the floor to the phone.
  const bx = chair.x - seatW / 2 - room.w * 0.04;
  ctx.strokeStyle = C.dark; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(bx, chair.y); ctx.lineTo(bx, lens.y); ctx.moveTo(bx - 4, chair.y); ctx.lineTo(bx + 4, chair.y); ctx.moveTo(bx - 4, lens.y); ctx.lineTo(bx + 4, lens.y); ctx.stroke();
  ctx.fillStyle = C.dark; ctx.font = `700 ${font}px ${FONT}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText("Hip height", bx - 6, (chair.y + lens.y) / 2);
  ctx.textAlign = "left";
  ctx.fillText("Sideways", phone.x + phone.w + 8, lens.y);
  ctx.restore();
}

/** Where the walker and the helper stand in the camera's picture `frame`: each one's feet (x, footY) and height. */
export function cameraFigures(frame: Box, state: Pick<WalkDemoState, "progress" | "heading">) {
  const fw = frame.w, fh = frame.h;
  // The walker stands well back: head to feet about 57% of the picture, with floor below and room above, its hips near
  // the middle (the camera at hip height). That leaves room to walk across, edge to edge.
  const height = fh * CAMERA_WALKER_SHARE / WALKER_SPAN, footY = frame.y + fh * 0.8, hipLine = footY - height * 0.5;
  // The helper further back on the far side: smaller, feet higher up the floor, hips on the same camera-height line;
  // a step ahead, so the two read as two people walking together, not one figure and its trail. Near the picture's
  // edge it waits, so the walker stops beside it, and at the turn it passes behind the walker.
  const helperH = height * 0.8, along = lerp(0.22, 0.78, state.progress);
  const ahead = clamp(state.heading >= 0 ? 0.92 - along : along - 0.08, 0, 0.17) * state.heading;
  return { walker: { x: frame.x + fw * along, footY, height }, helper: { x: frame.x + fw * (along + ahead), footY: hipLine + helperH * 0.5, height: helperH } };
}

/** The phone's landscape picture: the walker crossing side-on, edge to edge, the helper on the far side. */
function drawCameraView(ctx: CanvasRenderingContext2D, box: Box, state: WalkDemoState, now: number, reducedMotion: boolean, title: string | null = "What the camera sees") {
  // A landscape picture (4:3), as large as fits.
  const frame = fit(underTitle(ctx, box, title), 4 / 3), fw = frame.w, fh = frame.h;
  const font = clamp(fw * 0.05, 10, 14);
  ctx.save();
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, Math.max(6, fw * 0.04));
  ctx.fillStyle = "rgba(185,211,194,.22)"; ctx.fill();
  ctx.save(); ctx.clip();
  const { walker, helper } = cameraFigures(frame, state);
  const { x, footY: floorY, height } = walker, { x: helperX, footY: helperFoot, height: helperH } = helper;
  // The floor seen from the side, from the far wall (just behind the helper) to the bottom of the picture.
  const wallY = helperFoot - fh * 0.03;
  ctx.fillStyle = "rgba(185,211,194,.45)"; ctx.fillRect(frame.x, wallY, frame.w, frame.y + fh - wallY);
  ctx.strokeStyle = C.pale; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(frame.x, wallY); ctx.lineTo(frame.x + frame.w, wallY); ctx.stroke();
  // Each person's shadow on the floor.
  ctx.fillStyle = "rgba(185,211,194,.95)";
  for (const [cx, cy, size] of [[helperX, helperFoot, helperH], [x, floorY, height]]) { ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.012, size * 0.16, size * 0.022, 0, 0, Math.PI * 2); ctx.fill(); }
  const helperState = { ...state, cycle: state.cycle + HELPER.phase };
  drawWalker(ctx, helperX, helperFoot, helperH, helperState, HELPER.color, false, HELPER.alpha, HELPER.thin);
  // "Helper", above the walker's head (clear of it), with a short line down to the helper's head; it fades while the
  // helper passes behind the walker at the turn.
  const helperHead = walkerPose(helperX, helperFoot, helperH, state.facing, helperState.cycle, state.turn, state.stride);
  const labelFont = clamp(fw * 0.045, 10, 13), labelY = floorY - height * WALKER_SPAN - 6, shown = clamp(Math.abs(state.heading) * 1.5, 0, 1);
  ctx.font = `800 ${labelFont}px ${FONT}`;
  const half = ctx.measureText("Helper").width / 2 + 2, labelX = clamp(helperHead.head.x, frame.x + half + 4, frame.x + fw - half - 4);
  ctx.strokeStyle = C.dark; ctx.lineWidth = 1.2; ctx.globalAlpha = HELPER.alpha * shown;
  ctx.beginPath(); ctx.moveTo(labelX, labelY + 3); ctx.lineTo(helperHead.head.x, helperHead.head.y - helperHead.headR - 3); ctx.stroke();
  ctx.globalAlpha = shown;
  ctx.fillStyle = C.dark; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("Helper", labelX, labelY);
  ctx.globalAlpha = 1;
  drawWalker(ctx, x, floorY, height, state, C.green, true);
  ctx.restore();
  ctx.strokeStyle = C.dark; ctx.lineWidth = Math.max(2.5, fw * 0.012);
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, Math.max(6, fw * 0.04)); ctx.stroke();
  // Recording, while the walk is under way.
  if (state.phase > 0) {
    const blink = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(now / 300);
    ctx.fillStyle = `rgba(225,142,109,${blink})`;
    ctx.beginPath(); ctx.arc(frame.x + fw * 0.06, frame.y + fh * 0.09, Math.max(3, fw * 0.018), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.dark; ctx.font = `800 ${font * 0.8}px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("REC", frame.x + fw * 0.06 + Math.max(6, fw * 0.03), frame.y + fh * 0.09);
  }
  ctx.restore();
}

/** One caption with its step number, centred in the box. */
function drawCaption(ctx: CanvasRenderingContext2D, box: Box, phase: number) {
  const font = clamp(Math.min(box.w * 0.045, box.h * 0.5), 12, 17);
  const r = font * 0.75;
  ctx.save();
  ctx.font = `700 ${font}px ${FONT}`;
  ctx.textBaseline = "middle";
  const text = WALK_DEMO_CAPTIONS[phase];
  const width = ctx.measureText(text).width + r * 2 + 10;
  const x = box.x + Math.max(0, (box.w - width) / 2), y = box.y + box.h / 2;
  ctx.fillStyle = C.dark; ctx.beginPath(); ctx.arc(x + r, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.paper; ctx.textAlign = "center"; ctx.font = `800 ${font * 0.85}px ${FONT}`; ctx.fillText(String(phase + 1), x + r, y + 0.5);
  ctx.fillStyle = C.dark; ctx.textAlign = "left"; ctx.font = `700 ${font}px ${FONT}`; ctx.fillText(text, x + r * 2 + 10, y);
  ctx.restore();
}

/** The three-step progress dots under the caption. */
function drawDots(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number, size: number) {
  ctx.save();
  for (let k = 0; k < 3; k++) {
    ctx.beginPath(); ctx.arc(x + (k - 1) * size * 3, y, size, 0, Math.PI * 2);
    ctx.fillStyle = k === phase ? C.dark : C.pale; ctx.fill();
  }
  ctx.restore();
}

/**
 * Draws the demonstration at `elapsedMs` into a `width` × `height` area (CSS px; the caller scales for the screen's
 * pixel density). Wide areas show the set-up and the camera's view side by side, narrow ones stack them; with reduced
 * motion, three still frames with their captions.
 */
export function drawWalkFilmingDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, width: number, height: number, reducedMotion: boolean) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, width, height);
  const pad = demoPad(width);
  const now = elapsedMs;
  if (reducedMotion) {
    // Three still frames: the set-up, walking across, walking back; side by side when wide, stacked when narrow.
    const stills: WalkDemoState[] = [
      { ...STANDING },
      { phase: 1, progress: 0.5, facing: 1, turn: 0, cycle: Math.PI / 2, stride: 1, heading: 1 },
      { phase: 2, progress: 0.5, facing: -1, turn: 0, cycle: Math.PI / 2, stride: 1, heading: -1 },
    ];
    const wide = width >= 620, inner = width - 2 * pad;
    let top = pad;
    stills.forEach((state, k) => {
      const captionH = wide ? clamp((height - 2 * pad) * 0.2, 34, 56) : STILL_CAPTION;
      const box: Box = wide
        ? { x: pad + k * (width - pad) / 3, y: pad, w: (width - pad) / 3 - pad, h: height - 2 * pad }
        : { x: pad, y: top, w: inner, h: inner * STILL_ROWS[k] + captionH };
      top += box.h + pad;
      const picture: Box = { x: box.x, y: box.y, w: box.w, h: box.h - captionH };
      if (k === 0) drawSetUp(ctx, picture, state, now, true);
      else drawCameraView(ctx, picture, state, now, true, k === 1 ? "What the camera sees" : null);
      drawCaption(ctx, { x: box.x, y: box.y + box.h - captionH, w: box.w, h: captionH }, k);
    });
    ctx.restore();
    return;
  }
  const state = walkDemoState(elapsedMs);
  const captionH = clamp(height * 0.13, 38, 60);
  const area = { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad - captionH };
  if (width >= 520) {
    const gap = pad * 1.4, half = (area.w - gap) / 2;
    drawSetUp(ctx, { x: area.x, y: area.y, w: half, h: area.h }, state, now, false);
    drawCameraView(ctx, { x: area.x + half + gap, y: area.y, w: half, h: area.h }, state, now, false);
  } else {
    // Stacked: the room gets a little more height than the picture.
    const gap = pad, upper = (area.h - gap) * 0.54, lower = area.h - gap - upper;
    drawSetUp(ctx, { x: area.x, y: area.y, w: area.w, h: upper }, state, now, false);
    drawCameraView(ctx, { x: area.x, y: area.y + upper + gap, w: area.w, h: lower }, state, now, false);
  }
  const caption = { x: pad, y: height - pad - captionH, w: width - 2 * pad, h: captionH * 0.72 };
  drawCaption(ctx, caption, state.phase);
  drawDots(ctx, width / 2, caption.y + caption.h + captionH * 0.16, state.phase, Math.max(2.5, captionH * 0.06));
  ctx.restore();
}
