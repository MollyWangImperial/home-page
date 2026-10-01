import { aliraTopics } from "./alira-topics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import {
  aliraVoiceKey,
  aliraVoicePackDir,
  createAliraVoiceRouter,
  readVoiceConfig,
  type VoiceConfig,
} from "../../../server/alira-voice";
import { ALIRA_VOICE } from "../../../shared/alira-voice";
import { aliraVoicePhrases } from "./alira-voice-phrases";

const [phraseId, text] = Object.entries(aliraVoicePhrases)[0];
const config: VoiceConfig = {
  apiKey: "test-secret-do-not-expose",
  voiceId: "test-voice",
  modelId: "eleven_multilingual_v2",
};
const fixtures: { server: Server; root: string }[] = [];
const audioResponse = () =>
  new Response(new Uint8Array(200).fill(42), {
    headers: { "Content-Type": "audio/mpeg" },
  });
async function fixture(
  request = vi.fn(async () => audioResponse()),
  settings = config
) {
  const root = await mkdtemp(path.join(tmpdir(), "alira-voice-test-"));
  const app = createAliraVoiceRouter({
    root,
    request: request as typeof fetch,
    getConfig: () => settings,
  });
  const server = await new Promise<Server>(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  fixtures.push({ server, root });
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const post = (body: unknown = { phraseId }, origin?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  return { url, post, request, root };
}
afterEach(async () => {
  for (const { server, root } of fixtures.splice(0)) {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    if (
      !path
        .resolve(root)
        .startsWith(path.resolve(tmpdir()) + path.sep + "alira-voice-test-")
    )
      throw Error("Unexpected test folder");
    await rm(root, { recursive: true, force: true });
  }
});

describe("Alira voice server", () => {
  it("keeps credentials server-side and reports a missing configuration", async () => {
    const { url, post, request } = await fixture(undefined, {
      ...config,
      apiKey: "",
    });
    expect(await (await fetch(`${url}/status`)).json()).toMatchObject({
      provider: "elevenlabs",
      configured: false,
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("VOICE_NOT_CONFIGURED");
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects unknown phrases, arbitrary text, and cross-origin requests before generation", async () => {
    const { post, request } = await fixture();
    expect((await post({ text: "private patient text" })).status).toBe(400);
    expect((await post({ phraseId: "unknown" })).status).toBe(400);
    expect(
      (await post({ phraseId }, "https://another-site.example")).status
    ).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
  it("uses ElevenLabs settings and caches repeat listens", async () => {
    const { url, post, request } = await fixture();
    const response = await post({ phraseId }, url);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Alira-Voice-Provider")).toBe("elevenlabs");
    expect((await response.arrayBuffer()).byteLength).toBe(200);
    const [upstreamUrl, options] = (
      request.mock.calls as unknown as [string, RequestInit][]
    )[0];
    expect(upstreamUrl).toContain(
      "https://api.elevenlabs.io/v1/text-to-speech/test-voice"
    );
    expect(options.headers).toMatchObject({ "xi-api-key": config.apiKey });
    expect(JSON.parse(options.body as string)).toMatchObject({
      text,
      model_id: config.modelId,
      voice_settings: ALIRA_VOICE.settings,
    });
    await post();
    expect(request).toHaveBeenCalledTimes(1);
    const status = await (await fetch(`${url}/status`)).text();
    expect(status).not.toContain(config.apiKey);
  });
  it("speaks in Alira's one voice unless the environment names another", async () => {
    vi.stubEnv("ELEVENLABS_VOICE_ID", "");
    vi.stubEnv("ELEVENLABS_MODEL_ID", "");
    const { root } = await fixture();
    expect(readVoiceConfig(root)).toMatchObject({
      voiceId: ALIRA_VOICE.voiceId,
      modelId: ALIRA_VOICE.modelId,
    });
    vi.stubEnv("ELEVENLABS_VOICE_ID", "another-voice");
    expect(readVoiceConfig(root).voiceId).toBe("another-voice");
    vi.unstubAllEnvs();
  });
  it("plays a line from the voice pack without a key or a provider call", async () => {
    const { url, post, request, root } = await fixture(undefined, {
      ...config,
      apiKey: "",
    });
    const packed = new Uint8Array(300).fill(7);
    await mkdir(aliraVoicePackDir(root), { recursive: true });
    await writeFile(
      path.join(aliraVoicePackDir(root), `${aliraVoiceKey(config, text)}.mp3`),
      packed
    );
    const status = await (await fetch(`${url}/status`)).json();
    expect(status).toMatchObject({ configured: false });
    expect(status.packed).toContain(phraseId);
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Alira-Voice-Source")).toBe("pack");
    expect((await response.arrayBuffer()).byteLength).toBe(300);
    expect(request).not.toHaveBeenCalled();
  });
  it("does not play a clip recorded in a different voice", async () => {
    const { post, request, root } = await fixture();
    await mkdir(aliraVoicePackDir(root), { recursive: true });
    await writeFile(
      path.join(
        aliraVoicePackDir(root),
        `${aliraVoiceKey({ ...config, voiceId: "old-voice" }, text)}.mp3`
      ),
      new Uint8Array(300).fill(7)
    );
    const response = await post();
    expect(response.headers.get("X-Alira-Voice-Source")).toBe("live");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("deduplicates simultaneous requests for the same phrase", async () => {
    const request = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return audioResponse();
    });
    const { post } = await fixture(request);
    const responses = await Promise.all([post(), post(), post()]);
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not expose provider diagnostics or credentials", async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ secret: config.apiKey }), { status: 401 })
    );
    const { post } = await fixture(request);
    const response = await post();
    expect(response.status).toBe(502);
    const result = await response.text();
    expect(result).toContain("VOICE_ACCESS_DENIED");
    expect(result).not.toContain(config.apiKey);
  });
  it("rejects invalid upstream content", async () => {
    const { post } = await fixture(
      vi.fn(async () => new Response("not audio"))
    );
    const response = await post();
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("INVALID_AUDIO");
  });
});

// Topic prompts must be accepted by the same server allowlist used in the browser.
it.each(aliraTopics)("generates the $title opening question", async topic => {
  const { post, request } = await fixture();
  const response = await post({ phraseId: `topic-${topic.id}` });
  expect(response.status).toBe(200);
  const [, options] = (
    request.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(JSON.parse(options.body as string).text).toBe(topic.prompt);
});
