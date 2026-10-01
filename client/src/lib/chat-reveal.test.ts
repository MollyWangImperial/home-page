import { afterEach, describe, expect, it, vi } from "vitest";
import { revealCharacters } from "./chat-reveal";

afterEach(() => vi.useRealTimers());
describe("chat character reveal", () => {
  it("reveals individual Unicode characters and completes only after the last one", () => {
    vi.useFakeTimers();
    const frame = vi.fn();
    const done = vi.fn();
    revealCharacters("Hi 🌱", frame, done, 10);
    expect(frame).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(frame.mock.calls.map(([text]) => text)).toEqual(["H", "Hi", "Hi "]);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(frame).toHaveBeenLastCalledWith("Hi 🌱");
    expect(done).toHaveBeenCalledOnce();
  });
  it("cancels future characters and completion when a tab closes", () => {
    vi.useFakeTimers();
    const frame = vi.fn();
    const done = vi.fn();
    const cancel = revealCharacters("Hello", frame, done, 10);
    vi.advanceTimersByTime(20);
    cancel();
    vi.runAllTimers();
    expect(frame).toHaveBeenCalledTimes(2);
    expect(done).not.toHaveBeenCalled();
  });
});
