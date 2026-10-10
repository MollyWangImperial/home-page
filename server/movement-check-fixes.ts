// Fixes to the movement check's original runner, applied as it is served (movement-check-runner.ts): steadier
// keypoints, no coin on the pinch target, and posture checks that a seated patient's camera can measure. Each one
// leaves the page unchanged when the code it relies on is not as expected.
//
// Steadier keypoints for the runner. Display only:
// the runner's contact, holds, posture checks and scores still use the live landmarks, so nothing waits for the
// drawing. The runner drew MediaPipe's raw points, and two things made the hand bounce:
// - with the hand in front of the body (the reach's first circle) or at the mouth, the pose model flips the forearm
//   from folded to hanging for 100 ms to about a second, so the wrist jumped to the chest or lap and back;
// - the hand model loses a hand held at the mouth for a frame or a few, so the hand's points flashed on and off.
// As the exercises' cup-track.ts does, a reading of the affected hand that follows on from the drawn one at a real
// hand's speed is drawn at once; one that jumps further waits until it has stayed there a moment (longer for a drop,
// unless the hand is being lowered); a missed hand keeps its last drawing briefly; and the drawn arm and hand are
// smoothed together with a One Euro filter (heavier at rest, light while moving) and never move faster than a glide.
// The rest of the body is smoothed point by point the same way. Drawn in the exercises' style: the body's lines (the
// affected limbs in coral) and joints, no face mesh or pose hand points, and only the shoulders for the hand tasks.

/** The steadier's numbers (as the exercises' CUP_TRACK; lengths in torso lengths, times in ms). */
export const STEADY_CONFIG = {
  speed: 5,
  slack: 0.08,
  maxStepGapMs: 100,
  confirmMs: 200,
  dropConfirmMs: 1200,
  dropTorso: 0.15,
  graceMs: 300,
  lostMs: 1000,
  glideSpeed: 8,
  minCutoff: 1,
  beta: 2,
  speedCutoff: 1,
};

/**
 * A classic script for the runner page: defines window.RehynSteady (the steadier, for tests) and window.__rehynSteady
 * (the runner's one instance, with update / drawPose / drawHand). No template interpolation besides the config.
 */
