export const ALIRA_VISIT_KEY = "rehyn.alira.visit.v1";
type AliraVisit = { started: boolean };
let fallback: AliraVisit | null = null;

export function loadAliraVisit(): AliraVisit | null {
  try {
    const raw = localStorage.getItem(ALIRA_VISIT_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return typeof value?.started === "boolean" ? { started: value.started } : null;
  } catch {
    return fallback;
  }
}

export function rememberAliraVisit(started: boolean): void {
  const visit = { started: started || loadAliraVisit()?.started === true };
  try {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify(visit));
    fallback = null;
  } catch {
    fallback = visit;
  }
}
