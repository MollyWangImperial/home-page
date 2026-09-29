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
   - The status card at the top shows the not-started / in-progress / done states; the done
     card offers **Start now** (movement check here) and **Open in the Rehyn app instead**.
3. `/assessment` — the movement check. This is the Rehyn app's real pose runner
   (`D:\rh-release\backend\server.py`, served at `/api/pose/runner`) embedded full-screen with
   camera and microphone permission delegated to it. The page only frames the runner and
   listens to the messages it posts to its host:
   - `exit` → back to Alira
   - `task_complete` → counts tasks for the completion message
   - `assessment_complete` → the assessment id is remembered on this device
     (`localStorage["rehyn.assessment.latest"]`) and a completion card is shown.

   The runner receives `package=initial` and the `affected_side` from the answer to
   "Which side of your body has been affected?" ("both" / "not sure" fall back to the
   runner's default, right).

## Configuration

`VITE_ASSESSMENT_BASE` is the backend origin that serves the runner. HTTPS is accepted
anywhere; plain HTTP only on `localhost` / `127.0.0.1`. When unset, `pnpm dev` uses
`http://localhost:8001` (run the Rehyn backend from `D:\rh-release`) and production builds use
`https://rehyn.onrender.com`. `VITE_ASSESSMENT_URL` (the old full-page redirect) is no longer
read by the pages.

## Still device-local

There is no patient sign-in in this companion, so the survey answers and the assessment id are
kept in the browser only. The runner itself saves the movement results with the assessment
service (anonymously, without a `uid`). Connecting the answers to a patient record is the next
integration step.