export const RUNNER_STEADY = `<script>
(function(root){
  "use strict";
  var CFG = ${JSON.stringify(STEADY_CONFIG)};
  var POSE_LINES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[27,31],[24,26],[26,28],[28,32]];
  var POSE_DOTS = [0,11,12,13,14,15,16,23,24,25,26,27,28,31,32];
  var HAND_LINES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  function joints(side){
    var l = side === "left";
    return { shoulder: l ? 11 : 12, elbow: l ? 13 : 14, wrist: l ? 15 : 16, hip: l ? 23 : 24, knee: l ? 25 : 26, ankle: l ? 27 : 28, foot: l ? 31 : 32, hand: l ? [17, 19, 21] : [18, 20, 22] };
  }
  function finite(p){ return !!p && isFinite(p.x) && isFinite(p.y); }
  function inFrame(p){ return finite(p) && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99; }
  function vis(p){ return p && typeof p.visibility === "number" ? p.visibility : 1; }
  function copy(p){ if (!p) return p; var out = {}; for (var k in p) out[k] = p[k]; return out; }
  function mean(points){ var x = 0, y = 0; for (var i = 0; i < points.length; i++) { x += points[i].x; y += points[i].y; } return { x: x / points.length, y: y / points.length }; }
  function alpha(cutoff, dt){ return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt)); }
  /** The torso's length in image heights (shoulders to hips, or from the shoulders' width when the hips are out of view). */
  function torsoLength(pose, aspect){
    if (!pose) return null;
    var ls = pose[11], rs = pose[12], lh = pose[23], rh = pose[24];
    if (finite(ls) && finite(rs) && finite(lh) && finite(rh) && vis(lh) >= 0.4 && vis(rh) >= 0.4) {
      var d = Math.hypot(((ls.x + rs.x) - (lh.x + rh.x)) / 2 * aspect, ((ls.y + rs.y) - (lh.y + rh.y)) / 2);
      if (d > 0.05) return d;
    }
    if (finite(ls) && finite(rs)) { var w = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y) * 1.3; if (w > 0.05) return w; }
    return null;
  }

  function Steady(){ this.reset(); }
  Steady.prototype.reset = function(){
    this.task = null; this.scale = null;
    this.drawn = null; this.rival = null; this.last = null; this.seenAt = null; this.stale = false; this.handSeenAt = null; this.previous = null;
    this.cup = null; this.target = null; this.velocity = { x: 0, y: 0 }; this.arm = null; this.hand = null; this.t = null;
    this.body = null; this.bodyT = null;
  };
  /** Where the affected hand is this frame: the hand model's palm when it sees the hand, else the pose's hand points. */
  Steady.prototype.reading = function(pose, hand, side){
    if (hand && hand.length >= 21 && inFrame(hand[0]) && inFrame(hand[2]) && inFrame(hand[5]) && inFrame(hand[17])) return { point: mean([hand[17], hand[5], hand[2]]), hand: true };
    if (!pose) return null;
    var j = joints(side), wrist = pose[j.wrist];
    if (!inFrame(wrist) || vis(wrist) < 0.5) return null;
    var points = j.hand.map(function(i){ return pose[i]; }).filter(inFrame);
    return points.length ? { point: mean(points), hand: false } : null;
  };
  /** Sorts one reading; true when it is drawn (cup-track.ts's observe, with no mouth hold). */
  Steady.prototype.observe = function(at, snapshot, lowering){
    var self = this, drawn = this.drawn, scale = this.scale, aspect = this.aspect;
    var accept = function(){ self.drawn = { at: at, arm: snapshot.arm, hand: snapshot.hand }; self.rival = null; self.stale = false; return true; };
    if (!drawn) return accept();
    var distance = function(from){ return Math.hypot((at.x - from.x) * aspect, at.y - from.y) / scale; };
    var step = CFG.speed * Math.min(Math.max(0, at.t - (this.last ? this.last.t : drawn.at.t)), CFG.maxStepGapMs) / 1000 + CFG.slack;
    var drop = (at.y - drawn.at.y) / scale >= CFG.dropTorso;
    if (distance(drawn.at) <= step) return accept();
    if (this.rival && distance(this.rival.at) <= step) {
      this.rival.at = at;
      var wait = this.rival.drop && !lowering ? CFG.dropConfirmMs : CFG.confirmMs;
      return at.t - this.rival.since >= wait ? accept() : false;
    }
    var reach = CFG.speed * (at.t - drawn.at.t) / 1000 + CFG.slack;
    if ((this.rival || this.stale) && (!drop || lowering) && distance(drawn.at) <= reach) return accept();
    this.rival = { at: at, since: at.t, drop: drop };
    return false;
  };
  /** The arm and hand drawn: smoothed together, driven by the hand's point; a newly drawn part starts on the hand. */
  Steady.prototype.smoothArm = function(t, arm, hand, cup){
    var self = this;
    var place = function(points, dx, dy){ return points ? points.map(function(p){ if (!p) return p; var q = copy(p); q.x += dx; q.y += dy; return q; }) : null; };
    if (!this.cup || this.t === null) {
      this.cup = { x: cup.x, y: cup.y }; this.target = { x: cup.x, y: cup.y }; this.velocity = { x: 0, y: 0 }; this.t = t;
      this.arm = place(arm, 0, 0); this.hand = place(hand, 0, 0);
      return { arm: place(this.arm, 0, 0), hand: place(this.hand, 0, 0) };
    }
    var dt = Math.min(CFG.maxStepGapMs, Math.max(1, t - this.t)) / 1000;
    this.t = t;
    var k = alpha(CFG.speedCutoff, dt);
    this.velocity = { x: this.velocity.x + k * ((cup.x - this.target.x) * this.aspect / this.scale / dt - this.velocity.x), y: this.velocity.y + k * ((cup.y - this.target.y) / this.scale / dt - this.velocity.y) };
    this.target = { x: cup.x, y: cup.y };
    var a = alpha(CFG.minCutoff + CFG.beta * Math.hypot(this.velocity.x, this.velocity.y), dt);
    var gap = Math.hypot((cup.x - this.cup.x) * this.aspect, cup.y - this.cup.y) / this.scale;
    if (a * gap > CFG.glideSpeed * dt) a = CFG.glideSpeed * dt / gap;
    var mix = function(from, to){ return from + a * (to - from); };
    var blend = function(shown, live){
      if (!live) return null;
      // A part that was not drawn last frame starts where the hand is drawn now, keeping its shape.
      if (!shown || shown.length !== live.length) return place(live, self.cup.x - cup.x, self.cup.y - cup.y);
      return live.map(function(p, i){
        var from = shown[i];
        if (!p) return from;
        if (!from) return copy(p);
        var q = copy(p); q.x = mix(from.x, p.x); q.y = mix(from.y, p.y); q.z = mix(from.z || 0, p.z || 0); return q;
      });
    };
    this.cup = { x: mix(this.cup.x, cup.x), y: mix(this.cup.y, cup.y) };
    this.arm = blend(this.arm, arm);
    this.hand = blend(this.hand, hand);
    return { arm: place(this.arm, 0, 0), hand: place(this.hand, 0, 0) };
  };
  /** The rest of the body, point by point. */
  Steady.prototype.smoothBody = function(t, pose){
    if (!pose) { this.body = null; return null; }
    var dt = this.bodyT === null ? 0 : Math.min(CFG.maxStepGapMs, Math.max(1, t - this.bodyT)) / 1000;
    this.bodyT = t;
    if (!this.body || this.body.length !== pose.length || !dt) {
      this.body = pose.map(function(p){ return p ? { shown: copy(p), raw: copy(p), vx: 0, vy: 0 } : null; });
      return pose.map(copy);
    }
    var scale = this.scale, aspect = this.aspect, k = alpha(CFG.speedCutoff, dt);
    return pose.map(function(p, i){
      var f = this.body[i];
      if (!finite(p)) { this.body[i] = null; return copy(p); }
      if (!f) { this.body[i] = { shown: copy(p), raw: copy(p), vx: 0, vy: 0 }; return copy(p); }
      f.vx += k * ((p.x - f.raw.x) * aspect / scale / dt - f.vx);
      f.vy += k * ((p.y - f.raw.y) / scale / dt - f.vy);
      f.raw = copy(p);
      var a = alpha(CFG.minCutoff + CFG.beta * Math.hypot(f.vx, f.vy), dt);
      var q = copy(p); q.x = f.shown.x + a * (p.x - f.shown.x); q.y = f.shown.y + a * (p.y - f.shown.y); q.z = (f.shown.z || 0) + a * ((p.z || 0) - (f.shown.z || 0));
      f.shown = copy(q);
      return q;
    }, this);
  };
  /**
   * One frame: { pose, hand (the affected hand's 21 points when fresh, else null), side, aspect, now, task, lowering }.
   * Returns what to draw: { pose (null with no pose), hand (null when no hand is drawn), side, task }.
   */
  Steady.prototype.update = function(input){
    var t = input.now, side = input.side === "left" ? "left" : "right", pose = input.pose || null, hand = input.hand || null;
    if (input.task !== this.task) { this.reset(); this.task = input.task; }
    this.aspect = input.aspect > 0 && isFinite(input.aspect) ? input.aspect : 1;
    var length = torsoLength(pose, this.aspect);
    if (length) this.scale = this.scale === null ? length : this.scale + 0.1 * (length - this.scale);
    if (this.scale === null) this.scale = 0.35;
    if (this.seenAt !== null && t - this.seenAt > CFG.lostMs) {
      this.rival = null; this.last = null; this.seenAt = null; this.stale = this.drawn !== null; this.cup = null; this.t = null;
    }
    var read = this.reading(pose, hand, side);
    if (read && read.hand) this.handSeenAt = t;
    // A hand the hand model missed for a moment keeps its last drawing rather than handing over to the pose's hand.
    else if (this.handSeenAt !== null && t - this.handSeenAt <= CFG.graceMs) read = null;
    // The runner draws every frame but reads the pose and hand less often (the hand every 100-180 ms on some tasks):
    // a frame repeating the reading it was given before keeps it on screen without judging it again, so a reading
    // is judged against the time since the previous reading, not since the previous frame.
    var source0 = read ? (read.hand ? hand : pose) : null;
    var fresh = !!read && source0 !== this.previous;
    if (read) { this.previous = source0; this.seenAt = t; }
    if (fresh) {
      var j = joints(side), arm = null;
      if (pose) {
        arm = [pose[j.elbow], pose[j.wrist]].concat(j.hand.map(function(i){ return pose[i]; })).map(copy);
        if (read.hand) { arm[1] = copy(hand[0]); arm[1].visibility = 1; }
      }
      var at = { x: read.point.x, y: read.point.y, t: t };
      this.observe(at, { arm: arm, hand: read.hand ? hand.map(copy) : null }, !!input.lowering);
      this.last = at;
    }
    var source = this.drawn && !this.stale && this.seenAt !== null && t - this.seenAt <= CFG.graceMs ? this.drawn : null;
    var body = this.smoothBody(t, pose);
    if (!source) { this.cup = null; this.t = null; this.arm = null; this.hand = null; return { pose: body, hand: null, side: side, task: input.task }; }
    var shown = this.smoothArm(t, source.arm, source.hand, source.at);
    if (body && shown.arm) {
      var indices = (function(jj){ return [jj.elbow, jj.wrist].concat(jj.hand); })(joints(side));
      indices.forEach(function(index, i){ if (shown.arm[i]) body[index] = shown.arm[i]; });
    }
    return { pose: body, hand: shown.hand, side: side, task: input.task };
  };

  /** The body in the exercises' style (the canvas is mirrored by CSS, so raw image coordinates). */
  function drawPose(ctx, state, width, height){
    var lm = state && state.pose;
    if (!lm) return;
    var j = joints(state.side), mine = {};
    [j.shoulder, j.elbow, j.wrist, j.hip, j.knee, j.ankle, j.foot].forEach(function(i){ mine[i] = true; });
    var handTask = /^H/.test(String(state.task || ""));
    ctx.save();
    ctx.lineWidth = Math.max(3, width / 220); ctx.lineCap = "round";
    (handTask ? [[11, 12]] : POSE_LINES).forEach(function(line){
      var a = lm[line[0]], b = lm[line[1]];
      if (!finite(a) || !finite(b) || vis(a) < 0.4 || vis(b) < 0.4) return;
      ctx.strokeStyle = mine[line[0]] && mine[line[1]] ? "#e18e6d" : "rgba(217,229,220,.85)";
      ctx.beginPath(); ctx.moveTo(a.x * width, a.y * height); ctx.lineTo(b.x * width, b.y * height); ctx.stroke();
    });
    ctx.fillStyle = "#fff";
    (handTask ? [0, 11, 12] : POSE_DOTS).forEach(function(i){
      var p = lm[i];
      if (!finite(p) || vis(p) < 0.4) return;
      ctx.beginPath(); ctx.arc(p.x * width, p.y * height, Math.max(3, width / 260), 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  function drawHand(ctx, state, width, height){
    var hand = state && state.hand;
    if (!hand || hand.length < 21) return;
    ctx.save();
    ctx.strokeStyle = "rgba(127,229,163,.95)"; ctx.lineWidth = Math.max(2, width / 320); ctx.lineCap = "round";
    HAND_LINES.forEach(function(line){
      var a = hand[line[0]], b = hand[line[1]];
      if (!finite(a) || !finite(b)) return;
      ctx.beginPath(); ctx.moveTo(a.x * width, a.y * height); ctx.lineTo(b.x * width, b.y * height); ctx.stroke();
    });
    ctx.fillStyle = "#fff";
    hand.forEach(function(p){ if (!finite(p)) return; ctx.beginPath(); ctx.arc(p.x * width, p.y * height, Math.max(2, width / 360), 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  var shared = new Steady();
  root.RehynSteady = { Steady: Steady, drawPose: drawPose, drawHand: drawHand, config: CFG };
  root.__rehynSteady = {
    update: function(input){ return shared.update(input); },
    drawPose: drawPose,
    drawHand: drawHand,
    reset: function(){ shared.reset(); },
  };
})(window);
</script>`;

