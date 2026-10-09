import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentReport } from "@/lib/assessment";
import { walkingScore } from "@/lib/assessment-engine/function-score";
import { CAMERA_TASKS } from "@/lib/assessment-engine/tasks";
import type { AssessmentTaskResult, AttemptRecord, CameraTaskId, GaitResult, NativeTaskScore } from "@/lib/assessment-engine/types";
import { REASSESSMENT_CYCLE_DAYS } from "@/lib/home-stage";
import type { JourneyAssessment } from "@/lib/journey";
import AssessmentResults, {
  areaScore, bestAlone, bodyInsight, byTask, checkUpChallenges, completedAtOf, COUNT_UP_GRACE_MS, COUNT_UP_MS, countUp, curiosityLine,
  deltaText, journeyTotal, ladderRungs, nextChallenge, nextCheckUp, RESULT_AREAS, roundHalfUp, scoreBand, sinceLastTime, speedBand,
  stepEvenness, taskRows, totalScore, walkingCuriosity, walkingInsight, type AssessmentResultsProps, type CountUpClock,
} from "./AssessmentResults";

const [ARM, HAND, WALK] = RESULT_AREAS;

const attempt = (levelId: string, completed: boolean, extra: Partial<AttemptRecord> = {}): AttemptRecord => ({
  level: 0, levelId, assist: null, completed, touched: completed, peakProgress: completed ? 1 : 0.5, compensations: {}, durationMs: 4000, ...extra,
});
const task = (taskId: CameraTaskId, attempts: AttemptRecord[], extra: Partial<AssessmentTaskResult> = {}): AssessmentTaskResult => ({
  taskId, exerciseId: CAMERA_TASKS[taskId].exerciseId, levelIds: CAMERA_TASKS[taskId].levels.map(level => level.id), startLevel: 0,
  tryOut: { completed: true, peakProgress: 1 }, attempts, movementSeen: true, stoppedBy: "reversal", measured: true, side: "right", insights: {}, ...extra,
});
const clean = (ids: string[]) => Object.fromEntries(ids.map(id => [id, "not_detected" as const]));

// A real-shaped check: reach held above the shoulder (shoulder hiking there), hand to mouth held cleanly, both hand
// tasks held at the partial level, pinch touched tip to tip without the hold, walking measured.
const T1 = task("T1", [
  attempt("r160", false, { level: 2, peakProgress: 0.72, compensations: clean(["trunk_lean", "shoulder_hike", "other_hand"]) }),
  attempt("r120", true, { level: 1, compensations: { trunk_lean: "not_detected", shoulder_hike: "detected", other_hand: "not_detected" } }),
], { startLevel: 2, insights: { shoulder_flexion: 112 } });
const T3 = task("T3", [attempt("mouth", true, { level: 1, compensations: clean(["head_forward", "trunk_forward", "shoulder_hike", "other_hand"]) })], { startLevel: 1, stoppedBy: "top_reached" });
const H4 = task("H4", [attempt("full", false, { level: 1, peakProgress: 0.6 }), attempt("partial", true, { level: 0 })], { startLevel: 1 });
const H3 = task("H3", [attempt("partial", true, { level: 0 }), attempt("full", false, { level: 1, touched: true, peakProgress: 1 })]);
const taskResults = [T1, T3, H4, H3];

const walking: GaitResult = {
  status: "scored", score: 72.3, areaScore: 72.3, assist: "none",
  metrics: { speedLegPerS: 0.8, speedMpsEstimate: 0.68, cadence: 96, stepLengthSymmetry: 0.94, stepTimeSymmetry: 0.97, kneeFlexA: 47.6, kneeFlexB: 55,
    kneeFlexPeak: 47.6, trunkLeanDeg: 3, stepLengthA: 0.5, stepLengthB: 0.47, steps: 14, passes: 2, seenShare: 0.9, sideOnRatio: 0.3 },
  components: { speed: 31.4, cadence: 83.6, step_length_symmetry: 100, step_time_symmetry: 100, knee_bend: 92, trunk_upright: 100 },
};
const rows: NativeTaskScore[] = [
  { task_id: "T1", task_label: "Reach", points: 50, level: 2, label: "Partly", best_level: "Above your shoulder", next_step: "Next: the overhead circle." },
  { task_id: "T3", task_label: "Hand to mouth", points: 100, level: 4, label: "Can do well", best_level: "Hand to your mouth" },
  { task_id: "H4", task_label: "Hand opening", points: 50, level: 2, label: "Partly", best_level: "Fingers part open", next_step: "Next: fingers wide open." },
  { task_id: "H3", task_label: "Pinch", points: 50, level: 2, label: "Partly", best_level: "Thumb close to finger", next_step: "Next: tip to tip." },
  { task_id: "L6", task_label: "Walking", points: 72.3, level: null, label: "Walking score" },
];
const reportWith = (areas: Record<string, number | null>, total: number | null, tasks: NativeTaskScore[] = rows, extra: Partial<AssessmentReport> = {}): AssessmentReport => ({
  id: "native-1791561600000", assessment_package: "initial", preview_only: false, testing_random: false,
  metrics: { function_score: { display_total: total, areas: Object.fromEntries(Object.entries(areas).map(([key, value]) => [key, { display_score: value }])), tasks } },
  ...extra,
});
const report = reportWith({ upper_limb: 75, hand: 50, lower_limb: 72 }, 66);
const previous: JourneyAssessment[] = [
  { id: "native-1791561600000", completedAt: "2026-10-09T15:30:00", scores: { upper_limb: 75, hand: 50, lower_limb: 72 } },
  { id: "native-older", completedAt: "2026-10-02T10:00:00", scores: { upper_limb: 67, hand: 53, lower_limb: null } },
  { id: "native-oldest", completedAt: "2026-09-18T10:00:00", scores: { upper_limb: 50, hand: 40, lower_limb: null } },
];
const finished = new Date(2026, 9, 9, 15, 30);
const props = (extra: Partial<AssessmentResultsProps> = {}): AssessmentResultsProps =>
  ({ report, previous, walking, taskResults, onContinue: vi.fn(), onHome: vi.fn(), completedAt: finished, ...extra });
