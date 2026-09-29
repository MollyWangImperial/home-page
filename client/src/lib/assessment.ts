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

export type RunnerOptions = {
  affectedSide: "left" | "right";
  voiceGuidance?: boolean;
};

/** The initial assessment package: seated reach, shoulder raise, hand to mouth, hand tasks, walking. */
export function buildRunnerUrl(base: string, { affectedSide, voiceGuidance = true }: RunnerOptions): string {
  const query = new URLSearchParams();
  query.set("package", "initial");
  query.set("affected_side", affectedSide === "left" ? "left" : "right");
  query.set("voice_guidance", voiceGuidance ? "1" : "0");
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

export type StoredAssessment = { id: string; completedAt: string; package?: string };

export function rememberAssessment(assessment: unknown): StoredAssessment | null {
  if (!assessment || typeof assessment !== "object") return null;
  const record = assessment as { id?: unknown; assessment_package?: unknown };
  if (typeof record.id !== "string" || !record.id) return null;
  const stored: StoredAssessment = {
    id: record.id,
    completedAt: new Date().toISOString(),
    package: typeof record.assessment_package === "string" ? record.assessment_package : undefined,
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
    return { id: parsed.id, completedAt: parsed.completedAt, package: parsed.package };
  } catch {
    return null;
  }
}