/** Where the runner's drawOverlay draws the pose and the hand (each exactly once in the page). */
const DRAW_ANCHORS = {
  start: "// draw skeleton",
  poseDots: 'drawingUtils.drawLandmarks(landmarks, {color:"#D9E5DC", radius:3});',
  poseLines: 'drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {color:"#4A7856", lineWidth:4});',
  handLines: 'drawingUtils.drawConnectors(latestHandLandmarks, HAND_CONNECTIONS, {color:"rgba(127,229,163,0.88)", lineWidth:2});',
  handDots: 'drawingUtils.drawLandmarks(latestHandLandmarks, {color:"rgba(217,229,220,0.72)", radius:1.4});',
  quality: "if(!armOnly && !calibratingAssessment && !stepCompleted && voiceFinishedAt > 0) assessmentQuality.draw(ctx, landmarks, canvas.width, canvas.height);",
} as const;

/** drawOverlay's first step: this frame's steadied drawing (null, and the runner's own drawing, if anything fails). */
const STEADY_FRAME = `const __steady = (function(){ try {
    if (!window.__rehynSteady) return null;
    const now = performance.now();
    const hand = latestHandLandmarks && latestHandLandmarks.length >= 21 && now - latestHandSeenAt <= handLandmarkFreshMs() ? latestHandLandmarks : null;
    return window.__rehynSteady.update({ pose: landmarks || null, hand, side: AFFECTED_SIDE, aspect: video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1,
      now, task: (tasks[currentTaskIdx] || {}).id || "", lowering: !!(ladderFlow && ladderFlow.returning) }) || null;
  } catch (error) { return null; } })();
  `;

