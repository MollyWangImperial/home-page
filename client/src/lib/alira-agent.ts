// Alira as an agent in the browser. Everything the patient types goes through here:
//  1. routeLocally() recognises clear requests ("restart the survey", "go back", "make the text
//     bigger", an answer typed in words) and names the tool to run. It works without any server,
//     and nothing leaves the device.
//  2. When Alira's thinking is connected (server/alira-agent.ts), anything else goes to Claude with
//     the same tools. runAgentTurn() runs that loop: Claude picks tools, the page runs them, and the
//     results go back until Claude has answered.
import {
  AGENT_LIMITS,
  echoableContent,
  type AgentBlock,
  type AgentMessage,
  type AliraToolName,
} from "@shared/alira-agent";
import {
  answerLabel,
  applicableQuestions,
  concernStarter,
  onboardingCopy,
  onboardingQuestions,
  starterSets,
  type OnboardingAnswers,
  type OnboardingQuestion,
} from "./alira-onboarding";
import { aliraAgentCopy as copy } from "./alira-agent-copy";

// ---- understanding typed requests -------------------------------------------------------------

export type LocalRoute = {
  /** A tool to run, exactly as Claude would call it. */
  tool?: { name: AliraToolName; input: Record<string, unknown> };
  /** A fixed line Alira says, in place of the tool's own confirmation. */
  say?: string;
  /** The test-only administrative control. */
  admin?: true;
};

export type RouteContext = {
  /** The question in play: on screen, or about to be asked again. */
  question: OnboardingQuestion | null;
  started: boolean;
  done: boolean;
  speaking: boolean;
};

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (t: string) => (t ? t.split(" ").length : 0);
const has = (t: string, phrase: string) => ` ${t} `.includes(` ${phrase} `);
const call = (name: AliraToolName, input: Record<string, unknown> = {}, say?: string): LocalRoute => ({ tool: { name, input }, ...(say ? { say } : {}) });

