# Molly's Progress

Settings → **For Zak: Molly's Progress**: on Zak's first visit each local calendar day, Alira tells Zak, message by message, what Molly built. Later visits restore the day's conversation immediately. Zak can ask follow-up questions in the composer at the bottom; the conversation scrolls above it.

## How it works

1. **8pm every day** Windows Task Scheduler runs `scripts/molly-progress.mjs` (task "Rehyn Molly Progress"; if the PC was off it runs when it is next on).
2. The script compares the working folder with its last snapshot (no git needed, so uncommitted edits count) and saves Molly's edits locally in `.molly-progress/snapshots/<date>/`:
   - `files/` full copies of every changed file, `changes.patch` a readable patch, `changes.json` per-file stats.
   - `.molly-progress/` is git-ignored: raw code never leaves this machine.
3. It writes a plain-language summary (areas, counts, names of new functions; no code or paths) to `server/data/molly-progress.json`.
4. It publishes that summary to Render: `POST <MOLLY_PUBLISH_URL>/api/molly-progress/publish` with `Authorization: Bearer <MOLLY_PUBLISH_TOKEN>`. Both values live in `.env.local`; Render needs the same `MOLLY_PUBLISH_TOKEN` as an environment variable (render.yaml declares it, `sync: false`).
5. The tab reads `/api/molly-progress`. Locally that is the file above; on Render it is the newest of the published summary and the one shipped with the last git push.

The first snapshot is a baseline (everything that exists), reported as "day one of my diary". Real daily changes start the next day.

## Commands

```
node scripts/molly-progress.mjs --dry            # show what would be reported, change nothing
node scripts/molly-progress.mjs --no-publish     # snapshot + summary only
node scripts/molly-progress.mjs --publish-only   # re-send the saved summary
powershell -ExecutionPolicy Bypass -File scripts/install-molly-progress-task.ps1 [-Time 20:00] [-Remove]
```

## Notes

- Render's free tier sleeps and has no persistent disk, so a published summary can be lost on restart; the next 8pm run sends the full 60-day history again.
- Without `MOLLY_PUBLISH_URL` the job still snapshots and summarises; it just does not publish.
- The opening diary and preset replies are templated in `client/src/lib/molly-progress.ts`. Up to three suggestions appear once the update finishes.
- **Show me the project heatmap** is one of those suggestions, also available before the first daily note. It opens four rows for exercise library design, assessment task design, web front end and Alira agentic development. Expand a row to see recorded work and what remains.
- Design milestones live in `shared/project-progress.ts`, independently of daily line/file counts. The initial numeric measure is Easy-level exercise design review coverage: Forward Reach and Hand-to-Mouth, 2 of 8 (25% reviewed, 75% left). Higher levels and patient-camera validation are separate work. Assessment and front-end completion estimates are unset until agreed; front end says **Nearly finished**. Alira says **Keeps learning**, with no finite percentage. Update milestone records/estimates when scope or review evidence changes. The same snapshot is supplied to free-text Alira answers.
- Free-text questions use the existing `/api/alira/channel` thinking service with `context: "molly-progress"`. The server provides the same latest notes as `/api/molly-progress`, including newer published notes in production. Alira treats them as reference data, distinguishes a first inventory from daily changes, and can read source code to explain the app. She cannot edit files or send messages to Molly.
- Generated replies reveal character by character. Requests and reveal timers are cancelled when the panel closes. This chat uses the existing channel configuration and availability gate (`ALIRA_CHANNEL_ENABLED` in production).
- The browser stores only the current day's report snapshot, preset replies, free-text conversation, draft and reading position in `rehyn.molly.chat.v1`. Switching Settings tabs, closing the dialog or reloading restores them without replaying completed messages. Planned report/preset messages are saved before animation; a reply already received appears in full if Zak closes during its reveal. A stopped request keeps Zak's question but does not invent an answer or replay the request.
- At local midnight the old chat expires and a fresh daily report starts, including while the panel is open. Focus/visibility checks handle sleeping laptops; yesterday's late responses cannot enter today's chat. Blocked/full browser storage falls back to memory for same-tab returns. This does not retain a cross-day archive or synchronize conversations between devices.
- The neighbouring **For Zak: How Alira works** chat also reveals its greeting and replies character by character, with no more than three suggestions, shown only after the message finishes.