const render = (extra: Partial<AssessmentResultsProps> = {}) => renderToStaticMarkup(createElement(AssessmentResults, props(extra)));
/** The page's words, without markup or entities. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const ringNumbers = (html: string) => Array.from(html.matchAll(/class="ar-ring-num" aria-hidden="true">([^<]*)</g), match => match[1]);
const stillDevice = () => vi.stubGlobal("window", { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });

afterEach(() => vi.unstubAllGlobals());

describe("reading the report", () => {
  it("colours areas by their displayed score, with words, and grey when not measured", () => {
    expect([75, 74, 50, 49, 0].map(scoreBand)).toEqual(["strong", "building", "building", "starting", "starting"]);
    expect([null, undefined, Number.NaN].map(scoreBand)).toEqual(["unmeasured", "unmeasured", "unmeasured"]);
  });

  it("rounds once, half up", () => {
    expect([72.5, 72.49, 0.5, 99.5].map(roundHalfUp)).toEqual([73, 72, 1, 100]);
  });

  it("reads the scores and rows the native score stored, falling back to the walk's own area score", () => {
    expect(totalScore(report)).toBe(66);
    expect(areaScore(report, "hand")).toBe(50);
    const noWalkingArea = reportWith({ upper_limb: 75, hand: 50, lower_limb: null }, 66);
    expect(areaScore(noWalkingArea, "lower_limb", walking)).toBe(72);
    expect(areaScore(noWalkingArea, "lower_limb", null)).toBeNull();
    expect(totalScore(reportWith({}, null))).toBeNull();
    expect(totalScore({})).toBeNull();
    expect(taskRows(report).T1?.next_step).toBe("Next: the overhead circle.");
    expect(byTask(taskResults).H3).toBe(H3);
  });
});

describe("the climbed level ladders", () => {
  it("marks levels held alone, those below them, the ones tried and the next", () => {
    expect(bestAlone(T1)).toBe(1);
    expect(ladderRungs("T1", T1).map(rung => rung.state)).toEqual(["below", "held", "tried"]);
    expect(ladderRungs("T3", T3).map(rung => rung.state)).toEqual(["below", "held"]);
    expect(ladderRungs("H3", H3).map(rung => rung.state)).toEqual(["held", "tried"]);
    const untried = task("T1", [attempt("r80", true)], { stoppedBy: "max_attempts" });
    expect(ladderRungs("T1", untried).map(rung => rung.state)).toEqual(["held", "next", "ahead"]);
  });

  it("keeps help apart from holding alone", () => {
    const helped = task("T1", [attempt("r80", false), attempt("r80", true, { assist: "helper" })], { stoppedBy: "lowest_failed" });
    expect(bestAlone(helped)).toBe(-1);
    expect(ladderRungs("T1", helped).map(rung => rung.state)).toEqual(["helped", "ahead", "ahead"]);
  });

  it("lights nothing for a skipped or unmeasured task", () => {
    expect(ladderRungs("H3", task("H3", [], { stoppedBy: "skipped" })).map(rung => rung.state)).toEqual(["ahead", "ahead"]);
    expect(ladderRungs("T1", task("T1", [attempt("r80", true)], { measured: false, stoppedBy: "not_measured" })).map(rung => rung.state)).toEqual(["ahead", "ahead", "ahead"]);
  });

  it("keeps the attempts of a task skipped part-way, as the scoring does", () => {
    const partWay = task("H3", [attempt("partial", true)], { stoppedBy: "skipped" });
    expect(bestAlone(partWay)).toBe(0);
    expect(ladderRungs("H3", partWay).map(rung => rung.state)).toEqual(["held", "next"]);
    expect(bodyInsight(HAND, byTask([partWay]))).toBe("You brought your thumb close to your first finger on your own.");
    // Skipped before any attempt: not assessed, never "comes after hand opening".
    const html = renderToStaticMarkup(createElement(AssessmentResults, {
      report: reportWith({ upper_limb: null, hand: null, lower_limb: null }, null, []), previous: [], walking: null,
      taskResults: [task("H4", [], { stoppedBy: "skipped" })], onContinue: () => {}, onHome: () => {},
    }));
    expect(words(html)).toContain("Hand opening Not assessed");
    expect(words(html)).not.toContain("Comes after hand opening");
  });

  it("uses only the row's best level when the attempts are not there", () => {
    expect(ladderRungs("T1", undefined, rows[0]).map(rung => rung.state)).toEqual(["below", "held", "next"]);
    expect(ladderRungs("T1", undefined, { ...rows[0], best_level: undefined, level: null }).map(rung => rung.state)).toEqual(["ahead", "ahead", "ahead"]);
  });
});

describe("body insight and curiosity lines (real data only)", () => {
  const results = byTask(taskResults);

  it("says what each area held alone, with the arm's measured peak angle", () => {
    expect(bodyInsight(ARM, results)).toBe("You lifted your hand above your shoulder and brought your hand to your mouth on your own. Your arm rose to about 110° from your side.");
    expect(bodyInsight(HAND, results)).toBe("You opened your fingers part of the way and brought your thumb close to your first finger on your own.");
  });

  it("never states an angle that was not measured", () => {
    const line = bodyInsight(ARM, byTask([{ ...T1, insights: {} }, T3]));
    expect(line).not.toMatch(/°|\d/);
    expect(bodyInsight(ARM, byTask([{ ...T1, insights: { shoulder_flexion: Number.NaN } }]))).not.toContain("°");
    expect(bodyInsight(ARM, byTask([task("T3", [attempt("mouth", true)], { insights: { peak_elbow_flexion: 118 } })]))).toBe("You brought your hand to your mouth on your own. Your elbow bent to about 120°.");
  });

  it("falls back to help, a touch without the hold, then how far the movement got", () => {
    const helped = task("T1", [attempt("r80", false, { peakProgress: 0.4 }), attempt("r80", true, { assist: "helper" })]);
    expect(bodyInsight(ARM, byTask([helped]))).toBe("With help, you lifted your hand to chest height.");
    const touched = task("H4", [attempt("partial", false, { touched: true, peakProgress: 1 })]);
    expect(bodyInsight(HAND, byTask([touched]))).toBe("Your fingers reached the inner ring; holding it there comes next.");
    const partWay = task("T1", [attempt("r80", false, { peakProgress: 0.3 })], { tryOut: { completed: false, peakProgress: 0.42 } });
    expect(bodyInsight(ARM, byTask([partWay]))).toBe("Your hand moved about 40% of the way to the chest-height circle.");
  });

  it("names pinch's partial target as the spot its level asks for, which its progress measures toward", () => {
    const touched = task("H3", [attempt("partial", false, { touched: true, peakProgress: 1 })]);
    expect(bodyInsight(HAND, byTask([touched]))).toBe("Your thumb reached the spot close to your first finger; holding it there comes next.");
    const partWay = task("H3", [attempt("partial", false, { peakProgress: 0.5 })], { tryOut: { completed: false, peakProgress: 0.7 } });
    expect(bodyInsight(HAND, byTask([partWay]))).toBe("Your thumb moved about 70% of the way to the spot close to your first finger.");
    // Tip to tip is touching the finger itself.
    expect(bodyInsight(HAND, byTask([task("H3", [attempt("full", false, { level: 1, touched: true, peakProgress: 1 })])]))).toBe("Your thumb reached your first finger; holding it there comes next.");
  });

  it("says the arm's angle only beside a level its own task held alone", () => {
    // Nothing lifted: the resting arm's angle is not a movement.
    const still = task("T1", [attempt("r80", false, { peakProgress: 0.05 })], { tryOut: { completed: false, peakProgress: 0.02 }, insights: { shoulder_flexion: 25 } });
    expect(bodyInsight(ARM, byTask([still]))).toBe("Today sets your starting point. Every level from here is a step forward.");
    // Held only with help: the angle came from the try on the patient's own.
    const helped = task("T1", [attempt("r160", false, { peakProgress: 0.4 }), attempt("r160", true, { assist: "helper" })], { insights: { shoulder_flexion: 40 } });
    expect(bodyInsight(ARM, byTask([helped]))).toBe("With help, you reached overhead.");
    // Reach failed, hand to mouth held: the reach's angle is not hand to mouth's.
    const failed = task("T1", [attempt("r80", false, { peakProgress: 0.2 })], { insights: { shoulder_flexion: 25 } });
    expect(bodyInsight(ARM, byTask([failed, task("T3", [attempt("mouth", true)])]))).toBe("You brought your hand to your mouth on your own.");
    expect(bodyInsight(ARM, byTask([failed, task("T3", [attempt("mouth", true)], { insights: { elbow_flexion: 131 } })]))).toBe("You brought your hand to your mouth on your own. Your elbow bent to about 130°.");
    // A touch without the hold, or part of the way: no angle either.
    const touched = task("T1", [attempt("r80", false, { touched: true, peakProgress: 1 })], { insights: { shoulder_flexion: 70 } });
    expect(bodyInsight(ARM, byTask([touched]))).not.toContain("°");
    expect(bodyInsight(ARM, byTask([{ ...failed, tryOut: { completed: false, peakProgress: 0.5 } }]))).toBe("Your hand moved about 50% of the way to the chest-height circle.");
  });

  it("has nothing to say about an area the camera did not measure", () => {
    expect(bodyInsight(ARM, {})).toBeNull();
    expect(bodyInsight(HAND, byTask([task("H4", [], { measured: false, stoppedBy: "not_measured" }), task("H3", [], { stoppedBy: "skipped" })]))).toBeNull();
    expect(curiosityLine(ARM, {})).toBeNull();
  });

  it("is curious about a helping move the camera confirmed, at the hardest level it was seen", () => {
    expect(curiosityLine(ARM, results)).toBe("Your shoulder tried to help when the target was above your shoulder. A sign your shoulder wants to join in; gentle practice can teach it to relax.");
  });

  it("ignores helping moves seen while someone was helping", () => {
    const helped = task("T1", [attempt("r80", false), attempt("r80", true, { assist: "helper", compensations: { other_hand: "detected" } })]);
    expect(curiosityLine(ARM, byTask([helped]))).toBeNull();
  });

  it("then a near miss above the best level, then a clean top level", () => {
    expect(curiosityLine(HAND, results)).toBe("Your thumb reached your first finger too, just not for the full hold yet. Holding is strength you can build.");
    expect(curiosityLine(HAND, byTask([H4]))).toBe("You got about 60% of the way to the wide ring. That edge is where practice counts most.");
    expect(curiosityLine(ARM, byTask([T3]))).toBe("You brought your hand to your mouth with no helping moves seen. Notice next time whether it feels easier.");
    // No checks recorded: "no helping moves seen" would be a claim without data.
    expect(curiosityLine(ARM, byTask([task("T3", [attempt("mouth", true)])]))).toBeNull();
    // A check the camera could not see is not a clean check.
    expect(curiosityLine(ARM, byTask([task("T3", [attempt("mouth", true, { compensations: { head_forward: "not_measured", trunk_forward: "not_detected" } })])]))).toBeNull();
  });

  it("names the next challenge from the scoring's next step, else the next level up", () => {
    expect(nextChallenge(ARM, taskRows(report), results)).toBe("The overhead circle.");
    expect(nextChallenge(HAND, taskRows(report), results)).toBe("Fingers wide open.");
    expect(nextChallenge(ARM, {}, byTask([T1]))).toBe("Reach overhead.");
    expect(nextChallenge(ARM, {}, byTask([T3]))).toBeNull();
    expect(nextChallenge(WALK, {}, {})).toBeNull();
  });
});

describe("walking", () => {
  it("bands the speed as displayed, so the words match the number", () => {
    expect(speedBand(0.34).id).toBe("household");
    expect(speedBand(0.35).id).toBe("indoor");
    expect(speedBand(0.68)).toMatchObject({ id: "indoor", label: "Indoor stroll" });
    expect(speedBand(0.74).id).toBe("indoor");
    expect(speedBand(0.79).id).toBe("community");
    expect(speedBand(1.3).label).toBe("Community pace");
  });

  it("reads step evenness from the symmetry, else from the two step lengths", () => {
    expect(stepEvenness(walking.status === "scored" ? walking.metrics : {})).toBe(94);
    expect(stepEvenness({ stepLengthA: 0.5, stepLengthB: 0.4 })).toBe(80);
    expect(stepEvenness({})).toBeNull();
  });

  it("describes the walk and one thing to notice, from its own numbers", () => {
    expect(walkingInsight(walking)).toBe("You walked across and back, 14 steps in all.");
    expect(walkingCuriosity(walking)).toBe("Your steps are 94% even in length. A steady rhythm to build on.");
    const scored = walking as Extract<GaitResult, { status: "scored" }>;
    const uneven = { ...scored, metrics: { ...scored.metrics, stepTimeSymmetry: 0.85 } };
    expect(walkingCuriosity(uneven)).toBe("One step takes a little longer than the other: your step timing is 85% even. Your body is still finding its rhythm.");
    const stiff = { ...scored, metrics: { ...scored.metrics, kneeFlexPeak: 34.6 } };
    expect(walkingCuriosity(stiff)).toBe("Your knee bends to about 35° as your foot swings. More bend helps your foot clear the floor.");
    expect(walkingInsight({ ...scored, metrics: { ...scored.metrics, passes: 1, steps: 8 } })).toBe("You walked across, 8 steps in all.");
    expect(walkingInsight({ ...scored, metrics: { ...scored.metrics, passes: 3 } })).toBe("You walked across 3 times, 14 steps in all.");
  });

  it("calls the lean extra only when a standing baseline was recorded", () => {
    const scored = walking as Extract<GaitResult, { status: "scored" }>;
    const leaning = { ...scored, metrics: { ...scored.metrics, trunkLeanDeg: 8.4 } };
    expect(walkingCuriosity(leaning)).toBe("You leaned about 8° further forward than when standing. Your body may be helping your legs along.");
    const baseline = { ...leaning, metrics: { ...leaning.metrics, trunkBaseline: true } };
    expect(walkingCuriosity(baseline)).toContain("further forward than when standing");
    const raw = { ...leaning, metrics: { ...leaning.metrics, trunkBaseline: false } };
    expect(walkingCuriosity(raw)).toBe("Your body leaned about 8° forward as you walked. Notice next time whether you can walk a little taller.");
    expect(walkingCuriosity(raw)).not.toContain("than when standing");
  });

  it("says nothing measured about a walk that was not measured", () => {
    const missed: GaitResult = { status: "not_measured", reason: "I saw too few steps. Walk a little further across the picture.", metrics: { steps: 3 } };
    expect(walkingInsight(missed)).toBeNull();
    expect(walkingCuriosity(missed)).toBeNull();
    expect(walkingInsight(null)).toBeNull();
  });
});

describe("since last time and the next check-up", () => {
  it("compares with the most recent earlier check, never with this one", () => {
    const since = sinceLastTime(report, previous)!;
    expect(since.when.getDate()).toBe(2);
    // Walking is new today, so the total compares arm and hand only, by name; the sparkline totals the same two areas.
    expect(since.changes.map(change => [change.key, change.name, change.delta])).toEqual([
      ["total", "Arm and hand together", 3], ["upper_limb", "Arm", 8], ["hand", "Hand", -3], ["lower_limb", "Walking", null]]);
    expect(since.changes.find(change => change.key === "lower_limb")).toMatchObject({ now: 72, before: null });
    expect(since.totals).toEqual([45, 60, 63]);
    expect(since.totalsName).toBe("Arm and hand together");
    expect(sinceLastTime(report, [previous[0]])).toBeNull();
    expect(sinceLastTime(report, [])).toBeNull();
  });

  it("totals the same areas both times: skipping one is not a drop", () => {
    const last: JourneyAssessment = { id: "native-last", completedAt: "2026-10-02T10:00:00", scores: { upper_limb: 50, hand: 50, lower_limb: 80 } };
    const today = reportWith({ upper_limb: 55, hand: 55, lower_limb: null }, 55);
    const since = sinceLastTime(today, [last])!;
    expect(since.changes.map(change => [change.name, change.delta])).toEqual([["Arm and hand together", 5], ["Arm", 5], ["Hand", 5]]);
    expect(since.totals).toEqual([50, 55]);
    // Every area both times: the daily function score itself.
    const all = sinceLastTime(reportWith({ upper_limb: 55, hand: 55, lower_limb: 70 }, 60), [last])!;
    expect(all.changes[0]).toMatchObject({ key: "total", name: "Daily function score", now: 60, before: 60, delta: 0 });
    expect(all.totalsName).toBe("Daily function score");
    // One shared area is its own chip; nothing shared, no total.
    const one = sinceLastTime(reportWith({ upper_limb: 60, hand: null, lower_limb: null }, 60), [last])!;
    expect(one.changes.map(change => change.key)).toEqual(["upper_limb"]);
    expect(one.totalsName).toBe("Arm");
    const none = sinceLastTime(reportWith({ upper_limb: 60, hand: null, lower_limb: null }, 60), [{ ...last, scores: { upper_limb: null, hand: 40, lower_limb: null } }])!;
    expect(none.changes.map(change => [change.key, change.delta])).toEqual([["upper_limb", null]]);
    expect(none.totals).toEqual([]);
  });

  it("totals today as the Journey keeps it, so the same check again is the same", () => {
    // Arm 62.5 and hand 37.5 display as 63 and 38: the scoring's total is 50, the Journey's 51.
    const today = reportWith({ upper_limb: 63, hand: 38, lower_limb: null }, 50);
    const since = sinceLastTime(today, [{ id: "native-last", completedAt: "2026-10-02T10:00:00", scores: { upper_limb: 63, hand: 38, lower_limb: null } }])!;
    expect(since.changes[0]).toMatchObject({ name: "Daily function score", delta: 0 });
    expect(since.totals).toEqual([51, 51]);
  });

  it("compares an area the last check skipped with the most recent check that measured it", () => {
    const checks: JourneyAssessment[] = [
      { id: "native-1", completedAt: "2026-08-20T10:00:00", scores: { upper_limb: 50, hand: 50, lower_limb: 60 } },
      { id: "native-2", completedAt: "2026-10-02T10:00:00", scores: { upper_limb: 50, hand: 50, lower_limb: null } },
    ];
    const since = sinceLastTime(reportWith({ upper_limb: 50, hand: 50, lower_limb: 65 }, 55), checks)!;
    const walk = since.changes.find(change => change.key === "lower_limb")!;
    expect(walk).toMatchObject({ before: 60, delta: 5 });
    expect(walk.since?.getDate()).toBe(20);
    expect(since.changes.find(change => change.key === "hand")?.since).toBeUndefined();
    const text = words(render({ report: reportWith({ upper_limb: 50, hand: 50, lower_limb: 65 }, 55), previous: checks }));
    expect(text).toContain("Walking +5 ▲ since 20 Aug : up 5 points since 20 Aug");
    expect(text).not.toContain("first time");
  });

  it("has nothing to compare when today measured nothing", () => {
    const empty = reportWith({ upper_limb: null, hand: null, lower_limb: null }, null, []);
    expect(sinceLastTime(empty, previous)).toBeNull();
    const html = render({ report: empty, walking: null, taskResults: [] });
    expect(words(html)).not.toContain("Since last time");
    expect(html).not.toContain("ar-spark");
    expect(html).not.toContain('<ul class="ar-deltas"></ul>');
  });

  it("totals a stored check from its measured areas", () => {
    expect(journeyTotal({ upper_limb: 67, hand: 53, lower_limb: null })).toBe(60);
    expect(journeyTotal({ upper_limb: 50, hand: 41, lower_limb: null })).toBe(46);
    expect(journeyTotal({ upper_limb: null, hand: null, lower_limb: null })).toBeNull();
  });

  it("writes changes as +N ▲, −N ▼ or Same", () => {
    expect(deltaText(8)).toMatchObject({ text: "+8", arrow: "▲", say: "up 8 points", dir: "up" });
    expect(deltaText(-3)).toMatchObject({ text: "−3", arrow: "▼", say: "down 3 points", dir: "down" });
    expect(deltaText(-1)?.say).toBe("down 1 point");
    expect(deltaText(0)).toMatchObject({ text: "Same", dir: "same" });
    expect(deltaText(null)).toBeNull();
  });

  it("finds when the check finished and the check-up a re-assessment cycle on", () => {
    expect(REASSESSMENT_CYCLE_DAYS).toBe(14);
    expect(completedAtOf({ id: `native-${finished.getTime()}` }).getTime()).toBe(finished.getTime());
    expect(completedAtOf({ id: "native-2026-10-09T15:30:00" }).getDate()).toBe(9);
    const fallback = new Date(2020, 0, 1);
    expect(completedAtOf({ id: "native-soon" }, fallback)).toBe(fallback);
    expect(completedAtOf({}, fallback)).toBe(fallback);
    expect(nextCheckUp(finished)).toEqual(new Date(2026, 9, 23));
    expect(nextCheckUp(new Date(2026, 9, 25, 23, 50))).toEqual(new Date(2026, 10, 8));
  });

  it("sets one or two challenges from the next levels, most room first", () => {
    expect(checkUpChallenges(taskResults)).toEqual(["open your fingers wide", "touch your thumb and first finger tip to tip"]);
    expect(checkUpChallenges([T1, T3])).toEqual(["reach overhead"]);
    const topWithHike = task("T1", [attempt("r160", true, { level: 2, compensations: { shoulder_hike: "detected" } })], { stoppedBy: "top_reached" });
    expect(checkUpChallenges([topWithHike, T3])).toEqual(["reach overhead with your shoulder relaxed"]);
    expect(checkUpChallenges([task("H3", [], { stoppedBy: "skipped" })])).toEqual([]);
  });
});

describe("the results page", () => {
  it("opens with the movement map, the daily function score and every area named in words", () => {
    const html = render();
    const text = words(html);
    expect(html).toContain("<h1");
    expect(text).toContain("Your movement map");
    expect(html).toContain('aria-label="Daily function score: 66 out of 100, building"');
    expect(html).toMatch(/class="ar-map" viewBox="0 0 220 330" role="img" aria-label="Your movement map. Arm 75, strong; Hand 50, building; Walking 72, building."/);
    expect(text).toContain("Arm 75 · Strong");
    expect(text).toContain("Hand 50 · Building");
    expect(text).toContain("Walking 72 · Building");
    expect(html.match(/<h2/g)?.length).toBe(5);
    expect(text).not.toContain("Test run");
  });

  it("glows only the affected side's arm and hand", () => {
    const right = render();
    expect(right.match(/class="ar-lit ar-limb is-strong"/g)?.length).toBe(1);
    expect(right).toContain('points="86,86 66,134 58,178" class="ar-lit ar-limb is-strong"');
    const left = render({ taskResults: taskResults.map(result => ({ ...result, side: "left" as const })) });
    expect(left).toContain('points="134,86 154,134 162,178" class="ar-lit ar-limb is-strong"');
  });

  it("counts up from zero with motion, and the full score is read out at once", () => {
    const html = render();
    expect(ringNumbers(html)).toEqual(["0", "0", "0", "0"]);
    expect(html).toContain('aria-label="Arm score: 75 out of 100, strong"');
    expect(html).toContain('class="ar-page"');
    expect(html).toContain("--beat:0.625s");
  });

  it("shows the final state at once with reduced motion", () => {
    stillDevice();
    const html = render();
    expect(ringNumbers(html)).toEqual(["66", "75", "50", "72"]);
    expect(html).toContain('class="ar-page is-still"');
    const circumference = 2 * Math.PI * 52;
    expect(html).toContain(`stroke-dashoffset="${(circumference * (1 - 0.66)).toFixed(2)}"`);
  });

  it("climbs each task's ladder with words beside the ticks", () => {
    const text = words(render());
    expect(text).toContain("Reach Partly");
    expect(text).toContain("✓ Above your shoulder : held on your own");
    expect(text).toContain("✓ Chest height : within reach, you held a harder level");
    expect(text).toContain("○ Overhead not yet : not this time");
    expect(text).toContain("Hand to mouth Can do well");
    expect(text).toContain("Body insight You lifted your hand above your shoulder and brought your hand to your mouth on your own. Your arm rose to about 110° from your side.");
    expect(text).toContain("Did you notice? Your shoulder tried to help when the target was above your shoulder.");
    expect(text).toContain("Next challenge The overhead circle.");
  });

  it("gives walking its speed band, rhythm, footprints and knee gauge from the real walk", () => {
    const html = render();
    const text = words(html);
    expect(text).toContain("About 0.7 m/s");
    expect(text).toContain("Indoor stroll");
    // The marker sits at the speed as shown (0.7 of the scale's 1.4 m/s), not the raw 0.68.
    expect(html).toContain("--at:50.0%");
    expect(text).toContain("96 steps a minute");
    expect(text).toContain("94% even in length");
    expect(html).toContain("the shorter step is 94% of the longer");
    expect(text).toContain("Knee bend (stiffer side)");
    expect(text).toContain("48° as your foot swings");
    expect(html).toContain('aria-label="Knee bend as your foot swings: 48 degrees"');
    expect(text).toContain("You walked across and back, 14 steps in all.");
    expect(text).not.toContain("The walk itself scored");
  });

  it("puts the pace marker in the stretch its words name", () => {
    const scored = walking as Extract<GaitResult, { status: "scored" }>;
    // 0.76 m/s shows as 0.8, community pace: the marker sits where community pace starts (0.8 / 1.4), not in the indoor stretch.
    const html = render({ walking: { ...scored, metrics: { ...scored.metrics, speedMpsEstimate: 0.76 } } });
    expect(words(html)).toContain("About 0.8 m/s Community pace");
    expect(html).toContain("--at:57.1%");
    expect(html).not.toContain("--at:54.3%");
  });

  it("is honest when walking could not be measured", () => {
    const missed: GaitResult = { status: "not_measured", reason: "I saw too few steps. Walk a little further across the picture.", metrics: { steps: 3, cadence: 70 } };
    const html = render({ walking: missed, report: reportWith({ upper_limb: 75, hand: 50, lower_limb: null }, 63, [...rows.slice(0, 4), { task_id: "L6", task_label: "Walking", points: null, level: null, label: "Not measured" }]) });
    const text = words(html);
    expect(text).toContain("I couldn't measure your walking this time. I saw too few steps. Walk a little further across the picture.");
    expect(text).toContain("Try walking next time.");
    expect(html).toContain('aria-label="Walking score: not measured"');
    expect(text).toContain("Walking Not measured");
    expect(text).not.toMatch(/m\/s|steps a minute|70|3 steps/);
  });

  it("does not push walking on someone who skipped it", () => {
    const text = words(render({ walking: { status: "skipped", reason: "Uses a wheelchair" }, report: reportWith({ upper_limb: 75, hand: 50, lower_limb: null }, 63, rows.slice(0, 4)) }));
    expect(text).toContain("Walking was not part of today's check.");
    expect(text).not.toContain("Try walking next time");
  });

  it("treats a skipped walk as a choice when the page passes no walk, only the report's skipped row", () => {
    // What the page does for "Skip this task" and "Skip walking today": no walk, and the report's L6 row from a skip.
    const skippedRow = walkingScore({ status: "skipped", reason: "Skipped" });
    const text = words(render({ walking: null, report: reportWith({ upper_limb: 75, hand: 50, lower_limb: null }, 63, [...rows.slice(0, 4), skippedRow]) }));
    expect(text).toContain("Walking was not part of today's check.");
    expect(text).not.toContain("couldn't measure");
    expect(text).not.toContain("Try walking next time");
    // A walk that was tried and not measured still says so.
    const missedRow = walkingScore({ status: "not_measured", reason: "I didn't see you walk across." });
    expect(words(render({ walking: null, report: reportWith({ upper_limb: 75, hand: 50, lower_limb: null }, 63, [...rows.slice(0, 4), missedRow]) }))).toContain("I couldn't measure your walking this time.");
  });

  it("says when someone held the patient, with both real scores", () => {
    const scored = walking as Extract<GaitResult, { status: "scored" }>;
    const text = words(render({ walking: { ...scored, assist: "holds", score: 68.4, areaScore: 50 }, report: reportWith({ upper_limb: 75, hand: 50, lower_limb: 50 }, 58) }));
    expect(text).toContain("The walk itself scored 68; because someone held you, walking counts at most 50.");
    expect(text).not.toContain("on its own");
  });

  it("shows the change since last time, with a sparkline of totals", () => {
    const html = render();
    const text = words(html);
    expect(text).toContain("Since last time");
    expect(text).toContain("Compared with your check on 2 Oct.");
    // Walking was not measured last time: the total compares arm and hand, and says so.
    expect(text).toContain("Arm and hand together +3 ▲ : up 3 points");
    expect(text).not.toContain("Daily function score +");
    expect(text).toContain("Arm +8 ▲ : up 8 points");
    expect(text).toContain("Hand −3 ▼ : down 3 points");
    expect(text).toContain("Walking Not measured last time : not measured last time");
    expect(text).not.toContain("first time");
    expect(html).toContain('aria-label="Arm and hand together at each check, oldest first: 45, 60, 63"');
    expect(text).toContain("Arm and hand together at each check, oldest first");
    expect(html).toMatch(/>45<\/text>/);
    expect(html).toMatch(/class="is-now" aria-hidden="true">63<\/text>/);
    // The same areas every time: the daily function score itself.
    const same = words(render({ previous: [{ id: "native-older", completedAt: "2026-10-02T10:00:00", scores: { upper_limb: 67, hand: 53, lower_limb: 60 } }] }));
    expect(same).toContain("Daily function score +6 ▲ : up 6 points");
    expect(same).toContain("Daily function score at each check, oldest first");
  });

  it("leaves out since last time on the first check", () => {
    expect(words(render({ previous: [] }))).not.toContain("Since last time");
    expect(words(render({ previous: [previous[0]] }))).not.toContain("Since last time");
  });

  it("dates the next check-up and sets challenges from the next levels", () => {
    const html = render();
    const text = words(html);
    expect(html).toContain('dateTime="2026-10-23"');
    expect(text).toContain("Friday 23 October");
    expect(text).toContain("14 days after this check.");
    expect(text).toContain("Until then, try to: open your fingers wide touch your thumb and first finger tip to tip");
    expect(text).toContain("Come back to see your map change.");
  });

  it("explains how it scored, with the walk's real components", () => {
    const text = words(render());
    expect(text).toContain("How we scored this");
    expect(text).toContain("100 Can do well: the top level, on your own, with no helping moves seen.");
    expect(text).toContain("30% Walking speed : yours 31 of 100");
    expect(text).toContain("10% Upright trunk : yours 100 of 100");
    expect(text).toContain("These are engineering estimates, not a medical diagnosis.");
    expect(words(render({ walking: null }))).not.toContain("yours");
  });

  it("marks a simulated run and offers the two ways on", () => {
    const html = render({ report: { ...report, testing_random: true } });
    expect(words(html)).toContain("Test run with a simulated patient. These numbers are not yours.");
    expect(html).toMatch(/<button[^>]* type="button" class="ar-primary">Continue to Alira/);
    expect(html).toMatch(/<button[^>]* type="button" class="ar-secondary">Go to my home<\/button>/);
  });

  it("shows a skipped pinch and an unmeasured area without inventing anything", () => {
    const sparse = reportWith({ upper_limb: null, hand: 50, lower_limb: null }, 50, [
      { task_id: "H4", task_label: "Hand opening", points: 100, level: 4, label: "Can do well" },
      { task_id: "H3", task_label: "Pinch", points: 0, level: 0, label: "Not yet: comes after hand opening" },
    ]);
    const html = render({ report: sparse, walking: null, previous: [], taskResults: [
      task("T1", [], { measured: false, stoppedBy: "not_measured" }),
      task("H4", [attempt("full", true, { level: 1 })], { stoppedBy: "top_reached" }),
      task("H3", [], { stoppedBy: "skipped" }),
    ] });
    const text = words(html);
    expect(html).toContain('aria-label="Arm score: not measured"');
    expect(text).toContain("Not measured this time. We'll try again at your next check-up.");
    expect(text).toContain("Pinch Not yet: comes after hand opening");
    expect(text).toContain("You opened your fingers wide on your own.");
    expect(text).not.toContain("°");
    expect(text).toContain("Walking was not part of today's check.");
  });
});

/** A clock for countUp: timers run when due; while `frames` is on, an animation frame runs every 16 ms. */
function fakeClock() {
  let time = 0, next = 1;
  let timers: { id: number; at: number; run: () => void }[] = [];
  let frames: { id: number; tick: () => void }[] = [];
  const state = { frames: true };
  const clock: CountUpClock = {
    now: () => time,
    frame: tick => { const id = next++; frames.push({ id, tick }); return id; },
    cancelFrame: id => { frames = frames.filter(item => item.id !== id); },
    after: (ms, run) => { const id = next++; timers.push({ id, at: time + ms, run }); return id; },
    cancelAfter: id => { timers = timers.filter(item => item.id !== id); },
  };
  const advanceTo = (end: number) => {
    for (;;) {
      const due = timers.filter(item => item.at <= time).sort((a, b) => a.at - b.at)[0];
      if (due) { timers = timers.filter(item => item !== due); due.run(); continue; }
      if (time >= end) return;
      const frameAt = state.frames && frames.length ? time + 16 : Number.POSITIVE_INFINITY;
      time = Math.min(end, frameAt, ...timers.map(item => item.at));
      if (time === frameAt) { const ticks = frames; frames = []; ticks.forEach(item => item.tick()); }
    }
  };
  return { clock, state, advanceTo, pending: () => timers.length + frames.length };
}

