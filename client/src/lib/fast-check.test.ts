import { describe, expect, it, vi } from "vitest";
import { checkFastRunner, fastCheckPath, fastCheckReturnPath, fastRunnerUrl } from "./fast-check";

describe("FAST check navigation", () => {
  it.each(["/", "/welcome", "/journey?tab=journal", "/alira?onboarding=1", "/my-time"])("returns to %s", path => {
    const target = fastCheckPath(path);
    expect(target.startsWith("/fast-check?")).toBe(true);
    expect(fastCheckReturnPath(target.split("?")[1])).toBe(path);
  });

  it("keeps the current page query", () => {
    const target = fastCheckPath("/journey", "tab=progress&section=exercises");
    expect(fastCheckReturnPath(target.split("?")[1])).toBe("/journey?tab=progress&section=exercises");
  });

  it.each(["https://example.com", "//example.com", "/\\example.com", "/fast-check", "/unknown", "javascript:alert(1)"])("does not redirect to %s", value => {
    expect(fastCheckReturnPath(new URLSearchParams({ returnTo: value }).toString())).toBe("/");
  });

  it("opens the copied runner introduction without camera autostart", () => {
    expect(fastRunnerUrl("http://127.0.0.1:8002")).toBe("http://127.0.0.1:8002/api/emergency/fast-runner");
    expect(fastCheckReturnPath("")).toBe("/");
  });
});

describe("FAST runner availability", () => {
  const url = "http://127.0.0.1:8002/api/emergency/fast-runner";

  it("accepts the public runner HTML", async () => {
    const request = vi.fn().mockResolvedValue(new Response('<main id="workspace"><button data-testid="fast-start"></button></main>', { headers: { "content-type": "text/html; charset=utf-8" } }));
    const signal = new AbortController().signal;
    await expect(checkFastRunner(url, signal, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(url, { signal, cache: "no-store" });
  });

  it.each([
    [404, "text/html", '<main id="workspace"><button data-testid="fast-start"></button></main>'],
    [200, "application/json", '{"status":"ok"}'],
    [200, "text/html", "<h1>Unavailable</h1>"],
  ])("rejects an error page or incomplete runner (%s, %s)", async (status, type, html) => {
    const request = vi.fn().mockResolvedValue(new Response(html, { status, headers: { "content-type": type } }));
    await expect(checkFastRunner(url, new AbortController().signal, request)).rejects.toThrow(/FAST runner/);
  });
});
