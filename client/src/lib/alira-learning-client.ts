// Talks to Alira's learning agent (server/alira-learning.ts). A learning run sends the snapshot the
// patient agreed to share and gets back proposed setting changes plus a summary; the changes are
// checked again here before they are stored. Runs continue in the background across page changes,
// and the warm-up gates can wait a little for one to finish before the check or exercise opens.

import type { LearningRequest, LearningResponse, LearningTrigger, LearningSummary } from "@shared/alira-adaptation";
import { channelHistory, type ChannelTurn } from "./alira-channel-client";
import {
  addLearningSummary, applyLearnedChanges, autoValuesNow, buildSnapshot, currentSafety, learningAllowed, learningToday,
  loadAdaptation, loadConsent, takeKeyFrames,
} from "./alira-learning-store";

export const LEARNING_LIMITS = {
  /** Background runs per day; manual reviews from the admin tab count too. */
  runsPerDay: 8,
  requestMs: 150_000,
  /** How long a gate waits for a run in progress before opening with the current settings. */
  gateWaitMs: 40_000,
} as const;

export type LearningStatus = { enabled: boolean; configured: boolean; model?: string; unreachable?: boolean };
export type LearningOutcome =
  | { kind: "done"; summary: LearningSummary }
  | { kind: "skipped"; reason: "no_consent" | "daily_limit" | "disabled" }
  | { kind: "failed"; error: string };

export async function learningStatus(signal?: AbortSignal): Promise<LearningStatus> {
  try {
    const response = await fetch("/api/alira/learning/status", { cache: "no-store", signal });
    if (!response.ok) return { enabled: true, configured: true, unreachable: true };
    const data = await response.json();
    return { enabled: data.enabled === true, configured: data.configured === true, model: typeof data.model === "string" ? data.model : undefined };
  } catch {
    // A brief network failure is not "switched off": let a review try, and report its own error.
    return { enabled: true, configured: true, unreachable: true };
  }
}

/** The request for one learning run, cut down to what the patient agreed to share. */
export function buildLearningRequest(trigger: LearningTrigger): LearningRequest {
  const consent = loadConsent();
  // Still images are taken (and so forgotten) either way; they are only sent with camera consent.
  const frames = takeKeyFrames();
  return {
    trigger,
    consent,
    snapshot: buildSnapshot(consent),
    state: loadAdaptation(),
    auto: autoValuesNow(),
    ...(consent.camera && frames.length ? { keyFrames: frames } : {}),
  };
}

let inFlight: Promise<LearningOutcome> | null = null;
let lastOutcome: LearningOutcome | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => { try { listener(); } catch { /* ignore */ } });

export function subscribeLearningRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const learningRunning = () => inFlight !== null;
export const lastLearningOutcome = () => lastOutcome;

function runsToday(day = learningToday()): number {
  return loadAdaptation().summaries.filter(summary => summary.day === day).length;
}

async function postRun(request: LearningRequest, signal: AbortSignal): Promise<LearningResponse> {
  const response = await fetch("/api/alira/learning/run", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Alira couldn't review today's results just now.");
  return data as LearningResponse;
}

/**
 * Starts a learning run unless one is already running. Without consent to share movement results,
 * or past today's limit, nothing is sent and the defaults stay in force.
 */
export function startLearning(trigger: LearningTrigger, { force = false }: { force?: boolean } = {}): Promise<LearningOutcome> {
  if (inFlight) return inFlight;
  const skip = (reason: "no_consent" | "daily_limit"): Promise<LearningOutcome> => {
    takeKeyFrames();
    lastOutcome = { kind: "skipped", reason };
    notify();
    return Promise.resolve(lastOutcome);
  };
  if (!learningAllowed()) return skip("no_consent");
  if (!force && runsToday() >= LEARNING_LIMITS.runsPerDay) return skip("daily_limit");
  const request = buildLearningRequest(trigger);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEARNING_LIMITS.requestMs);
  const day = learningToday();
  inFlight = (async (): Promise<LearningOutcome> => {
    try {
      const reply = await postRun(request, controller.signal);
      const at = new Date().toISOString();
      const { accepted, rejected } = applyLearnedChanges(Array.isArray(reply.changes) ? reply.changes : [], { at, by: "alira", trigger }, day);
      const summary: LearningSummary = {
        id: `learn-${Date.now().toString(36)}`, day, at, trigger,
        text: typeof reply.summary === "string" ? reply.summary : "",
        patientNote: typeof reply.patientNote === "string" ? reply.patientNote : "",
        changeIds: accepted.map(entry => entry.id),
        rejected: [...(Array.isArray(reply.rejected) ? reply.rejected : []), ...rejected].slice(0, 20),
        model: typeof reply.model === "string" ? reply.model : "",
      };
      addLearningSummary(summary);
      return { kind: "done", summary };
    } catch (error) {
      const message = error instanceof Error && error.name !== "AbortError" ? error.message : "Alira took too long to review today's results.";
      return { kind: "failed", error: message };
    } finally {
      clearTimeout(timer);
    }
  })();
  notify();
  const run = inFlight;
  run.then(outcome => {
    lastOutcome = outcome;
    if (inFlight === run) inFlight = null;
    notify();
  });
  return run;
}

/** Waits for the run in progress, if any, for at most `ms`. Resolves true if it finished in time. */
export async function waitForLearning(ms: number = LEARNING_LIMITS.gateWaitMs): Promise<boolean> {
  const run = inFlight;
  if (!run) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); });
  const done = run.then(() => true as const);
  const finished = await Promise.race([done, timeout]);
  clearTimeout(timer);
  return finished;
}

/** Safety as Alira's learning sees it now, for the admin tab. */
export const safetyNow = () => currentSafety();

// ---------------------------------------------------------------- the admin chat

type ChatEvent = { type: "status"; text: string; file?: string } | { type: "answer"; text: string } | { type: "error"; error: string } | { type: "done" };

/** Asks Alira about what she learned and changed. She can explain, never change, in this chat. */
export async function askLearningChat({ turns, signal, onStatus }: {
  turns: ChannelTurn[];
  signal: AbortSignal;
  onStatus?: (event: Extract<ChatEvent, { type: "status" }>) => void;
}): Promise<{ text: string; files: string[] }> {
  const consent = loadConsent();
  const response = await fetch("/api/alira/learning/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: channelHistory(turns).map(({ role, text }) => ({ role, text })),
      context: { consent, snapshot: buildSnapshot(consent), state: loadAdaptation(), auto: autoValuesNow() },
    }),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "I couldn't answer that just now. Please try again.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const files: string[] = [];
  let buffer = "";
  let answer = "";
  const consume = (part: string) => {
    const line = part.split("\n").find(item => item.startsWith("data: "));
    if (!line) return;
    const event: ChatEvent = JSON.parse(line.slice(6));
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "answer") answer = event.text;
    if (event.type === "status") {
      if (event.file && !files.includes(event.file)) files.push(event.file);
      onStatus?.(event);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      parts.forEach(consume);
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (!answer.trim()) throw new Error("The answer got interrupted. Please ask again.");
    return { text: answer, files };
  } finally { reader.releaseLock(); }
}
