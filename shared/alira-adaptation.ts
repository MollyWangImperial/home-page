// Alira's adaptation layer: the only way Alira's learning can change how Rehyn scores and sets up
// exercises and the movement check. Alira never edits code. She proposes a value for one of a small,
// fixed set of settings; the functions below accept it only inside that setting's bounds, its
// daily limit and the safety rules, and every accepted change is logged and can be undone.
//
// The browser (applying and storing settings) and the server (validating Alira's tool calls) both
// use this file, so it has no imports. Every number here is an engineering default that needs
// clinician review.

export const ADAPTATION_VERSION = "rehyn-adaptation-1";
/** Alira's changes per day across all settings (undone changes do not count). */
export const MAX_CHANGES_PER_DAY = 4;
export const LOG_LIMIT = 200;
export const SUMMARY_LIMIT = 30;

// ---------------------------------------------------------------- the settings Alira may adjust

export type ParamDomain = "exercise" | "assessment";
/** "demand" changes what the body is asked to do; "grading" only changes how a result is scored. */
export type ParamKind = "demand" | "grading";
export type ParamUnit = "seconds" | "times" | "share" | "points" | "start";

export type ParamSpec = {
  domain: ParamDomain;
  kind: ParamKind;
  label: string;
  /** Plain words for the admin view and for Alira. */
  meaning: string;
  unit: ParamUnit;
  /** null = decided by the survey answers, as before Alira learned anything. */
  default: number | null;
  min: number;
  max: number;
  step: number;
  /** Which direction makes it easier for the patient. */
  easier: "lower" | "higher";
  /** How far it may move towards harder in one day, in steps. Moves towards easier are not limited. */
  maxHarderStepsPerDay: number;
  appliesTo: string;
  appliedIn: string;
  /** Ordered from easiest to hardest, for start-point settings (value = index). */
  choices?: readonly string[];
  choiceLabels?: readonly string[];
};

