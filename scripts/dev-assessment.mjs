import { spawn } from "node:child_process";
import { startAssessmentService } from "./start-assessment-service.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, VITE_ASSESSMENT_BASE: `http://127.0.0.1:${process.env.REHYN_ASSESSMENT_PORT || "8002"}` };
const children = [
  startAssessmentService(env),
  spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port",
    process.env.REHYN_COMPANION_PORT || "3003", "--strictPort"], { cwd: root, env, stdio: "inherit", windowsHide: true }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
for (const child of children) {
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 0); });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
