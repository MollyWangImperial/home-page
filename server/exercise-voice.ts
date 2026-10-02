import express from "express";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

// Text arrives through stdin as JSON, never as executable PowerShell source.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Speech
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $english = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -match '^en(-|$)' })
  if ($english.Count -eq 0) { throw 'No English Windows voice is installed.' }
  $chosen = $english | Where-Object { $_.VoiceInfo.Name -match 'Zira|Sonia|Libby' } | Select-Object -First 1
  if (-not $chosen) { $chosen = $english[0] }
  $speaker.SelectVoice($chosen.VoiceInfo.Name)
  $memory = [System.IO.MemoryStream]::new()
  try {
    $speaker.SetOutputToWaveStream($memory)
    $speaker.Speak([string]$payload.text)
    @{ voice = $chosen.VoiceInfo.Name; language = $chosen.VoiceInfo.Culture.Name; audio = [Convert]::ToBase64String($memory.ToArray()) } | ConvertTo-Json -Compress
  } finally { $memory.Dispose() }
} finally { $speaker.Dispose() }
`;

export async function generateLocalEnglishAudio(text: string): Promise<{ audio: Buffer; voice: string; language: string }> {
  if (process.platform !== "win32") throw new Error("Local Windows English speech is unavailable.");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const error: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("Local English speech timed out.")); }, 20000);
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => error.push(chunk));
    child.on("error", failure => { clearTimeout(timer); reject(failure); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error("Could not generate local English speech.")); return; }
      try {
        const result = JSON.parse(Buffer.concat(output).toString("utf8").replace(/^\uFEFF/, ""));
        if (!/^en(?:-|$)/i.test(result.language)) throw new Error("English voice unavailable.");
        resolve({ audio: Buffer.from(result.audio, "base64"), voice: result.voice, language: result.language });
      } catch (failure) { reject(failure); }
    });
    child.stdin.end(JSON.stringify({ text }));
  });
}

type SpeakAlira = (text: string) => Promise<{ audio: Buffer; source: "pack" | "cache" | "live" }>;

const isLoopback = (peer: string) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
const sameOrigin = (req: express.Request) => {
  const origin = req.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.get("host"); } catch { return false; }
};
const isEnglishLine = (text: unknown): text is string =>
  typeof text === "string" && Boolean(text.trim()) && text.length <= 2000 && !/[\u3400-\u9fff]/.test(text);

/** Limits how often one visitor can ask for speech; recorded lines are cheap, live ones cost credits. */
function rateLimiter(perMinute: number) {
  const seen = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request) => {
    const now = Date.now();
    seen.forEach((entry, ip) => { if (entry.resetAt <= now) seen.delete(ip); });
    const ip = req.ip ?? req.socket.remoteAddress ?? "local";
    const entry = seen.get(ip) ?? { count: 0, resetAt: now + 60000 };
    entry.count += 1;
    seen.set(ip, entry);
    return entry.count <= perMinute && seen.size < 1000;
  };
}

/**
 * Exercise speech. `{ text, provider: "alira" }` speaks the line in Alira's ElevenLabs voice, the
 * same voice as the Alira page and the assessment. Without a provider it uses this computer's
 * English Windows voice, which the exercise runner only asks for when Alira's voice and the
 * browser's English voices are both unavailable.
 */
export function createExerciseVoiceRouter(generate = generateLocalEnglishAudio, speakAlira?: SpeakAlira) {
  const app = express();
  const cache = new Map<string, Awaited<ReturnType<typeof generate>>>();
  const pending = new Map<string, ReturnType<typeof generate>>();
  const allowAlira = rateLimiter(120);
  app.post("/", express.json({ limit: "8kb" }), async (req, res, next) => {
    if (req.body?.provider !== "alira") { next(); return; }
    if (!sameOrigin(req)) { res.status(403).json({ error: "This voice request isn't allowed." }); return; }
    const text = req.body?.text;
    if (!isEnglishLine(text)) { res.status(400).json({ error: "An English instruction is required." }); return; }
    if (!speakAlira || !allowAlira(req)) { res.status(503).json({ error: "Alira's voice is unavailable. English subtitles are shown." }); return; }
    try {
      const { audio, source } = await speakAlira(text.trim());
      res.set({ "Content-Type": "audio/mpeg", "X-Exercise-Voice": "Alira", "X-Exercise-Voice-Provider": "elevenlabs", "X-Exercise-Language": "en-GB", "X-Exercise-Voice-Source": source, "Cache-Control": "private, max-age=86400" }).send(audio);
    } catch {
      res.status(503).json({ error: "Alira's voice is unavailable. English subtitles are shown." });
    }
  });
  app.use((req, res, next) => {
    const peer = req.socket.remoteAddress ?? "";
    let allowed = isLoopback(peer);
    try { const origin = req.get("origin"); if (origin) allowed = allowed && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname); } catch { allowed = false; }
    if (!allowed) { res.status(403).json({ error: "Local English speech is available only on this computer." }); return; }
    next();
  });
  app.post("/", express.json({ limit: "8kb" }), async (req, res) => {
    const text = req.body?.text;
    if (!isEnglishLine(text)) { res.status(400).json({ error: "An English instruction is required." }); return; }
    const key = createHash("sha256").update(text).digest("hex");
    try {
      const cached = cache.has(key);
      let result = cache.get(key);
      if (!result) {
        let work = pending.get(key);
        if (!work) {
          if (pending.size >= 4) { res.status(429).json({ error: "English speech is preparing. Try again shortly." }); return; }
          work = generate(text);
          pending.set(key, work);
          void work.finally(() => pending.delete(key)).catch(() => {});
        }
        result = await work;
        cache.set(key, result);
        if (cache.size > 128) cache.delete(cache.keys().next().value!);
      }
      if (!/^en(?:-|$)/i.test(result.language)) throw new Error("An English voice is required.");
      res.set({ "Content-Type": "audio/wav", "X-Exercise-Voice": result.voice, "X-Exercise-Language": result.language, "X-Exercise-Voice-Source": cached ? "cache" : "local", "Cache-Control": "private, max-age=86400" }).send(result.audio);
    } catch { res.status(503).json({ error: "Local English speech is unavailable. English subtitles are shown." }); }
  });
  return app;
}

/**
 * The FAST check asks this site for `/api/tts/generate` with `{ text }` and expects
 * `{ audio_b64 }`. It answers in Alira's voice; on any failure the check uses the browser's
 * English voice at once, so an emergency prompt is never delayed or silent.
 */
export function createFastCheckVoiceRouter(speakAlira: SpeakAlira) {
  const app = express();
  const allow = rateLimiter(60);
  app.post("/", express.json({ limit: "4kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "This voice request isn't allowed." }); return; }
    const text = req.body?.text;
    if (!isEnglishLine(text) || text.length > 600) { res.status(400).json({ error: "An English prompt is required." }); return; }
    if (!allow(req)) { res.status(503).json({ error: "Alira's voice is busy." }); return; }
    try {
      const { audio, source } = await speakAlira(text.trim());
      res.json({ audio_b64: audio.toString("base64"), voice: "Alira", source });
    } catch {
      res.status(503).json({ error: "Alira's voice is unavailable." });
    }
  });
  return app;
}

/**
 * Alira's own messages that aren't fixed lines (her replies written in the moment and her personal
 * messages, such as assessment congratulations) are read in her voice through `/api/alira/speak`.
 * Only text Alira wrote reaches it: the page never sends a patient's own words.
 */
export function createAliraSpeakRouter(speakAlira: SpeakAlira) {
  const app = express();
  const allow = rateLimiter(30);
  app.post("/", express.json({ limit: "8kb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ code: "ORIGIN_NOT_ALLOWED", error: "This voice request isn't allowed." }); return; }
    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 1500) { res.status(400).json({ code: "INVALID_TEXT", error: "This message can't be read aloud." }); return; }
    if (!allow(req)) { res.status(429).json({ code: "VOICE_BUSY", error: "Alira's voice is busy. Please try again in a moment." }); return; }
    try {
      const { audio, source } = await speakAlira(text.trim());
      res.set({ "Content-Type": "audio/mpeg", "X-Alira-Voice-Provider": "elevenlabs", "X-Alira-Voice-Source": source }).send(audio);
    } catch {
      res.status(503).json({ code: "VOICE_UNAVAILABLE", error: "Alira's voice can't read this message right now." });
    }
  });
  return app;
}