export const ADAPTATION_PARAMS = {
  "exercise.hold_seconds": {
    domain: "exercise", kind: "demand", label: "Hold at the target", unit: "seconds",
    meaning: "How long the hand has to stay in the target before a repetition counts as held. Every step's hold time is scaled by the same factor.",
    default: 1.5, min: 0.8, max: 2.5, step: 0.1, easier: "lower", maxHarderStepsPerDay: 3,
    appliesTo: "All exercises except Graded Forward Reach", appliedIn: "client/src/lib/exercise-engine/session.ts (session tuning: hold time)",
  },
  "exercise.reach_height_scale": {
    domain: "exercise", kind: "demand", label: "Reach target height", unit: "times",
    meaning: "Scales how high the forward-reach target circle sits and how far it rises after each repetition. 1.0 is the standard placement.",
    default: 1, min: 0.7, max: 1.2, step: 0.05, easier: "lower", maxHarderStepsPerDay: 2,
    // Graded Forward Reach is the everyday exercise and always keeps the standard settings.
    appliesTo: "Nothing at present (Graded Forward Reach always keeps the standard placement)", appliedIn: "client/src/pages/ExerciseRunner.tsx (reach target geometry)",
  },
  "exercise.target_size_scale": {
    domain: "exercise", kind: "demand", label: "Target size", unit: "times",
    meaning: "Scales the size of the on-screen target circles. A bigger circle is easier to reach and to stay inside.",
    default: 1, min: 0.85, max: 1.3, step: 0.05, easier: "higher", maxHarderStepsPerDay: 2,
    appliesTo: "Hand-to-Mouth (Graded Forward Reach keeps the standard size)", appliedIn: "client/src/pages/ExerciseRunner.tsx (target circle radius)",
  },
  "exercise.reps_scale": {
    domain: "exercise", kind: "demand", label: "Repetitions per session", unit: "times",
    meaning: "Scales how many repetitions a session plans (never fewer than 3). Quick tests from the test bench are not affected.",
    default: 1, min: 0.5, max: 1.25, step: 0.25, easier: "lower", maxHarderStepsPerDay: 1,
    appliesTo: "All exercises except Graded Forward Reach", appliedIn: "client/src/lib/exercise-engine/session.ts (planned repetitions)",
  },
  "exercise.target_zone": {
    domain: "exercise", kind: "demand", label: "Counts as reaching", unit: "share",
    meaning: "Share of the target angle that counts as reaching it on angle-scored exercises. Below it a repetition is a miss, and two misses in a row bring the target closer.",
    default: 0.7, min: 0.55, max: 0.8, step: 0.05, easier: "lower", maxHarderStepsPerDay: 1,
    appliesTo: "Exercises scored by angle (not the on-screen circle exercises)", appliedIn: "client/src/lib/exercise-engine/session.ts and scoring.ts (target zone, miss rule)",
  },
  "exercise.good_rep_share": {
    domain: "exercise", kind: "grading", label: "Good repetition", unit: "share",
    meaning: "How much of the target a repetition needs, with a full hold and no compensation, to count as a good repetition.",
    default: 0.9, min: 0.75, max: 0.95, step: 0.05, easier: "lower", maxHarderStepsPerDay: 1,
    appliesTo: "All exercises except Graded Forward Reach (the good-repetition count)", appliedIn: "client/src/lib/exercise-engine/scoring.ts (isGoodRep)",
  },
  "exercise.one_compensation_points": {
    domain: "exercise", kind: "grading", label: "Score with one compensation", unit: "points",
    meaning: "The fixed score a repetition gets when one compensation, such as a trunk lean, is confirmed. Two or more compensations stay at 15.",
    default: 30, min: 15, max: 60, step: 5, easier: "higher", maxHarderStepsPerDay: 2,
    appliesTo: "All exercises except Graded Forward Reach", appliedIn: "client/src/lib/exercise-engine/scoring.ts (repScore)",
  },
  "assessment.reach_start_rung": {
    domain: "assessment", kind: "demand", label: "Movement check: forward reach starts at", unit: "start",
    meaning: "Which of the three reach heights the movement check tries first. The check still moves up or down from there and the level rules do not change; a better start means fewer tiring attempts at a height that is out of reach today.",
    default: null, min: 0, max: 2, step: 1, easier: "lower", maxHarderStepsPerDay: 1,
    choices: ["r80", "r120", "r160"], choiceLabels: ["the low target", "the middle target", "the high target"],
    appliesTo: "Movement check, task T1 (seated forward reach)", appliedIn: "client/src/lib/assessment.ts (start_rung in the runner URL)",
  },
  "assessment.mouth_start_rung": {
    domain: "assessment", kind: "demand", label: "Movement check: hand-to-mouth starts at", unit: "start",
    meaning: "Whether the hand-to-mouth task starts at the chest or at the mouth. The local preview always uses the mouth target.",
    default: null, min: 0, max: 1, step: 1, easier: "lower", maxHarderStepsPerDay: 1,
    choices: ["chest", "mouth"], choiceLabels: ["the chest", "the mouth"],
    appliesTo: "Movement check, task T3 (hand to mouth)", appliedIn: "client/src/lib/assessment.ts (start_rung in the runner URL)",
  },
  "assessment.hand_open_start_rung": {
    domain: "assessment", kind: "demand", label: "Movement check: hand opening starts at", unit: "start",
    meaning: "Whether hand opening starts with a partial or a full opening. Starting partial still allows the full level.",
    default: null, min: 0, max: 1, step: 1, easier: "lower", maxHarderStepsPerDay: 1,
    choices: ["partial", "full"], choiceLabels: ["a partial opening", "a full opening"],
    appliesTo: "Movement check, task H4 (hand opening)", appliedIn: "client/src/lib/assessment.ts (start_rung in the runner URL)",
  },
  "assessment.pinch_start_rung": {
    domain: "assessment", kind: "demand", label: "Movement check: pinch starts at", unit: "start",
    meaning: "Whether the pinch task starts with a partial or a full pinch. Starting partial still allows the full level.",
    default: null, min: 0, max: 1, step: 1, easier: "lower", maxHarderStepsPerDay: 1,
    choices: ["partial", "full"], choiceLabels: ["a partial pinch", "a full pinch"],
    appliesTo: "Movement check, task H3 (pinch)", appliedIn: "client/src/lib/assessment.ts (start_rung in the runner URL)",
  },
} as const satisfies Record<string, ParamSpec>;

export type ParamId = keyof typeof ADAPTATION_PARAMS;
export const PARAM_IDS = Object.keys(ADAPTATION_PARAMS) as ParamId[];
export const isParamId = (value: unknown): value is ParamId => typeof value === "string" && Object.prototype.hasOwnProperty.call(ADAPTATION_PARAMS, value);
export const paramSpec = (id: ParamId): ParamSpec => ADAPTATION_PARAMS[id];

export type ParamValues = Partial<Record<ParamId, number | null>>;

const EPS = 1e-9;
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Snaps a proposed value onto the setting's step grid and clamps it to its bounds. */
export function snapValue(id: ParamId, value: number): number {
  const spec = paramSpec(id);
  const steps = Math.round((value - spec.min) / spec.step);
  return round(Math.min(spec.max, Math.max(spec.min, spec.min + steps * spec.step)));
}

/** A stored value, made safe: missing, invalid or out-of-bounds values fall back to the default. */
export function cleanValue(id: ParamId, value: unknown): number | null {
  const spec = paramSpec(id);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return spec.default;
  if (value < spec.min - EPS || value > spec.max + EPS) return spec.default;
  return snapValue(id, value);
}

/** Human wording for a value, for the admin view and the log. */
export function formatValue(id: ParamId, value: number | null, auto?: number): string {
  const spec = paramSpec(id);
  if (value === null) return auto === undefined ? "survey default" : `${formatValue(id, auto)} (survey default)`;
  if (spec.choices) return spec.choiceLabels?.[value] ?? spec.choices[value] ?? String(value);
  if (spec.unit === "seconds") return `${round(value, 2)} s`;
  if (spec.unit === "share") return `${Math.round(value * 100)}%`;
  if (spec.unit === "points") return `${value} points`;
  return `${round(value, 2)}×`;
}

