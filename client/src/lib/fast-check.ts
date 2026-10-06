export const FAST_CHECK_PATH = "/fast-check";
const RETURN_ORIGIN = "https://rehyn.invalid";
// My community keeps its view in the query (?space=safety), so the check comes back to that view.
const RETURN_PAGES = new Set(["/", "/welcome", "/journey", "/alira", "/my-time", "/community"]);

function safeReturnPath(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, RETURN_ORIGIN);
    if (url.origin !== RETURN_ORIGIN || !RETURN_PAGES.has(url.pathname)) return "/";
    return url.pathname + url.search + url.hash;
  } catch { return "/"; }
}

export function fastCheckPath(location: string, search = ""): string {
  const suffix = search ? `${search.startsWith("?") ? "" : "?"}${search}` : "";
  return `${FAST_CHECK_PATH}?${new URLSearchParams({ returnTo: safeReturnPath(location + suffix) })}`;
}

export function fastCheckReturnPath(search: string): string {
  return safeReturnPath(new URLSearchParams(search).get("returnTo"));
}

/** The copied runner keeps its own introduction; opening warning signs never starts the camera. */
export function fastRunnerUrl(base: string): string {
  return `${base}/api/emergency/fast-runner`;
}

/** Detect unavailable services and error pages before embedding them as a health check. */
export async function checkFastRunner(url: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<void> {
  const response = await request(url, { signal, cache: "no-store" });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/html") throw new Error("FAST runner unavailable");
  const html = await response.text();
  if (!html.includes('id="workspace"') || !html.includes('data-testid="fast-start"')) throw new Error("FAST runner incomplete");
}