/**
 * The runner's drawOverlay drawing the steadied body and hand (display only). Returns the page unchanged when its
 * drawing code is not as expected.
 */
export function steadyRunnerDrawing(html: string): string {
  const anchors = Object.values(DRAW_ANCHORS);
  if (!anchors.every(anchor => html.split(anchor).length === 2)) return html;
  const swap = (page: string, anchor: string, next: string) => page.replace(anchor, () => next);
  let page = html;
  page = swap(page, DRAW_ANCHORS.start, `${STEADY_FRAME}${DRAW_ANCHORS.start}`);
  page = swap(page, DRAW_ANCHORS.poseDots, `if(__steady) window.__rehynSteady.drawPose(ctx, __steady, canvas.width, canvas.height); else ${DRAW_ANCHORS.poseDots}`);
  page = swap(page, DRAW_ANCHORS.poseLines, `if(!__steady) ${DRAW_ANCHORS.poseLines}`);
  page = swap(page, DRAW_ANCHORS.handLines, `if(!__steady) ${DRAW_ANCHORS.handLines}`);
  page = swap(page, DRAW_ANCHORS.handDots, `if(!__steady) ${DRAW_ANCHORS.handDots}`);
  page = swap(page, DRAW_ANCHORS.quality,
    "if(__steady && (!armOnly || testingMouthEnabled())) window.__rehynSteady.drawHand(ctx, __steady, canvas.width, canvas.height);\n  "
    + DRAW_ANCHORS.quality.replace("assessmentQuality.draw(ctx, landmarks,", "assessmentQuality.draw(ctx, (__steady && __steady.pose) || landmarks,"));
  return page;
}