/** How hard a value is: larger is harder, whichever direction the setting runs. */
function hardness(id: ParamId, value: number): number {
  return paramSpec(id).easier === "lower" ? value : -value;
}

// ---------------------------------------------------------------- safety signals

export type FeltReport = "easier" | "about_right" | "harder" | "much_harder";
export type PainReport = "none" | "a_little" | "a_lot";
export type ReportSource = "exercise" | "warm_rep";
/** "How did that feel?", asked after a warm-up and after each exercise. */
export type DifficultyReport = { day: string; at: string; source: ReportSource; exerciseId?: string; felt?: FeltReport; pain?: PainReport; stopped?: boolean };
export type SafetyState = { easierOnly: boolean; checkWithPhysio: boolean; reasons: string[] };

export const FELT_OPTIONS: readonly FeltReport[] = ["easier", "about_right", "harder", "much_harder"];
export const PAIN_OPTIONS: readonly PainReport[] = ["none", "a_little", "a_lot"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day before a YYYY-MM-DD key. */
export function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Pain, feeling that it was harder, or stopping for symptoms today or yesterday mean Alira may only
 * make things easier. This is code, not an instruction to Alira, so no reasoning can get round it.
 */
export function safetyFrom(reports: readonly DifficultyReport[], today: string, extra: { rehabBlocked?: boolean } = {}): SafetyState {
  const window = [today, previousDay(today)];
  const reasons: string[] = [];
  let easierOnly = false;
  let checkWithPhysio = false;
  for (const report of reports) {
    if (!window.includes(report.day)) continue;
    const when = report.day === today ? "today" : "yesterday";
    const what = report.source === "warm_rep" ? "the warm-up" : report.exerciseId ? `an exercise (${report.exerciseId})` : "an exercise";
    if (report.felt === "harder" || report.felt === "much_harder") {
      easierOnly = true;
      reasons.push(`${report.felt === "much_harder" ? "Felt much harder" : "Felt harder"} after ${what} ${when}.`);
    }
    if (report.pain === "a_little" || report.pain === "a_lot") {
      easierOnly = true;
      if (report.pain === "a_lot") checkWithPhysio = true;
      reasons.push(`Reported ${report.pain === "a_lot" ? "a lot of" : "a little"} pain after ${what} ${when}.`);
    }
    if (report.stopped) {
      easierOnly = true;
      checkWithPhysio = true;
      reasons.push(`Stopped because of how they felt during ${what} ${when}.`);
    }
  }
  if (extra.rehabBlocked) {
    easierOnly = true;
    reasons.push("The movement check's review gate has paused exercises until a clinician has looked at the results.");
  }
  return { easierOnly, checkWithPhysio, reasons };
}

// ---------------------------------------------------------------- the change log

export type LearningTrigger = "warm_rep" | "exercise_session" | "assessment" | "manual";
export type ChangeEntry = {
  id: string;
  at: string;
  day: string;
  param: ParamId;
  from: number | null;
  to: number | null;
  why: string;
  evidence: string[];
  by: "alira" | "admin";
  trigger: LearningTrigger | "admin";
  revertedAt?: string;
};
export type LearningSummary = {
  id: string;
  day: string;
  at: string;
  trigger: LearningTrigger;
  /** For admins: what Alira saw, what she changed or chose not to change, and why. */
  text: string;
  /** For the patient: one warm sentence with no numbers. */
  patientNote: string;
  changeIds: string[];
  rejected: { param: string; reason: string }[];
  model: string;
};
export type AdaptationState = { v: 1; values: ParamValues; log: ChangeEntry[]; summaries: LearningSummary[] };
export type ChangeRequest = { param: string; value: number | null; why: string; evidence: string[] };
/** Survey-derived values used when a start-point setting is null ("survey default"). */
export type AutoValues = Partial<Record<ParamId, number>>;
export type ValidationContext = { today: string; safety: SafetyState; auto?: AutoValues };

export const emptyAdaptation = (): AdaptationState => ({ v: 1, values: {}, log: [], summaries: [] });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

function readEntry(value: unknown): ChangeEntry | null {
  if (!isRecord(value) || !isParamId(value.param) || typeof value.id !== "string" || typeof value.at !== "string" || typeof value.day !== "string" || !DAY.test(value.day)) return null;
  const by = value.by === "admin" ? "admin" : "alira";
  const triggers = ["warm_rep", "exercise_session", "assessment", "manual", "admin"];
  return {
    id: value.id.slice(0, 80), at: value.at.slice(0, 40), day: value.day, param: value.param,
    from: cleanValue(value.param, value.from), to: cleanValue(value.param, value.to),
    why: text(value.why, 600), evidence: Array.isArray(value.evidence) ? value.evidence.map(item => text(item, 300)).filter(Boolean).slice(0, 8) : [],
    by, trigger: (triggers.includes(value.trigger as string) ? value.trigger : "manual") as ChangeEntry["trigger"],
    ...(typeof value.revertedAt === "string" ? { revertedAt: value.revertedAt.slice(0, 40) } : {}),
  };
}

function readSummary(value: unknown): LearningSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.day !== "string" || !DAY.test(value.day) || typeof value.at !== "string") return null;
  const triggers: LearningTrigger[] = ["warm_rep", "exercise_session", "assessment", "manual"];
  return {
    id: value.id.slice(0, 80), day: value.day, at: value.at.slice(0, 40),
    trigger: triggers.includes(value.trigger as LearningTrigger) ? (value.trigger as LearningTrigger) : "manual",
    text: text(value.text, 6000), patientNote: text(value.patientNote, 400),
    changeIds: Array.isArray(value.changeIds) ? value.changeIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [],
    rejected: Array.isArray(value.rejected) ? value.rejected.filter(isRecord).map(item => ({ param: text(item.param, 80), reason: text(item.reason, 300) })).slice(0, 20) : [],
    model: text(value.model, 80),
  };
}

