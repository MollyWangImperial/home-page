// What Alira may learn from, what she has learned and changed, and the warm-up records, all kept in
// this browser. The rules for changing anything live in shared/alira-adaptation.ts; this file only
// stores, loads and assembles. Nothing here talks to the server.
//
// Storage follows the house pattern: a guarded accessor, a loader that rebuilds known fields only,
// and an in-memory fallback so a choice survives navigation within the tab when storage is blocked.

import {
  adaptStartRungs, applyChange, autoValuesFromStartRungs, canLearn, emptyAdaptation, exerciseTuning, filterSnapshot,
  NO_CONSENT, readAdaptationState, readConsent, readReport, readWarmRep, resetAdaptations, revertChange, safetyFrom,
  type AdaptationState, type ApplyMeta, type AssessmentSummary, type AutoValues, type ChangeEntry, type ChangeRequest,
  type Consent, type ConsentCategory, type DifficultyReport, type ExerciseSessionSummary, type ExerciseTuning, type GateKind,
  type KeyFrame, type LearningSummary, type PatientSnapshot, type SafetyState, type StartRungs, type WarmRepRecord,
} from "@shared/alira-adaptation";
import { loadOnboardingAnswers, onboardingQuestions, type OnboardingAnswers } from "./alira-onboarding";
import { assessmentPlanFrom, loadRememberedAssessment, type StoredAssessment } from "./assessment";
import { readLabSessions } from "./exercise-engine/lab-storage";
import { dayKey, PATIENT_NAME } from "./home-stage";
import { loadJournal } from "./journal-days";
import { journeyNow, loadJourneyAssessments, loadSessionStore } from "./journey";

export const CONSENT_KEY = "rehyn.alira.consent.v1";
export const WARM_REP_KEY = "rehyn.alira.warmrep.v1";
export const REPORTS_KEY = "rehyn.alira.reports.v1";
export const ADAPTATION_KEY = "rehyn.alira.adaptation.v1";

const WARM_REP_LIMIT = 30;
const SKIP_LIMIT = 60;
const REPORT_LIMIT = 60;
const CONSENT_HISTORY_LIMIT = 20;

// ---------------------------------------------------------------- storage plumbing

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Blocked storage still keeps today's choices for this tab. Only used when storage cannot be read. */
const memory = new Map<string, string>();

function readRaw(key: string): unknown {
  const store = storage();
  if (store) {
    try {
      // Readable storage is the only truth: an account reset that removed the key must not be
      // undone by the in-memory copy.
      const raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      /* blocked or unreadable: fall back to this tab's memory */
    }
  }
  try {
    const raw = memory.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Returns false when the value could only be kept in memory for this tab. */
function writeRaw(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, raw);
    return true;
  } catch {
    return false;
  } finally {
    notify();
  }
}

