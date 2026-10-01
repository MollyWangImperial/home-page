import type { Side } from "./config";
import type { SessionRecord } from "./session";

// Test-lab conveniences only: which options were last used and the last few test sessions, kept in this browser.
export type LabOptions = { side: Side; quick: boolean; sim: boolean; chairBack: boolean; assisted: boolean };

const OPTIONS_KEY = "rehyn.exerciseLab.options";
const SESSIONS_KEY = "rehyn.exerciseLab.sessions";

export const DEFAULT_LAB_OPTIONS: LabOptions = { side: "right", quick: true, sim: false, chairBack: false, assisted: false };

export function readLabOptions(): LabOptions {
  try {
    const raw = window.localStorage.getItem(OPTIONS_KEY);
    return { ...DEFAULT_LAB_OPTIONS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULT_LAB_OPTIONS;
  }
}

export function writeLabOptions(options: LabOptions) {
  try {
    window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* storage unavailable: the options just are not remembered */
  }
}

export type LabSession = SessionRecord & { side: Side; sim: boolean };

export function readLabSessions(): LabSession[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLabSession(record: SessionRecord, extra: { side: Side; sim: boolean }) {
  try {
    const list = [{ ...record, ...extra }, ...readLabSessions()].slice(0, 20);
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function clearLabSessions() {
  try {
    window.localStorage.removeItem(SESSIONS_KEY);
  } catch {
    /* nothing to clear */
  }
}