/** Rebuilds a stored or received adaptation state from known fields only, clamping every value. */
export function readAdaptationState(value: unknown): AdaptationState {
  if (!isRecord(value)) return emptyAdaptation();
  const values: ParamValues = {};
  if (isRecord(value.values)) {
    for (const id of PARAM_IDS) {
      if (Object.prototype.hasOwnProperty.call(value.values, id)) {
        const clean = cleanValue(id, value.values[id]);
        if (clean !== paramSpec(id).default) values[id] = clean;
      }
    }
  }
  const log = Array.isArray(value.log) ? value.log.map(readEntry).filter((e): e is ChangeEntry => e !== null).slice(-LOG_LIMIT) : [];
  const summaries = Array.isArray(value.summaries) ? value.summaries.map(readSummary).filter((s): s is LearningSummary => s !== null).slice(-SUMMARY_LIMIT) : [];
  return { v: 1, values, log, summaries };
}

/** The value in force (null = survey default for start-point settings). */
export function currentValue(state: AdaptationState, id: ParamId): number | null {
  return Object.prototype.hasOwnProperty.call(state.values, id) ? cleanValue(id, state.values[id]) : paramSpec(id).default;
}

/** The value as a number, using the survey-derived value for "survey default". */
export function effectiveNumber(state: AdaptationState, id: ParamId, auto: AutoValues = {}): number {
  const value = currentValue(state, id);
  if (value !== null) return value;
  const fallback = auto[id];
  return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : paramSpec(id).max;
}

const activeToday = (state: AdaptationState, today: string) => state.log.filter(entry => entry.day === today && !entry.revertedAt);

/** The value a setting had when the day began: the "from" of the day's first change still standing. */
function dayStartValue(state: AdaptationState, id: ParamId, today: string): number | null {
  const first = activeToday(state, today).find(entry => entry.param === id);
  return first ? first.from : currentValue(state, id);
}

export type Validation = { ok: true; param: ParamId; from: number | null; to: number | null } | { ok: false; param: string; reason: string };

/** Checks one proposed change against the setting's bounds, the daily limits and the safety rules. */
export function validateChange(state: AdaptationState, request: ChangeRequest, ctx: ValidationContext, by: "alira" | "admin" = "alira"): Validation {
  const param = typeof request?.param === "string" ? request.param : "";
  if (!isParamId(param)) return { ok: false, param, reason: "There is no such setting." };
  const spec = paramSpec(param);
  if (!text(request.why, 600)) return { ok: false, param, reason: "Every change needs a reason." };
  if (by === "alira" && !(Array.isArray(request.evidence) && request.evidence.some(item => text(item, 300)))) return { ok: false, param, reason: "Every change needs at least one piece of evidence from the patient's data." };
  let to: number | null;
  if (request.value === null) {
    if (spec.default !== null) return { ok: false, param, reason: "Only start-point settings can go back to the survey default." };
    to = null;
  } else {
    if (typeof request.value !== "number" || !Number.isFinite(request.value)) return { ok: false, param, reason: "The value must be a number." };
    if (request.value < spec.min - EPS || request.value > spec.max + EPS) return { ok: false, param, reason: `The value must be between ${spec.min} and ${spec.max}.` };
    to = snapValue(param, request.value);
  }
  const from = currentValue(state, param);
  const auto = ctx.auto ?? {};
  const numeric = (value: number | null) => (value === null ? effectiveNumber({ ...state, values: { ...state.values, [param]: null } }, param, auto) : value);
  const fromNumber = numeric(from);
  const toNumber = numeric(to);
  if (Math.abs(toNumber - fromNumber) < EPS && from === to) return { ok: false, param, reason: "That is already the current value." };
  const harder = hardness(param, toNumber) - hardness(param, fromNumber) > EPS;
  if (harder && ctx.safety.easierOnly) return { ok: false, param, reason: `Only easier changes are allowed right now: ${ctx.safety.reasons[0] ?? "a safety report"}` };
  if (harder) {
    const start = numeric(dayStartValue(state, param, ctx.today));
    const limit = spec.maxHarderStepsPerDay * spec.step;
    if (hardness(param, toNumber) - hardness(param, start) > limit + EPS) return { ok: false, param, reason: `That is more than ${spec.maxHarderStepsPerDay} step${spec.maxHarderStepsPerDay === 1 ? "" : "s"} harder in one day.` };
  }
  if (by === "alira" && activeToday(state, ctx.today).filter(entry => entry.by === "alira").length >= MAX_CHANGES_PER_DAY) {
    return { ok: false, param, reason: `Alira has already made ${MAX_CHANGES_PER_DAY} changes today.` };
  }
  return { ok: true, param, from, to };
}

