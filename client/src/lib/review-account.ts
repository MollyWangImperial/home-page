import { createAccountResetStore } from "./account-reset";

// This public review release starts with an unanswered survey. Later visits keep
// the reviewer's own answers and progress; localhost and other sites are untouched.
export const REVIEW_ORIGIN = "https://rehyn-recovery-companion.onrender.com";
export const REVIEW_ACCOUNT_VERSION = "fresh-survey-2026-10-01";
// Outside the account-key prefix so a manual account reset/undo keeps this marker.
export const REVIEW_ACCOUNT_KEY = "rehyn-review-account-version";
type ReviewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function initializeReviewAccount(origin: string, access: () => { local: ReviewStorage; session: ReviewStorage }): boolean {
  if (origin !== REVIEW_ORIGIN) return false;
  let local: ReviewStorage | undefined;
  try {
    const stores = access();
    local = stores.local;
    if (local.getItem(REVIEW_ACCOUNT_KEY) === REVIEW_ACCOUNT_VERSION) return false;
    // Reserve the marker before resetting. If storage cannot save it, retain the
    // existing account rather than repeatedly clearing new answers on reload.
    local.setItem(REVIEW_ACCOUNT_KEY, REVIEW_ACCOUNT_VERSION);
    if (createAccountResetStore(() => stores).reset()) return true;
    local.removeItem(REVIEW_ACCOUNT_KEY);
  } catch {
    try { local?.removeItem(REVIEW_ACCOUNT_KEY); } catch { /* Storage is unavailable. */ }
  }
  return false;
}
