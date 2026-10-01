#!/usr/bin/env node
// Molly's daily progress snapshot. Runs at 8pm from Windows Task Scheduler (see scripts/install-molly-progress-task.ps1).
//
//   1. Compares the working folder with the last snapshot (no git needed: it works on uncommitted local edits).
//   2. Saves Molly's edits locally in .molly-progress/snapshots/<date>/ (changed files + a readable patch).
//   3. Summarises the day into server/data/molly-progress.json (areas + highlights, no raw code).
//   4. Publishes that summary to the Render site, if MOLLY_PUBLISH_URL and MOLLY_PUBLISH_TOKEN are set in .env.local.
//
// Flags: --dry (print only, change nothing)  --no-publish  --publish-only  --first-hours=N (first run only; default: every file counts as the starting point)

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = path.join(ROOT, ".molly-progress");
const MIRROR = path.join(STORE, "mirror");
const STATE_FILE = path.join(STORE, "state.json");
const SUMMARY_FILE = path.join(ROOT, "server", "data", "molly-progress.json");
const args = new Set(process.argv.slice(2));
const flag = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1];
const DRY = args.has("--dry");
const FIRST_RUN_HOURS = Number(flag("first-hours") ?? 1e6); // first run: describe everything that exists, as the starting point
const KEEP_DAYS = 60;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".molly-progress", "work", ".manus-logs", ".webdev", "tmp", "temp", ".cache", "audio", "vendor"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "molly-progress.json", ".env.local"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json", ".md", ".html", ".yaml", ".yml", ".ps1", ".txt"]);
const MAX_TEXT_BYTES = 1_500_000;

// ---------- area rules: path -> a part of the platform, in plain words ----------
const AREAS = [
  { id: "exercise", label: "Exercise coach", test: p => /exercise|ex-engine/i.test(p) },
  { id: "voice", label: "Alira's voice", test: p => /voice|speech/i.test(p) },
  { id: "alira", label: "Alira's conversations", test: p => /alira/i.test(p) },
  { id: "movement", label: "Movement check", test: p => /assessment/i.test(p) },
  { id: "journey", label: "Journey, journal and medals", test: p => /journey|journal|medal|mytime|home-stage|home-greeting|homedashboard/i.test(p) },
  { id: "settings", label: "Settings and privacy", test: p => /settings|legal|data-permissions|molly/i.test(p) },
  { id: "look", label: "Look and feel", test: p => /\.css$|components\/ui\/|index\.css/i.test(p) },
  { id: "plumbing", label: "Under the hood", test: p => /^(server|scripts|shared)\/|vite\.config|render\.yaml|package\.json|tsconfig|\.env/i.test(p) },
  { id: "docs", label: "Notes and docs", test: p => /^docs\/|\.md$/i.test(p) },
];
const areaOf = rel => AREAS.find(a => a.test(rel)) ?? { id: "other", label: "Other touches" };
const isTest = rel => /\.test\.[tj]sx?$/.test(rel);

// ---------- helpers ----------
const rel = abs => path.relative(ROOT, abs).split(path.sep).join("/");
const sha = buf => crypto.createHash("sha1").update(buf).digest("hex");
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const readJson = async (file, fallback) => { try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch { return fallback; } };
const writeJson = async (file, value) => { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8"); };

async function loadEnv() {
  const env = { ...process.env };
  for (const name of [".env.local", ".env"]) {
    try {
      for (const line of (await fsp.readFile(path.join(ROOT, name), "utf8")).split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* optional */ }
  }
  return env;
}

async function walk(dir, out = []) {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !(entry.name === "ui" && dir.endsWith("components"))) await walk(path.join(dir, entry.name), out); continue; }
    if (!entry.isFile() || SKIP_FILES.has(entry.name) || entry.name.startsWith(".env")) continue;
    out.push(path.join(dir, entry.name));
  }
  return out;
}

// ---------- line diff (LCS on the changed middle) ----------
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const ops = []; // {t:' '|'-'|'+', s}
  for (let i = 0; i < start; i++) ops.push({ t: " ", s: a[i] });
  if (A.length * B.length > 6_000_000) {
    A.forEach(s => ops.push({ t: "-", s }));
    B.forEach(s => ops.push({ t: "+", s }));
  } else {
    const w = B.length + 1;
    const dp = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { ops.push({ t: " ", s: A[i] }); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: "-", s: A[i++] });
      else ops.push({ t: "+", s: B[j++] });
    }
    while (i < A.length) ops.push({ t: "-", s: A[i++] });
    while (j < B.length) ops.push({ t: "+", s: B[j++] });
  }
  for (let i = endA; i < a.length; i++) ops.push({ t: " ", s: a[i] });
  return ops;
}