export type ApplyMeta = { id: string; at: string; by: "alira" | "admin"; trigger: ChangeEntry["trigger"] };

/** Validates and applies one change, returning the new state and its log entry. */
export function applyChange(state: AdaptationState, request: ChangeRequest, ctx: ValidationContext, meta: ApplyMeta):
  { ok: true; state: AdaptationState; entry: ChangeEntry } | { ok: false; reason: string } {
  const check = validateChange(state, request, ctx, meta.by);
  if (!check.ok) return { ok: false, reason: check.reason };
  const entry: ChangeEntry = {
    id: meta.id.slice(0, 80), at: meta.at, day: ctx.today, param: check.param, from: check.from, to: check.to,
    why: text(request.why, 600), evidence: (Array.isArray(request.evidence) ? request.evidence : []).map(item => text(item, 300)).filter(Boolean).slice(0, 8),
    by: meta.by, trigger: meta.trigger,
  };
  const values = { ...state.values };
  if (check.to === paramSpec(check.param).default) delete values[check.param];
  else values[check.param] = check.to;
  return { ok: true, state: { ...state, values, log: [...state.log, entry].slice(-LOG_LIMIT) }, entry };
}

/**
 * Undoes a change: the setting goes back to the value it had before it. Later changes to the same
 * setting were built on top of this one, so they are undone too.
 */
export function revertChange(state: AdaptationState, entryId: string, at: string): AdaptationState {
  const index = state.log.findIndex(entry => entry.id === entryId);
  if (index < 0 || state.log[index].revertedAt) return state;
  const target = state.log[index];
  const log = state.log.map((entry, i) => (i >= index && entry.param === target.param && !entry.revertedAt ? { ...entry, revertedAt: at } : entry));
  const values = { ...state.values };
  if (target.from === paramSpec(target.param).default) delete values[target.param];
  else values[target.param] = target.from;
  return { ...state, values, log };
}

/** Every setting back to its default; all standing changes are marked as undone. */
export function resetAdaptations(state: AdaptationState, at: string): AdaptationState {
  return { ...state, values: {}, log: state.log.map(entry => (entry.revertedAt ? entry : { ...entry, revertedAt: at })) };
}

export function changesOn(state: AdaptationState, day: string): ChangeEntry[] {
  return state.log.filter(entry => entry.day === day);
}

export function addSummary(state: AdaptationState, summary: LearningSummary): AdaptationState {
  return { ...state, summaries: [...state.summaries.filter(item => item.id !== summary.id), summary].slice(-SUMMARY_LIMIT) };
}

// ---------------------------------------------------------------- applying the settings

export type ExerciseTuning = {
  holdSeconds: number;
  /** holdSeconds relative to the standard 1.5 s hold; scales every step's hold time. */
  holdFactor: number;
  reachHeightScale: number;
  targetSizeScale: number;
  repsScale: number;
  targetZone: number;
  goodRepShare: number;
  oneCompensationPoints: number;
  /** Any setting differs from its default. */
  adapted: boolean;
  /** The values that differ from the defaults, for the session record. */
  changed: Partial<Record<ParamId, number>>;
};

const STANDARD_HOLD_SECONDS = 1.5;

/** The exercise settings in force for a session, every value clamped. Taken once when a session starts. */
export function exerciseTuning(values: ParamValues | undefined): ExerciseTuning {
  const get = (id: ParamId) => {
    const value = cleanValue(id, values?.[id]);
    return value === null ? (paramSpec(id).default as number) : value;
  };
  const changed: Partial<Record<ParamId, number>> = {};
  for (const id of PARAM_IDS) {
    if (paramSpec(id).domain !== "exercise") continue;
    const value = get(id);
    if (Math.abs(value - (paramSpec(id).default as number)) > EPS) changed[id] = value;
  }
  const holdSeconds = get("exercise.hold_seconds");
  return {
    holdSeconds,
    holdFactor: round(holdSeconds / STANDARD_HOLD_SECONDS),
    reachHeightScale: get("exercise.reach_height_scale"),
    targetSizeScale: get("exercise.target_size_scale"),
    repsScale: get("exercise.reps_scale"),
    targetZone: get("exercise.target_zone"),
    goodRepShare: get("exercise.good_rep_share"),
    oneCompensationPoints: get("exercise.one_compensation_points"),
    adapted: Object.keys(changed).length > 0,
    changed,
  };
}

