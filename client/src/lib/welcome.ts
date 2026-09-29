// The companion currently has a demo profile, not an authenticated patient record.
// Keep onboarding explicit until the sign-in service supplies assessment status.
export function isOnboardingLocation(pathname: string, search: string): boolean {
  return pathname === "/welcome" ||
    (pathname === "/alira" && new URLSearchParams(search).get("onboarding") === "1");
}

export function getAssessmentUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
