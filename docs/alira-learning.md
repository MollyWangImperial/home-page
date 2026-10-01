# Alira's Learning

Alira reviews the data a patient has agreed to share and may adjust a small, fixed set of their own settings for exercises and the movement check. Alira never edits code: she proposes a value for one setting, and code accepts it only inside that setting's bounds, its daily limit and the safety rules. Every change is logged with its reason and evidence and can be undone.

Every limit and default below is an engineering default awaiting clinician review.

## The daily warm-up

A one-minute check of two comfortable forward reaches. It is never scored and never pass or fail. It records "today's starting line": the resting angles, the best reach (shoulder and elbow angles, wrist height from lap to shoulder) and posture measures during the hold.

- Offered at the end of the survey with an encouraging invitation and a "Maybe later" option (`client/src/pages/Alira.tsx`, copy in `client/src/lib/alira-onboarding.ts`).
- If it has not been done today, it is offered again before the movement check and before an exercise (`client/src/components/WarmRepGate.tsx`, wrapping the `/assessment` and `/exercise/:id` routes in `client/src/App.tsx`). Each gate offers it once a day; skipping at one gate does not stop the next gate from offering it.
- Not offered on the carer-led route (the survey says the arm does not move yet).
- The page `/warm-up?gate=survey_end&next=/assessment` runs it on its own (`client/src/pages/WarmUp.tsx`).
- Measurement: `client/src/lib/warm-rep.ts` (pure state machine), camera and voice in `client/src/components/WarmRep.tsx`.
- After the warm-up and after each exercise the patient can say how it felt (easier, about right, a bit harder, much harder; pain none, a little, a lot; stopped because they felt unwell).

## What Alira may change

Defined in `shared/alira-adaptation.ts` (`ADAPTATION_PARAMS`):

| Setting | Default | Range | Easier when |
|---|---|---|---|
| Hold at the target | 1.5 s | 0.8 to 2.5 s | lower |
| Reach target height (forward reach) | 1.0× | 0.7 to 1.2× | lower |
| Target size (forward reach, hand to mouth) | 1.0× | 0.85 to 1.3× | higher |
| Repetitions per session | 1.0× | 0.5 to 1.25× (never fewer than 3) | lower |
| Counts as reaching (angle-scored exercises) | 70% | 55 to 80% | lower |
| Good repetition | 90% | 75 to 95% | lower |
| Score with one compensation | 30 points | 15 to 60 | higher |
| Movement check start points (forward reach, hand to mouth, hand opening, pinch) | survey answers | the runner's own rungs | lower |

The movement check's level and points rules stay fixed, so scores remain comparable over time. Only where each task starts can change.

## Rules enforced in code

- Values outside a setting's bounds are rejected; values are snapped to the setting's step.
- Each change needs a reason and at least one piece of evidence from the data.
- Moves towards harder are limited per day for each setting; moves towards easier are not.
- At most 4 of Alira's changes stand per day.
- Pain, feeling harder, or stopping because of how they felt (today or yesterday) means only easier changes are possible. A lot of pain or stopping also flags a physiotherapist check in the admin tab. A movement check whose review gate paused exercises has the same effect.
- Settings are read once when a session or a movement check starts, so nothing changes in the middle of a repetition.
- The browser validates Alira's changes again before storing them.

## Consent

Five switches in Settings, Data and permissions, all off by default (`client/src/components/AliraLearningConsent.tsx`):

1. My answers to Alira's questions
2. My movement results (needed for any learning)
3. Still pictures from my warm-up (up to two, sent for that review only, never kept in the browser)
4. My name and my goal in my own words
5. My journal (mood and up to 300 characters a day, last seven days)

Without consent to share movement results, nothing is sent and the standard settings apply. The browser cuts the data down to the agreed categories and the server cuts it down again on arrival. Raw video is never sent for Alira's learning.

## When Alira reviews

After a warm-up, after a finished exercise session, after a movement check, and when an admin presses "Ask Alira to review today again". At most 8 reviews a day. The gates wait up to 40 seconds for a review in progress, with a "Start now" button.

## Settings, Alira's Learning

Today's warm-up, Alira's summary of what she saw and changed (and what she chose not to change), the changes with Undo, what the rules did not allow, all settings with their bounds, and an admin chat at the bottom. The chat can explain, never change: changes and undo are buttons.

## Server and storage

- `server/alira-learning.ts`: `GET /api/alira/learning/status`, `POST /api/alira/learning/run` (JSON), `POST /api/alira/learning/chat` (server-sent events). Same-origin requests only, rate limited, no request bodies logged.
- On by default when developing locally. In production it is off unless `ALIRA_LEARNING_ENABLED=true`, because it sends consented patient data to the Claude API.
- Browser storage keys: `rehyn.alira.consent.v1`, `rehyn.alira.warmrep.v1`, `rehyn.alira.reports.v1`, `rehyn.alira.adaptation.v1`. The account reset in Settings clears them with the other `rehyn.*` keys.

## Before patients use it

- Clinician review of every bound, step, daily limit and safety rule.
- Legal review: still pictures sent to an AI provider, the processor list and processing location in the Privacy Notice, and the existing line that switching off health data removes the plan (these new switches are narrower and keep the plan working).