export const DEFAULT_EXERCISE_TUNING: ExerciseTuning = exerciseTuning(undefined);

/** Planned repetitions under the tuning: the base count scaled, never fewer than 3. */
export function tunedReps(base: number, tuning: ExerciseTuning): number {
  return Math.max(3, Math.round(base * tuning.repsScale));
}

export type StartRungs = { T1?: "r80" | "r120" | "r160"; T3?: "chest" | "mouth"; H4?: "partial" | "full"; H3?: "partial" | "full" };
const RUNG_PARAMS = { T1: "assessment.reach_start_rung", T3: "assessment.mouth_start_rung", H4: "assessment.hand_open_start_rung", H3: "assessment.pinch_start_rung" } as const;
type RungTask = keyof typeof RUNG_PARAMS;
const RUNG_TASKS = Object.keys(RUNG_PARAMS) as RungTask[];

/** Survey-derived start points as setting values (the runner starts H4 and H3 at "full" by default). */
export function autoValuesFromStartRungs(base: { T1?: string; T3?: string; H4?: string; H3?: string }): AutoValues {
  const auto: AutoValues = {};
  for (const task of RUNG_TASKS) {
    const id = RUNG_PARAMS[task];
    const choices = paramSpec(id).choices as readonly string[];
    const index = choices.indexOf(base[task] ?? (task === "H4" || task === "H3" ? "full" : ""));
    if (index >= 0) auto[id] = index;
  }
  return auto;
}

/** The movement check's start points with Alira's settings applied; survey defaults stay as they were. */
export function adaptStartRungs(base: { T1?: string; T3?: string }, values: ParamValues | undefined): StartRungs {
  const out: Record<string, string> = {};
  if (base.T1) out.T1 = base.T1;
  if (base.T3) out.T3 = base.T3;
  for (const task of RUNG_TASKS) {
    const id = RUNG_PARAMS[task];
    const value = cleanValue(id, values?.[id]);
    const choices = paramSpec(id).choices as readonly string[];
    if (value !== null && choices[value]) out[task] = choices[value];
  }
  return out as StartRungs;
}

// ---------------------------------------------------------------- consent and the patient snapshot