/**
 * The pinch task asks for the thumb to meet the first finger, with no object, so its target no longer shows a coin
 * (the demonstration shows no object either). Unchanged if the icon table is not as expected.
 */
export function withoutPinchCoin(html: string): string {
  if (html.split("const ICON_EMOJI = {").length !== 2) return html;
  return html.replace(/(const ICON_EMOJI = \{[^}\n]*?),\s*coin:\s*"[^"\n]*"/, (_match, head: string) => head);
}

/**
 * Posture a seated patient's camera can measure (the runner's ladder mode only). Every ladder task checks trunk lean
 * and shoulder hiking (and head drop, or the wrist), and a check never measured costs the task its full marks ("your
 * posture wasn't clear enough"). The runner measured all of them only with both hips seen at 65% confidence, the
 * upright reference included, but a laptop camera shows a seated patient's hips at the bottom edge, if at all, and an
 * arm reaching or resting in front of them hides them, so the checks went unmeasured. The hips are needed by none
 * of these measures except the trunk lean's zoom guard. In ladder mode:
 * - the shoulder line, width and screen width come from the shoulders alone (shoulder hiking, head drop, the
 *   reference), and the reference keeps its stillness check (the torso's direction) only while enough of its frames
 *   show the hips;
 * - shoulder hiking's allowance for a raised arm uses the upper arm's angle from vertical when the hip is unseen;
 * - the trunk lean (shoulders and face both growing on screen, as when leaning toward the camera) keeps its pelvis
 *   guard when the hips are seen, and otherwise takes the seated pelvis as staying put, along the image's horizontal.
 * Thresholds, durations and what counts as detected are unchanged.
 */