// Settings, the warm-up page and the gates read the same stores; listeners re-read on change.
const listeners = new Set<() => void>();
let version = 0;
function notify() {
  version += 1;
  listeners.forEach(listener => {
    try { listener(); } catch { /* a listener must not break storage */ }
  });
}
/** For useSyncExternalStore: subscribe to any change in these stores. */
export function subscribeLearning(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const learningVersion = () => version;

/** "Today" as the Journey and exercise results count it, including the local testing offset. */
export function learningToday(now = new Date()): string {
  return dayKey(journeyNow(now));
}

// ---------------------------------------------------------------- consent

export type ConsentRecord = { v: 1; categories: Consent; asked: boolean; updatedAt: string | null; history: { at: string; categories: Consent }[] };

export function loadConsentRecord(): ConsentRecord {
  const raw = readRaw(CONSENT_KEY) as Partial<ConsentRecord> | null;
  if (!raw || typeof raw !== "object") return { v: 1, categories: { ...NO_CONSENT }, asked: false, updatedAt: null, history: [] };
  const history = Array.isArray(raw.history)
    ? raw.history.filter(item => item && typeof item.at === "string").map(item => ({ at: item.at.slice(0, 40), categories: readConsent(item.categories) })).slice(-CONSENT_HISTORY_LIMIT)
    : [];
  return { v: 1, categories: readConsent(raw.categories), asked: raw.asked === true, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null, history };
}

export const loadConsent = (): Consent => loadConsentRecord().categories;

/** Records the patient's choice with a timestamp; every change is kept so it can be shown later. */
export function saveConsent(categories: Partial<Consent>, at = new Date().toISOString()): ConsentRecord {
  const current = loadConsentRecord();
  const next = readConsent({ ...current.categories, ...categories });
  const record: ConsentRecord = { v: 1, categories: next, asked: true, updatedAt: at, history: [...current.history, { at, categories: next }].slice(-CONSENT_HISTORY_LIMIT) };
  writeRaw(CONSENT_KEY, record);
  return record;
}

/** "Not now" still counts as asked, so the question is not repeated on every warm-up. */
export function markConsentAsked(at = new Date().toISOString()): ConsentRecord {
  const current = loadConsentRecord();
  const record = { ...current, asked: true, updatedAt: current.updatedAt ?? at };
  writeRaw(CONSENT_KEY, record);
  return record;
}

export const CONSENT_COPY: Record<ConsentCategory, { title: string; detail: string }> = {
  survey: { title: "My answers to Alira's questions", detail: "Things like when the stroke happened, how your arm moves and who helps at home. Not your own typed words." },
  movement: { title: "My movement results", detail: "Warm-ups, movement checks, exercise scores, and how you said exercises felt. Needed for Alira to adjust anything." },
  camera: { title: "Still pictures from my warm-up", detail: "Up to two still pictures taken while you hold a reach. They are sent to Rehyn's AI provider for that review only and are not kept in this browser." },
  personal: { title: "My name and my goal in my own words", detail: "Your first name and anything you typed as your own goal." },
  journal: { title: "My journal", detail: "Your mood and up to 300 characters of words from each of the last seven days." },
};

// ---------------------------------------------------------------- warm-up records

export type WarmRepStore = { v: 1; records: WarmRepRecord[]; skips: { day: string; gate: GateKind; at: string }[] };
const GATES: GateKind[] = ["survey_end", "pre_assessment", "pre_exercise"];

export function loadWarmRepStore(): WarmRepStore {
  const raw = readRaw(WARM_REP_KEY) as Partial<WarmRepStore> | null;
  const records = Array.isArray(raw?.records) ? raw!.records.map(readWarmRep).filter((r): r is WarmRepRecord => r !== null).slice(-WARM_REP_LIMIT) : [];
  const skips = Array.isArray(raw?.skips)
    ? raw!.skips.filter(item => item && typeof item.day === "string" && GATES.includes(item.gate as GateKind)).map(item => ({ day: item.day, gate: item.gate as GateKind, at: typeof item.at === "string" ? item.at : "" })).slice(-SKIP_LIMIT)
    : [];
  return { v: 1, records, skips };
}

export function saveWarmRep(record: WarmRepRecord): WarmRepStore {
  const store = loadWarmRepStore();
  const clean = readWarmRep(record);
  if (!clean) return store;
  const next: WarmRepStore = { ...store, records: [...store.records.filter(item => item.id !== clean.id), clean].slice(-WARM_REP_LIMIT) };
  writeRaw(WARM_REP_KEY, next);
  return next;
}

export function recordWarmRepSkip(gate: GateKind, day = learningToday(), at = new Date().toISOString()): WarmRepStore {
  const store = loadWarmRepStore();
  const next: WarmRepStore = { ...store, skips: [...store.skips, { day, gate, at }].slice(-SKIP_LIMIT) };
  writeRaw(WARM_REP_KEY, next);
  return next;
}

export function warmRepToday(day = learningToday(), store = loadWarmRepStore()): WarmRepRecord | null {
  const today = store.records.filter(record => record.day === day);
  return today.length ? today[today.length - 1] : null;
}

/**
 * Whether a gate should offer the warm-up. Offered once a day: not when today's warm-up is done,
 * not again at a gate the patient already skipped today, and not when the survey says the arm does
 * not move yet (that route is carer-led, so a reach check does not fit).
 */
export function warmRepNeeded(gate: GateKind, answers: OnboardingAnswers = loadOnboardingAnswers(), day = learningToday(), store = loadWarmRepStore()): boolean {
  if (answers.arm_hand_movement === "none") return false;
  if (warmRepToday(day, store)) return false;
  return !store.skips.some(skip => skip.day === day && skip.gate === gate);
}

// ---------------------------------------------------------------- how it felt

export function loadReports(): DifficultyReport[] {
  const raw = readRaw(REPORTS_KEY);
  return Array.isArray(raw) ? raw.map(readReport).filter((r): r is DifficultyReport => r !== null).slice(-REPORT_LIMIT) : [];
}

export function saveReport(report: Omit<DifficultyReport, "day" | "at"> & Partial<Pick<DifficultyReport, "day" | "at">>): DifficultyReport[] {
  const clean = readReport({ day: learningToday(), at: new Date().toISOString(), ...report });
  if (!clean) return loadReports();
  const next = [...loadReports(), clean].slice(-REPORT_LIMIT);
  writeRaw(REPORTS_KEY, next);
  return next;
}

export function currentSafety(day = learningToday(), assessment: StoredAssessment | null = loadRememberedAssessment()): SafetyState {
  return safetyFrom(loadReports(), day, { rehabBlocked: assessment?.report?.clinical_review_gate?.rehab_access === "blocked" });
}

// ---------------------------------------------------------------- adaptations

export function loadAdaptation(): AdaptationState {
  return readAdaptationState(readRaw(ADAPTATION_KEY));
}

function saveAdaptation(state: AdaptationState): AdaptationState {
  const clean = readAdaptationState(state);
  writeRaw(ADAPTATION_KEY, clean);
  return clean;
}

/** Survey-derived start points, used when a start-point setting is on "survey default". */
export function autoValuesNow(answers: OnboardingAnswers = loadOnboardingAnswers()): AutoValues {
  const plan = assessmentPlanFrom(answers);
  return autoValuesFromStartRungs(plan.startRung);
}

/** Applies changes from Alira (validated again here) or from an admin, and stores the result. */
export function applyLearnedChanges(entries: (ChangeEntry | (ChangeRequest & { id?: string }))[], meta: Omit<ApplyMeta, "id">, day = learningToday()):
  { state: AdaptationState; accepted: ChangeEntry[]; rejected: { param: string; reason: string }[] } {
  let state = loadAdaptation();
  const ctx = { today: day, safety: currentSafety(day), auto: autoValuesNow() };
  const accepted: ChangeEntry[] = [];
  const rejected: { param: string; reason: string }[] = [];
  entries.forEach((entry, index) => {
    const request: ChangeRequest = "to" in entry ? { param: entry.param, value: entry.to, why: entry.why, evidence: entry.evidence } : entry;
    const id = typeof entry.id === "string" && entry.id ? entry.id : `${meta.by}-${Date.now().toString(36)}-${index}`;
    const result = applyChange(state, request, ctx, { ...meta, id });
    if (result.ok) {
      state = result.state;
      accepted.push(result.entry);
    } else rejected.push({ param: String(request.param), reason: result.reason });
  });
  return { state: saveAdaptation(state), accepted, rejected };
}

export function addLearningSummary(summary: LearningSummary): AdaptationState {
  const state = loadAdaptation();
  return saveAdaptation({ ...state, summaries: [...state.summaries.filter(item => item.id !== summary.id), summary] });
}

/** Undo is a plain button for admins, never something the chat can be talked into. */
export function undoChange(entryId: string, at = new Date().toISOString()): AdaptationState {
  return saveAdaptation(revertChange(loadAdaptation(), entryId, at));
}

export function resetAllAdaptations(at = new Date().toISOString()): AdaptationState {
  return saveAdaptation(resetAdaptations(loadAdaptation(), at));
}

/** The exercise settings in force; read once when a session starts so nothing changes mid-repetition. */
export function loadExerciseTuning(): ExerciseTuning {
  // Withdrawing consent puts the standard settings back in force (the log is kept for admins).
  return exerciseTuning(canLearn(loadConsent()) ? loadAdaptation().values : undefined);
}

/** The movement check's start points with Alira's settings applied, read when the check opens. */
export function adaptedStartRungs(base: { T1?: string; T3?: string }): StartRungs {
  return adaptStartRungs(base, canLearn(loadConsent()) ? loadAdaptation().values : undefined);
}

// ---------------------------------------------------------------- still images (memory only)

let keyFrames: { frames: KeyFrame[]; at: number } | null = null;
const KEY_FRAME_TTL_MS = 30 * 60 * 1000;

/** Still images from today's warm-up live only in memory and are handed over once. */
export function holdKeyFrames(frames: KeyFrame[], now = Date.now()) {
  keyFrames = frames.length ? { frames: frames.slice(0, 2), at: now } : null;
}
export function takeKeyFrames(now = Date.now()): KeyFrame[] {
  const held = keyFrames;
  keyFrames = null;
  return held && now - held.at < KEY_FRAME_TTL_MS ? held.frames : [];
}
export const keyFramesHeld = () => keyFrames?.frames.length ?? 0;

// ---------------------------------------------------------------- the snapshot Alira learns from

const MOOD_NAMES = ["tough", "low", "okay", "good", "great"];

function surveyForAlira(answers: OnboardingAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const question of onboardingQuestions) {
    const value = answers[question.k];
    if (typeof value === "string" && value) {
      const option = question.o?.find(item => item.v === value);
      out[question.k] = option ? `${value} (${option.l})` : value;
    }
  }
  return out;
}

