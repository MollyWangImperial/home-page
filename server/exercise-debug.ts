import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const clipName = /^(?:practice|rep)-[1-9]\d{0,2}\.(?:webm|mp4)$/;
const localHost = (host: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
type Clip = { name: string; mimeType: string; bytes: number };
type DebugSession = { id: string; exerciseId: string; simulated: boolean; startedAt: string; clips: Clip[] };

/** Debug clips stay on this machine. Only starting a new exercise clears the owned files. */
export function createExerciseDebugRouter({ root }: { root: string }) {
  // An Express app also initializes req/res helpers when mounted in Vite's Connect middleware.
  const router = express();
  const directory = path.resolve(root, "work", "exercise-debug", "current");
  const manifest = path.join(directory, "session.json");
  let serial = Promise.resolve();
  const exclusive = <T,>(work: () => Promise<T>) => {
    const result = serial.then(work);
    serial = result.then(() => {}, () => {});
    return result;
  };
  const ownedPath = (name: string) => {
    const resolved = path.resolve(directory, name);
    if (path.dirname(resolved) !== directory) throw new Error("Invalid debug file path");
    return resolved;
  };
  const read = async (): Promise<DebugSession | null> => {
    try { return JSON.parse(await fs.readFile(manifest, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const write = (session: DebugSession) => fs.writeFile(manifest, JSON.stringify(session, null, 2), "utf8");
  router.use((req, res, next) => {
    const peer = req.socket.remoteAddress ?? "";
    const origin = req.get("origin");
    let originLocal = !origin;
    try { if (origin) originLocal = localHost(new URL(origin).hostname); } catch { /* reject invalid origins */ }
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) || !originLocal) {
      res.status(403).json({ error: "Debug recordings are available only on this computer." }); return;
    }
    res.set("Cache-Control", "no-store");
    next();
  });
  const handle = (work: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler => (req, res, next) => { void work(req, res).catch(next); };

  router.post("/begin", express.json({ limit: "1kb" }), handle(async (req, res) => {
    if (!/^ex_[a-z0-9_]{1,40}$/.test(req.body?.exerciseId ?? "") || typeof req.body?.simulated !== "boolean") {
      res.status(400).json({ error: "Invalid exercise debug session." }); return;
    }
    const session = await exclusive(async () => {
      await fs.mkdir(directory, { recursive: true });
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        // Do not recursively delete directories or files outside the recorder's naming scheme.
        if (entry.isFile() && (entry.name === "session.json" || clipName.test(entry.name) || /^(?:practice|rep)-[1-9]\d{0,2}\.(?:webm|mp4)\.json$/.test(entry.name))) await fs.unlink(ownedPath(entry.name));
      }
      const session: DebugSession = { id: randomUUID(), exerciseId: req.body.exerciseId, simulated: req.body.simulated, startedAt: new Date().toISOString(), clips: [] };
      await write(session);
      return session;
    });
    res.json({ ...session, directory });
  }));
  router.get("/", handle(async (_req, res) => { await serial; res.json({ session: await read(), directory }); }));
  router.post("/:sessionId/clips/:name", express.raw({ type: ["video/webm", "video/mp4"], limit: "100mb" }), handle(async (req, res) => {
    const name = String(req.params.name);
    const mimeType = req.get("content-type")?.split(";")[0] ?? "";
    if (!clipName.test(name) || !Buffer.isBuffer(req.body) || !req.body.length || !["video/webm", "video/mp4"].includes(mimeType) || !name.endsWith(mimeType === "video/mp4" ? ".mp4" : ".webm")) {
      res.status(400).json({ error: "Invalid video clip." }); return;
    }
    await exclusive(async () => {
      const session = await read();
      if (!session || session.id !== req.params.sessionId) { res.status(409).json({ error: "A new exercise has already started." }); return; }
      await fs.writeFile(ownedPath(name), req.body);
      const clip = { name, mimeType, bytes: req.body.length };
      session.clips = [...session.clips.filter(item => item.name !== name), clip];
      await write(session);
      res.json(clip);
    });
  }));
  router.post("/:sessionId/clips/:name/metadata", express.json({ limit: "2mb" }), handle(async (req, res) => {
    const name = String(req.params.name);
    if (!clipName.test(name) || !req.body || typeof req.body !== "object" || Array.isArray(req.body)) { res.status(400).json({ error: "Invalid clip metadata." }); return; }
    await exclusive(async () => {
      const session = await read();
      if (!session || session.id !== req.params.sessionId) { res.status(409).json({ error: "A new exercise has already started." }); return; }
      if (!session.clips.some(clip => clip.name === name)) { res.status(404).json({ error: "Clip not found." }); return; }
      await fs.writeFile(ownedPath(`${name}.json`), JSON.stringify(req.body, null, 2), "utf8");
      res.json({ saved: true });
    });
  }));
  router.get("/:sessionId/clips/:name", handle(async (req, res) => {
    const name = String(req.params.name);
    await serial;
    const session = await read();
    if (!clipName.test(name) || session?.id !== req.params.sessionId || !session.clips.some(clip => clip.name === name)) { res.status(404).json({ error: "Clip not found." }); return; }
    res.sendFile(ownedPath(name));
  }));
  const errors: express.ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error?.type === "entity.too.large" ? 413 : 500).json({ error: "Could not save the local debug recording." });
  };
  router.use(errors);
  return router;
}
