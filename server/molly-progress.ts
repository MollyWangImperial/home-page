import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";

type Day = { date: string; [key: string]: unknown };
type History = { schema?: number; updatedAt: string; days: Day[] };

const empty: History = { updatedAt: "", days: [] };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readHistory(file: string): Promise<History> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed?.days) ? parsed : empty;
  } catch {
    return empty;
  }
}

function validHistory(body: unknown): body is History {
  const days = (body as History | undefined)?.days;
  return Array.isArray(days) && days.length <= 120 && days.every(day => day && typeof day.date === "string" && DATE.test(day.date) && Array.isArray((day as { areas?: unknown }).areas));
}

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Share the same latest notes with the progress panel and Alira's conversation. */
export async function readMollyProgress(root: string): Promise<History & { source: "local" | "published" | "deployed" }> {
  const seed = await readHistory(path.resolve(root, "server", "data", "molly-progress.json"));
  if (process.env.NODE_ENV !== "production") return { ...seed, source: "local" };
  const published = await readHistory(path.join(process.env.MOLLY_PROGRESS_DIR || os.tmpdir(), "rehyn-molly-progress.json"));
  const newest = published.updatedAt > seed.updatedAt ? published : seed;
  return { ...newest, source: newest === published && published.updatedAt ? "published" : "deployed" };
}

/**
 * Molly's daily progress summary for the "Molly's Progress" settings tab.
 * - Locally (dev) the file written by scripts/molly-progress.mjs is read directly, so it is always fresh.
 * - On Render, the 8pm job POSTs the summary to /publish (bearer token); the newest of that and the
 *   summary that shipped with the last git push is served.
 */
export function createMollyProgressRouter({ root }: { root: string }) {
  const router = express();
  const publishedFile = path.join(process.env.MOLLY_PROGRESS_DIR || os.tmpdir(), "rehyn-molly-progress.json");

  router.get("/", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await readMollyProgress(root));
  });

  router.post("/publish", express.json({ limit: "2mb" }), async (req, res) => {
    const expected = process.env.MOLLY_PUBLISH_TOKEN;
    if (!expected) { res.status(503).json({ error: "Publishing is not enabled on this server." }); return; }
    const given = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!sameSecret(given, expected)) { res.status(401).json({ error: "Invalid token." }); return; }
    if (!validHistory(req.body)) { res.status(400).json({ error: "Invalid progress summary." }); return; }
    const history: History = { schema: 1, updatedAt: new Date().toISOString(), days: req.body.days };
    const tmp = `${publishedFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(history), "utf8");
    await fs.rename(tmp, publishedFile);
    res.json({ ok: true, days: history.days.length, updatedAt: history.updatedAt });
  });

  return router;
}
