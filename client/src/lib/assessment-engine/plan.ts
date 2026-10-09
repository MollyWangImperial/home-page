// The exercise plan from the native movement check (pure): a port of the Rehyn backend's function_rehab_plan.py
// (rehyn-function-plan-1) onto the companion's exercises. The two lowest tasks, a goal task and a success task each get
// a slot; a level of 1 or less goes to a carer-supported domain instead. Walking measured below 75 adds two seated leg
// exercises. The storage code puts the everyday reach first (withEverydayExercise). Engineering defaults, to be
// reviewed by a clinician.

import type { OnboardingAnswers } from "../alira-onboarding";
import type { PlanExercise } from "../assessment";
import { EVERYDAY_EXERCISE_ID, EXERCISES, REPS_BY_RUNG, type Domain } from "../exercise-engine/config";
import type { CameraTaskId, CompStatus, GaitResult } from "./types";

/** The impairment each task names when its level is 2 or 3 (function_rehab_plan.py TASK_CODES). */
const TASK_CODES: Record<CameraTaskId, string> = { T1: "REACH_INCOMPLETE", T3: "H2M_IMPAIRED", H4: "HAND_OPENING", H3: "PINCH_IMPAIRED" };
const TASK_ORDER = Object.keys(TASK_CODES) as CameraTaskId[];
/** The backend's codes on the companion's exercises. */
export const CODE_EXERCISE: Record<string, string> = {
  REACH_INCOMPLETE: "ex_reach", TRUNK_COMP: "ex_reach", SHOULDER_HIKE: "ex_wallslide", H2M_IMPAIRED: "ex_h2m",
  GROSS_GRASP: "ex_grasp", HAND_OPENING: "ex_handopen", PINCH_IMPAIRED: "ex_pinch",
};
/** The tasks behind each everyday goal, matched as a word inside the goal (function_rehab_plan.py GOAL_TASKS). */
const GOAL_TASKS: [string, CameraTaskId[]][] = [["eating", ["T3", "H4"]], ["dressing", ["H3", "T1", "H4"]], ["grooming", ["T1", "T3", "H4"]], ["drinking", ["T3", "H4"]]];
export const SLOT_COUNT = 4;
/** Walking measured below this (the walking area's unrounded score) adds the leg exercises. */
export const WALKING_PLAN_BELOW = 75;
export const WALKING_EXERCISES = ["ex_lower_selective", "ex_ankle_dorsiflexion"];
/** At most this many exercises a day, counting the everyday reach the storage code adds. */
export const PLAN_LIMIT = 6;
/** The goals that walking exercises serve (JourneyExercises' goal labels). */
const WALKING_GOALS = ["walking_house", "going_out"];
/** Leaning checks: the reach's own (face approach) and the other seated tasks' (whole-trunk approach). */
const TRUNK_CHECKS = ["trunk_lean", "trunk_forward"];

/** Short, patient-friendly descriptions, after each exercise's own cycle and set-up. */
const DESCRIPTION: Record<string, string> = {
  ex_reach: "Seated. Reach forward to the target and back, slowly, with your affected arm.",
  ex_h2m: "Seated. Bring the cup on your screen up to your mouth, hold, then lower it slowly.",
  ex_wallslide: "Seated, forearm resting beside you. Slide your hand out to the cup and back, shoulder relaxed.",
  ex_handopen: "Elbow resting, palm to the camera. Open your fingers out to the ring, hold, then relax.",
  ex_grasp: "Seated. Pick up the cup on your screen, carry it across your body and set it down.",
  ex_pinch: "Elbow resting, palm to the camera. Bring your thumb to your fingertip, tip to tip, and hold.",
  ex_lower_selective: "Seated, feet flat. Straighten your knee slowly, hold, then lower your foot.",
  ex_ankle_dorsiflexion: "Seated, feet flat. Keep your heel down, lift your toes, hold, then lower slowly.",
};
const SAFETY_NOTE = "Sit in a stable chair and move in a comfortable range. Stop for pain, dizziness or new weakness.";
const LEG_SAFETY_NOTE = "Sit in a stable chair with a back, with someone nearby if your balance is unsteady. Stop for pain, cramp or dizziness.";

const TASK_WORD: Record<CameraTaskId, string> = { T1: "reach", T3: "hand-to-mouth movement", H4: "hand opening", H3: "pinch" };
/** Why the plan changed the exercise from the task's own: posture to practise, or a harder use of a movement done well. */
const CODE_NOTE: Record<string, string> = {
  TRUNK_COMP: "It practises reaching while you sit tall.",
  SHOULDER_HIKE: "It practises moving your arm with your shoulder relaxed.",
  GROSS_GRASP: "It puts your movement to work, gripping and carrying a cup.",
};

type Slot = "building" | "goal" | "success" | "walking";
type ScoreRow = { task_id: string; level: number | null; compensations?: Record<string, CompStatus | string> };
type Choice = { id: string; difficulty: "easy" | "medium"; slots: { slot: Slot; task?: CameraTaskId; code?: string }[] };
export type PlanSelection = { exercises: PlanExercise[]; caregiver_domains: Domain[] };

const isCameraTask = (id: string): id is CameraTaskId => Object.hasOwn(TASK_CODES, id);

