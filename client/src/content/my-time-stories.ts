// "Stories" in My Time: what life after a stroke is like, told by survivors and by carers.
//
// IMPORTANT: these four are composite stories. They were written for Rehyn from experiences that
// stroke survivors and carers commonly describe; David, Lin, Margaret, Alan, Jo and Anne are not
// real people. STORIES_NOTE explains their creation under the list; storyNote() names the
// fictional characters under each story. When real stories are collected, with each person's written
// consent, replace these and change both notes.
// Sentences are kept short because they are read aloud one at a time.

export const STORIES_NOTE = "These stories were created for Rehyn by combining experiences commonly described by stroke survivors and carers on similar recovery journeys.";

export type StoryVoice = "survivor" | "carer";
/** The colours of the initial that stands in for a face: a soft background and a darker letter. */
export type StoryTint = { background: string; ink: string };
export type SurvivorStory = {
  id: string;
  voice: StoryVoice;
  /** Who is speaking. */
  name: string;
  /** Their situation in a few words. */
  who: string;
  /** The line that carries the story, in their words. */
  quote: string;
  paragraphs: string[];
  /** "What helped", in their voice. */
  helped: string[];
  /** For lines such as "Read his story". */
  pronoun?: "his" | "her" | "their";
  /** This person's own colours, so each one is recognisable at a glance. */
  tint?: StoryTint;
  /** Anyone else named in the story. They are not real people either, and the note says so. */
  alsoNamed?: string[];
};

/** Explains this story's creation and names its fictional characters. */
export function storyNote(story: SurvivorStory): string {
  const people = [story.name, ...(story.alsoNamed ?? [])];
  const named = people.length > 1 ? `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}` : people[0];
  const from = story.voice === "survivor" ? "stroke survivors" : "carers of stroke survivors";
  return `This story was created for Rehyn by combining experiences commonly described by ${from} on similar recovery journeys. ${named} ${people.length > 1 ? "are fictional characters" : "is a fictional character"}.`;
}

