import { afterEach, describe, expect, it, vi } from "vitest";
import { ALIRA_MESSAGE_STYLE, aliraCharacters, presentAliraMessage } from "./alira-message-style";

afterEach(() => vi.useRealTimers());
describe("Alira message delivery", () => {
  it("waits before a message, reveals Unicode characters in order, and completes after the final character", async () => {
    vi.useFakeTimers();
    const events: (string | boolean)[] = [];
    let done = false;
    const flow = presentAliraMessage("Hi 🌱!", {
      onThinking: value => events.push(value), onMessage: () => events.push("message"), onFrame: text => events.push(text),
    }, new AbortController().signal, false).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(ALIRA_MESSAGE_STYLE.thinkingMs - 1);
    expect(events).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([true, false, "message", "H"]);
    await vi.advanceTimersByTimeAsync(24 * 4);
    expect(events.slice(-5)).toEqual(["H", "Hi", "Hi ", "Hi 🌱", "Hi 🌱!"]);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(450);
    await flow;
    expect(done).toBe(true);
  });
  it.each(["thinking", "typing"])("cancels during %s without delivering later characters or completion", async phase => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const frame = vi.fn();
    const message = vi.fn();
    const flow = presentAliraMessage("Hello", { onThinking: () => {}, onMessage: message, onFrame: frame }, controller.signal, false);
    const cancelled = expect(flow).rejects.toBe("page-left");
    await vi.advanceTimersByTimeAsync(phase === "thinking" ? 400 : 825);
    const shown = frame.mock.calls.length;
    controller.abort("page-left");
    await cancelled;
    await vi.runAllTimersAsync();
    expect(frame).toHaveBeenCalledTimes(shown);
    expect(message).toHaveBeenCalledTimes(phase === "thinking" ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("waits for CSS character reveal to finish before releasing the next message or its buttons", async () => {
    vi.useFakeTimers();
    const text = "Rest, Alex.";
    const length = aliraCharacters(text).total;
    const message = vi.fn();
    let ready = false;
    const flow = presentAliraMessage(text, { onThinking: () => {}, onMessage: message }, new AbortController().signal, false).then(() => { ready = true; });
    await vi.advanceTimersByTimeAsync(ALIRA_MESSAGE_STYLE.thinkingMs + length + ALIRA_MESSAGE_STYLE.settleMs - 1);
    expect(message).toHaveBeenCalledOnce();
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flow;
    expect(ready).toBe(true);
  });
  it("delivers readable complete text immediately for reduced motion without waiting timers", async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    await presentAliraMessage("Good rest 🌱", { onThinking: value => events.push(value), onMessage: chars => events.push(chars), onFrame: text => events.push(text) }, new AbortController().signal, true);
    expect(events).toEqual([false, [], "Good rest 🌱"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
