import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { aliraVoiceKey, aliraVoicePackDir, createAliraSpeaker, type VoiceConfig } from "../../../server/alira-voice";
import { createAliraSpeakRouter, createExerciseVoiceRouter, createFastCheckVoiceRouter } from "../../../server/exercise-voice";
import { aliraSpokenLines } from "./alira-spoken-lines";
import { aliraVoicePhrases } from "./alira-voice-phrases";
import { EXERCISES } from "./exercise-engine/config";

const config: VoiceConfig = { apiKey: "test-secret", voiceId: "test-voice", modelId: "eleven_multilingual_v2" };
const audio = () => new Response(new Uint8Array(200).fill(7), { headers: { "Content-Type": "audio/mpeg" } });
const fixtures: { server: Server; root: string }[] = [];

async function fixture({ request = vi.fn(async () => audio()), settings = config } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "alira-exercise-voice-test-"));
  const speak = createAliraSpeaker({ root, request: request as typeof fetch, getConfig: () => settings });
  const local = vi.fn(async () => ({ audio: Buffer.from("RIFF"), voice: "Microsoft Zira", language: "en-US" }));
  const app = express();
  app.use("/api/exercise-voice", createExerciseVoiceRouter(local, speak));
  app.use("/api/tts/generate", createFastCheckVoiceRouter(speak));
  app.use("/api/alira/speak", createAliraSpeakRouter(speak));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  fixtures.push({ server, root });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { root, base, post, request, local };
}
afterEach(async () => {
  for (const { server, root } of fixtures.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("alira-exercise-voice-test-")) throw new Error("Unsafe test cleanup path");
    await rm(root, { recursive: true });
  }
});

describe("Alira's voice in the exercises and the FAST check", () => {
  it("adds every fixed exercise and FAST line to Alira's recorded phrases", () => {
    const lines = new Set(Object.values(aliraVoicePhrases));
    for (const exercise of Object.values(EXERCISES)) {
      expect(lines.has(exercise.setupVoice)).toBe(true);
      expect(lines.has(exercise.praise)).toBe(true);
      for (const step of exercise.cycle) expect(lines.has(step.voice)).toBe(true);
    }
    expect(lines.has("Face. Please smile and hold while I compare both sides.")).toBe(true);
    expect(Object.keys(aliraSpokenLines).every(id => /^(exercise|fast)-[0-9a-f]{8}$/.test(id))).toBe(true);
  });

  it("plays a recorded line from the voice pack without calling ElevenLabs", async () => {
    const { root, post, request } = await fixture();
    const line = "Slowly reach your hand forward, as far as you comfortably can.";
    await mkdir(aliraVoicePackDir(root), { recursive: true });
    await writeFile(path.join(aliraVoicePackDir(root), `${aliraVoiceKey(config, line)}.mp3`), Buffer.alloc(300, 1));
    const response = await post("/api/exercise-voice", { text: line, provider: "alira" });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Exercise-Voice")).toBe("Alira");
    expect(response.headers.get("X-Exercise-Voice-Source")).toBe("pack");
    expect(response.headers.get("X-Exercise-Language")).toBe("en-GB");
    expect(request).not.toHaveBeenCalled();
  });

  it("speaks a live line in Alira's voice and settings, then serves it from the cache", async () => {
    const { post, request } = await fixture();
    const first = await post("/api/exercise-voice", { text: "Repetition 1 complete. Your score is 80 out of 100.", provider: "alira" });
    expect(first.headers.get("X-Exercise-Voice-Source")).toBe("live");
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/text-to-speech/test-voice");
    expect(JSON.parse(String(init.body)).voice_settings).toBeDefined();
    const again = await post("/api/exercise-voice", { text: "Repetition 1 complete. Your score is 80 out of 100.", provider: "alira" });
    expect(again.headers.get("X-Exercise-Voice-Source")).toBe("cache");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when Alira's voice can't speak, so the runner uses a device voice", async () => {
    const { post, request } = await fixture({ request: vi.fn(async () => new Response("{}", { status: 401 })) });
    expect((await post("/api/exercise-voice", { text: "Relax your shoulder.", provider: "alira" })).status).toBe(503);
    // After a refusal it stops asking ElevenLabs for a while instead of making patients wait.
    expect((await post("/api/exercise-voice", { text: "Sit tall.", provider: "alira" })).status).toBe(503);
    expect(request).toHaveBeenCalledTimes(1);
    const { post: postUnconfigured } = await fixture({ settings: { ...config, apiKey: "" } });
    expect((await postUnconfigured("/api/exercise-voice", { text: "Sit tall.", provider: "alira" })).status).toBe(503);
  });

  it("refuses requests from another site and keeps the local Windows voice as before", async () => {
    const { post, local } = await fixture();
    expect((await post("/api/exercise-voice", { text: "Sit tall.", provider: "alira" }, { Origin: "https://elsewhere.example" })).status).toBe(403);
    const windows = await post("/api/exercise-voice", { text: "Sit tall." });
    expect(windows.headers.get("Content-Type")).toContain("audio/wav");
    expect(local).toHaveBeenCalledTimes(1);
  });

  it("gives the FAST check Alira's voice in the format it expects", async () => {
    const { post } = await fixture();
    const response = await post("/api/tts/generate", { text: "Face. Please smile and hold while I compare both sides." });
    const data = await response.json();
    expect(data.voice).toBe("Alira");
    expect(Buffer.from(data.audio_b64, "base64")).toHaveLength(200);
    const { post: postUnconfigured } = await fixture({ settings: { ...config, apiKey: "" } });
    expect((await postUnconfigured("/api/tts/generate", { text: "Arms." })).status).toBe(503);
  });

  it("reads Alira's personal messages and in-the-moment replies in her voice", async () => {
    const { post, request } = await fixture();
    const response = await post("/api/alira/speak", { text: "Well done, Zak. Your upper limb score is 62 today." });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("audio/mpeg");
    expect(response.headers.get("X-Alira-Voice-Source")).toBe("live");
    expect(request).toHaveBeenCalledTimes(1);
    expect((await post("/api/alira/speak", { text: "Hi" }, { Origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await post("/api/alira/speak", { text: "" })).status).toBe(400);
    const { post: postUnconfigured } = await fixture({ settings: { ...config, apiKey: "" } });
    expect((await (await postUnconfigured("/api/alira/speak", { text: "Hello." })).json()).code).toBe("VOICE_UNAVAILABLE");
  });
});
