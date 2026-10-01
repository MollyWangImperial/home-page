# Alira as an agent

Alira acts on what the patient types in her chat, using the app's own functions as tools. For
example, "restart the survey" clears the saved answers and asks question one again. The composer
now stays open while a question card is showing, so the patient can type an answer, a question
or a request at any point.

## How a message is handled

1. **On the device** (`client/src/lib/alira-agent.ts`, `routeLocally`). Clear requests are
   recognised without any server, and nothing leaves the device. These include:
   - safety: signs of a new stroke or an emergency, and words about self-harm
   - restarting, pausing, carrying on, going back and skipping in the questions
   - an answer typed in words ("my left side", "about two months ago")
   - opening pages, My Time activities, exercises and settings
   - larger text and stronger contrast, reading aloud, and the warning signs
   - the questions people often ask, answered with the approved starter answers
2. **Claude** (`server/alira-agent.ts`, only when `ANTHROPIC_API_KEY` is set). Anything else goes
   to Claude with the same tools. Claude picks the tools, the page runs them, and the results go
   back until Claude replies (at most 6 round trips per message). The key stays on the server.
3. **Neither.** Alira gives a kind fixed reply and brings back the question card or choices.

Each message to Claude starts with a `page_state` block that describes the screen: which question
is showing and its options, how many questions are answered, whether the movement check is done,
and the display settings. It does not include the patient's answers. Claude reads those with
`get_survey_answers` only when it needs them.

## Tools

The tools are defined in `shared/alira-agent.ts` and run in `client/src/pages/Alira.tsx` (`runTool`).

| Tool | What it does |
|---|---|
| `restart_survey` | Clears the saved answers and asks question 1 again |
| `continue_survey`, `pause_survey` | Starts or carries on with the questions, or sets them aside (a "Carry on" choice appears) |
| `answer_current_question` | Records an answer given in words, then moves on |
| `set_survey_answer` | Changes one saved answer without leaving the current question |
| `go_to_question`, `go_back_one_question`, `skip_current_question` | Moves around the questions (only optional questions can be skipped, and none are yet) |
| `get_survey_answers` | Reads the saved answers and each question's options |
| `show_assessment_steps` | Shows the three-part "how it works" card |
| `start_movement_check` | Opens `/assessment` |
| `get_recovery_status` | Movement check done or not, days to the next check, exercises done today |
| `open_page` | Home, progress, journal, medals or My Time (Journey and My Time stay locked for new users, as in the navigation) |
| `open_my_time` | My Time at breathing (1, 3 or 5 minutes), circle, memory game or sounds (`/my-time?activity=…&minutes=…`) |
| `open_exercise` | One launch exercise on its start screen, easy level by default, on the affected side |
| `open_settings` | Settings at profile, privacy, data and permissions, terms, or the exercise test panel |
| `get_medals` | Earned medals, the ones within reach, and how each one is earned |
| `set_display` | Larger text and stronger contrast (now shared by the page shell and Alira; still not saved) |
| `read_aloud`, `stop_reading` | Reads Alira's latest fixed line aloud, or stops |
| `show_warning_signs` | Opens the stroke warning signs |

Tools that open another page run after Alira's reply has been shown.

## Model and API settings

- Model `claude-sonnet-5-5` (Claude Sonnet 5.5, $2 / $10 per million input / output tokens), effort `low`. Thinking is on by default for this model, and `max_tokens` is
  16000 (a ceiling, not a target).
- Strict tool schemas with `tool_choice: auto`. Forced tool choice is not supported on this model.
- **Server-side fallbacks are on** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).
  If Claude declines a request, the API retries it on Anthropic's recommended fallback model. To
  turn this off, remove `betas` and `fallbacks` in `agentRequest`.
- The system prompt and tools are cached (`cache_control` on the system block). The conversation
  only grows at its end, so earlier replies and their thinking stay valid. Past 60 messages, the
  browser starts a fresh conversation, and the page state carries on.
- Rate limits: 40 requests a minute from one address and 8 at once. The endpoint only takes
  same-origin requests.

## Privacy

- Without `ANTHROPIC_API_KEY`, nothing the patient types leaves the device.
- With the key set, messages that Alira does not recognise on the device are sent to Anthropic.
  So are the page state and, when Claude asks for them, the survey answers. **Check this with the
  privacy notice and data processing agreements before turning it on for patients.**
- Replies that Claude writes are never sent to a speech provider. They have no listen button;
  only Alira's fixed lines can be read aloud, as before.

## Tests

- `client/src/lib/alira-agent.test.ts`: the request routing (including many ways of saying
  "restart the survey"), answer matching, the page state, the tool definitions and the tool loop
- `client/src/lib/alira-agent-server.test.ts`: the endpoint, the request it sends to Claude, error
  handling and rate limits
