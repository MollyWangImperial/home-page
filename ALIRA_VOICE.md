# Alira voice

Alira has one voice. The Alira page, the welcome conversation, and the movement assessment and exercises all speak with the same ElevenLabs voice, model and delivery settings.

On this site that covers four places:

- **The Alira page and the welcome conversation**: `/api/alira/voice` for her fixed lines, `/api/alira/speak` for everything else she writes.
- **The warm-up repetition**: `createVoice({ alira: true })` asks `/api/exercise-voice` with `provider: "alira"`.
- **The daily exercises**: not yet. They still use the device's English voice; switch them on the same way and record their lines with `pnpm voice:bake --exercises` first.
- **The emergency FAST check**: `/api/tts/generate`.
- **The copied assessment service** (`assessment-service/`): `local_app.py` turns on Alira's voice for every line (`INSTRUCTION_TTS_PROVIDER=elevenlabs`, `ELEVENLABS_VOICE_SCOPE=all`) and reads the key from this site's `.env.local`, however the service is started. Its recorded lines are in `assessment-service/frontend/public/audio/prepared`.

When Alira's voice can't speak a line (it isn't recorded and there is no key or no credits), the exercises and the FAST check fall back to the device's English voice, so spoken guidance never stops, and the assessment falls back to the OpenAI voice. Every Alira message on her page can be heard in her voice, including replies she writes in the moment and personal messages such as her congratulations with your assessment results: those go to `/api/alira/speak`, which sends the text to ElevenLabs. A patient's own words are never sent.

## Where the voice is set

`shared/alira-voice.ts` is the single place it is defined for this site: the voice ID, the model (Eleven Multilingual v2) and the delivery settings (expressive warmth on a steady base, at an unhurried pace). The server and the recording script both read it.

The voice is **Alira** (`WeMiVLMEQeVXN5PFqfo3`), designed for Rehyn with ElevenLabs Voice Design: a British woman in her early thirties with a soft, modern southern English accent, warm and bright, like a favourite physiotherapist who has become a trusted friend. It lives in the ElevenLabs workspace called Molly's Workspace, so `ELEVENLABS_API_KEY` must be a key from that workspace; a key from another workspace answers `voice_not_found`.

The assessment and the exercises run in the Rehyn backend (`D:\rh-release`), which cannot import that file. It mirrors the same values: `ALIRA_ELEVENLABS_VOICE_ID` in `backend/server.py` is the same voice ID (and is used when `ELEVENLABS_VOICE_ID` is not set), `ELEVENLABS_VOICE_SCOPE=all` makes it the voice for every spoken line, and `ALIRA_VOICE_SETTINGS` in `backend/server.py` holds the same delivery settings. See `backend/VOICE_CLONING.md` there.

To change her voice: change `voiceId` in `shared/alira-voice.ts`, set the same ID in the backend, and record the lines again in both places (below). Clips are stored under a key made from the voice, model, settings and text, so a clip recorded in an older voice is never played.

## The voice pack

Alira's fixed lines are recorded once and committed in `server/voice-pack`. A recorded line plays without an API key and without spending ElevenLabs credits, so production does not need the key for them. The fixed exercise, warm-up and FAST check lines are listed in `client/src/lib/alira-spoken-lines.ts` and recorded after her page's lines (the FAST check first, the exercises last). Lines built while a patient exercises, such as a repetition's score, can't be recorded ahead; they are spoken live while credits last.

```
pnpm voice:bake --dry-run    # what is ready and what is missing
pnpm voice:bake              # record every missing line the month's credits allow
pnpm voice:bake --max 2000   # spend at most this many credits now
pnpm voice:bake --prune      # also delete clips from an older voice or deleted lines
```

The script reads `ELEVENLABS_API_KEY` from `.env.local`, asks ElevenLabs how many credits are left, and records the new patient's first conversation before anything else if credits are short. All the lines together are about 5,500 characters. `server/voice-pack/manifest.json` lists what has been recorded.

Run it again after changing any of Alira's wording, because a changed line is a new recording.

## Local setup

Use Node.js 22 or newer. Copy `elevenlabs.env.example` to `.env.local` in the repository root and set `ELEVENLABS_API_KEY` to a key with Text to Speech access. The key must stay on the server; never use a `VITE_` prefix. `.env.local` is ignored by Git.

Run `pnpm install` and `pnpm dev`, then open `/alira`. Press **Hear Alira** or a message’s Listen button. Selecting a Start a conversation topic opens a dialog and automatically plays its question. The dialog shows Alira’s animated icon, the question, and a text reply box. Press the icon to stop or replay the question. Closing it cancels playback; reopening preserves an unsent draft. Sending continues the exchange in the main chat. Other playback is opt-in and can also be stopped while loading. The avatar follows actual playback events.

`ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` in the environment override `shared/alira-voice.ts`. Prefer changing the shared file, so the pack and the backend stay on the same voice. Restart the server and refresh the page after changing the voice to clear the browser’s in-memory audio cache.

## Hosting

Run `pnpm build` and `pnpm start`. `PORT` defaults to 3000. The Express server serves both the frontend and `/api/alira/voice`; a static-only upload of `dist/public` cannot play voice. Vite development and preview servers also include the voice endpoint.

Recorded lines need no configuration on the host, as long as `server/voice-pack` is deployed with the code. Only a line that is not in the pack needs `ELEVENLABS_API_KEY` in the host’s secret environment settings. The local key is intentionally not included in a Git push.

## Requests and caching

The browser sends a registered phrase ID, never an API key or the patient’s free-form draft. The browser and server share `client/src/lib/alira-voice-phrases.ts`, which combines the legacy clip registry with the topic prompts in `alira-topics.ts`. The server sends only that preset text to ElevenLabs. The old WAV paths in that registry are identifiers; playback uses the MP3 audio described here.

For each request the server looks in memory, then the voice pack, then the ignored `.cache/alira-elevenlabs` directory, and only then asks ElevenLabs. The response header `X-Alira-Voice-Source` says which one answered (`pack`, `cache` or `live`). Live generation is deduplicated, timed out and rate limited. `/api/alira/voice/status` lists the phrase IDs that are in the pack. If a line is in neither the pack nor the cache and ElevenLabs is unavailable, the page shows a retry message and remains readable.

## Verification

- `pnpm check`
- `pnpm exec vitest run src/lib/alira-companion.test.ts src/lib/alira-voice-server.test.ts`
- `pnpm build`

API reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
