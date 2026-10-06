import { describe, expect, it } from "vitest";
import { STORIES_NOTE, storyNote, survivorStories, type SurvivorStory } from "@/content/my-time-stories";
import {
  countWord,
  filterCounts,
  filterSummary,
  inFilter,
  listenProgress,
  nextLabel,
  nextStory,
  paragraphAt,
  readingOrder,
  storyNarration,
  storyOpening,
} from "./stories-model";

const story = (id: string): SurvivorStory => {
  const found = survivorStories.find(candidate => candidate.id === id);
  if (!found) throw new Error(`No story called ${id}`);
  return found;
};

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(one: string, two: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(at => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe("The stories list", () => {
  it("counts each filter from the stories themselves", () => {
    const counts = filterCounts(survivorStories);
    expect(counts).toEqual({ all: 4, survivor: 2, carer: 2 });
    expect(filterCounts([])).toEqual({ all: 0, survivor: 0, carer: 0 });
    expect(filterCounts([story("lin"), story("david"), story("jo")])).toEqual({ all: 3, survivor: 2, carer: 1 });
    expect(survivorStories.filter(item => inFilter("carer", item)).map(item => item.id)).toEqual(["margaret", "jo"]);
    expect(survivorStories.filter(item => inFilter("survivor", item)).map(item => item.id)).toEqual(["david", "lin"]);
    expect(survivorStories.filter(item => inFilter("all", item))).toHaveLength(4);
    expect(filterSummary("all", counts)).toBe("Showing all four stories.");
    expect(filterSummary("survivor", counts)).toBe("Showing two stories from survivors.");
    expect(filterSummary("carer", { all: 1, survivor: 0, carer: 1 })).toBe("Showing one story from carers.");
  });

  it("opens each card with the first lines of the story, in whole sentences", () => {
    expect(storyOpening(story("david"))).toBe("I drove buses for thirty-one years. Then one Tuesday my right arm stopped being mine. In hospital I kept looking at my hand on the blanket.");
    expect(storyOpening(story("lin"))).toBe("I teach primary school. Words are my whole job. After the stroke I woke up and could not say my daughter's name.");
    expect(storyOpening(story("margaret"))).toBe("Everyone asked how Alan was. For four months, nobody asked how I was. I am not complaining. I did not ask myself either.");
    expect(storyOpening(story("jo"))).toBe("Mum had her stroke two days after my thirty-third birthday. I moved back into my old bedroom with a laptop and a bag of clothes.");
    for (const item of survivorStories) {
      const opening = storyOpening(item);
      expect(item.paragraphs.join(" ").startsWith(opening), item.id).toBe(true);
      expect(opening.length, item.id).toBeLessThanOrEqual(150);
      expect(opening, item.id).toMatch(/[.!?]["”’)]*$/);
    }
    // A first sentence longer than the limit is still shown whole.
    const long = { ...story("david"), paragraphs: [`${"Very ".repeat(40)}long.`, "Second."] };
    expect(storyOpening(long)).toBe(long.paragraphs[0]);
  });

  it("gives every person their own readable colours and a pronoun", () => {
    for (const item of survivorStories) {
      expect(item.pronoun, item.id).toMatch(/^(his|her|their)$/);
      expect(item.tint?.background, item.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(item.tint?.ink, item.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(item.tint!.ink, item.tint!.background), item.id).toBeGreaterThanOrEqual(4.5);
    }
    expect(new Set(survivorStories.map(item => item.tint?.background)).size).toBe(survivorStories.length);
    expect(story("david").pronoun).toBe("his");
    expect(story("lin").pronoun).toBe("her");
  });

  it("keeps light words on the green panels readable", () => {
    const green = "#285b49";
    for (const ink of ["#fffefa", "#cfe0d5", "#dbe8df", "#f1cf7a"]) expect(contrast(ink, green), ink).toBeGreaterThanOrEqual(4.5);
    // The hero's SURVIVOR / CARER pill.
    expect(contrast("#f1cf7a", "#1c4538")).toBeGreaterThanOrEqual(4.5);
    // Small grey words on the cards and the page.
    for (const ink of ["#597066", "#4c6157", "#83533d"]) {
      expect(contrast(ink, "#fffefa"), ink).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink, "#f7f6f2"), ink).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Reading a story", () => {
  it("offers the other side next, and reaches every story before coming round again", () => {
    expect(readingOrder(survivorStories).map(item => item.id)).toEqual(["david", "margaret", "lin", "jo"]);
    let current = story("david");
    const seen: string[] = [];
    for (let step = 0; step < survivorStories.length; step += 1) {
      const next = nextStory(survivorStories, current.id);
      expect(next.voice, `after ${current.id}`).not.toBe(current.voice);
      seen.push(next.id);
      current = next;
    }
    expect(new Set(seen).size).toBe(survivorStories.length);
    expect(current.id).toBe("david");
    expect(nextLabel(nextStory(survivorStories, "david"))).toBe("Next, from a carer");
    expect(nextLabel(nextStory(survivorStories, "margaret"))).toBe("Next, from a survivor");
    expect(nextStory(survivorStories, "somebody else").id).toBe("david");
  });

  it("keeps going when one side has more stories than the other", () => {
    const uneven = [story("david"), story("lin"), story("margaret")];
    expect(readingOrder(uneven).map(item => item.id)).toEqual(["david", "margaret", "lin"]);
    expect(nextStory(uneven, "lin").id).toBe("david");
  });

  it("reads every sentence of the story, and knows which paragraph each one is in", () => {
    for (const item of survivorStories) {
      const narration = storyNarration(item.paragraphs);
      expect(narration.paragraphOf).toHaveLength(narration.lines.length);
      item.paragraphs.forEach((paragraph, index) => {
        expect(narration.lines.filter((_, at) => narration.paragraphOf[at] === index).join(" "), `${item.id} ${index}`).toBe(paragraph);
      });
      expect(paragraphAt(narration, -1)).toBe(-1);
      expect(paragraphAt(narration, 0)).toBe(0);
      expect(paragraphAt(narration, narration.lines.length - 1)).toBe(item.paragraphs.length - 1);
      expect(paragraphAt(narration, narration.lines.length)).toBe(-1);
    }
    // David's third sentence opens his second paragraph: "Part 2 of 7".
    const david = storyNarration(story("david").paragraphs);
    expect(david.lines[2]).toBe("In hospital I kept looking at my hand on the blanket.");
    expect(paragraphAt(david, 2) + 1).toBe(2);
    expect(story("david").paragraphs).toHaveLength(7);
  });

  it("fills the progress bar up to the sentence being read", () => {
    expect(listenProgress(-1, 30, false)).toBe(0);
    expect(listenProgress(-1, 30, true)).toBe(100);
    expect(listenProgress(0, 4, false)).toBe(25);
    expect(listenProgress(3, 4, false)).toBe(100);
    expect(listenProgress(9, 4, false)).toBe(100);
    expect(listenProgress(0, 0, false)).toBe(0);
  });

  it("explains that the stories combine shared experiences, naming the fictional characters", () => {
    for (const item of survivorStories) {
      const note = storyNote(item);
      expect(note, item.id).toMatch(/^This story was created for Rehyn by combining experiences/);
      expect(note, item.id).toMatch(/fictional characters?\.$/);
      expect(note, item.id).toContain(item.name);
    }
    expect(storyNote(story("david"))).toBe("This story was created for Rehyn by combining experiences commonly described by stroke survivors on similar recovery journeys. David is a fictional character.");
    expect(storyNote(story("margaret"))).toBe("This story was created for Rehyn by combining experiences commonly described by carers of stroke survivors on similar recovery journeys. Margaret and Alan are fictional characters.");
    expect(storyNote(story("jo"))).toMatch(/Jo and Anne are fictional characters\.$/);
    expect(storyNote({ ...story("jo"), alsoNamed: ["Anne", "Sam"] })).toMatch(/Jo, Anne and Sam are fictional characters\.$/);
    expect(STORIES_NOTE).toMatch(/combining experiences/);
  });

  it("writes small counts as words", () => {
    expect(countWord(4)).toBe("four");
    expect(countWord(1)).toBe("one");
    expect(countWord(25)).toBe("25");
  });
});