function reasonFor(choice: Choice): string {
  const sentences: string[] = [];
  const add = (text: string) => { if (text && !sentences.includes(text)) sentences.push(text); };
  const building = choice.slots.some(item => item.slot === "building");
  for (const { slot, task, code } of choice.slots) {
    if (slot === "building" && task) add(`It builds up your ${TASK_WORD[task]}, one of the harder movements in your check.`);
    // The same exercise cannot be both the hardest and the strongest movement: building says it.
    if (slot === "success" && task && !building) add(`It builds on your ${TASK_WORD[task]}, your strongest movement in your check.`);
    if (slot === "goal") add("It works toward your everyday goal.");
    if (slot === "walking") add("It strengthens the leg movements you use for walking.");
    if (code && CODE_NOTE[code]) add(CODE_NOTE[code]);
  }
  return sentences.join(" ");
}

/** The plan and the carer-supported domains, from the task levels, the survey's goal and walking. */
export function planSelection(score: { tasks: readonly ScoreRow[] }, answers: OnboardingAnswers = {}, walking: GaitResult | null = null): PlanSelection {
  const rows = score.tasks.filter((row): row is ScoreRow & { task_id: CameraTaskId; level: number } => isCameraTask(row.task_id) && typeof row.level === "number");
  const ranked = [...rows].sort((a, b) => a.level - b.level || TASK_ORDER.indexOf(a.task_id) - TASK_ORDER.indexOf(b.task_id));
  const candidates = ranked.slice(0, 2).map(row => [row, "building"] as [typeof row, Slot]);
  const mainGoal = typeof answers.main_goal === "string" ? answers.main_goal : "";
  // "Something else" is matched on the patient's own words, as the backend matched its free-text priority.
  const goalText = (mainGoal === "other" && typeof answers.main_goal_other === "string" ? answers.main_goal_other : mainGoal).toLowerCase();
  const goalTasks = GOAL_TASKS.find(([key]) => goalText.includes(key))?.[1] ?? [];
  const goalRow = goalTasks.map(taskId => ranked.find(row => row.task_id === taskId)).find(row => !!row);
  if (goalRow) candidates.push([goalRow, "goal"]);
  if (ranked.length) candidates.push([ranked[ranked.length - 1], "success"]);

  const choices: Choice[] = [];
  const caregiver: Domain[] = [];
  const choose = (id: string, difficulty: Choice["difficulty"], slot: Choice["slots"][number]) => {
    // One exercise once: a second slot for it is combined, never replaced by an unrelated filler.
    const existing = choices.find(choice => choice.id === id);
    if (existing) existing.slots.push(slot);
    else choices.push({ id, difficulty, slots: [slot] });
  };
  for (const [row, slot] of candidates.slice(0, SLOT_COUNT)) {
    const { task_id: task, level } = row;
    if (level <= 1) {
      const domain: Domain = task.startsWith("H") ? "hand" : "upper_limb";
      if (!caregiver.includes(domain)) caregiver.push(domain);
      continue;
    }
    let code = TASK_CODES[task];
    if (level === 3) {
      const checks: Record<string, string> = row.compensations ?? {};
      code = TRUNK_CHECKS.some(id => checks[id] === "detected") ? "TRUNK_COMP" : checks.shoulder_hike === "detected" ? "SHOULDER_HIKE" : code;
    } else if (level >= 4) code = task === "H3" ? "PINCH_IMPAIRED" : "GROSS_GRASP";
    choose(CODE_EXERCISE[code], level === 2 ? "easy" : "medium", { slot, task, code: code === TASK_CODES[task] ? undefined : code });
  }
  if (walking?.status === "scored" && Number.isFinite(walking.areaScore) && walking.areaScore < WALKING_PLAN_BELOW) {
    for (const id of WALKING_EXERCISES) choose(id, "easy", { slot: "walking" });
  }

  // Over the daily limit (with the everyday reach): a success-only exercise goes first, then the last chosen.
  const limit = choices.some(choice => choice.id === EVERYDAY_EXERCISE_ID) ? PLAN_LIMIT : PLAN_LIMIT - 1;
  while (choices.length > limit) {
    let drop = choices.length - 1;
    for (let index = choices.length - 1; index >= 0; index--) {
      if (choices[index].slots.every(item => item.slot === "success")) { drop = index; break; }
    }
    choices.splice(drop, 1);
  }

  const exercises = choices.map((choice): PlanExercise => {
    const leg = WALKING_EXERCISES.includes(choice.id);
    // The patient's own goal, as the backend links it; a leg exercise only names a walking goal.
    const linked = leg ? (WALKING_GOALS.includes(mainGoal) ? mainGoal : "") : mainGoal;
    return {
      id: choice.id, name: EXERCISES[choice.id]?.name ?? choice.id, description: DESCRIPTION[choice.id] ?? "",
      sets: 1, reps: REPS_BY_RUNG[1], frequency: "Daily", difficulty: choice.difficulty,
      selection_reason: reasonFor(choice), safety_note: leg ? LEG_SAFETY_NOTE : SAFETY_NOTE,
      ...(linked ? { linked_goal: linked } : {}),
    };
  });
  return { exercises, caregiver_domains: caregiver };
}

/** The daily exercise plan (no duplicates, never more than six with the everyday reach). */
export function buildRehabPlan(score: { tasks: readonly ScoreRow[] }, answers: OnboardingAnswers, walking: GaitResult | null): PlanExercise[] {
  return planSelection(score, answers, walking).exercises;
}