function patchFor(relPath, status, ops) {
  const lines = [`--- ${status === "added" ? "/dev/null" : "a/" + relPath}`, `+++ ${status === "removed" ? "/dev/null" : "b/" + relPath}`];
  const changed = ops.map((o, i) => (o.t === " " ? -1 : i)).filter(i => i >= 0);
  let k = 0;
  while (k < changed.length) {
    let from = Math.max(0, changed[k] - 3), to = changed[k];
    while (k < changed.length && changed[k] <= to + 7) { to = changed[k]; k++; }
    to = Math.min(ops.length - 1, to + 3);
    lines.push(`@@ near line ${ops.slice(0, from).filter(o => o.t !== "+").length + 1} @@`);
    for (let i = from; i <= to; i++) lines.push(ops[i].t + ops[i].s);
  }
  return lines.join("\n") + "\n";
}

// names Molly added: exported functions, components, constants
const NAME_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>)/;
function addedNames(addedLines) {
  const names = [];
  for (const line of addedLines) {
    const m = line.match(NAME_RE);
    const name = m && (m[1] || m[2] || m[3]);
    if (name && name.length > 6 && /[a-z][A-Z]|_/.test(name) && !/^(use|handle|on|set|get)[A-Z]/.test(name) && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 8);
}

// ---------- 1. snapshot ----------
async function snapshot(today) {
  const state = await readJson(STATE_FILE, null);
  const firstRun = !state;
  const prev = state?.files ?? {};
  const now = Date.now();
  const files = await walk(ROOT);
  const current = {};
  const entries = {};
  const archiveDir = path.join(STORE, "snapshots", today);
  const patches = [];
  let mergedFirstRun = firstRun;

  for (const abs of files) {
    const relPath = rel(abs);
    const ext = path.extname(abs).toLowerCase();
    let stat;
    try { stat = await fsp.stat(abs); } catch { continue; }
    const text = TEXT_EXT.has(ext) && stat.size <= MAX_TEXT_BYTES;
    const buf = await fsp.readFile(abs);
    const hash = sha(buf);
    current[relPath] = { h: hash, size: stat.size };
    const before = prev[relPath];
    let status = null;
    if (firstRun) { if (now - stat.mtimeMs <= FIRST_RUN_HOURS * 3600_000) status = "modified"; }
    else if (!before) status = "added";
    else if (before.h !== hash) status = "modified";
    if (!status) continue;

    const newLines = text ? buf.toString("utf8").split(/\r?\n/) : [];
    let added = 0, removed = 0, names = [];
    if (text) {
      let oldLines = [];
      if (!firstRun && status === "modified") { try { oldLines = (await fsp.readFile(path.join(MIRROR, relPath), "utf8")).split(/\r?\n/); } catch { /* no mirror */ } }
      if (firstRun || status === "added") { added = newLines.length; names = addedNames(newLines); if (!firstRun) patches.push(patchFor(relPath, "added", newLines.map(s => ({ t: "+", s })))); }
      else {
        const ops = diffLines(oldLines, newLines);
        added = ops.filter(o => o.t === "+").length;
        removed = ops.filter(o => o.t === "-").length;
        names = addedNames(ops.filter(o => o.t === "+").map(o => o.s));
        patches.push(patchFor(relPath, "modified", ops));
      }
    }
    entries[relPath] = { status, added, removed, names, area: areaOf(relPath).id, test: isTest(relPath), text };
    if (!DRY) {
      const dest = path.join(archiveDir, "files", relPath);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
    }
  }
  if (!firstRun) {
    for (const relPath of Object.keys(prev)) {
      if (current[relPath]) continue;
      let removed = 0;
      try { removed = (await fsp.readFile(path.join(MIRROR, relPath), "utf8")).split(/\r?\n/).length; } catch { /* binary */ }
      entries[relPath] = { status: "removed", added: 0, removed, names: [], area: areaOf(relPath).id, test: isTest(relPath), text: true };
    }
  }

  if (!DRY) {
    // merge with an earlier run on the same day, so the day's entry covers everything done since the day began
    const dayFile = path.join(archiveDir, "changes.json");
    const earlier = await readJson(dayFile, { files: {} });
    for (const [p, e] of Object.entries(earlier.files)) {
      const n = entries[p];
      if (!n) entries[p] = e;
      else {
        n.added += e.added; n.removed += e.removed;
        n.names = [...new Set([...e.names, ...n.names])].slice(0, 8);
        if (e.status === "added" && n.status === "modified") n.status = "added";
        if (e.status === "added" && n.status === "removed") delete entries[p];
      }
    }
    mergedFirstRun = firstRun || earlier.firstRun === true;
    await writeJson(dayFile, { date: today, firstRun: mergedFirstRun, files: entries });
    if (patches.length) await fsp.appendFile(path.join(archiveDir, "changes.patch"), `# run at ${new Date().toISOString()}\n` + patches.join("\n"), "utf8");
    // refresh the mirror and state to what the folder looks like now
    for (const abs of files) {
      const relPath = rel(abs);
      if (!TEXT_EXT.has(path.extname(abs).toLowerCase()) || current[relPath].size > MAX_TEXT_BYTES) continue;
      const dest = path.join(MIRROR, relPath);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(abs, dest);
    }
    await writeJson(STATE_FILE, { lastRunAt: new Date().toISOString(), files: current });
  }
  return { entries, firstRun: mergedFirstRun };
}

// ---------- 2. summary (areas + highlights only: no code, no paths) ----------
function summarise(date, entries, firstRun) {
  const list = Object.values(entries);
  const byArea = new Map();
  for (const e of list) {
    const a = byArea.get(e.area) ?? { id: e.area, label: (AREAS.find(x => x.id === e.area) ?? { label: "Other touches" }).label, filesAdded: 0, filesChanged: 0, filesRemoved: 0, linesAdded: 0, linesRemoved: 0, highlights: [] };
    if (e.status === "added") a.filesAdded++; else if (e.status === "removed") a.filesRemoved++; else a.filesChanged++;
    a.linesAdded += e.added; a.linesRemoved += e.removed;
    for (const n of e.names) if (!a.highlights.includes(n) && a.highlights.length < 6) a.highlights.push(n);
    byArea.set(e.area, a);
  }
  const areas = [...byArea.values()].sort((x, y) => (y.linesAdded + y.linesRemoved + y.filesAdded * 20) - (x.linesAdded + x.linesRemoved + x.filesAdded * 20));
  const sum = k => list.reduce((s, e) => s + (k(e) ?? 0), 0);
  return {
    date,
    generatedAt: new Date().toISOString(),
    firstRun,
    quiet: list.length === 0,
    totals: {
      filesAdded: list.filter(e => e.status === "added").length,
      filesChanged: list.filter(e => e.status === "modified").length,
      filesRemoved: list.filter(e => e.status === "removed").length,
      linesAdded: sum(e => e.added),
      linesRemoved: sum(e => e.removed),
      testFiles: list.filter(e => e.test).length,
    },
    areas,
  };
}

async function updateHistory(day) {
  const history = await readJson(SUMMARY_FILE, { days: [] });
  const days = [day, ...history.days.filter(d => d.date !== day.date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP_DAYS);
  const next = { schema: 1, updatedAt: new Date().toISOString(), days };
  if (!DRY) await writeJson(SUMMARY_FILE, next);
  return next;
}

// ---------- 3. publish to Render ----------
async function publish(history, env) {
  const base = (env.MOLLY_PUBLISH_URL ?? "").replace(/\/+$/, "");
  const token = env.MOLLY_PUBLISH_TOKEN ?? "";
  if (!base || !token) return { ok: false, reason: "MOLLY_PUBLISH_URL / MOLLY_PUBLISH_TOKEN are not set in .env.local, so nothing was published." };
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) return { ok: false, reason: "MOLLY_PUBLISH_URL must be https (or localhost)." };
  let lastError = "";
  // Render's free tier sleeps; the first request can take about a minute to wake it.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${base}/api/molly-progress/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(history),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) return { ok: true, status: res.status };
      lastError = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403 || res.status === 503) break;
    } catch (error) { lastError = String(error?.message ?? error); }
    await new Promise(r => setTimeout(r, 15_000 * attempt));
  }
  return { ok: false, reason: lastError };
}

// ---------- main ----------
async function main() {
  const env = await loadEnv();
  const today = localDate();
  let history;
  if (args.has("--publish-only")) history = await readJson(SUMMARY_FILE, { days: [] });
  else {
    const { entries, firstRun } = await snapshot(today);
    const day = summarise(today, entries, firstRun);
    history = await updateHistory(day);
    console.log(`[molly-progress] ${today}: ${day.quiet ? "no changes" : `${Object.keys(entries).length} files, +${day.totals.linesAdded}/-${day.totals.linesRemoved} lines`}${firstRun ? " (first snapshot)" : ""}${DRY ? " [dry run]" : ""}`);
    day.areas.forEach(a => console.log(`  - ${a.label}: ${a.filesAdded} new, ${a.filesChanged} changed, ${a.filesRemoved} removed`));
  }
  if (DRY || args.has("--no-publish")) return;
  const result = await publish(history, env);
  console.log(result.ok ? "[molly-progress] published to Render" : `[molly-progress] not published: ${result.reason}`);
  await writeJson(path.join(STORE, "last-run.json"), { at: new Date().toISOString(), published: result.ok, reason: result.reason ?? null });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error("[molly-progress] failed:", error); process.exit(1); });
}
