import type { StoryVoice, SurvivorStory } from "@/content/my-time-stories";
import { splitSentences } from "@/lib/alira-read-aloud";

// The small decisions behind Stories, kept apart from the page so they can be tested: what each
// filter holds, which story comes next, the sentences a story is read aloud in (and the paragraph
// each one belongs to), and the opening lines shown on each card.

export type StoryFilter = "all" | StoryVoice;

export const storyFilters: { value: StoryFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "survivor", label: "Survivors" },
  { value: "carer", label: "Carers" },
];

export const inFilter = (filter: StoryFilter, story: SurvivorStory) => filter === "all" || story.voice === filter;

/** How many stories each filter holds, for the counts on the filter buttons. */
export function filterCounts(stories: SurvivorStory[]): Record<StoryFilter, number> {
  const counts: Record<StoryFilter, number> = { all: 0, survivor: 0, carer: 0 };
  for (const story of stories) {
    counts.all += 1;
    counts[story.voice] += 1;
  }
  return counts;
}

const numberWords = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** A small number written as a word, as it reads in a sentence: "all four stories". */
export const countWord = (count: number) => numberWords[count] ?? String(count);
export const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "David’s", "Margaret’s". */
export const possessive = (name: string) => `${name}’s`;

/** What a screen reader hears after a filter is chosen. */
export function filterSummary(filter: StoryFilter, counts: Record<StoryFilter, number>): string {
  const count = counts[filter];
  const stories = count === 1 ? "story" : "stories";
  if (filter === "all") return `Showing all ${countWord(count)} ${stories}.`;
  return `Showing ${countWord(count)} ${stories} from ${filter === "survivor" ? "survivors" : "carers"}.`;
}

/**
 * The order "Next" walks through: a survivor, then a carer, then the next survivor, and so on,
 * so both sides are heard and every story is reached. Leftovers of one side come at the end.
 */
export function readingOrder(stories: SurvivorStory[]): SurvivorStory[] {
  const survivors = stories.filter(story => story.voice === "survivor");
  const carers = stories.filter(story => story.voice === "carer");
  const order: SurvivorStory[] = [];
  for (let index = 0; index < Math.max(survivors.length, carers.length); index += 1) {
    if (survivors[index]) order.push(survivors[index]);
    if (carers[index]) order.push(carers[index]);
  }
  return order;
}

/** The story offered after this one: the next in the reading order, round to the start again. */
export function nextStory(stories: SurvivorStory[], id: string): SurvivorStory {
  const order = readingOrder(stories);
  const at = order.findIndex(story => story.id === id);
  return order[(at + 1) % order.length];
}

/** "Next, from a carer" or "Next, from a survivor". */
export const nextLabel = (story: SurvivorStory) => `Next, from a ${story.voice}`;

/** A story as Alira reads it: one sentence at a time, each knowing the paragraph it belongs to. */
export type StoryNarration = { lines: string[]; paragraphOf: number[] };

export function storyNarration(paragraphs: string[]): StoryNarration {
  const lines: string[] = [];
  const paragraphOf: number[] = [];
  paragraphs.forEach((paragraph, index) => {
    for (const sentence of splitSentences(paragraph)) {
      lines.push(sentence);
      paragraphOf.push(index);
    }
  });
  return { lines, paragraphOf };
}

/** The paragraph that holds sentence `sentence`, or -1 when nothing is being read. */
export const paragraphAt = (narration: StoryNarration, sentence: number) => (sentence >= 0 ? narration.paragraphOf[sentence] ?? -1 : -1);

/** How far through the reading is, in percent: up to and including the sentence being read. */
export function listenProgress(sentence: number, total: number, done: boolean): number {
  if (done) return 100;
  if (sentence < 0 || total <= 0) return 0;
  return Math.round((Math.min(sentence + 1, total) / total) * 100);
}

/**
 * The first lines of a story, for its card: whole sentences, at most `most` characters, and no
 * further than the end of a paragraph once there are `enough` characters to set the scene.
 */
export function storyOpening(story: SurvivorStory, most = 150, enough = 100): string {
  const taken: string[] = [];
  let length = 0;
  for (const paragraph of story.paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      const longer = length + (taken.length ? 1 : 0) + sentence.length;
      if (taken.length && longer > most) return taken.join(" ");
      taken.push(sentence);
      length = longer;
    }
    if (length >= enough) break;
  }
  return taken.join(" ");
}
