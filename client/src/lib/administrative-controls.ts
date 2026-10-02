import { REVIEW_ORIGIN } from "./review-account";

/** The public review site keeps the same test controls as the local preview. */
export function renderReviewControlsEnabled(): boolean {
  return typeof window !== "undefined" && window.location?.origin === REVIEW_ORIGIN;
}

export const administrativeControlsEnabled = () => import.meta.env.DEV || renderReviewControlsEnabled();
