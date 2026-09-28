# Alira voice

Alira uses ElevenLabs for the greeting and the Listen controls on each reply.
The default is **Sarah — Mature, Reassuring, Confident**, using Eleven Multilingual v2 at a slightly slower speaking pace.

## Local setup

Use Node.js 22 or newer. Copy `elevenlabs.env.example` to `.env.local` in the repository root and set `ELEVENLABS_API_KEY` to a key with Text to Speech access. The key must stay on the server; never use a `VITE_` prefix. `.env.local` is ignored by Git.

Run `pnpm install` and `pnpm dev`, then open `/alira`. Press **Hear Alira** or a message’s Listen button. Playback is opt-in and can be stopped, including while the voice is loading. The avatar follows actual playback events.

`ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` can be changed in the environment. Restart the server and refresh the page after changing the voice to clear the browser’s in-memory audio cache.

## Hosting

Run `pnpm build` and `pnpm start` with the same server environment variables configured on the host. `PORT` defaults to 3000. The Express server serves both the frontend and `/api/alira/voice`; a static-only upload of `dist/public` cannot generate voice. Vite development and preview servers also include the voice endpoint.

The local key is intentionally not included in a Git push. Set it separately in the hosting provider’s secret environment settings.

## Requests and caching

The browser sends a registered phrase ID, never an API key or the patient’s free-form draft. The server looks up the preset Alira text in `client/src/lib/alira-voice-clips.json` and sends that text to ElevenLabs. The old WAV paths in that registry are identifiers; playback now uses generated MP3 audio.

Audio is cached in memory and in the ignored `.cache/alira-elevenlabs` directory, keyed by text, voice, model and settings. Repeat listens reuse the audio. Generation is deduplicated, timed out and rate limited. If ElevenLabs is unavailable, the page shows a retry message and remains readable.

## Verification

- `pnpm check`
- `pnpm exec vitest run src/lib/alira-companion.test.ts src/lib/alira-voice-server.test.ts`
- `pnpm build`

API reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
