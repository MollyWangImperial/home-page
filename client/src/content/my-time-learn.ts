// "Learn" in My Time: short, plain answers to the questions people ask after a stroke.
//
// Every figure and piece of advice here was checked against the pages listed under each article's
// `sources` on 6 October 2026. When you edit an article, check the wording against its sources
// again, keep sentences short (they are read aloud one at a time) and update LEARN_CHECKED.
// This is general information. It never replaces what a person's own stroke team tells them.

export const LEARN_CHECKED = "October 2026";

export type LearnSource = { label: string; url: string };
export type LearnArticle = {
  id: string;
  /** One or two words above the title. */
  kicker: string;
  /** The question, in the words a survivor would use. */
  question: string;
  /** The line that makes someone want the answer. */
  hook: string;
  /** The answer in two or three sentences, for people who read no further. */
  short: string;
  sections: { heading: string; paragraphs: string[] }[];
  /** Everything the sources say helps, in full. */
  helps: string[];
  /**
   * Three of `helps`, shortened, for the "What helps" list a reader can tick to try this week.
   * Shorten what `helps` already says; never add advice that is not there.
   */
  tryThisWeek: string[];
  /** A question to take to the stroke team. */
  ask: string;
  sources: LearnSource[];
};

const strokeAssociation = (label: string, path: string): LearnSource => ({ label: `Stroke Association: ${label}`, url: `https://www.stroke.org.uk/stroke/${path}` });

