import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkInAnswers,
  parseRememberedCheckIn,
  rememberCheckIn,
  loadRememberedCheckIn,
  forgetCheckIn,
} from "./alira-check-ins";
import { createAliraSpeech } from "./alira-speech";
import voiceClips from "./alira-voice-clips.json";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("check-in continuity", () => {
  it("only uses known, recent answers; rejects malformed and future memories", () => {
    const now = Date.now();
    expect(
      parseRememberedCheckIn(
        JSON.stringify({ answerId: "tired", recordedAt: now }),
        now
      )?.answerId
    ).toBe("tired");
    for (const value of [
      "broken",
      "null",
      JSON.stringify({ answerId: "invented", recordedAt: now }),
      JSON.stringify({ answerId: "good", recordedAt: now + 1 }),
      JSON.stringify({ answerId: "good", recordedAt: now - 31 * 86400000 }),
    ]) {
      expect(parseRememberedCheckIn(value, now)).toBeNull();
    }
  });
  it("remembers a real choice across visits and supports forgetting it", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    rememberCheckIn(checkInAnswers.tired);
    expect(loadRememberedCheckIn()?.answerId).toBe("tired");
    expect(forgetCheckIn()).toBe(true);
    expect(loadRememberedCheckIn()).toBeNull();
  });
  it("keeps the page usable when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
      removeItem() {
        throw Error();
      },
    });
    expect(loadRememberedCheckIn()).toBeNull();
    expect(rememberCheckIn(checkInAnswers.good)).toBeNull();
    expect(forgetCheckIn()).toBe(false);
  });
});

function speechFixture(voices = [{ localService: true, lang: "en-GB" }]) {
  const synth = { getVoices: () => voices, cancel: vi.fn(), speak: vi.fn() };
  const changed = vi.fn();
  const utterances: SpeechSynthesisUtterance[] = [];
  const playback = createAliraSpeech(
    synth as unknown as SpeechSynthesis,
    text => {
      const utterance = { text } as SpeechSynthesisUtterance;
      utterances.push(utterance);
      return utterance;
    },
    changed
  );
  return { playback, synth, changed, utterances };
}

describe("optional voice playback", () => {
  it("ships an audio clip for each check-in acknowledgment", () => {
    for (const answer of Object.values(checkInAnswers)) {
      expect((voiceClips as Record<string, string>)[answer.response]).toMatch(
        /^\/audio\/alira\/.+\.wav$/
      );
    }
  });
  it("plays packaged audio when a browser has no device voices, and cleans up on stop", async () => {
    vi.useFakeTimers();
    const audio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      onplaying: null,
      onended: null,
      onerror: null,
    } as unknown as HTMLAudioElement;
    const changed = vi.fn();
    const playback = createAliraSpeech(null, vi.fn(), changed, () => audio);
    playback.play("hello", "Hello Molly");
    expect(audio.play).toHaveBeenCalledOnce();
    audio.onplaying?.(new Event("playing"));
    expect(changed).toHaveBeenLastCalledWith({
      activeId: "hello",
      speaking: true,
      error: "",
    });
    playback.stop();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith({
      activeId: null,
      speaking: false,
      error: "",
    });
    const calls = changed.mock.calls.length;
    audio.onended?.(new Event("ended"));
    vi.advanceTimersByTime(6000);
    expect(changed).toHaveBeenCalledTimes(calls);
  });
  it("reports rejected audio playback without leaving the avatar speaking", async () => {
    const audio = {
      play: vi.fn().mockRejectedValue(Error("not allowed")),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    } as unknown as HTMLAudioElement;
    const changed = vi.fn();
    const playback = createAliraSpeech(null, vi.fn(), changed, () => audio);
    playback.play("hello", "Hello Molly");
    await Promise.resolve();
    expect(changed.mock.lastCall?.[0].speaking).toBe(false);
    expect(changed.mock.lastCall?.[0].error).toContain("couldn’t play");
  });
  it("never auto-plays and only animates as speaking after playback starts", () => {
    vi.useFakeTimers();
    const { playback, synth, changed, utterances } = speechFixture();
    expect(synth.speak).not.toHaveBeenCalled();
    playback.play("hello", "Hello Molly");
    expect(changed).toHaveBeenLastCalledWith({
      activeId: "hello",
      speaking: false,
      error: "",
    });
    utterances[0].onstart?.(new Event("start") as SpeechSynthesisEvent);
    expect(changed).toHaveBeenLastCalledWith({
      activeId: "hello",
      speaking: true,
      error: "",
    });
    utterances[0].onend?.(new Event("end") as SpeechSynthesisEvent);
    expect(changed).toHaveBeenLastCalledWith({
      activeId: null,
      speaking: false,
      error: "",
    });
    vi.advanceTimersByTime(6000);
    expect(changed.mock.lastCall?.[0].error).toBe("");
  });
  it("can stop, replace playback and ignore callbacks from an old utterance", () => {
    vi.useFakeTimers();
    const { playback, synth, changed, utterances } = speechFixture();
    playback.play("one", "First message");
    playback.play("two", "Second message");
    const calls = changed.mock.calls.length;
    utterances[0].onend?.(new Event("end") as SpeechSynthesisEvent);
    expect(changed).toHaveBeenCalledTimes(calls);
    playback.play("two", "Second message");
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(changed.mock.lastCall?.[0].activeId).toBeNull();
  });
  it("handles unavailable local voices without sending text to a remote voice", () => {
    const { playback, synth, changed } = speechFixture([
      { localService: false, lang: "en-GB" },
    ]);
    playback.play("hello", "Hello Molly");
    expect(synth.speak).not.toHaveBeenCalled();
    expect(changed.mock.lastCall?.[0].error).toContain("isn’t available");
  });
  it("recovers from stalled playback and cancels pending work on cleanup", () => {
    vi.useFakeTimers();
    const { playback, changed } = speechFixture();
    playback.play("hello", "Hello Molly");
    vi.advanceTimersByTime(5000);
    expect(changed.mock.lastCall?.[0].error).toContain("didn’t start");
    playback.play("hello", "Hello Molly");
    playback.stop(false);
    const calls = changed.mock.calls.length;
    vi.advanceTimersByTime(6000);
    expect(changed).toHaveBeenCalledTimes(calls);
  });
});
