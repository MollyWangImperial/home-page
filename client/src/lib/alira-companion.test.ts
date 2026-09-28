import { aliraTopics } from "./alira-topics";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkInAnswers,
  parseRememberedCheckIn,
  rememberCheckIn,
  loadRememberedCheckIn,
  forgetCheckIn,
} from "./alira-check-ins";
import {
  createAliraSpeech,
  fetchAliraVoice,
  silentSpeech,
} from "./alira-speech";
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

function speechFixture(
  requestAudio = vi.fn(
    async (_text: string, _signal: AbortSignal) => new Blob(["audio"])
  )
) {
  const changed = vi.fn();
  const audios: HTMLAudioElement[] = [];
  const revokeUrl = vi.fn();
  const playback = createAliraSpeech(changed, {
    requestAudio,
    makeAudio: () => {
      const audio = {
        play: vi.fn(async () => {}),
        pause: vi.fn(),
        load: vi.fn(),
        removeAttribute: vi.fn(),
      } as unknown as HTMLAudioElement;
      audios.push(audio);
      return audio;
    },
    createUrl: () => "blob:alira",
    revokeUrl,
  });
  return { playback, changed, audios, requestAudio, revokeUrl };
}

describe("ElevenLabs voice playback", () => {
  it("has a registered phrase for every check-in reply", () => {
    for (const answer of Object.values(checkInAnswers))
      expect(
        (voiceClips as Record<string, string>)[answer.response]
      ).toBeTruthy();
  });
  it("never autoplays and animates only while audio is actually playing", async () => {
    const { playback, changed, audios, requestAudio, revokeUrl } =
      speechFixture();
    expect(requestAudio).not.toHaveBeenCalled();
    await playback.play("one", "Hello");
    expect(changed).toHaveBeenLastCalledWith({
      activeId: "one",
      speaking: false,
      loading: true,
      error: "",
    });
    audios[0].onplaying?.call(audios[0], new Event("playing"));
    expect(changed.mock.lastCall?.[0].speaking).toBe(true);
    audios[0].onended?.call(audios[0], new Event("ended"));
    expect(changed).toHaveBeenLastCalledWith(silentSpeech);
    expect(revokeUrl).toHaveBeenCalledWith("blob:alira");
  });
  it("cancels pending generation and ignores a late response", async () => {
    let resolve!: (blob: Blob) => void;
    const request = vi.fn(
      (_text: string, _signal: AbortSignal) =>
        new Promise<Blob>(done => {
          resolve = done;
        })
    );
    const { playback, audios, changed } = speechFixture(request);
    const pending = playback.play("one", "Hello");
    playback.stop();
    expect(request.mock.calls[0][1].aborted).toBe(true);
    resolve(new Blob(["audio"]));
    await pending;
    expect(audios).toHaveLength(0);
    expect(changed).toHaveBeenLastCalledWith(silentSpeech);
  });
  it("replaces playback, ignores stale callbacks and reuses cached audio", async () => {
    const { playback, audios, changed, requestAudio } = speechFixture();
    await playback.play("one", "Hello");
    const latePlaying = audios[0].onplaying!;
    await playback.play("two", "Second");
    const calls = changed.mock.calls.length;
    latePlaying.call(audios[0], new Event("playing"));
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(audios[0].pause).toHaveBeenCalled();
    await playback.play("two", "Second");
    expect(changed).toHaveBeenLastCalledWith(silentSpeech);
    await playback.play("one", "Hello");
    expect(requestAudio).toHaveBeenCalledTimes(2);
    playback.stop();
  });
  it("handles loading stalls, waiting during playback, and cleanup", async () => {
    vi.useFakeTimers();
    const { playback, audios, changed } = speechFixture();
    await playback.play("one", "Hello");
    audios[0].onplaying?.call(audios[0], new Event("playing"));
    audios[0].onwaiting?.call(audios[0], new Event("waiting"));
    expect(changed.mock.lastCall?.[0].loading).toBe(true);
    vi.advanceTimersByTime(30000);
    expect(changed.mock.lastCall?.[0].error).toContain("too long");
    await playback.play("one", "Hello");
    playback.stop(false);
    const calls = changed.mock.calls.length;
    vi.advanceTimersByTime(30000);
    expect(changed).toHaveBeenCalledTimes(calls);
  });
  it("shows safe errors and never leaves the avatar speaking after failure", async () => {
    const request = vi.fn(async () => {
      throw Error("private upstream diagnostic");
    });
    const { playback, changed } = speechFixture(request);
    await playback.play("one", "Hello");
    expect(changed.mock.lastCall?.[0]).toMatchObject({
      activeId: null,
      speaking: false,
      loading: false,
    });
    expect(changed.mock.lastCall?.[0].error).not.toContain("private");
  });
  it("sends only a known phrase ID to the same-origin server", async () => {
    const request = vi.fn(
      async () =>
        new Response(new Blob(["audio"]), {
          headers: { "Content-Type": "audio/mpeg" },
        })
    );
    vi.stubGlobal("fetch", request);
    const [text, clip] = Object.entries(voiceClips)[0];
    const signal = new AbortController().signal;
    await fetchAliraVoice(text, signal);
    expect(request).toHaveBeenCalledWith(
      "/api/alira/voice",
      expect.objectContaining({
        body: JSON.stringify({
          phraseId: clip.split("/").pop()!.replace(".wav", ""),
        }),
        signal,
      })
    );
    await expect(
      fetchAliraVoice("unregistered private message", signal)
    ).rejects.toThrow("isn’t available");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("reports connection errors and rejects invalid audio", async () => {
    const text = Object.keys(voiceClips)[0];
    const signal = new AbortController().signal;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "VOICE_NOT_CONFIGURED" }), {
            status: 503,
          })
      )
    );
    await expect(fetchAliraVoice(text, signal)).rejects.toThrow(
      "isn’t connected"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>oops</html>", {
            headers: { "Content-Type": "text/html" },
          })
      )
    );
    await expect(fetchAliraVoice(text, signal)).rejects.toThrow(
      "couldn’t load"
    );
  });
});

it.each(aliraTopics)(
  "requests the registered voice for $title",
  async topic => {
    const request = vi.fn(
      async () =>
        new Response(new Blob(["audio"]), {
          headers: { "Content-Type": "audio/mpeg" },
        })
    );
    vi.stubGlobal("fetch", request);
    await fetchAliraVoice(topic.prompt, new AbortController().signal);
    expect(request).toHaveBeenCalledWith(
      "/api/alira/voice",
      expect.objectContaining({
        body: JSON.stringify({ phraseId: `topic-${topic.id}` }),
      })
    );
  }
);