function assessmentForAlira(stored: StoredAssessment | null): AssessmentSummary | null {
  const score = stored?.report?.metrics?.function_score as unknown as Record<string, unknown> | undefined;
  if (!stored || !score) return null;
  const areas: Record<string, number | null> = {};
  const rawAreas = (score.areas ?? {}) as Record<string, { display_score?: unknown }>;
  for (const key of Object.keys(rawAreas)) {
    const value = rawAreas[key]?.display_score;
    areas[key] = typeof value === "number" ? value : null;
  }
  const results = (stored.report?.task_results ?? []) as Record<string, unknown>[];
  const tasks = (Array.isArray(score.tasks) ? score.tasks : []).map((task: Record<string, unknown>) => {
    const ladder = (results.find(item => item.task_id === task.task_id)?.metrics as Record<string, unknown> | undefined)?.ladder as Record<string, unknown> | undefined;
    return {
      taskId: String(task.task_id ?? ""), label: String(task.task_label ?? task.label ?? ""),
      level: typeof task.level === "number" ? task.level : null, points: typeof task.points === "number" ? task.points : null,
      reason: typeof task.reason === "string" ? task.reason : "",
      bestAlone: typeof task.best_alone === "string" ? task.best_alone : null, bestAssisted: typeof task.best_assisted === "string" ? task.best_assisted : null,
      compensations: (task.compensations && typeof task.compensations === "object" ? task.compensations : {}) as Record<string, string>,
      stoppedBy: typeof ladder?.stopped_by === "string" ? ladder.stopped_by : null,
    };
  });
  return {
    completedAt: stored.completedAt,
    testing: stored.report?.testing_random === true,
    total: typeof score.display_total === "number" ? score.display_total : null,
    areas, tasks,
    reviewGate: stored.report?.clinical_review_gate?.rehab_access ?? null,
  };
}

