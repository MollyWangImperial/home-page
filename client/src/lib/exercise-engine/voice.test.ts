import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoice, pickEnglishVoice } from "./voice";

const voice = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
class Utterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
function mockSpeech(getVoices: () => SpeechSynthesisVoice[]) {
  const synth = { getVoices, speak: vi.fn(), cancel: vi.fn(), speaking: false, pending: false };
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  return synth;
}
/** Alira's voice is unavailable (no recording, no credits), so the device voice takes over. */
function refuseAlira(local?: () => Response) {
  const calls: { provider?: string; text: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (body.provider === "alira" || !local) return new Response("{}", { status: 503 });
    return local();
  }));
  return calls;
}
function mockAudio() {
  const audio: { onended: (() => void) | null; src: string }[] = [];
  vi.stubGlobal("URL", { createObjectURL: () => "blob:clip", revokeObjectURL: () => {} });
  vi.stubGlobal("Audio", class {
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) { audio.push(this); }
    play() { return Promise.resolve(); }
    pause() {}
  });
  return audio;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Alira's voice in the exercises (opt-in, off for now)", () => {
  it("speaks each instruction in Alira's voice first, without the device voice", async () => {
    vi.useFakeTimers();
    const synth = mockSpeech(() => [voice("Microsoft Sonia", "en-GB")]);
    const calls: { provider?: string; text: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(new Blob(["mp3"]), { headers: { "X-Exercise-Language": "en-GB", "X-Exercise-Voice": "Alira", "X-Exercise-Voice-Provider": "elevenlabs", "Content-Type": "audio/mpeg" } });
    }));
    const audio = mockAudio();
    const api = createVoice({ alira: true });
    api.onAvailability = vi.fn();
    api.say("Reach forward. Hold on the circle.");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ text: "Reach forward. Hold on the circle.", provider: "alira" }]);
    expect(audio).toHaveLength(1);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(api.onAvailability).toHaveBeenCalledWith(true);
    expect(api.busy(100000)).toBe(true);
    audio[0].onended?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.busy(100000)).toBe(false);
  });
});

describe("English-only exercise voice when Alira's voice is unavailable", () => {
  it("keeps targets waiting until every spoken sentence actually ends", async () => {
    const synth = mockSpeech(() => [voice("Microsoft Sonia", "en-GB")]);
    refuseAlira();
    const api = createVoice();
    api.say("Reach forward. Hold on the circle.");
    expect(api.busy(1000000)).toBe(true);
    await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(2));
    const utterances = synth.speak.mock.calls.map(([utterance]) => utterance);
    expect(utterances).toHaveLength(2);
    expect(api.busy(1000000)).toBe(true);
    utterances[0].onend();
    expect(api.busy(1000000)).toBe(true);
    utterances[1].onend();
    expect(api.busy(1000000)).toBe(false);
  });
  it("rejects non-English voices even when they are the system default", () => {
    const chinese = voice("Microsoft Huihui", "zh-CN");
    expect(pickEnglishVoice([chinese])).toBeNull();
    const english = voice("Microsoft Zira", "en-US");
    expect(pickEnglishVoice([chinese, english])).toBe(english);
  });
  it("waits for late voice loading, then explicitly speaks the score in English", async () => {
    vi.useFakeTimers();
    let available: SpeechSynthesisVoice[] = [];
    const synth = mockSpeech(() => available);
    refuseAlira();
    const api = createVoice();
    api.say("Repetition 1 complete. Your score is 100 out of 100.");
    expect(api.busy(0)).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
    available = [voice("Microsoft Huihui", "zh-CN"), voice("Microsoft Sonia", "en-GB")];
    await vi.advanceTimersByTimeAsync(100);
    expect(synth.speak).toHaveBeenCalledTimes(2);
    synth.speak.mock.calls.forEach(([utterance]) => { expect(utterance.voice.lang).toBe("en-GB"); expect(utterance.lang).toBe("en-GB"); });
  });
  it("keeps subtitles instead of speaking Chinese when no English voice loads", async () => {
    vi.useFakeTimers();
    const synth = mockSpeech(() => [voice("Huihui", "zh-CN")]);
    refuseAlira();
    const api = createVoice();
    api.onAvailability = vi.fn();
    api.say("Straighten your elbow a little more.");
    await vi.advanceTimersByTimeAsync(3100);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(api.onAvailability).toHaveBeenCalledWith(false);
  });
  it("does not play a cancelled prompt after voices finish loading", async () => {
    vi.useFakeTimers();
    let available: SpeechSynthesisVoice[] = [];
    const synth = mockSpeech(() => available);
    refuseAlira();
    const api = createVoice();
    api.say("Old setup guidance.");
    api.stop();
    available = [voice("Sonia", "en-GB")];
    await vi.advanceTimersByTimeAsync(100);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(api.busy(5000)).toBe(false);
  });
  it("plays the local English fallback when the browser offers only Chinese voices", async () => {
    vi.useFakeTimers();
    const synth = mockSpeech(() => [voice("Huihui", "zh-CN")]);
    const calls = refuseAlira(() => new Response(new Blob(["wav"]), { headers: { "X-Exercise-Language": "en-US", "Content-Type": "audio/wav" } }));
    const audio = mockAudio();
    const api = createVoice();
    api.onAvailability = vi.fn();
    api.say("Relax your shoulder.");
    await vi.advanceTimersByTimeAsync(3100);
    // Alira's voice is off for the exercises by default, so only the local voice is asked.
    expect(calls.map(call => call.provider ?? "local")).toEqual(["local"]);
    expect(audio).toHaveLength(1);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(api.onAvailability).toHaveBeenCalledWith(true);
    expect(api.busy(100000)).toBe(true);
    audio[0].onended?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.busy(100000)).toBe(false);
  });
});

describe("reach keeps Alira as its only speaker", () => {
  it.each([503, 200])("does not switch to a device or local voice on unavailable or mismatched audio (%s)", async status => {
    vi.useFakeTimers();
    const synth = mockSpeech(() => [voice("Microsoft Sonia", "en-GB")]);
    const requests: { provider?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(new Blob(["other voice"]), { status, headers: { "X-Exercise-Language": "en-GB", "X-Exercise-Voice": "Other", "X-Exercise-Voice-Provider": "elevenlabs" } });
    }));
    const audio = mockAudio();
    const api = createVoice({ aliraOnly: true });
    api.onAvailability = vi.fn();
    api.say("Bring your hand back to your lap.");
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([{ text: "Bring your hand back to your lap.", provider: "alira" }]);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(audio).toHaveLength(0);
    expect(api.onAvailability).toHaveBeenCalledWith(false);
    expect(api.busy(100000)).toBe(false);
  });
});
