import { describe, expect, it } from "vitest";
import { allMedals, earnedLabel, earnedMedals, findMedalGuide, medalGuides, withinReachNext } from "./medals";

describe("medals", () => {
  it("keeps every medal id unique", () => {
    const ids = allMedals.map(medal => medal.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every medal a guided next step with Alira", () => {
    for (const medal of allMedals) {
      const guide = medalGuides[medal.id];
      expect(guide.intro).toContain(medal.name);
      expect(guide.reply).not.toBe("");
      expect(guide.follow).not.toBe("");
      expect(guide.upNext).not.toBe("");
      if (guide.next.kind === "go") expect(guide.next.href.startsWith("/")).toBe(true);
    }
  });

  it("finds a medal's guide from the Alira link and ignores unknown ids", () => {
    expect(findMedalGuide("baseline")?.medal.name).toBe("Baseline Set");
    expect(findMedalGuide("baseline")?.next.kind).toBe("assessment");
    expect(findMedalGuide("not-a-medal")).toBeNull();
    expect(findMedalGuide(null)).toBeNull();
  });

  it("only offers medals not yet earned as within reach next", () => {
    const earned = new Set(earnedMedals.map(medal => medal.id));
    expect(withinReachNext.every(id => !earned.has(id))).toBe(true);
  });

  it("words when a medal was earned", () => {
    expect(earnedLabel("Today")).toBe("Earned today");
    expect(earnedLabel("8 Sep")).toBe("Earned on 8 Sep");
  });
});
