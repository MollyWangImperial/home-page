import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Alira speaks the assessment in her one ElevenLabs voice (see ALIRA_VOICE.md). The key is read
// from this site's .env.local, the same one the Alira page uses; it is never written anywhere.
function aliraVoiceEnvironment(environment) {
  let file = {};
  for (const name of [".env", ".env.local"]) {
    try { file = { ...file, ...parseEnv(readFileSync(path.join(root, name), "utf8")) }; } catch { /* optional */ }
  }
  const key = environment.ELEVENLABS_API_KEY || file.ELEVENLABS_API_KEY || "";
  return {
    INSTRUCTION_TTS_PROVIDER: environment.INSTRUCTION_TTS_PROVIDER || "elevenlabs",
    ELEVENLABS_VOICE_SCOPE: environment.ELEVENLABS_VOICE_SCOPE || "all",
    ...(key ? { ELEVENLABS_API_KEY: key } : {}),
  };
}
export function startAssessmentService(environment = process.env) {
  const service = path.join(root, "assessment-service");
  const localPython = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = environment.REHYN_ASSESSMENT_PYTHON || (existsSync(localPython) ? localPython : "python");
  const port = environment.REHYN_ASSESSMENT_PORT || "8002";
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Invalid assessment port");
  return spawn(python, ["-m", "uvicorn", "local_app:app", "--app-dir", service,
    "--host", "127.0.0.1", "--port", port], {
    cwd: service, windowsHide: true, stdio: "inherit",
    env: { ...environment, ...aliraVoiceEnvironment(environment), REHYN_LOCAL_ASSESSMENT_PREVIEW: "1", FUNCTION_LADDER_ENABLED: "1",
      MONGO_URL: environment.MONGO_URL || "mongodb://127.0.0.1:27017",
      DB_NAME: environment.DB_NAME || "rehyn_claude_local", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = startAssessmentService();
  child.on("error", error => { console.error(`Could not start assessment Python: ${error.message}`); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 0; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}
