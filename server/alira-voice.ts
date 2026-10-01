import express from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { aliraVoicePhrases } from "../client/src/lib/alira-voice-phrases";
import { ALIRA_VOICE } from "../shared/alira-voice";

const phrases = new Map(Object.entries(aliraVoicePhrases));
// One voice for every line: the same ID, model and delivery settings each time.
const voiceSettings = ALIRA_VOICE.settings;
export type VoiceConfig = { apiKey: string; voiceId: string; modelId: string };

/** Identifies one line spoken in one voice. The live cache and the voice pack share it. */
export function aliraVoiceKey(
  config: Pick<VoiceConfig, "voiceId" | "modelId">,
  text: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([config.voiceId, config.modelId, voiceSettings, text])
    )
    .digest("hex");
}

/**
 * Clips generated ahead of time with `pnpm voice:bake` and committed with the code, so
 * Alira's fixed lines play without an API key and without spending ElevenLabs credits.
 */
export function aliraVoicePackDir(root: string): string {
  return path.join(root, "server", "voice-pack");
}

export function readVoiceConfig(root: string): VoiceConfig {
  let fromFiles: Record<string, string | undefined> = {};
  for (const file of [".env", ".env.local"]) {
    try {
      fromFiles = {
        ...fromFiles,
        ...parseEnv(readFileSync(path.join(root, file), "utf8")),
      };
    } catch {
      /* Environment variables can also be supplied by the host. */
    }
  }
  const env = { ...fromFiles, ...process.env };
  return {
    apiKey: env.ELEVENLABS_API_KEY?.trim() ?? "",
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || ALIRA_VOICE.voiceId,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || ALIRA_VOICE.modelId,
  };
}

class VoiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function createAliraVoiceRouter({
  root,
  getConfig = () => readVoiceConfig(root),
  request = fetch,
}: {
  root: string;
  getConfig?: () => VoiceConfig;
  request?: typeof fetch;
}) {
  // Initialise Express request helpers even when mounted in Vite's Connect server.
  const router = express();
  const pending = new Map<string, Promise<Buffer>>();
  const cache = new Map<string, Buffer>();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const cacheDir = path.join(root, ".cache", "alira-elevenlabs");
  const packDir = aliraVoicePackDir(root);

  router.get("/status", (_req, res) => {
    const config = getConfig();
    res
      .set("Cache-Control", "no-store")
      .json({
        provider: "elevenlabs",
        configured: Boolean(config.apiKey),
        voiceId: config.voiceId,
        modelId: config.modelId,
        // Lines that are ready in the voice pack play even without a key.
        packed: Array.from(phrases)
          .filter(([, text]) =>
            existsSync(path.join(packDir, `${aliraVoiceKey(config, text)}.mp3`))
          )
          .map(([id]) => id),
      });
  });
  router.post("/", express.json({ limit: "1kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("origin");
    try {
      if (origin && new URL(origin).host !== req.get("host")) throw new Error();
    } catch {
      res
        .status(403)
        .json({
          code: "ORIGIN_NOT_ALLOWED",
          error: "This voice request isn’t allowed.",
        });
      return;
    }
    const phraseId =
      typeof req.body?.phraseId === "string" ? req.body.phraseId : "";
    const text = phrases.get(phraseId);
    if (!text) {
      res
        .status(400)
        .json({
          code: "UNKNOWN_PHRASE",
          error: "This message isn’t available to listen to yet.",
        });
      return;
    }
    const config = getConfig();
    const key = aliraVoiceKey(config, text);
    const send = (audio: Buffer, source: "pack" | "cache" | "live") =>
      res
        .set({
          "Content-Type": "audio/mpeg",
          "X-Alira-Voice-Provider": "elevenlabs",
          "X-Alira-Voice-Source": source,
          "Cache-Control": "private, max-age=86400",
        })
        .send(audio);
    // The voice pack and earlier listens need neither a key nor credits.
    let ready = cache.get(key);
    let source: "pack" | "cache" = "cache";
    for (const [dir, from] of [
      [packDir, "pack"],
      [cacheDir, "cache"],
    ] as const) {
      if (ready) break;
      try {
        ready = await readFile(path.join(dir, `${key}.mp3`));
        source = from;
        cache.set(key, ready);
        if (cache.size > 96) cache.delete(cache.keys().next().value!);
      } catch {
        /* Not prepared yet. */
      }
    }
    if (ready) {
      send(ready, source);
      return;
    }
    if (!config.apiKey) {
      res
        .status(503)
        .json({
          code: "VOICE_NOT_CONFIGURED",
          error:
            "Alira’s new voice isn’t connected yet. You can still read every message here.",
        });
      return;
    }
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(config.voiceId) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(config.modelId)
    ) {
      res
        .status(503)
        .json({
          code: "VOICE_CONFIG_INVALID",
          error: "Alira’s voice needs a configuration update.",
        });
      return;
    }
    try {
      let generation = pending.get(key);
      if (!generation) {
        const now = Date.now();
        attempts.forEach((entry, ip) => {
          if (entry.resetAt <= now) attempts.delete(ip);
        });
        const ip = req.ip ?? req.socket.remoteAddress ?? "local";
        const rate = attempts.get(ip) ?? { count: 0, resetAt: now + 60000 };
        if (rate.count >= 20 || pending.size >= 3 || attempts.size >= 1000)
          throw new VoiceError(
            429,
            "VOICE_BUSY",
            "Alira’s voice is busy. Please try again in a moment."
          );
        rate.count += 1;
        attempts.set(ip, rate);
        generation = (async () => {
          const upstream = await request(
            `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}?output_format=${ALIRA_VOICE.outputFormat}`,
            {
              method: "POST",
              headers: {
                "xi-api-key": config.apiKey,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
              },
              body: JSON.stringify({
                text,
                model_id: config.modelId,
                voice_settings: voiceSettings,
              }),
              signal: AbortSignal.timeout(25000),
            }
          );
          if (!upstream.ok) {
            const auth = upstream.status === 401 || upstream.status === 403;
            throw new VoiceError(
              upstream.status === 429 ? 429 : 502,
              auth ? "VOICE_ACCESS_DENIED" : "VOICE_PROVIDER_ERROR",
              auth
                ? "Alira’s voice connection needs attention. Please try again later."
                : "Alira’s voice is temporarily unavailable. Please try again shortly."
            );
          }
          if (!upstream.headers.get("content-type")?.startsWith("audio/"))
            throw new VoiceError(
              502,
              "INVALID_AUDIO",
              "Alira’s voice couldn’t load. Please try again."
            );
          const bytes = Buffer.from(await upstream.arrayBuffer());
          if (bytes.length < 100 || bytes.length > 5 * 1024 * 1024)
            throw new VoiceError(
              502,
              "INVALID_AUDIO",
              "Alira’s voice couldn’t load. Please try again."
            );
          cache.set(key, bytes);
          if (cache.size > 96) cache.delete(cache.keys().next().value!);
          // Disk caching is an optimisation; a read-only host can still play the response.
          try {
            await mkdir(cacheDir, { recursive: true });
            await writeFile(path.join(cacheDir, `${key}.mp3`), bytes);
          } catch {
            /* Use memory cache. */
          }
          return bytes;
        })();
        pending.set(key, generation);
        generation.finally(() => pending.delete(key)).catch(() => {});
      }
      send(await generation, "live");
    } catch (error) {
      if (error instanceof VoiceError) {
        res
          .status(error.status)
          .json({ code: error.code, error: error.message });
        return;
      }
      res
        .status(502)
        .json({
          code: "VOICE_CONNECTION_FAILED",
          error: "Alira’s voice couldn’t connect. Please try again.",
        });
    }
  });
  const errors: express.ErrorRequestHandler = (_error, _req, res, _next) => {
    res
      .status(400)
      .json({
        code: "INVALID_REQUEST",
        error: "Please try that voice request again.",
      });
  };
  router.use(errors);
  return router;
}

