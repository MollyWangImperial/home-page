import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createExerciseDebugRouter } from "../../../../server/exercise-debug";
import { createExerciseVoiceRouter } from "../../../../server/exercise-voice";

const fixtures: { root: string; server: Server }[] = [];
async function fixture(generate?: Parameters<typeof createExerciseVoiceRouter>[0]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rehyn-debug-test-"));
  const app = express();
  app.use("/api/exercise-debug", createExerciseDebugRouter({ root }));
  if (generate) app.use("/api/exercise-voice", createExerciseVoiceRouter(generate));
  const server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  fixtures.push({ root, server });
  const port = (server.address() as { port: number }).port;
  return { root, url: `http://127.0.0.1:${port}/api/exercise-debug` };
}
afterEach(async () => {
  for (const { root, server } of fixtures.splice(0)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    // This directory was created by this test under the OS temp directory; verify before deleting it.
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("rehyn-debug-test-")) throw new Error("Unsafe test cleanup path");
    await fs.rm(root, { recursive: true });
  }
});
const start = async (url: string) => (await fetch(`${url}/begin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exerciseId: "ex_reach", simulated: true }) })).json();

describe("temporary local repetition videos", () => {
  it("keeps videos and measurements until a new exercise starts, then rejects stale uploads", async () => {
    const { root, url } = await fixture();
    const first = await start(url);
    const video = `${url}/${first.id}/clips/rep-1.webm`;
    expect((await fetch(video, { method: "POST", headers: { "Content-Type": "video/webm" }, body: new Uint8Array([1, 2, 3]) })).status).toBe(200);
    expect((await fetch(`${video}/metadata`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: { score: 85 }, samples: [{ ms: 200 }] }) })).status).toBe(200);
    expect((await fetch(video)).status).toBe(200);
    expect((await (await fetch(`${url}/`)).json()).session.clips).toHaveLength(1);
    for (const name of ["practice-1.webm", "rep-2.webm"]) {
      const clip = `${url}/${first.id}/clips/${name}`;
      expect((await fetch(clip, { method: "POST", headers: { "Content-Type": "video/webm" }, body: new Uint8Array([1]) })).status).toBe(200);
      expect((await fetch(`${clip}/metadata`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: { score: 85 } }) })).status).toBe(200);
    }
    const directory = path.join(root, "work/exercise-debug/current");
    await fs.writeFile(path.join(directory, "unowned-notes.txt"), "keep");
    expect((await fs.readdir(directory))).toContain("rep-1.webm.json");
    const next = await start(url);
    expect(next.id).not.toBe(first.id);
    expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(["session.json", "unowned-notes.txt"]));
    expect(await fs.readdir(directory)).not.toContain("rep-1.webm");
    expect(await fs.readdir(directory)).not.toContain("rep-1.webm.json");
    expect((await fs.readdir(directory)).filter(name => /\.(webm|mp4)(\.json)?$/.test(name))).toEqual([]);
    expect((await (await fetch(`${url}/`)).json()).session.clips).toEqual([]);
    expect((await fetch(video)).status).toBe(404);
    expect((await fetch(video, { method: "POST", headers: { "Content-Type": "video/webm" }, body: new Uint8Array([4]) })).status).toBe(409);
    expect((await fetch(`${video}/metadata`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: { score: 85 } }) })).status).toBe(409);
    const newVideo = `${url}/${next.id}/clips/rep-1.webm`;
    expect((await fetch(newVideo, { method: "POST", headers: { "Content-Type": "video/webm" }, body: new Uint8Array([9, 8]) })).status).toBe(200);
    expect((await fetch(`${newVideo}/metadata`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: { score: 30 } }) })).status).toBe(200);
    expect([...new Uint8Array(await (await fetch(newVideo)).arrayBuffer())]).toEqual([9, 8]);
    expect(JSON.parse(await fs.readFile(path.join(directory, "rep-1.webm.json"), "utf8")).result.score).toBe(30);
    const manifest = (await (await fetch(`${url}/`)).json()).session;
    expect(manifest.id).toBe(next.id);
    expect(manifest.clips).toHaveLength(1);
  });
  it("rejects a third-party origin and invalid file names", async () => {
    const { url } = await fixture();
    expect((await fetch(`${url}/begin`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: JSON.stringify({ exerciseId: "ex_reach", simulated: true }) })).status).toBe(403);
    const session = await start(url);
    expect((await fetch(`${url}/${session.id}/clips/secret.txt`, { method: "POST", headers: { "Content-Type": "video/webm" }, body: new Uint8Array([1]) })).status).toBe(400);
  });
  it("returns explicit English WAV audio and caches repeated instructions locally", async () => {
    const generate = vi.fn(async () => ({ audio: Buffer.from("RIFF-test"), voice: "Microsoft Zira Desktop", language: "en-US" }));
    const { url } = await fixture(generate);
    const speak = () => fetch(url.replace("exercise-debug", "exercise-voice"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Relax your shoulder." }) });
    const first = await speak();
    expect(first.headers.get("Content-Type")).toContain("audio/wav");
    expect(first.headers.get("X-Exercise-Language")).toBe("en-US");
    expect((await speak()).headers.get("X-Exercise-Voice-Source")).toBe("cache");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
