import { afterEach, describe, expect, it, vi } from "vitest";
import { createFastCheckHost } from "./fast-check-host";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16),
    cancelAnimationFrame: clearTimeout,
  });
  const root = { querySelector: vi.fn(), ownerDocument: { createElement: vi.fn() } } as unknown as HTMLElement;
  const exit = vi.fn(), restart = vi.fn();
  return { root, exit, restart, host: createFastCheckHost(root, "http://127.0.0.1:8002", exit, restart) };
}

describe("FAST native page host", () => {
  it("scopes element lookups and forwards only explicit local navigation", () => {
    const { host, root, exit, restart } = setup();
    host.document.getElementById("begin");
    expect(root.querySelector).toHaveBeenCalledWith('[id="begin"]');
    expect(host.document.body).toBe(root);
    host.onMessage({ type: "fast_check_result" });
    expect(exit).not.toHaveBeenCalled();
    host.onMessage({ type: "exit" }); host.onRestart();
    expect(exit).toHaveBeenCalledOnce(); expect(restart).toHaveBeenCalledOnce();
    host.dispose(); host.onMessage({ type: "exit" }); host.onRestart();
    expect(exit).toHaveBeenCalledOnce(); expect(restart).toHaveBeenCalledOnce();
  });

  it("routes speech and vision resources to the assessment service, and cancels requests on exit", async () => {
    const { host } = setup();
    const request = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", request);
    expect(host.resource("/vendor/mediapipe/wasm")).toBe("http://127.0.0.1:8002/vendor/mediapipe/wasm");
    await host.fetch("/api/stt/transcribe", { method: "POST" });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8002/api/stt/transcribe");
    expect(options.method).toBe("POST"); expect(options.signal.aborted).toBe(false);
    host.dispose(); expect(options.signal.aborted).toBe(true);
    await expect(host.fetch("/api/tts/generate")).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("cancels pending transitions, voice watchdogs and animation frames on exit", () => {
    const { host } = setup(); const callback = vi.fn();
    host.setTimeout(callback, 100); host.requestAnimationFrame(callback);
    host.dispose(); host.dispose();
    host.setTimeout(callback, 100); host.requestAnimationFrame(callback);
    vi.runAllTimers(); expect(callback).not.toHaveBeenCalled();
  });

  it("stops camera/microphone tracks and closes models without acquiring media on mount", async () => {
    const { host } = setup(); const stop = vi.fn(), close = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    expect(getUserMedia).not.toHaveBeenCalled();
    await host.getUserMedia({ video: true }); host.ownModel({ close });
    host.dispose(); expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });

  it("releases media and models that finish starting after the patient leaves", async () => {
    const { host } = setup(); const stop = vi.fn(), close = vi.fn();
    let resolve!: (value: MediaStream) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(done => { resolve = done; }) } });
    const pending = host.getUserMedia({ audio: true });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    host.dispose();
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await rejected; host.ownModel({ close });
    expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
});