describe("the numbers counting up", () => {
  const last = (values: number[]) => values[values.length - 1];
  const fallbackMs = COUNT_UP_MS + COUNT_UP_GRACE_MS;

  it("shows the real number within COUNT_UP_MS + 300 ms when animation frames never run (a hidden tab)", () => {
    expect(COUNT_UP_GRACE_MS).toBe(300);
    // The hero ring and the three area rings (their delays).
    for (const delay of [0, 400, 620, 840]) {
      const { clock, state, advanceTo, pending } = fakeClock();
      state.frames = false;
      const shown: number[] = [];
      countUp(66, delay, value => shown.push(value), clock);
      expect(shown).toEqual([0]);
      advanceTo(fallbackMs - 1);
      expect(last(shown)).toBe(0);
      advanceTo(fallbackMs);
      expect(last(shown)).toBe(66);
      expect(pending()).toBe(0);
    }
  });

  it("counts up on animation frames without a jump at the end", () => {
    const { clock, advanceTo, pending } = fakeClock();
    const shown: number[] = [];
    countUp(72, 400, value => shown.push(value), clock);
    advanceTo(400);
    expect(last(shown)).toBe(0);
    advanceTo(400 + COUNT_UP_MS / 2);
    expect(last(shown)).toBeGreaterThan(50);
    expect(last(shown)).toBeLessThan(72);
    // The first frame at or after the end shows the target exactly.
    advanceTo(400 + COUNT_UP_MS + 16);
    expect(last(shown)).toBe(72);
    expect(shown.every((value, index) => index === 0 || value >= shown[index - 1])).toBe(true);
    expect(Math.max(...shown)).toBe(72);
    const count = shown.length;
    advanceTo(10000);
    expect(shown.length).toBe(count);
    expect(pending()).toBe(0);
  });

  it("finishes a count whose frames stopped part-way, soon after its own end", () => {
    const { clock, state, advanceTo } = fakeClock();
    const shown: number[] = [];
    countUp(50, 840, value => shown.push(value), clock);
    advanceTo(1100);
    expect(last(shown)).toBeGreaterThan(0);
    state.frames = false;
    advanceTo(840 + fallbackMs - 1);
    expect(last(shown)).toBeLessThan(50);
    advanceTo(840 + fallbackMs);
    expect(last(shown)).toBe(50);
  });

  it("stops when asked (the page left, or the number changed)", () => {
    const { clock, advanceTo, pending } = fakeClock();
    const shown: number[] = [];
    const stop = countUp(66, 0, value => shown.push(value), clock);
    advanceTo(200);
    stop();
    const count = shown.length;
    advanceTo(10000);
    expect(shown.length).toBe(count);
    expect(pending()).toBe(0);
  });

  it("reads every ring's real number out while the digits count", () => {
    const html = render();
    expect(ringNumbers(html)).toEqual(["0", "0", "0", "0"]);
    for (const label of ["Daily function score: 66 out of 100", "Arm score: 75 out of 100", "Hand score: 50 out of 100", "Walking score: 72 out of 100"]) expect(html).toContain(`aria-label="${label}`);
  });
});