const NEGATED_RESTART = /\b(don'?t|do not|never|no need to|not)\b.*\b(re ?start|re ?do|re ?set|start (over|again))\b/;
const RESTART =
  /\b(re ?start|re ?do|re ?set|re ?take|start (\w+ ){0,2}(all )?(over|again|afresh|from scratch)|begin (\w+ ){0,2}again|(start|begin) from the (very )?(beginning|start|top)|go back to the (very )?(beginning|start|first question)|from scratch)\b/;
const ANSWER_AGAIN = /\b(answer|do|take|go through|fill in|fill out)\b.*\b(questions?|survey|questionnaire)\b.*\bagain\b/;
const CLEAR_ANSWERS = /\b(clear|erase|wipe|delete|remove|reset)\b.*\b(answers?|responses?)\b/;
const SURVEY_WORDS = /\b(survey|questionnaire|questions?|quiz|onboarding|answers?|form|assessment|it|them|this|everything|all)\b/;
const MOVEMENT_WORDS = /\b(movement|movements|camera|video|walking check)\b/;
const EXERCISE_TALK = /\b(exercis\w*|practi[sc]e\w*|workout)\b/;
// Questions about something, rather than requests to do it ("what happens if I restart?").
const ASKING_ABOUT = /^(what|why|when|where|who|which|does|do you think|should|if|would i|will i|would my|will my|is that)\b/;

const EMERGENCY = [
  /\b(i'?m|i am|i think i'?m|i think i am|might be|may be|he'?s|she'?s|they'?re|he is|she is|they are) (having|getting) (a |another )?(new )?stroke\b/,
  /\bchest (pain|pains|tightness|is tight)\b/,
  /\b(can'?t|cannot|struggling to|hard to) breathe\b|\bshort of breath\b|\bcan'?t catch my breath\b/,
  /\b(call|ring|dial|need) (an |the )?(ambulance|999|911|112|000|emergency services)\b/,
  /\b(fallen|fell)\b.*\b(can'?t|cannot) (get up|stand up)\b|\b(just|have just|'ve just) (fallen|fell)\b|\bhit my head\b/,
  /\b(sudden|suddenly|all of a sudden|just now|out of nowhere)\b.*\b(droop\w*|numb\w*|weak\w*|slurr\w*|confus\w*|can'?t (see|speak|talk|move|feel)|blurr\w*|dizz\w*|headache|lost (my )?balance)\b/,
  /\b(droop\w*|numb\w*|weak\w*|slurr\w*|confus\w*|can'?t (see|speak|talk|move|feel)|blurr\w*|dizz\w*|headache|lost (my )?balance)\b.*\b(sudden|suddenly|all of a sudden|just now|out of nowhere)\b/,
  /\bworst headache\b/,
];
const CRISIS =
  /\b(kill(ing)? myself|end(ing)? (it all|my life)|suicid\w*|want to die|wanna die|(don'?t|do not) want to (live|be alive|be here any ?more|go on)|hurt(ing)? myself|self ?harm\w*|no reason to live|better off dead|take my (own )?life)\b/;

const NAV_VERB = /\b(open|show|go|take|bring|see|view|visit|back|check|look|let me|want|can i|could i|where|find|write|add|log|record)\b/;

function questionByWords(t: string): string | null {
  const hints: [string, RegExp][] = [
    ["stroke_when", /\b(when|how long ago|date)\b/],
    ["side_affected", /\bside\b/],
    ["arm_hand_movement", /\b(arm|hand)\b/],
    ["get_around", /\b(get around|getting around|walking|walk|mobility)\b/],
    ["falls", /\b(fall|falls|fallen|fell)\b/],
    ["stiffness", /\b(stiff\w*|tight\w*)\b/],
    ["speech", /\b(speech|speaking|talking|words)\b/],
    ["swallowing", /\bswallow\w*\b/],
    ["mood", /\b(mood|feeling|feelings)\b/],
    ["help_at_home", /\b(help at home|who helps|helps me|help)\b/],
    ["exercise_place", /\b(where i exercise|exercise place|exercises?|exercising)\b/],
    ["main_goal", /\b(goal|get back to)\b/],
  ];
  const found = hints.filter(([, pattern]) => pattern.test(t)).map(([key]) => key);
  return found.length === 1 ? found[0] : null;
}

const EXERCISE_WORDS: [string, RegExp][] = [
  ["ex_h2m", /\b(hand to mouth|mouth)\b/],
  ["ex_reach", /\breach\w*\b/],
  ["ex_wallslide", /\b(wall ?slide|arm (raise|raises|lift|lifts|elevation))\b/],
  ["ex_handopen", /\b(hand open\w*|open\w* (my |the )?hand)\b/],
  ["ex_grasp", /\b(grasp\w*|grip\w*|cup|cylinder)\b/],
  ["ex_pinch", /\b(pinch\w*|peg|pegs)\b/],
  ["ex_lower_selective", /\bknee\w*\b/],
  ["ex_ankle_dorsiflexion", /\b(ankle\w*|toe|toes|foot|feet)\b/],
];

export function routeLocally(text: string, ctx: RouteContext): LocalRoute | null {
  const t = normalise(text);
  if (!t) return null;
  const asking = ASKING_ABOUT.test(t);

  // Safety first, whatever else is going on.
  if (CRISIS.test(t)) return { say: copy.crisis };
  if (EMERGENCY.some(pattern => pattern.test(t))) return call("show_warning_signs", {}, copy.emergency);
  if (t === "administrative control" || t === "admin control") return { admin: true };

  if (/\b(stop (reading|talking|speaking)|be quiet|mute)\b/.test(t) || (ctx.speaking && /^(stop|stop it|quiet|shh+|silence|enough)$/.test(t))) return call("stop_reading");
  if (/\b(read (it|that|this|the (last |previous )?(message|question))|say (it|that) (again|out loud|aloud)|out loud|aloud)\b/.test(t)) return call("read_aloud");

  // Restarting the questions: "restart the survey", "start over", "reset my answers"...
  if (!asking && !NEGATED_RESTART.test(t) && !EXERCISE_TALK.test(t)) {
    const restart = RESTART.test(t) || ANSWER_AGAIN.test(t);
    if (restart && MOVEMENT_WORDS.test(t)) return call("start_movement_check");
    if ((restart && (SURVEY_WORDS.test(t) || words(t) <= 8)) || CLEAR_ANSWERS.test(t)) return call("restart_survey");
  }

  if (/\b(change|edit|fix|correct|update)\b.*\b(answer|question)\b/.test(t) && ctx.started) {
    if (/\b(last|previous)\b/.test(t)) return call("go_back_one_question");
    const key = questionByWords(t.replace(/\b(change|edit|fix|correct|update|my|the|answer|question|about|to|for|on)\b/g, " "));
    if (key) return call("go_to_question", { question_key: key });
  }
  if (ctx.started && /^(go )?back$|\b(go back|previous question|last question|question before|undo( that)?)\b/.test(t)) return call("go_back_one_question");
  if (ctx.question && /^(skip|pass|next question|skip it)$|\bskip (this|that|it|the question)\b|\b(rather not|prefer not to) (say|answer)\b|\bdon'?t want to answer\b/.test(t)) return call("skip_current_question");
  if (ctx.started && !ctx.done && (/^(pause|stop|wait|hold on|not now|later|maybe later)$/.test(t) || /\b(pause|stop) (the |these |our )?(questions?|survey)\b|\b(continue|carry on|finish|do (this|it)) later\b/.test(t)))
    return call("pause_survey");

  // An answer to the question on screen, typed in words.
  if (ctx.question && !ctx.done) {
    const match = matchOption(ctx.question, text);
    if (match) return call("answer_current_question", { values: match.values, other_text: match.otherText });
  }

  // Help, warning signs and display.
  if (/^(help|help me|menu|options|commands)$|\bwhat can (you|i) (do|ask)\b|\bwhat can you help( me)? with\b/.test(t)) return { say: copy.help };
  if (/\b(warning signs?|signs of (a )?stroke|stroke signs|stroke symptoms|symptoms of (a )?stroke|fast test)\b/.test(t)) return call("show_warning_signs", {}, copy.warningSigns);
  const textWords = /\b(text|font|writing|words|letters|print)\b/;
  if (textWords.test(t) || /\bzoom (in|out)\b/.test(t)) {
    if (/\b(smaller|too (big|large)|reduce|decrease|normal|standard|usual|regular)\b|\bzoom out\b/.test(t)) return call("set_display", { larger_text: false, stronger_contrast: null });
    if (/\b(bigger|larger|increase|enlarge|big|large)\b|\bzoom in\b|\bcan'?t (read|see)\b/.test(t)) return call("set_display", { larger_text: true, stronger_contrast: null });
  }
  if (/\bcontrast\b/.test(t)) {
    const off = /\b(less|lower|normal|standard|usual|off|reduce|remove|disable|no)\b/.test(t);
    return call("set_display", { larger_text: null, stronger_contrast: !off });
  }

  // Questions people often ask, answered with Alira's own words.
  if (/\bwhat('s| is) rehyn\b|\bwhat is this (app|website|site|for)\b/.test(t)) return { say: starterSets[0][0].a };
  if (/\bhow (does|do|will) (the |this |it |my )?(assessment|it|this|check|movement check) work\b/.test(t)) return call("show_assessment_steps", {}, onboardingCopy.how);
  if (/\bhow long (does|will|is|do) (it|this|that|the (assessment|check|movement check|questions?|survey|session))\b|\bhow long does it take\b/.test(t)) return { say: starterSets[1][1].a };
  if (/\b(need|have) to stand\b/.test(t)) return { say: starterSets[1][2].a };
  if (/\bcamera\b/.test(t) && /\b(why|what for|what is .* for|need)\b/.test(t)) return { say: starterSets[2][0].a };
  if (/\b(carer|family|wife|husband|partner|son|daughter|friend|someone)\b/.test(t) && /\b(can|could|may)\b/.test(t) && /\b(help|with me|sit|join|do this)\b/.test(t)) return { say: starterSets[1][0].a };
  if (/\bwhat happens (after|next|then)\b|\bwhat('s| is) next\b/.test(t)) return { say: starterSets[2][2].a };
  if (/\b(tired|exhausted|worn out|need a (break|rest)|take a break|have a rest)\b/.test(t))
    return ctx.started && !ctx.done ? call("pause_survey", {}, starterSets[2][1].a) : { say: starterSets[2][1].a };
  if (/\b(raise a concern|i have a concern|i'?m worried|i am worried|worried about|concerned about)\b/.test(t)) return { say: concernStarter.a };
  if (/\b(talk it through|can we (just )?talk|i want to talk|need to talk)\b/.test(t)) return { say: starterSets[0][2].a };

  // The movement check.
  if (/\b(movement check|movement assessment|movement test|camera check|camera test|assessment|the check)\b/.test(t) && /\b(start|begin|do|open|take|ready|try|go)\b/.test(t) && !asking)
    return call("start_movement_check");

  // Other pages.
  const nav = NAV_VERB.test(t) || words(t) <= 3;
  if (nav && !asking) {
    if (/\b(breath\w*)\b/.test(t)) {
      const minutes = /\b(1|one) min/.test(t) ? 1 : /\b(3|three) min/.test(t) ? 3 : /\b(5|five) min/.test(t) ? 5 : null;
      return call("open_my_time", { activity: "breathing", minutes });
    }
    if (/\b(memory game|pairs game|matching game|pairs|play a game|a game)\b/.test(t)) return call("open_my_time", { activity: "memory_game", minutes: null });
    if (/\b(calming|relaxing|soothing) (sounds?|music)\b|\b(listen|play|put on|hear)\b.*\b(sounds?|rain|birdsong|waves|music)\b/.test(t)) return call("open_my_time", { activity: "sounds", minutes: null });
    if (/\b(my circle|messages from (my )?(family|friends)|family messages)\b/.test(t)) return call("open_my_time", { activity: "circle", minutes: null });
    if (/\bmy time\b/.test(t)) return call("open_page", { page: "my_time" });
    if (/\b(journal|diary)\b/.test(t)) return call("open_page", { page: "journal" });
    if (/\b(medals?|badges?|awards?|trophies)\b/.test(t)) return call("open_page", { page: "medals" });
    if (/\b(progress|journey|everyday wins|add a win|log a win|my week)\b/.test(t)) return call("open_page", { page: "progress" });
    if (/\bprivacy\b/.test(t)) return call("open_settings", { section: "privacy" });
    if (/\bterms( of use)?\b/.test(t)) return call("open_settings", { section: "terms" });
    if (/\bpermissions?\b|\bmy data\b/.test(t)) return call("open_settings", { section: "data_and_permissions" });
    if (/\b(settings?|preferences|my profile|profile)\b/.test(t)) return call("open_settings", { section: "profile" });
    if (/\bhome( page| screen)?\b/.test(t) && !/\b(at home|help at home)\b/.test(t)) return call("open_page", { page: "home" });
    if (EXERCISE_TALK.test(t)) {
      const found = EXERCISE_WORDS.filter(([, pattern]) => pattern.test(t));
      if (found.length === 1) {
        const level = /\b(hard|harder|difficult)\b/.test(t) ? "hard" : /\b(medium|middle)\b/.test(t) ? "medium" : null;
        const side = /\bleft\b/.test(t) ? "left" : /\bright\b/.test(t) && !/\bright now\b/.test(t) ? "right" : null;
        return call("open_exercise", { exercise_id: found[0][0], level, side });
      }
    }
  }

  // Starting or carrying on with the questions.
  const explicitSurvey = /\b(continue|carry on|resume|back to|start|begin|do|go on with) (the |my |our |with the )?(questions?|survey|questionnaire)\b|\bwhere were we\b/.test(t);
  const goAhead = /^(ok(ay)?|yes|yeah|yep|sure|ready|go|go on|carry on|continue|keep going|resume|next|start|begin|let'?s (go|start|begin|do it|carry on|continue)|i'?m ready|ready to (start|begin|go)|let'?s get started)\b/.test(t);
  if (explicitSurvey || (goAhead && !ctx.question)) return call("continue_survey");
  if (!ctx.started && /^(not now|not right now|later|maybe later|no thanks|no thank you)$/.test(t)) return { say: onboardingCopy.notNow };
  return null;
}

// ---- matching an answer typed in words ----------------------------------------------------------

/** Everyday words for each answer, beyond the label on its button. */
const OPTION_WORDS: Record<string, Record<string, string[]>> = {
  stroke_when: {
    lt_1m: ["less than a month", "under a month", "few weeks", "few days", "last week", "this week", "this month", "recently", "just happened", "days ago", "weeks ago"],
    "1_3m": ["one to three months", "1 to 3 months", "1 3 months", "a month ago", "a couple of months", "couple of months", "two months"],
    "3_6m": ["three to six months", "3 to 6 months", "3 6 months", "four months", "five months", "six months"],
    gt_6m: ["more than six months", "over six months", "more than 6 months", "over 6 months", "a year", "years ago", "last year", "over a year", "long time ago", "ages ago"],
  },
  side_affected: {
    left: ["left", "left side", "my left"],
    right: ["right", "right side", "my right"],
    both: ["both", "both sides", "each side", "left and right", "right and left", "all over"],
    unsure: ["not sure", "unsure", "don't know", "dont know", "no idea", "i'm not sure", "not certain"],
  },
  arm_hand_movement: {
    none: ["not at all", "can't move", "cannot move", "no movement", "none", "can't use", "cannot use", "doesn't move"],
    little_help: ["a little", "a bit", "with help", "slightly", "only a little", "with some help"],
    tires: ["tires quickly", "gets tired", "it tires", "tire quickly", "tires easily", "get tired quickly", "tires fast"],
    fairly_well: ["fairly well", "pretty well", "quite well", "well", "fine", "normally", "no problem"],
  },
  get_around: {
    wheelchair: ["wheelchair", "wheel chair", "in a chair"],
    frame_stick: ["frame", "stick", "walker", "cane", "zimmer", "walking stick", "rollator", "crutch", "crutches"],
    person: ["someone's arm", "holding someone", "someone helps me walk", "hold someone", "with someone", "lean on someone", "hold on to someone"],
    own: ["on my own", "by myself", "myself", "alone", "independently", "without help", "walk fine"],
  },
  falls: {
    no: ["no", "none", "nope", "not fallen", "haven't fallen", "have not fallen", "no falls", "never", "not once"],
    once: ["once", "one fall", "one time", "one", "1"],
    more: ["more than once", "twice", "several", "a few times", "many", "lots", "more", "a couple of times", "few times", "2", "3", "two", "three"],
  },
  stiffness: {
    not_really: ["not really", "no", "not stiff", "rarely", "nope", "not at all"],
    sometimes: ["sometimes", "occasionally", "now and then", "a bit", "a little", "on and off"],
    most: ["most of the time", "always", "all the time", "very stiff", "constantly", "mostly"],
  },
  speech: {
    no: ["no", "nope", "not really", "fine", "no trouble", "no problem"],
    sometimes: ["sometimes", "occasionally", "a bit", "a little", "now and then"],
    often: ["often", "a lot", "always", "all the time", "frequently", "most of the time"],
  },
  swallowing: {
    no: ["no", "nope", "fine", "none", "no trouble", "no problem"],
    sometimes: ["sometimes", "occasionally", "a bit", "a little", "now and then"],
    special_diet: ["special diet", "diet", "thickened", "puree", "pureed", "soft food", "soft foods", "thickener"],
  },
  mood: {
    good: ["good", "mostly good", "fine", "okay", "ok", "great", "well", "happy", "not bad", "pretty good", "alright", "all right"],
    up_down: ["up and down", "ups and downs", "mixed", "so so", "varies", "some good days", "good and bad"],
    low: ["low", "down", "sad", "bad", "depressed", "not good", "rough", "terrible", "awful", "not great", "miserable", "not well", "unwell"],
  },
  help_at_home: {
    own: ["on my own", "myself", "no one", "nobody", "no one helps", "alone", "i manage", "manage"],
    family: ["family", "wife", "husband", "partner", "son", "daughter", "mum", "dad", "mother", "father", "sister", "brother", "family member", "my kids", "children"],
    carer: ["carer", "caregiver", "care worker", "carers", "nurse", "paid carer", "home help"],
    both: ["both", "family and a carer", "family and carer", "carer and family", "both of them"],
  },
  exercise_place: {
    chair: ["chair", "sitting", "seated", "sit down", "sat down", "armchair"],
    standing: ["standing", "stand", "stood up", "stand up"],
    bed: ["bed", "lying down", "in bed", "lying"],
    varies: ["varies", "it varies", "depends", "different places", "a mix", "mix", "all of them"],
  },
  main_goal: {
    eating: ["eat", "eating", "drink", "drinking", "meals", "feed myself", "feeding myself", "cup of tea"],
    dressing: ["dress", "dressing", "dressed", "clothes", "get dressed", "buttons"],
    walking_house: ["walk around the house", "walking around the house", "walking at home", "walk at home", "walk around", "walking around", "walking", "walk"],
    going_out: ["going out", "go out", "out and about", "shops", "shopping", "outside", "get out", "getting out", "the pub", "see friends"],
  },
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, eighteen: 18, twenty: 20, few: 3, couple: 2, several: 4,
};

/**
 * "Six weeks ago", "2 months", "over a year": how many months since the stroke, if the text says.
 * "Less than" and "more than" nudge the number just under or over, so they land in the right band.
 */
export function monthsAgo(text: string): number | null {
  const t = normalise(text);
  const found = /\b(less than|under|not even|nearly|almost|more than|over|longer than|at least)? ?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty|few|couple|several)(?: of)? (day|days|week|weeks|month|months|year|years)\b/.exec(t);
  if (!found) return null;
  const amount = /^\d+$/.test(found[2]) ? Number(found[2]) : NUMBER_WORDS[found[2]];
  const unit = found[3].replace(/s$/, "");
  const months = unit === "day" ? amount / 30 : unit === "week" ? (amount * 7) / 30.4 : unit === "year" ? amount * 12 : amount;
  if (!Number.isFinite(months)) return null;
  const nudge = !found[1] ? 0 : /less|under|not even|nearly|almost/.test(found[1]) ? -0.01 : 0.01;
  return months + nudge;
}

function strokeWhenFromMonths(months: number): string {
  if (months < 1) return "lt_1m";
  if (months <= 3) return "1_3m";
  if (months <= 6) return "3_6m";
  return "gt_6m";
}

type Span = { value: string; start: number; end: number };

function findSpans(t: string, q: OnboardingQuestion): Span[] {
  const spans: Span[] = [];
  const padded = ` ${t} `;
  for (const option of q.o) {
    if (q.other && option.v === q.other) continue;
    const phrases = Array.from(new Set([normalise(option.l), normalise(option.v.replace(/_/g, " ")), ...(OPTION_WORDS[q.k]?.[option.v] ?? []).map(normalise)]));
    for (const phrase of phrases) {
      if (!phrase) continue;
      let from = 0;
      for (;;) {
        const at = padded.indexOf(` ${phrase} `, from);
        if (at < 0) break;
        spans.push({ value: option.v, start: at, end: at + phrase.length });
        from = at + 1;
      }
    }
  }
  return spans;
}

/**
 * Which answer the patient's words point to. A longer phrase wins over a shorter one inside it
 * ("not good" over "good"); two answers that both appear on their own are left for the patient.
 */
export function matchOption(q: OnboardingQuestion, text: string): { values: string[]; otherText: string | null } | null {
  const t = normalise(text);
  // A question about the options ("what do you mean by fairly well") is not an answer.
  if (!t || /\?\s*$/.test(text.trim()) || /^(what|why|how|which|who|where|do you|does|is it|is that|can you|could you|would you|should)\b/.test(t)) return null;
  if (q.k === "stroke_when") {
    const months = monthsAgo(t);
    if (months !== null) return { values: [strokeWhenFromMonths(months)], otherText: null };
  }
  const spans = findSpans(t, q);
  const kept = spans.filter(span => !spans.some(other => other.value !== span.value && other.start <= span.start && other.end >= span.end && other.end - other.start > span.end - span.start));
  const values = Array.from(new Set(kept.map(span => span.value)));
  if (q.type === "multi" && values.length) return { values, otherText: null };
  if (values.length === 1) return { values, otherText: null };
  if (q.k === "help_at_home" && values.includes("family") && values.includes("carer")) return { values: ["both"], otherText: null };
  if (q.k === "side_affected" && values.includes("left") && values.includes("right")) return { values: ["both"], otherText: null };
  // A goal in the patient's own words: "I'd like to play the piano again".
  if (!values.length && q.other && /^(i'?d like to|i would like to|i want to|i'?d love to|i would love to|i hope to|to be able to|being able to|get back to|getting back to)\b/.test(t)) {
    return { values: [q.other], otherText: text.trim().slice(0, 300) };
  }
  return null;
}

// ---- what Alira can see ------------------------------------------------------------------------

export type PageStateInput = {
  answers: OnboardingAnswers;
  qi: number;
  started: boolean;
  done: boolean;
  paused: boolean;
  newUser: boolean;
  medal: string | null;
  movementCheckDoneOn: string | null;
  largeText: boolean;
  strongContrast: boolean;
};

export function answeredCount(answers: OnboardingAnswers): number {
  return applicableQuestions(answers).filter(i => answers[onboardingQuestions[i].k] !== undefined).length;
}

/** A short description of the screen, sent with each message so Alira knows where things stand. */
export function describePageState(state: PageStateInput): string {
  const list = applicableQuestions(state.answers);
  const answered = answeredCount(state.answers);
  const lines = ["Page: chat with Alira."];
  if (state.done || answered === list.length) {
    lines.push(`Questions: all ${list.length} answered. The movement check card is ${state.done ? "showing" : "next"}.`);
  } else if (!state.started && answered === 0) {
    lines.push(`Questions: not started (0 of ${list.length} answered).`);
  } else if (state.qi >= 0 && !state.paused) {
    const q = onboardingQuestions[state.qi];
    const current = answerLabel(q, state.answers[q.k], String(state.answers[q.otherKey ?? ""] ?? ""));
    lines.push(
      `Questions: ${answered} of ${list.length} answered. On screen: question ${list.indexOf(state.qi) + 1} of ${list.length} (${q.k}) "${q.t}" ` +
        `Options (${q.type === "multi" ? "choose any" : "choose one"}): ${q.o.map(o => `${o.v} = "${o.l}"`).join("; ")}.` +
        `${current ? ` Saved answer: "${current}".` : ""}${q.optional ? " Optional." : ""}`
    );
  } else {
    lines.push(`Questions: paused, ${answered} of ${list.length} answered.`);
  }
  lines.push(`Movement check: ${state.movementCheckDoneOn ? `done on ${state.movementCheckDoneOn}` : "not done yet"}.`);
  if (state.newUser) lines.push("New user: Journey and My Time open after the first movement check.");
  if (state.medal) lines.push(`Came from the medal "${state.medal}".`);
  lines.push(`Display: larger text ${state.largeText ? "on" : "off"}, stronger contrast ${state.strongContrast ? "on" : "off"}.`);
  return `<page_state>\n${lines.join("\n")}\n</page_state>`;
}

/** Saved answers in words, with each question's options, for Claude's get_survey_answers tool. */
export function surveySummary(answers: OnboardingAnswers): string {
  const list = applicableQuestions(answers);
  return JSON.stringify({
    answered: answeredCount(answers),
    total: list.length,
    questions: list.map(i => {
      const q = onboardingQuestions[i];
      return {
        question_key: q.k,
        question: q.t,
        options: q.o.map(o => `${o.v} = ${o.l}`),
        answer: answerLabel(q, answers[q.k], String(answers[q.otherKey ?? ""] ?? "")) || null,
      };
    }),
  });
}

// ---- talking to Claude ---------------------------------------------------------------------------

export type AgentToolCall = { id: string; name: string; input: Record<string, unknown> };
export type AgentToolResult = { content: string; isError?: boolean };
export type AgentTurn = { history: AgentMessage[]; texts: string[]; stopReason: string | null };

export class AgentRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function requestAgentReply(
  messages: AgentMessage[],
  { request = fetch, signal }: { request?: typeof fetch; signal?: AbortSignal } = {}
): Promise<{ content: AgentBlock[]; stopReason: string | null }> {
  const response = await request("/api/alira/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AgentRequestError(data?.code ?? "AGENT_FAILED", data?.error ?? "Alira couldn’t answer.", response.status);
  if (!Array.isArray(data?.content)) throw new AgentRequestError("AGENT_FAILED", "Alira couldn’t answer.", 502);
  return { content: echoableContent(data.content), stopReason: typeof data.stop_reason === "string" ? data.stop_reason : null };
}

/** Adds the patient's blocks, joining them to a trailing patient message (tool results) if there is one. */
export function withUserBlocks(history: AgentMessage[], blocks: AgentBlock[]): AgentMessage[] {
  const last = history.at(-1);
  if (last?.role === "user") return [...history.slice(0, -1), { role: "user", content: [...last.content, ...blocks] }];
  return [...history, { role: "user", content: blocks }];
}

/**
 * One thing the patient said, answered by Claude. Claude's tool calls run through `execute`, in
 * order, and their results go back until Claude replies without a tool (or the step limit is hit).
 * The conversation only ever grows at the end, so earlier replies (and their thinking) stay valid.
 */
export async function runAgentTurn({
  history,
  user,
  execute,
  request,
  signal,
  maxSteps = AGENT_LIMITS.maxSteps,
}: {
  history: AgentMessage[];
  user: AgentBlock[];
  execute: (call: AgentToolCall) => AgentToolResult | Promise<AgentToolResult>;
  request?: typeof fetch;
  signal?: AbortSignal;
  maxSteps?: number;
}): Promise<AgentTurn> {
  // Past the limit, start a new conversation; the page state in each message carries on.
  const fresh = () => withUserBlocks([], user);
  let messages = history.length + 2 * maxSteps + 1 > AGENT_LIMITS.maxMessages ? fresh() : withUserBlocks(history, user);
  let startedAfresh = messages.length === 1;
  const texts: string[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    let reply: Awaited<ReturnType<typeof requestAgentReply>>;
    try {
      reply = await requestAgentReply(messages, { request, signal });
    } catch (error) {
      // The API could not use this conversation: ask once more with just this message.
      if (error instanceof AgentRequestError && error.code === "AGENT_CONVERSATION_REJECTED" && !startedAfresh && step === 0) {
        startedAfresh = true;
        messages = fresh();
        step -= 1;
        continue;
      }
      throw error;
    }
    const said = reply.content.filter((b): b is Extract<AgentBlock, { type: "text" }> => b.type === "text").map(b => b.text.trim()).filter(Boolean);
    const calls = reply.content.filter((b): b is Extract<AgentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (reply.stopReason === "refusal") {
      // Start afresh next time so the declined message doesn't follow the conversation.
      return { history: [], texts: said, stopReason: reply.stopReason };
    }
    if (calls.length && reply.stopReason === "max_tokens") {
      // A tool call cut off mid-way is never run, and never kept.
      return { history: messages, texts: [...texts, ...said], stopReason: reply.stopReason };
    }
    texts.push(...said);
    if (reply.content.length) messages = [...messages, { role: "assistant", content: reply.content }];
    if (!calls.length) return { history: messages, texts, stopReason: reply.stopReason };
    const results: AgentBlock[] = [];
    for (const toolCall of calls) {
      let result: AgentToolResult;
      try {
        result = await execute({ id: toolCall.id, name: toolCall.name, input: toolCall.input });
      } catch {
        result = { content: "That didn't work. Nothing was changed.", isError: true };
      }
      results.push({
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: result.content.slice(0, AGENT_LIMITS.maxTextChars) || "Done.",
        ...(result.isError ? { is_error: true } : {}),
      });
    }
    messages = [...messages, { role: "user", content: results }];
  }
  // Out of steps: the tool results stay at the end and the next message joins them.
  return { history: messages, texts, stopReason: "max_steps" };
}