function sessionsForAlira(): ExerciseSessionSummary[] {
  return readLabSessions()
    .filter(session => session && session.sim !== true && typeof session.exercise_id === "string")
    .slice(0, 12)
    .reverse()
    .map(session => ({
      finishedAt: session.finished_at, exerciseId: session.exercise_id, score: session.score,
      reps: session.reps_planned, goodReps: session.quality_reps, levelStart: session.rung_start, levelEnd: session.rung_end,
      compensations: session.compensation_counts ?? {}, bestValue: session.best_value, bestLabel: session.best_label,
      notAttempted: session.not_attempted, assisted: session.assisted,
      adapted: Boolean((session as unknown as { adaptation?: { adapted?: boolean } }).adaptation?.adapted),
    }));
}

/**
 * Everything Alira may learn from, assembled from the existing stores and then cut down to the
 * categories the patient agreed to share (the server cuts it down again on arrival).
 */
export function buildSnapshot(consent: Consent = loadConsent(), day = learningToday()): PatientSnapshot {
  const answers = loadOnboardingAnswers();
  const journal = loadJournal().pages;
  const journalDays = Object.keys(journal).sort().slice(-7);
  const store = loadSessionStore();
  const dailyScores = Object.keys(store).sort().slice(-14).flatMap(key => Object.keys(store[key] ?? {}).map(exerciseId => ({ day: key, exerciseId, score: store[key][exerciseId].score })));
  const goal = typeof answers.main_goal_other === "string" ? answers.main_goal_other : "";
  const raw = {
    today: day,
    survey: surveyForAlira(answers),
    personal: { name: PATIENT_NAME, goalInOwnWords: goal },
    journal: journalDays.map(key => ({ day: key, mood: journal[key].mood >= 0 ? MOOD_NAMES[journal[key].mood] ?? null : null, words: journal[key].text })),
    movement: {
      warmReps: loadWarmRepStore().records,
      assessment: assessmentForAlira(loadRememberedAssessment()),
      assessmentHistory: loadJourneyAssessments().map(item => ({ completedAt: item.completedAt, scores: item.scores })),
      exerciseSessions: sessionsForAlira(),
      dailyScores,
      reports: loadReports(),
    },
  };
  return filterSnapshot(raw, consent);
}

/** Learning runs only with consent to share movement results; until then the defaults apply. */
export const learningAllowed = (consent: Consent = loadConsent()) => canLearn(consent);

/** A fresh empty state, for tests and for "reset". */
export const blankAdaptation = emptyAdaptation;