describe("contrast", () => {
  const css = readFileSync(fileURLToPath(new URL("./assessment-results.css", import.meta.url)), "utf8");
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };
  const rule = (selector: string) => css.split(/\r?\n/).find(line => line.startsWith(`${selector} {`)) ?? "";
  const token = (name: string) => new RegExp(`--${name}:(#[0-9a-f]{6})`).exec(css)?.[1] ?? "";
  /** A property's colour in a rule, following var(--token) to its value. */
  const colour = (selector: string, property: string) => {
    const raw = new RegExp(`(?:^|[;{ ])${property}:([^;}]+)`).exec(rule(selector))?.[1].trim() ?? "";
    const ref = /^var\(--([\w-]+)\)$/.exec(raw);
    return ref ? token(ref[1]) : raw;
  };

  it("keeps small text at least 4.5:1 on its background", () => {
    const pairs: [string, string, string][] = [
      [".ar-eyebrow", "color", "#f4f5ee"], [".ar-ring-caption", "color", "#fffefa"], [".ar-stat-name", "color", "#f6f8f1"],
      [".ar-stat-note", "color", "#f6f8f1"], [".ar-pace-words", "color", "#f6f8f1"], [".ar-knee text", "fill", "#f6f8f1"],
      [".ar-spark text", "fill", "#fffefa"], [".ar-spark figcaption", "color", "#fffefa"], [".ar-delta small", "color", "#ffffff"],
      [".ar-rung", "color", "#ffffff"], [".ar-muted", "color", "#fffefa"], [".ar-task-level", "color", "#fffefa"],
      [".ar-curious b", "color", colour(".ar-curious", "background")],
    ];
    for (const [selector, property, background] of pairs) {
      const text = colour(selector, property);
      expect(text, selector).toMatch(/^#[0-9a-f]{6}$/);
      expect(ratio(text, background), selector).toBeGreaterThanOrEqual(4.5);
    }
    for (const chip of [".ar-delta.is-up b", ".ar-delta.is-down b"]) expect(ratio(colour(chip, "color"), colour(chip, "background")), chip).toBeGreaterThanOrEqual(4.5);
    expect(css).not.toContain("#7a8a7d");
  });
});