export type AliraSpeech = { audio: Buffer; source: "pack" | "cache" | "live" };

export class AliraSpeechUnavailable extends Error {}

/**
 * Speaks app-written text in Alira's voice for the exercises and the FAST check. A line in the
 * voice pack or the local cache needs neither a key nor credits; any other line is generated live
 * with the same voice, model and delivery settings as the Alira page, then cached. Throws
 * AliraSpeechUnavailable when it can't, so callers fall back to a device voice instead of silence.
 */
export function createAliraSpeaker({
  root,
  getConfig = () => readVoiceConfig(root),
  request = fetch,
}: {
  root: string;
  getConfig?: () => VoiceConfig;
  request?: typeof fetch;
}) {
  const memory = new Map<string, Buffer>();
  const pending = new Map<string, Promise<Buffer>>();
  const cacheDir = path.join(root, ".cache", "alira-elevenlabs");
  const packDir = aliraVoicePackDir(root);
  // After ElevenLabs refuses (no key, no credits), stop asking for a while so patients don't wait.
  let liveRetryAt = 0;
  const remember = (key: string, audio: Buffer) => {
    memory.set(key, audio);
    if (memory.size > 96) memory.delete(memory.keys().next().value!);
  };

  return async function speak(text: string): Promise<AliraSpeech> {
    const config = getConfig();
    const key = aliraVoiceKey(config, text);
    const known = memory.get(key);
    if (known) return { audio: known, source: "cache" };
    for (const [dir, source] of [
      [packDir, "pack"],
      [cacheDir, "cache"],
    ] as const) {
      try {
        const audio = await readFile(path.join(dir, `${key}.mp3`));
        remember(key, audio);
        return { audio, source };
      } catch {
        /* Not recorded yet. */
      }
    }
    if (!config.apiKey || Date.now() < liveRetryAt)
      throw new AliraSpeechUnavailable("Alira's voice can't speak this line right now.");
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(config.voiceId) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(config.modelId)
    )
      throw new AliraSpeechUnavailable("Alira's voice needs a configuration update.");
    let generation = pending.get(key);
    if (!generation) {
      if (pending.size >= 3) throw new AliraSpeechUnavailable("Alira's voice is busy.");
      generation = (async () => {
        const upstream = await request(
          `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}?output_format=${ALIRA_VOICE.outputFormat}`,
          {
            method: "POST",
            headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify({ text, model_id: config.modelId, voice_settings: voiceSettings }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!upstream.ok) {
          if ([401, 402, 403, 429].includes(upstream.status)) liveRetryAt = Date.now() + 10 * 60 * 1000;
          throw new AliraSpeechUnavailable("Alira's voice is unavailable.");
        }
        const audio = Buffer.from(await upstream.arrayBuffer());
        if (!upstream.headers.get("content-type")?.startsWith("audio/") || audio.length < 100 || audio.length > 5 * 1024 * 1024)
          throw new AliraSpeechUnavailable("Alira's voice returned no audio.");
        try {
          await mkdir(cacheDir, { recursive: true });
          await writeFile(path.join(cacheDir, `${key}.mp3`), audio);
        } catch {
          /* A read-only host keeps the memory copy. */
        }
        return audio;
      })();
      pending.set(key, generation);
      generation.finally(() => pending.delete(key)).catch(() => {});
    }
    try {
      const audio = await generation;
      remember(key, audio);
      return { audio, source: "live" };
    } catch (error) {
      throw error instanceof AliraSpeechUnavailable ? error : new AliraSpeechUnavailable("Alira's voice couldn't connect.");
    }
  };
}
