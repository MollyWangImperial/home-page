import express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { aliraVoicePhrases } from "../client/src/lib/alira-voice-phrases";

const phrases = new Map(Object.entries(aliraVoicePhrases));
const voiceSettings = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.15,
  speed: 0.94,
  use_speaker_boost: true,
};
export type VoiceConfig = { apiKey: string; voiceId: string; modelId: string };

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
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || "EXAVITQu4vr4xnSDxMaL",
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2",
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

  router.get("/status", (_req, res) => {
    const config = getConfig();
    res
      .set("Cache-Control", "no-store")
      .json({
        provider: "elevenlabs",
        configured: Boolean(config.apiKey),
        voiceId: config.voiceId,
        modelId: config.modelId,
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
    const key = createHash("sha256")
      .update(
        JSON.stringify([config.voiceId, config.modelId, voiceSettings, text])
      )
      .digest("hex");
    try {
      let audio = cache.get(key);
      if (!audio) {
        try {
          audio = await readFile(path.join(cacheDir, `${key}.mp3`));
        } catch {
          /* First listen. */
        }
      }
      if (!audio) {
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
              `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}?output_format=mp3_44100_128`,
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
            if (cache.size > 64) cache.delete(cache.keys().next().value!);
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
        audio = await generation;
      }
      res
        .set({
          "Content-Type": "audio/mpeg",
          "X-Alira-Voice-Provider": "elevenlabs",
          "Cache-Control": "private, max-age=86400",
        })
        .send(audio);
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
