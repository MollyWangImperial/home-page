# Alira's daily plan review

Alira adjusts the exercise plan every day with fixed rules. No AI model decides anything here; Alira
only explains the changes. Because no clinician is assigned, the admin gets the emails a physio would.

## When it runs

All of the patient's results live in the browser, so the review runs in the app
(`client/src/hooks/usePlanReview.ts`, mounted in `App.tsx`):

- **Straight away after a warning sign.** As soon as a "How did that feel?" answer says *a lot of
  pain* or *I stopped because I felt unwell*, the exercise rests for the rest of that day and the
  next, comes back one level easier, and the admin is emailed. A warning during the warm-up rests
  every exercise. The same applies when the patient tells Alira in the chat (her `report_how_it_felt`
  tool).
- **Every evening at 8pm** (`REVIEW_HOUR`), if the app is open, the day's results are reviewed and
  the changes apply from the next day.
- **The next time the app opens**, any finished day that wasn't reviewed is caught up (up to seven
  days), so the next exercise always runs at the right level.
- It also runs on every page change and when the app comes back into view. Running twice changes nothing.
- **Late results count.** A session finished after a day was reviewed (after 8pm, say) reviews that
  day again: each exercise goes back to where it stood before that evening and is decided afresh with
  everything from the day, still at most one step. An exercise changed again since (a rest after a
  later warning sign) keeps what it has.

### Testing with "Next day"

The Journey's local testing strip ("Complete today's session", "Next day", "Reset") is treated as
real days:

- **Next day** moves the clock and runs the review straight away. Alira's note on the new day lists
  her changes, the reminder appears, and the change shows in Alira's Learning.
- Scores from the strip carry no level or reps, so a day known only by its score counts as done in
  full at the level the plan gave that day.
- "Complete today's session" skips exercises resting that day.
- **Reset** clears the review along with the Journey records.
- Admin emails from a simulated day are marked **[Test]**.

## The rules (`shared/plan-review.ts`)

Each threshold is a named constant marked *engineering default, needs clinician review*.

| Result of the day, per exercise | Next day |
|---|---|
| No session | No change |
| Felt much harder, a little pain, stopped before the last rep, best score below `LOW_SCORE` (50), or the target had to move closer | One level easier (not below the easiest) |
| `PROGRESS_DAYS` (2) good session days in a row at the current level: all reps, score at least `GOOD_SCORE` (80), nothing felt harder or hurt | One level harder, never more than `MAX_LEVELS_ABOVE_CHECK` (1) above the movement check's level |
| Anything felt harder or hurt in the last two days (`safetyFrom`), or the movement check's review gate is closed | Never harder |
| A lot of pain, or stopped feeling unwell | Rest that day and `REST_DAYS_AFTER_WARNING` (1) more, then one level easier, and an email to the admin |

- At most one step per exercise per day.
- The reach and hand-to-mouth exercises always run at one level, so they can rest but never change level.
- A new movement check brings a new plan, and the levels start again from it.
- The review only changes the level and rest days. Alira's Learning (`shared/alira-adaptation.ts`) tunes
  holds, targets and reps separately; both read the same "How did that feel?" answers
  (`rehyn.alira.reports.v1`).

## What the patient sees

- **A reminder in the lower-right corner** (`PlanChangeReminder`, on every page with the main menu):
  a message circle that opens once to say what changed and why, and stays until "Got it".
- **The next day, Alira's note on Journey** starts with "Zak, I've adjusted today's plan:" and lists
  the changes.
- **Today's session on Journey** shows "Easier today" or "Harder today" on a changed exercise, and
  "Resting today" instead of Start. "Done for today" counts only the exercises that aren't resting.
- Alira's `get_plan_changes` tool lets her explain the changes, and `open_exercise` won't open an
  exercise that is resting.
- **Settings > Alira's Learning** (for the admin) has a "Changes to Zak's plan" card
  (`PlanChangesCard`): every change, newest first, with its reason and whether the admin email went
  out or is still waiting.

## Emails to the admin

`server/admin-alerts.ts` (`POST /api/admin-alerts`) emails `ADMIN_ALERT_EMAIL` over SMTP:

- a warning email straight away for each warning sign;
- one summary on any evening the review changed the plan (warnings are not repeated in it).

Set `ADMIN_ALERT_EMAIL` (in `.env`) and `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and
`SMTP_PASS` (in `.env.local`). See `.env.example` for Gmail. Until they are set, alerts wait in the
browser (`rehyn.plan.review.v1`) and are sent once email works; they are dropped after 30 days.
`GET /api/admin-alerts/status` says whether email is set up.

The emails contain the patient's name, the exercise, what they reported and what changed. The
endpoint accepts same-origin requests only, at most 20 an hour from one address, and never sends the
same alert twice.

## Storage

`rehyn.plan.review.v1` in localStorage (`client/src/lib/plan-review-store.ts`): each exercise's level
and rest days, the change log (last 60), what the reminder has shown, and the email outbox. The
account reset clears it with every other `rehyn.` key.

## Tests

- `client/src/lib/plan-review.test.ts`: the rules, the wording, the review in the app, the email
  outbox and the Journey.
- `client/src/lib/admin-alerts-server.test.ts`: the email endpoint.