export const learnArticles: LearnArticle[] = [
  {
    id: "rewiring",
    kicker: "Your brain",
    question: "Can a brain really rewire itself?",
    hook: "The cells a stroke destroyed will not grow back. So how do people learn to walk and talk again?",
    short: "Yes. Brain cells that died in the stroke cannot grow back, but the healthy parts of your brain can build new connections and take over. Every repetition helps them do it.",
    sections: [
      {
        heading: "What is actually happening",
        paragraphs: [
          "Picture a town where the main bridge has collapsed. The bridge is gone, but the town is still there, and people start finding other roads. At first the back roads are slow and awkward. The more they are used, the wider and faster they become.",
          "Your brain does something very like this. Doctors call it neuroplasticity. It is how people relearn walking, speech and swallowing after a stroke.",
        ],
      },
      {
        heading: "Why your exercises repeat so much",
        paragraphs: [
          "A new connection is weak the first time it is used. Using it again and again is what makes it strong. That is the reason your exercises ask for the same movement many times.",
          "The Stroke Association puts it simply. Every time you take an extra step, say a new word or do a hand exercise, it helps the brain make new connections.",
        ],
      },
      {
        heading: "Is there a deadline?",
        paragraphs: [
          "No. The fastest recovery usually comes in the first weeks and months. But improvements can and do carry on for years, and there is no time limit on the brain's ability to rewire.",
        ],
      },
    ],
    helps: [
      "Practise the exact thing you want back. To lift your arm better, do activities that make you lift and use your arm.",
      "Little and often. A few repetitions, several times a day, keeps the new roads in use.",
      "A flat week does not mean it has stopped. There is no time limit on rewiring.",
    ],
    tryThisWeek: [
      "Practise the exact thing you want back, such as lifting and using your arm.",
      "Little and often: a few repetitions, several times a day.",
      "On a flat week, remember there is no time limit on rewiring.",
    ],
    ask: "Which movements should I be repeating most, and how many times a day?",
    sources: [
      strokeAssociation("Neuroplasticity, re-wiring the brain", "effects/neuroplasticity-rewiring-the-brain"),
      strokeAssociation("Physiotherapy after a stroke", "life-after-stroke/physiotherapy"),
    ],
  },
  {
    id: "fatigue",
    kicker: "Energy",
    question: "Why does a shower feel like a marathon?",
    hook: "It is not laziness, and a nap will not fix it. Tiredness after a stroke is its own thing.",
    short: "Fatigue is very common after a stroke, and it is different from ordinary tiredness because it does not seem to get better with rest. It can affect you even if your stroke was small, or some time ago.",
    sections: [
      {
        heading: "Why it happens",
        paragraphs: [
          "Your brain and body are healing, and healing uses energy. A weak arm or leg takes more effort to move, so everyday tasks cost more than they used to.",
          "Other things can add to it: low mood or anxiety, poor sleep, pain, and the side effects of some medicines.",
        ],
      },
      {
        heading: "What it is not",
        paragraphs: [
          "It is not a sign that you are not trying. It can follow any stroke, big or small. Even people who have made a full physical recovery can still find fatigue a problem.",
        ],
      },
      {
        heading: "Does it get better?",
        paragraphs: [
          "It often improves over time, but be patient with it. It can take many months before post-stroke fatigue starts to lift.",
        ],
      },
    ],
    helps: [
      "Pace, plan and prioritise. Take things step by step, decide when you will do them, and choose what matters most to you.",
      "Take proper breaks before and after doing things. Even a chat with friends, a car journey or a meal can be tiring.",
      "Keep a simple diary of what you do, even a few notes a day, so you can find how much is right for you.",
      "Start activity gently, such as a very short walk, and build it up slowly without overdoing it.",
      "Tell family and friends what it is like, so they understand what you are going through.",
    ],
    tryThisWeek: [
      "Pace, plan and prioritise. Take things step by step, and choose what matters most to you.",
      "Take proper breaks before and after doing things. Even a chat or a car journey can be tiring.",
      "Keep a simple diary of what you do, so you can find how much is right for you.",
    ],
    ask: "Could my medicines, my sleep or my mood be adding to my tiredness?",
    sources: [
      strokeAssociation("Post-stroke fatigue and tiredness", "effects/physical/tiredness-and-fatigue"),
      strokeAssociation("Managing post-stroke fatigue", "effects/physical/managing-fatigue"),
    ],
  },
  {
    id: "emotions",
    kicker: "Feelings",
    question: "Why do I cry at adverts now?",
    hook: "Tears, or laughter, that arrive out of nowhere have a name. About one in five people get them.",
    short: "A stroke can affect your ability to control your emotions, so tears or laughter can arrive suddenly. It is called emotionalism. It affects about one in five people in the first few months, and for many it eases or disappears within six months.",
    sections: [
      {
        heading: "What it feels like",
        paragraphs: [
          "You might cry at something that would never have moved you before, or laugh at the wrong moment. It can come on fast, and it may not match what you actually feel inside.",
          "That mismatch is the upsetting part for many people. You are not becoming a different person. It is an effect of the stroke.",
        ],
      },
      {
        heading: "It is not the same as low mood",
        paragraphs: [
          "Emotionalism is different from depression, although you can have both. Around one in three stroke survivors has some form of depression in the first year. Around one in four experiences anxiety within the first five years.",
          "These are common effects of stroke, not a weakness, and they can be treated. Talking therapy and medication both have a place.",
        ],
      },
    ],
    helps: [
      "Tell people it is an effect of your stroke. It takes the embarrassment out of the moment.",
      "Some people find distraction helps when they feel it starting.",
      "Say so when you are truly upset, so people do not put every feeling down to emotionalism.",
      "Being active can lift your mood, and talking a worry through can put it in perspective.",
    ],
    tryThisWeek: [
      "Tell people it is an effect of your stroke. It takes the embarrassment out of the moment.",
      "When you feel it starting, try a distraction. Some people find it helps.",
      "Be active, which can lift your mood, and talk a worry through with someone.",
    ],
    ask: "Is what I am feeling emotionalism, low mood, or both? What could help?",
    sources: [
      strokeAssociation("Emotionalism", "effects/emotional/emotionalism"),
      strokeAssociation("Depression and anxiety after stroke", "effects/emotional-and-behavioural/depression-and-anxiety"),
    ],
  },
  {
    id: "hand",
    kicker: "Movement",
    question: "Why won't my hand do what I tell it?",
    hook: "Your muscles are still there. The trouble is higher up, and that is good news for getting movement back.",
    short: "A stroke damages some of the connections inside the brain that carry the instruction to move. That is why it can leave weakness or paralysis down one side of the body. The muscles are waiting for a signal that is not getting through clearly yet.",
    sections: [
      {
        heading: "Why one side",
        paragraphs: [
          "Each side of the brain controls the opposite side of the body, because nearly all the signals between brain and body cross over on the way. So a stroke in the left side of the brain affects the right side of the body, and the other way round.",
        ],
      },
      {
        heading: "Why it can feel stiff as well as weak",
        paragraphs: [
          "Muscles can also become stiff, or go into spasm. This is called spasticity. It is a known effect of stroke, and it is something to tell your therapists about.",
        ],
      },
      {
        heading: "How movement comes back",
        paragraphs: [
          "The brain can rewire itself, which lets you relearn things like walking and using your affected arm. You help that along by practising the activities your team gives you.",
          "Be specific. If you have difficulty lifting your arm, you need activities that make you lift and use it. If walking is hard, you need to walk as much as you safely can.",
        ],
      },
    ],
    helps: [
      "Do your exercises on the affected side, even when the other side would be quicker.",
      "The fastest gains are usually in the first weeks and months, but improvements can carry on for years.",
      "Getting fitter and stronger over time is part of it too, so the steady days count.",
    ],
    tryThisWeek: [
      "Do your exercises on the affected side, even when the other side would be quicker.",
      "Keep going. Improvements can carry on for years.",
      "Count the steady days. Getting fitter and stronger is part of it too.",
    ],
    ask: "What should I practise for my arm and hand, and is stiffness something we should treat?",
    sources: [
      strokeAssociation("Physiotherapy after a stroke", "life-after-stroke/physiotherapy"),
      { label: "American Stroke Association: Effects of stroke", url: "https://www.stroke.org/en/about-stroke/effects-of-stroke" },
      strokeAssociation("Neuroplasticity, re-wiring the brain", "effects/neuroplasticity-rewiring-the-brain"),
    ],
  },
  {
    id: "words",
    kicker: "Speaking",
    question: "Where did my words go?",
    hook: "You know exactly what you want to say. It just will not come out. Around a third of people find this after a stroke.",
    short: "This is called aphasia. It is a problem with language, not with thinking. It happens when a stroke damages the language centres of the brain, and around a third of people who have a stroke experience it. It does not affect intelligence.",
    sections: [
      {
        heading: "What it can look like",
        paragraphs: [
          "You cannot find the word you want, or a different word comes out. Following a conversation is hard, especially on the phone or with noise in the background.",
          "Reading, writing and numbers can be affected too. A text message or a letter can suddenly take real effort.",
        ],
      },
      {
        heading: "The part other people get wrong",
        paragraphs: [
          "People with aphasia still think in the same way. The thoughts are all there. What has been damaged is the route from the thought to the word.",
        ],
      },
      {
        heading: "Can it improve?",
        paragraphs: [
          "The same rewiring that brings back movement can bring back language. A speech and language therapist can show you what to practise.",
        ],
      },
    ],
    helps: [
      "Cut down distractions and background noise before you talk. Turn the television off.",
      "Choose a good moment, when you have the energy and concentration for it.",
      "Stuck on a word? Spell it, write it down, draw it, point to it, or describe it by talking around it.",
      "Ask people to give you time, to allow silences and not to interrupt.",
    ],
    tryThisWeek: [
      "Cut down background noise before you talk. Turn the television off.",
      "Stuck on a word? Write it, draw it, point to it or talk around it.",
      "Ask people to give you time, and not to interrupt.",
    ],
    ask: "Can I see a speech and language therapist, and what should I practise at home?",
    sources: [
      strokeAssociation("Aphasia and its effects", "effects/aphasia/aphasia-and-its-effects"),
      strokeAssociation("Tips for aiding communication", "effects/aphasia/communication-problems/tips"),
    ],
  },
  {
    id: "again",
    kicker: "Looking ahead",
    question: "Could it happen again?",
    hook: "The honest answer, and the handful of things that really do lower the odds.",
    short: "Your risk is higher once you have had a stroke: nearly one in four survivors will have another. But you can reduce that risk, mainly by treating the condition that caused it and taking the medicines you are prescribed.",
    sections: [
      {
        heading: "Why the risk is higher",
        paragraphs: [
          "About 85 in every 100 strokes in the UK are caused by a blockage that cuts off the blood supply to part of the brain. The rest are caused by bleeding in or around the brain.",
          "Conditions such as high blood pressure, high cholesterol, diabetes and an irregular heartbeat called atrial fibrillation all raise the risk. Unless they are treated, they are still there after the stroke.",
        ],
      },
      {
        heading: "Know the signs",
        paragraphs: [
          "Remember the word FAST. Face, arms, speech, and time to call 999.",
          "Call 999 if you think you are having a stroke, even if the signs have stopped. Do not drive yourself to hospital.",
        ],
      },
    ],
    helps: [
      "Take the medication you are prescribed, and never stop it without talking to your GP first.",
      "Find out what caused your stroke, and what your own risk factors are.",
      "Keep your blood pressure, cholesterol and blood sugar checked and treated.",
      "Stop smoking, be more active, eat well, and keep alcohol within the recommended limits.",
    ],
    tryThisWeek: [
      "Take your medicines as prescribed. Never stop one without talking to your GP first.",
      "Keep your blood pressure, cholesterol and blood sugar checked and treated.",
      "Stop smoking, be more active, eat well, and keep alcohol within the recommended limits.",
    ],
    ask: "What caused my stroke, and what is each of my medicines for?",
    sources: [
      strokeAssociation("Managing risk", "manage-risk"),
      { label: "American Stroke Association: Preventing another stroke", url: "https://www.stroke.org/en/life-after-stroke/preventing-another-stroke" },
      strokeAssociation("Ischaemic stroke", "types/ischaemic"),
      { label: "NHS: Symptoms of a stroke", url: "https://www.nhs.uk/conditions/stroke/symptoms/" },
    ],
  },
];

export type TrustedPlace = { name: string; about: string; url: string };

/** Where to read more. Each of these is a charity or health service, not a company selling something. */
export const trustedPlaces: TrustedPlace[] = [
  { name: "Stroke Association", about: "The UK stroke charity. Clear guides to every effect of stroke, and a helpline on 0303 3033 100.", url: "https://www.stroke.org.uk/" },
  { name: "NHS: Stroke", about: "What the health service says about symptoms, treatment and recovery.", url: "https://www.nhs.uk/conditions/stroke/" },
  { name: "American Stroke Association", about: "Life after stroke, explained for survivors and families.", url: "https://www.stroke.org/en/life-after-stroke" },
  { name: "Different Strokes", about: "Run by younger stroke survivors, for working-age survivors and their families.", url: "https://differentstrokes.co.uk/" },
  { name: "Carers UK", about: "Information, advice and support for anyone looking after someone unpaid.", url: "https://www.carersuk.org/" },
];