export const survivorStories: SurvivorStory[] = [
  {
    id: "david",
    voice: "survivor",
    name: "David",
    who: "63, eight months after his stroke",
    pronoun: "his",
    tint: { background: "#f8e3d6", ink: "#83533d" },
    quote: "I cried when I buttered my own toast.",
    paragraphs: [
      "I drove buses for thirty-one years. Then one Tuesday my right arm stopped being mine.",
      "In hospital I kept looking at my hand on the blanket. I told it to move. It just lay there, like something left behind by another patient.",
      "The first weeks at home were the worst. Not the arm. The tiredness. I would get dressed and need to lie down. My wife thought I had given up. I thought so too, some days.",
      "My physio gave me one job. Slide a cloth across the kitchen table. Forward and back, twenty times, three times a day. I felt ridiculous. A grown man polishing a clean table.",
      "For five weeks nothing changed that I could see. Then one morning my fingers closed round the cloth on their own. I shouted so loud the dog barked.",
      "After that I started noticing the small things. Holding the toothpaste. Turning a key. In March I buttered my own toast, and I stood at the counter and cried. I cry easily now. They tell me that is the stroke as well. I have stopped apologising for it.",
      "I am not who I was. My right hand is slower and it tires first. But last week I tied my grandson's shoelace. It took three goes and he waited for me, which is more than I can say for most passengers.",
    ],
    helped: [
      "Doing the boring exercise anyway, three times a day, before I felt like it.",
      "Writing down one thing each week that I could not do the week before.",
      "Telling people the crying was part of the stroke, so nobody had to tiptoe round it.",
    ],
  },
  {
    id: "lin",
    voice: "survivor",
    name: "Lin",
    who: "47, a year after her stroke",
    pronoun: "her",
    tint: { background: "#ece7f5", ink: "#5a4a86" },
    quote: "I knew the word. It was behind glass.",
    paragraphs: [
      "I teach primary school. Words are my whole job. After the stroke I woke up and could not say my daughter's name.",
      "I knew it. That is what people do not understand. I could see her name in my head. It was behind glass, and I could not reach through.",
      "People started speaking to me slowly and loudly, as if I had become a child. One nurse did not. She sat down, looked at me, and waited. I have never been so grateful for silence.",
      "My speech therapist had me name pictures. Cup. Key. Dog. I got four out of ten and went home furious. My husband said, four more than last month. I threw a cushion at him. He was right.",
      "We found ways round it. If I lost a word, I drew it on the back of an envelope, or said what it was for. The thing you open the door with. Sometimes the word came while I was describing it, as if I had crept up on it.",
      "The television had to go off when we talked. Phone calls were the hardest, and still are. I text now, and I have stopped pretending otherwise.",
      "In the spring I read my daughter a bedtime story for the first time since. It took twenty minutes to read six pages. She did not hurry me once. At the end she said, again. So we read it again.",
    ],
    helped: [
      "People who waited, instead of finishing my sentences.",
      "Drawing it, pointing to it, or describing it when the word would not come.",
      "Turning off the background noise before trying to talk.",
    ],
  },
  {
    id: "margaret",
    voice: "carer",
    name: "Margaret",
    who: "68, caring for her husband Alan",
    pronoun: "her",
    tint: { background: "#e3efe6", ink: "#285b49" },
    alsoNamed: ["Alan"],
    quote: "Nobody tells you that you are recovering too.",
    paragraphs: [
      "Everyone asked how Alan was. For four months, nobody asked how I was. I am not complaining. I did not ask myself either.",
      "He came home after five weeks. I had a folder of leaflets and no idea what I was doing. I was his wife on the Monday and his nurse by the Friday.",
      "I did everything for him. Buttons, shoes, cutting up his dinner. It was quicker, and I could not bear to watch him struggle. Then his occupational therapist said something that stung. She said, every button you do for him is one he does not practise.",
      "So I learned to sit on my hands. It is the hardest thing I have ever done. It took him eleven minutes to do up a shirt, and I stood in the hall so he would not see my face.",
      "I was so tired I cried in the supermarket, by the tinned tomatoes. That was when I rang the council and asked for a carer's assessment. I should have done it in the first week. I also told my GP I was a carer, which I had not known you could do.",
      "Now our daughter comes on Thursdays, and I go swimming. I felt guilty for the first month. I do not any more. I come back kinder.",
      "Alan does his own buttons now. It takes four minutes. He times himself, and he tells me the score.",
    ],
    helped: [
      "Asking the council for a carer's assessment, and telling my GP I was a carer.",
      "One afternoon a week that is mine, without apologising for it.",
      "Letting him do the slow thing himself, even when it hurt to watch.",
    ],
  },
  {
    id: "jo",
    voice: "carer",
    name: "Jo",
    who: "34, looking after his mum Anne",
    pronoun: "his",
    tint: { background: "#f6ecc9", ink: "#7a5c14" },
    alsoNamed: ["Anne"],
    quote: "I learned to count to ten before I helped.",
    paragraphs: [
      "Mum had her stroke two days after my thirty-third birthday. I moved back into my old bedroom with a laptop and a bag of clothes. I thought it would be for a fortnight.",
      "She could not find her words, and her left side was weak. I could not find my patience. I am not proud of that. I would ask a question, wait about two seconds, and answer it for her.",
      "One evening she banged the table with her good hand. She pointed at me, and then at her own mouth. It took me a minute. She meant, let me. I felt about nine years old.",
      "After that I counted. Ask the question, then count to ten in my head before saying anything. Ten seconds is a very long time when you are doing it properly. Most of the time, the word came at about seven.",
      "We worked out a system for bad days. A notepad on the table, and she draws. Her cat looks like a potato with ears. We have laughed more over that notepad than we had in years.",
      "I do get angry. Not at her. At the forms, and at the friends who stopped calling. I talk to another carer online most weeks. She is two years ahead of me, and she tells me which bits get easier.",
      "Mum made me a cup of tea last month. Left hand on the counter to steady herself, right hand on the kettle. It was far too strong. I drank every drop.",
    ],
    helped: [
      "Counting to ten before stepping in. Most of the time she got there first.",
      "A notepad on the table for the days when the words would not come.",
      "Talking to someone who is further down the same road.",
    ],
  },
];
