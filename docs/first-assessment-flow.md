# First Assessment Flow

The new-user journey now runs end to end in this companion:

1. `/welcome` — one quiet focus. Alira greets the patient (typed out, with a replay on her
   mark) and invites them with **Yes, let's get to know each other**. Pressing it leaves a
   session note (`rehyn.fromHome`) and opens `/alira?onboarding=1&from=home`.
2. `/alira` — the guided start. When the patient arrives from the welcome page Alira goes
   straight into the questions; otherwise she introduces herself and offers **Let's start**,
   **How does it work?**, **Not right now** and the dashed **Administrative control** chip.
   - Twelve short questions (`client/src/lib/alira-onboarding.ts`) are asked one at a time
     inside the chat. Answers are echoed as the patient's messages and saved on this device
     (`localStorage["rehyn.onboarding.answers"]`) so the conversation can pause and resume.
   - **Administrative control** is a test-only control: it answers every remaining question
     at random, saves them, and jumps to the movement-check card.
   - The movement-check card appears inside the conversation after the questions and
     offers **Start now**. Local development also offers **Finish assessment with random scores**.
3. `/assessment` — the movement check. This is the Rehyn app's real pose runner
   (`assessment-service/backend/server.py`, served at `/api/pose/runner`) embedded full-screen with
   camera and microphone permission delegated to it. The page only frames the runner and
   listens to the messages it posts to its host:
   - `exit` → back to Alira
   - `task_complete` → counts tasks for the completion message
   - `assessment_complete` → the assessment id and scored report are remembered on this device
     (`localStorage["rehyn.assessment.latest"]`). Current runners keep their scores visible in the frame until Done; older runners retain a completion-card fallback.

   The runner receives `package=initial`, `ladder=1`, and the `affected_side` from the answer to
   "Which side of your body has been affected?" ("both" / "not sure" fall back to the
   runner's default, right). The task list, ladder starts and helper setting come from the
   survey (`companionTaskPlan` in `client/src/lib/assessment.ts`):

   | Answer | Runner URL |
   |---|---|
   | Arm and hand `fairly_well` | `task_ids` T1, T3, H4, H3; `start_rung={"T1":"r160","T3":"mouth"}` |
   | Arm and hand `tires` | same tasks; `start_rung={"T1":"r120","T3":"mouth"}` |
   | Arm and hand `little_help` | same tasks; `start_rung={"T1":"r80","T3":"chest"}`; `helper=ask` |
   | Arm and hand `none` | no arm or hand tasks; the page explains the carer-led route first, and there is no score for those areas |
   | Get around `own` / `frame_stick` | adds L6 |
   | Get around `person` | adds L6 with `walking_helper=1`; `helper=ask` |
   | Get around `wheelchair` | no L6 |
   | Help at home `own` | `helper=0` (no helper assumed; the bottom rung offers self-assist) |
   | Help at home anything else, or unanswered | `helper=ask` ("Is someone with you right now?" before the camera starts) |
   | Main goal | `main_goal` sends the selected goal to the runner |

   Task order is always seated reach, hand to mouth, open and close hand, pinch, then walking;
   the local preview keeps the requested order, so hand opening comes before pinch. With no
   arm/hand answer, the current runner starts at `r160` and the mouth rung. When no task is
   left (arm and hand `none`, and a wheelchair) the runner is not opened; the page explains the
   carer-led route and goes back to Alira.

   The current runner is copied into this project at `assessment-service/backend`.
   The assessment page uses the same JSON `start_rung`, `walking_helper` and `main_goal`
   contract as the v2 companion. Targets use 80%, 120% and 160% of calibrated reach.
   See [assessment-v2-copy.md](assessment-v2-copy.md) for the complete source map and startup commands.

## Configuration

`VITE_ASSESSMENT_BASE` is the backend origin that serves the runner. HTTPS is accepted
anywhere; plain HTTP only on `localhost` / `127.0.0.1`. When unset, `pnpm dev` uses
`http://localhost:8001` by default; this project’s `.env.local` selects its copied service at `http://127.0.0.1:8002` and production builds use
`https://rehyn.onrender.com`. `VITE_ASSESSMENT_URL` (the old full-page redirect) is no longer
read by the pages.

## Still device-local

There is no patient sign-in in this companion; survey answers are kept in the browser.
On loopback, the companion sends `local_preview=1`. The backend must also have
`REHYN_LOCAL_ASSESSMENT_PREVIEW=1`. Tasks load without an account, and
`POST /api/assessment/preview-results` scores the preview without reading or writing patient
records. The runner shows the results inside the frame and posts
`assessment_preview_complete` with `results_in_runner: true`.

The hosted backend requires authentication for `/api/assessment/tasks`; it does not save
anonymous assessments. The hosted companion still needs an agreed patient sign-in integration.
None of this changes the original app's assignment, scoring, or saving; the app does not send
`ladder=1`.

The twelve questions ask nothing about pain or sitting safely, which the app uses as safety
gates. Two quick questions from Alira before the camera tasks are proposed but not added yet.

## Assessment completion and exercise plan

The scored completion message carries the assessment report. The companion stores its
function marks, bounded task summaries, selected exercise plan and review gate in
`rehyn.assessment.latest`; it excludes motion frames and video evidence. Older ID-only
records remain readable, but do not announce a prepared plan. Updating a plan preserves
the assessment date used for reassessment reminders.

The runner keeps the score screen visible. Its Done action posts `exit` and returns to
Alira, where congratulations, measured marks, a designing message and a ready message
appear in order. Each line finishes before the next begins. The ready card waits for the
exercise selector and the final chat line. Failures retain the marks and offer a retry;
leaving the page cancels pending requests and typing. Returning after completion restores
the ready card. Score messages use device speech only when read aloud.

**View my exercises** opens `/journey?tab=progress&section=exercises`, scrolls to the
exercise section at the bottom of Progress and focuses its heading. Exercise details use
the backend's selected dose, affected side, difficulty and target rung. A blocked review
gate allows viewing the plan but does not offer an exercise launch.

The random-score button is limited to local development with a loopback assessment
service. It calls `preview-random-results`, followed by `preview-plan`, with the existing
survey-selected tasks and goal. These endpoints use the normal function scorer and
exercise selector without saving account results or altering recordings. Alira and
Journey clearly label the random test data. Unmeasured areas are omitted from the marks,
and a fully supported-movement route does not generate invented camera scores.