export const CONSENT_CATEGORIES = ["survey", "movement", "camera", "personal", "journal"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export type Consent = Record<ConsentCategory, boolean>;
export const NO_CONSENT: Consent = { survey: false, movement: false, camera: false, personal: false, journal: false };

/** Only an explicit true counts as agreement. */
export function readConsent(value: unknown): Consent {
  const out = { ...NO_CONSENT };
  if (isRecord(value)) for (const key of CONSENT_CATEGORIES) out[key] = value[key] === true;
  return out;
}

/** Learning needs the movement category: without it Alira has nothing about today to learn from. */
export const canLearn = (consent: Consent) => consent.movement;

export type GateKind = "survey_end" | "pre_assessment" | "pre_exercise";
export type WarmRepReach = {
  /** Median angles during the hold, in degrees (camera estimates). */
  shoulderFlexion: number;
  elbowExtension: number;
  /** Wrist height from the lap (0) to shoulder height (1); the movement check's reach targets sit at 0.8, 1.2 and 1.6. */
  wristHeight: number | null;
  /** Median compensation measures during the hold, against the resting posture. */
  trunkLeanDeg: number | null;
  shoulderElevationPct: number | null;
  faceApproachPct: number | null;
  heldMs: number;
};
export type WarmRepRecord = {
  id: string;
  day: string;
  at: string;
  source: GateKind;
  side: "left" | "right";
  simulated: boolean;
  rest: { shoulderFlexion: number; elbowExtension: number };
  reaches: (WarmRepReach | null)[];
  /** The reach with the larger shoulder movement from rest. */
  best: WarmRepReach | null;
  bestExcursionDeg: number | null;
  /** Highest movement-check reach target at or below the best wrist height: 0 low, 1 middle, 2 high. */
  suggestedReachRung: number | null;
};

export type AssessmentTaskSummary = { taskId: string; label: string; level: number | null; points: number | null; reason: string; bestAlone: string | null; bestAssisted: string | null; compensations: Record<string, string>; stoppedBy: string | null };
export type AssessmentSummary = { completedAt: string; testing: boolean; total: number | null; areas: Record<string, number | null>; tasks: AssessmentTaskSummary[]; reviewGate: string | null };
export type ExerciseSessionSummary = { finishedAt: string; exerciseId: string; score: number | null; reps: number; goodReps: number; levelStart: number; levelEnd: number; compensations: Record<string, number>; bestValue: number | null; bestLabel: string; notAttempted: boolean; assisted: boolean; adapted: boolean };

export type PatientSnapshot = {
  today: string;
  survey?: Record<string, string>;
  personal?: { name?: string; goalInOwnWords?: string };
  journal?: { day: string; mood: string | null; words?: string }[];
  movement?: {
    warmReps: WarmRepRecord[];
    assessment: AssessmentSummary | null;
    assessmentHistory: { completedAt: string; scores: Record<string, number | null> }[];
    exerciseSessions: ExerciseSessionSummary[];
    dailyScores: { day: string; exerciseId: string; score: number }[];
    reports: DifficultyReport[];
  };
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? round(value, 2) : null);
const list = <T,>(value: unknown, max: number, read: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.slice(-max).map(read).filter((item): item is T => item !== null) : [];
const record = (value: unknown, maxKeys: number, read: (item: unknown) => string | number | null): Record<string, string> & Record<string, number> => {
  const out: Record<string, string | number> = {};
  if (isRecord(value)) {
    for (const key of Object.keys(value).slice(0, maxKeys)) {
      const item = read(value[key]);
      if (item !== null) out[key.slice(0, 60)] = item;
    }
  }
  return out as Record<string, string> & Record<string, number>;
};

function readReach(value: unknown): WarmRepReach | null {
  if (!isRecord(value)) return null;
  const shoulderFlexion = num(value.shoulderFlexion);
  const elbowExtension = num(value.elbowExtension);
  if (shoulderFlexion === null || elbowExtension === null) return null;
  return { shoulderFlexion, elbowExtension, wristHeight: num(value.wristHeight), trunkLeanDeg: num(value.trunkLeanDeg), shoulderElevationPct: num(value.shoulderElevationPct), faceApproachPct: num(value.faceApproachPct), heldMs: num(value.heldMs) ?? 0 };
}

export function readWarmRep(value: unknown): WarmRepRecord | null {
  if (!isRecord(value) || typeof value.day !== "string" || !DAY.test(value.day) || !isRecord(value.rest)) return null;
  const sources: GateKind[] = ["survey_end", "pre_assessment", "pre_exercise"];
  const rest = { shoulderFlexion: num(value.rest.shoulderFlexion) ?? 0, elbowExtension: num(value.rest.elbowExtension) ?? 0 };
  const reaches = Array.isArray(value.reaches) ? value.reaches.slice(0, 3).map(readReach) : [];
  const suggested = num(value.suggestedReachRung);
  return {
    id: text(value.id, 80) || `warm-${value.day}`, day: value.day, at: text(value.at, 40),
    source: sources.includes(value.source as GateKind) ? (value.source as GateKind) : "pre_exercise",
    side: value.side === "left" ? "left" : "right", simulated: value.simulated === true, rest, reaches,
    best: readReach(value.best), bestExcursionDeg: num(value.bestExcursionDeg),
    suggestedReachRung: suggested !== null && suggested >= 0 && suggested <= 2 ? Math.round(suggested) : null,
  };
}

export function readReport(value: unknown): DifficultyReport | null {
  if (!isRecord(value) || typeof value.day !== "string" || !DAY.test(value.day)) return null;
  return {
    day: value.day, at: text(value.at, 40), source: value.source === "warm_rep" ? "warm_rep" : "exercise",
    ...(typeof value.exerciseId === "string" ? { exerciseId: value.exerciseId.slice(0, 40) } : {}),
    ...(FELT_OPTIONS.includes(value.felt as FeltReport) ? { felt: value.felt as FeltReport } : {}),
    ...(PAIN_OPTIONS.includes(value.pain as PainReport) ? { pain: value.pain as PainReport } : {}),
    ...(value.stopped === true ? { stopped: true } : {}),
  };
}

function readAssessment(value: unknown): AssessmentSummary | null {
  if (!isRecord(value) || typeof value.completedAt !== "string") return null;
  return {
    completedAt: value.completedAt.slice(0, 40), testing: value.testing === true, total: num(value.total),
    areas: record(value.areas, 6, item => num(item)) as Record<string, number | null>,
    tasks: list(value.tasks, 8, item => {
      if (!isRecord(item) || typeof item.taskId !== "string") return null;
      return {
        taskId: item.taskId.slice(0, 10), label: text(item.label, 80), level: num(item.level), points: num(item.points), reason: text(item.reason, 200),
        bestAlone: typeof item.bestAlone === "string" ? item.bestAlone.slice(0, 20) : null, bestAssisted: typeof item.bestAssisted === "string" ? item.bestAssisted.slice(0, 20) : null,
        compensations: record(item.compensations, 8, entry => (typeof entry === "string" ? entry.slice(0, 20) : null)) as Record<string, string>,
        stoppedBy: typeof item.stoppedBy === "string" ? item.stoppedBy.slice(0, 40) : null,
      };
    }),
    reviewGate: typeof value.reviewGate === "string" ? value.reviewGate.slice(0, 40) : null,
  };
}

function readSession(value: unknown): ExerciseSessionSummary | null {
  if (!isRecord(value) || typeof value.exerciseId !== "string") return null;
  return {
    finishedAt: text(value.finishedAt, 40), exerciseId: value.exerciseId.slice(0, 40), score: num(value.score),
    reps: num(value.reps) ?? 0, goodReps: num(value.goodReps) ?? 0, levelStart: num(value.levelStart) ?? 1, levelEnd: num(value.levelEnd) ?? 1,
    compensations: record(value.compensations, 8, item => num(item)) as Record<string, number>,
    bestValue: num(value.bestValue), bestLabel: text(value.bestLabel, 40), notAttempted: value.notAttempted === true,
    assisted: value.assisted === true, adapted: value.adapted === true,
  };
}

/**
 * Rebuilds a snapshot from known fields only and drops every category the patient has not agreed to
 * share. The browser builds the snapshot this way, and the server applies it again on arrival, so a
 * bug on one side cannot send or use data outside the patient's choices.
 */
export function filterSnapshot(value: unknown, consent: Consent): PatientSnapshot {
  const source = isRecord(value) ? value : {};
  const today = typeof source.today === "string" && DAY.test(source.today) ? source.today : "1970-01-01";
  const out: PatientSnapshot = { today };
  if (consent.survey) out.survey = record(source.survey, 20, item => (typeof item === "string" ? item.slice(0, 40) : null)) as Record<string, string>;
  if (consent.personal && isRecord(source.personal)) {
    const name = text(source.personal.name, 60);
    const goal = text(source.personal.goalInOwnWords, 300);
    out.personal = { ...(name ? { name } : {}), ...(goal ? { goalInOwnWords: goal } : {}) };
  }
  if (consent.journal) {
    out.journal = list(source.journal, 7, item => {
      if (!isRecord(item) || typeof item.day !== "string" || !DAY.test(item.day)) return null;
      const words = text(item.words, 300);
      return { day: item.day, mood: typeof item.mood === "string" ? item.mood.slice(0, 20) : null, ...(words ? { words } : {}) };
    });
  }
  if (consent.movement && isRecord(source.movement)) {
    const m = source.movement;
    out.movement = {
      warmReps: list(m.warmReps, 7, readWarmRep),
      assessment: readAssessment(m.assessment),
      assessmentHistory: list(m.assessmentHistory, 6, item => (isRecord(item) && typeof item.completedAt === "string"
        ? { completedAt: item.completedAt.slice(0, 40), scores: record(item.scores, 6, entry => num(entry)) as Record<string, number | null> } : null)),
      exerciseSessions: list(m.exerciseSessions, 12, readSession),
      dailyScores: list(m.dailyScores, 60, item => (isRecord(item) && typeof item.day === "string" && DAY.test(item.day) && typeof item.exerciseId === "string" && num(item.score) !== null
        ? { day: item.day, exerciseId: item.exerciseId.slice(0, 40), score: num(item.score) as number } : null)),
      reports: list(m.reports, 30, readReport),
    };
  }
  return out;
}

// ---------------------------------------------------------------- still images from the warm-up

export const KEY_FRAME_LIMITS = { maxFrames: 4, maxBase64Chars: 400_000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } as const;
export type KeyFrame = { label: string; dataUrl: string };
export type ValidKeyFrame = { label: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

/** Accepts at most four small still images as data URLs; anything else is dropped. */
export function validKeyFrames(value: unknown): ValidKeyFrame[] {
  if (!Array.isArray(value)) return [];
  const out: ValidKeyFrame[] = [];
  for (const item of value.slice(0, KEY_FRAME_LIMITS.maxFrames)) {
    if (!isRecord(item) || typeof item.dataUrl !== "string") continue;
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(item.dataUrl);
    if (!match || match[2].length > KEY_FRAME_LIMITS.maxBase64Chars) continue;
    out.push({ label: text(item.label, 80) || `Still image ${out.length + 1}`, mediaType: match[1] as ValidKeyFrame["mediaType"], data: match[2] });
  }
  return out;
}

// ---------------------------------------------------------------- the learning request

export type LearningRequest = {
  trigger: LearningTrigger;
  consent: Consent;
  snapshot: PatientSnapshot;
  /** Current values and today's log, so Alira knows what is already in force. */
  state: AdaptationState;
  auto: AutoValues;
  keyFrames?: KeyFrame[];
};
export type LearningResponse = {
  changes: ChangeEntry[];
  rejected: { param: string; reason: string }[];
  summary: string;
  patientNote: string;
  model: string;
};

/** Settings as Alira sees them: bounds, today's allowed range and the value in force. */
export function describeParams(state: AdaptationState, ctx: ValidationContext): Record<string, unknown>[] {
  return PARAM_IDS.map(id => {
    const spec = paramSpec(id);
    const value = currentValue(state, id);
    return {
      id, domain: spec.domain, kind: spec.kind, label: spec.label, meaning: spec.meaning, applies_to: spec.appliesTo,
      default: spec.default, min: spec.min, max: spec.max, step: spec.step, easier_direction: spec.easier,
      max_harder_steps_today: spec.maxHarderStepsPerDay,
      ...(spec.choices ? { choices: spec.choices.map((choice, index) => `${index} = ${choice} (${spec.choiceLabels?.[index] ?? choice})`) } : {}),
      current: value, current_in_words: formatValue(id, value, ctx.auto?.[id]),
      only_easier_allowed: ctx.safety.easierOnly,
    };
  });
}
