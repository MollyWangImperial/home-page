// The movement check is the Rehyn app's real pose runner (backend/server.py, served at
// /api/pose/runner). The companion embeds it and listens for the messages it posts to its host.

export const DEFAULT_ASSESSMENT_BASE = "https://rehyn.onrender.com";
export const LOCAL_ASSESSMENT_BASE = "http://localhost:8001";

/** The backend origin that serves the runner. HTTPS anywhere, or plain HTTP on localhost only. */
export function getAssessmentBase(value: unknown, dev = false): string {
  if (typeof value === "string" && value.trim()) {
    try {
      const url = new URL(value.trim());
      const local = ["localhost", "127.0.0.1"].includes(url.hostname);
      const secure = url.protocol === "https:" || (url.protocol === "http:" && local);
      if (secure && !url.username && !url.password) return url.origin;
    } catch {
      /* fall through to the defaults */
    }
  }
  return dev ? LOCAL_ASSESSMENT_BASE : DEFAULT_ASSESSMENT_BASE;
}

import type { OnboardingAnswers } from "./alira-onboarding";

export type RunnerOptions = {
  affectedSide: "left" | "right";
  voiceGuidance?: boolean;
  plan?: CompanionTaskPlan;
  answers?: OnboardingAnswers;
  /** Start points that replace the plan's for the tasks they name (Alira's learned settings). */
  startRungs?: StartRungs;
};

/** Companion core tasks, with hand opening before pinch. The app keeps its own assignment. */
export const FUNCTION_CORE_TASK_IDS = ["T1", "T3", "H4", "H3", "L6"] as const;

export function assessmentPlanFrom(answers: OnboardingAnswers = {}) {
  const movement = answers.arm_hand_movement;
  const cameraTasks = movement === "none" ? [] : ["T1", "T3", "H4", "H3"];
  const taskIds = [...cameraTasks, ...(answers.get_around === "wheelchair" ? [] : ["L6"])];
  return {
    taskIds,
    startRung: { T1: movement === "little_help" ? "r80" : movement === "tires" ? "r120" : "r160", T3: movement === "little_help" ? "chest" : "mouth" },
    helper: answers.help_at_home === "own" && movement !== "little_help" ? "0" : "ask",
    walkingHelper: answers.get_around === "person",
    caregiverRoute: movement === "none",
    goal: typeof answers.main_goal === "string" ? answers.main_goal : "",
  };
}

/** Start points the runner understands, per task, easiest first. Without one, H4 and H3 start at "full". */
const START_RUNG_CHOICES: { [Task in keyof Required<StartRungs>]: readonly NonNullable<StartRungs[Task]>[] } = {
  T1: ["r80", "r120", "r160"], T3: ["chest", "mouth"], H4: ["partial", "full"], H3: ["partial", "full"],
};

/**
 * The start_rung JSON the runner reads per task, in task order: a learned start point where one is
 * set, otherwise the plan's. Only tasks and start points the runner knows are sent.
 */
function startRungJson(learned: Record<string, unknown> | undefined, planned: Record<string, unknown>): string {
  const out: Record<string, string> = {};
  for (const task of Object.keys(START_RUNG_CHOICES) as (keyof StartRungs)[]) {
    const choices: readonly unknown[] = START_RUNG_CHOICES[task];
    const value = [learned?.[task], planned[task]].find(item => choices.includes(item));
    if (typeof value === "string") out[task] = value;
  }
  return JSON.stringify(out);
}