const POSTURE_FIXES: [string, string][] = [
  // The shoulders' own measures without the hips, and the upper arm's angle from vertical.
  ["      if(usable([11,12,23,24])) {",
    "      if(this.ladderTrunkScale && !usable([11,12,23,24]) && usable([11,12])) {\n"
    + "        r.width=length(sub(w[11],w[12]));\n"
    + "        r.screenWidth=Math.hypot(p[11].x-p[12].x,p[11].y-p[12].y);\n"
    + "        r.shoulderLine=(w[o.s].y-w[a.s].y)/Math.max(.05,r.width);\n"
    + "      }\n"
    + "      if(this.ladderTrunkScale && usable([a.s,a.e])) r.armFromVertical=angleV([0,1,0],sub(w[a.e],w[a.s]));\n"
    + "      if(usable([11,12,23,24])) {"],
  // The horizontal axis from the image when the hips (and the reference) give none.
  ["        if(visible([11,12])) {",
    "        if(this.ladderTrunkScale && !finite(r.shoulderAxisX) && !finite(this.baseline?.shoulderAxisX) && visible([11,12])) {\n"
    + "          const across=sub2D(p[12],p[11],imageAspect);\n"
    + "          if(Math.abs(across[0])>.03){r.shoulderAxisX=Math.sign(across[0]);r.shoulderAxisY=0;}\n"
    + "        }\n"
    + "        if(visible([11,12])) {"],
  // The reference from the shoulders when the hips are unseen.
  ["if(!r.torso || !finite(r.width)) return;", "if((!r.torso && !this.ladderTrunkScale) || !finite(r.width)) return;"],
  ["const directions=samples.map(x=>x.torso);", "const directions=samples.map(x=>x.torso).filter(Boolean);"],
  // The stillness check stays whenever enough frames show the hips to judge it.
  ["return Math.max(...directions.map(v=>angleV(v,b.torso)))<6 ? b : null;", "return (this.ladderTrunkScale && directions.length<15) || Math.max(...directions.map(v=>angleV(v,b.torso)))<6 ? b : null;"],
  // Measure against the reference without the hips' torso direction.
  ["if(b && r.torso && finite(r.screenWidth)", "if(b && (r.torso || this.ladderTrunkScale) && finite(r.screenWidth)"],
  ["(r.arm_elevation||0)*.12", "(finite(r.arm_elevation)?r.arm_elevation:finite(r.armFromVertical)?r.armFromVertical:0)*.12"],
  // The seated pelvis taken as staying put when either the frame or the reference has no hips.
  ["const pelvisScale=b?.hipScreenSpan>0?r.hipScreenSpan/b.hipScreenSpan:NaN;", "const pelvisScale=b?.hipScreenSpan>0&&finite(r.hipScreenSpan)?r.hipScreenSpan/b.hipScreenSpan:1;"],
];

export function measurablePosture(html: string): string {
  if (!POSTURE_FIXES.every(([anchor]) => html.split(anchor).length === 2)) return html;
  return POSTURE_FIXES.reduce((page, [anchor, next]) => page.replace(anchor, () => next), html);
}

/** All the runner fixes, each applied only when its anchors are as expected. */
export function fixRunnerPage(html: string): { html: string; steady: boolean } {
  const steadied = steadyRunnerDrawing(html);
  return { html: measurablePosture(withoutPinchCoin(steadied)), steady: steadied !== html };
}