/** The companion opts into the shared deterministic function ladder. */
export function buildRunnerUrl(base: string, { affectedSide, voiceGuidance = true, answers = {}, plan: suppliedPlan, startRungs }: RunnerOptions): string {
  const plan = suppliedPlan ? { taskIds: suppliedPlan.taskIds, startRung: suppliedPlan.startRungs,
    helper: suppliedPlan.helper === "none" ? "0" : "ask", walkingHelper: suppliedPlan.walkHelper,
    goal: suppliedPlan.mainGoal } : assessmentPlanFrom(answers);
  const query = new URLSearchParams();
  query.set("package", "initial");
  query.set("ladder", "1");
  query.set("task_ids", plan.taskIds.join(","));
  query.set("start_rung", startRungJson(startRungs, plan.startRung));
  query.set("helper", plan.helper);
  if (plan.walkingHelper) query.set("walking_helper", "1");
  if (plan.goal) query.set("main_goal", plan.goal);
  query.set("affected_side", affectedSide === "left" ? "left" : "right");
  query.set("voice_guidance", voiceGuidance ? "1" : "0");
  if (["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) query.set("local_preview", "1");
  return `${base}/api/pose/runner?${query.toString()}`;
}

/** The same assessment inside the Rehyn app (readiness intro, camera setup, then the runner). */
export function appAssessmentUrl(base: string): string {
  return `${base}/task-intro?mode=initial`;
}

export type RunnerMessage = { type: string } & Record<string, unknown>;

/** Messages the runner posts to its host (task_complete, assessment_complete, exit, ...). */
export function parseRunnerMessage(data: unknown): RunnerMessage | null {
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !type) return null;
  return value as RunnerMessage;
}

export const ASSESSMENT_RESULT_KEY = "rehyn.assessment.latest";

export type FunctionScore = {
  display_total: number | null;
  areas: Record<string, { display_score: number | null }>;
  tasks: { task_id: string; task_label: string; points: number | null; level: number | null }[];
};
export type PlanExercise = {
  id: string; name: string; description: string; sets: number; reps: number; frequency: string;
  difficulty?: string; target_rung?: string | null; selection_reason?: string; safety_note?: string; linked_goal?: string;
};
export type AssessmentReport = {
  id?: string; assessment_package?: string; preview_only?: boolean; testing_random?: boolean;
  task_results?: Record<string, unknown>[];
  metrics?: { function_score?: FunctionScore };
  rehab_plan?: PlanExercise[];
  function_rehab_plan?: { caregiver_domains?: string[]; candidate_only?: boolean };
  clinical_review_gate?: { rehab_access?: string; patient_message?: string };
};
export type StoredAssessment = { id: string; completedAt: string; package?: string; report?: AssessmentReport; planChatCompleted?: boolean };

/** Keep the scored report and task summaries, never camera frames or video blobs. */
function retainReport(record: AssessmentReport): AssessmentReport {
  return {
    id: record.id, assessment_package: record.assessment_package,
    preview_only: record.preview_only === true, testing_random: record.testing_random === true,
    metrics: record.metrics?.function_score ? { function_score: record.metrics.function_score } : undefined,
    task_results: Array.isArray(record.task_results) ? record.task_results.slice(0, 20).map(task => {
      const metrics = { ...(task.metrics as Record<string, unknown> ?? {}) };
      delete metrics.motion_data;
      delete metrics.gait_2d_evidence;
      return { task_id: task.task_id, duration_ms: task.duration_ms, completed_steps: task.completed_steps,
        total_steps: task.total_steps, steps: task.steps, metrics };
    }) : undefined,
    rehab_plan: Array.isArray(record.rehab_plan) ? record.rehab_plan : undefined,
    function_rehab_plan: record.function_rehab_plan, clinical_review_gate: record.clinical_review_gate,
  };
}

export function rememberAssessment(assessment: unknown): StoredAssessment | null {
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return null;
  const record = assessment as AssessmentReport;
  if (!(typeof record.id === "string" && record.id) && !(record.preview_only && record.metrics?.function_score)) return null;
  const id = record.id || `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stored: StoredAssessment = {
    id,
    completedAt: new Date().toISOString(),
    package: typeof record.assessment_package === "string" ? record.assessment_package : undefined,
    report: record.metrics?.function_score || Array.isArray(record.rehab_plan) ? retainReport(record) : undefined,
  };
  try {
    localStorage.setItem(ASSESSMENT_RESULT_KEY, JSON.stringify(stored));
  } catch {
    /* Storage can be blocked; the result still lives on the assessment service. */
  }
  return stored;
}

export function loadRememberedAssessment(): StoredAssessment | null {
  try {
    const raw = localStorage.getItem(ASSESSMENT_RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAssessment>;
    if (typeof parsed.id !== "string" || typeof parsed.completedAt !== "string") return null;
    const report = parsed.report?.metrics?.function_score || Array.isArray(parsed.report?.rehab_plan) ? parsed.report : undefined;
    return { id: parsed.id, completedAt: parsed.completedAt, package: parsed.package, report, planChatCompleted: parsed.planChatCompleted === true };
  } catch {
    return null;
  }
}

/** Updating the plan must not reset the assessment's completion/reassessment date. */
export function rememberAssessmentPlan(stored: StoredAssessment, report: AssessmentReport, planChatCompleted = stored.planChatCompleted): StoredAssessment {
  const updated = { ...stored, report: retainReport(report), planChatCompleted };
  try { localStorage.setItem(ASSESSMENT_RESULT_KEY, JSON.stringify(updated)); } catch { /* current page still has it */ }
  return updated;
}

// Compatibility for the Claude site's existing onboarding callers. The current
// camera runner receives the same 80/120/160 targets as the v2 assessment.
export type CoreTaskId = (typeof FUNCTION_CORE_TASK_IDS)[number];
// The survey sets T1 and T3; H4 and H3 are set only when Alira has learned a start point for them.
export type StartRungs = { T1?: "r80" | "r120" | "r160"; T3?: "chest" | "mouth"; H4?: "partial" | "full"; H3?: "partial" | "full" };
export type DailyActivity = "eating_drinking" | "dressing" | "moving_around";
export type CompanionTaskPlan = {
  taskIds: CoreTaskId[]; startRungs: StartRungs; helper: "none" | "ask";
  walkHelper: boolean; firstActivity?: DailyActivity; carerLed: boolean; mainGoal: string;
};
export function companionTaskPlan(answers: Partial<Record<string, unknown>> = {}): CompanionTaskPlan {
  const plan = assessmentPlanFrom(answers as OnboardingAnswers);
  const activities: Record<string, DailyActivity> = {
    eating: "eating_drinking", dressing: "dressing", walking_house: "moving_around", going_out: "moving_around",
  };
  return { taskIds: plan.taskIds as CoreTaskId[], startRungs: plan.startRung as StartRungs,
    helper: plan.helper === "0" ? "none" : "ask", walkHelper: plan.walkingHelper,
    firstActivity: Object.hasOwn(activities, plan.goal) ? activities[plan.goal] : undefined,
    carerLed: plan.caregiverRoute, mainGoal: plan.goal };
}
