import { describe, expect, it } from "vitest";
import { blankCommunityMemory, defaultCommunitySettings, LIMITS, type CommunitySettings } from "@/lib/community-store";
import {
  breakHint,
  breakNow,
  cardLine,
  cardNote,
  dayLabel,
  hiddenWordProblem,
  nextSuggestedWord,
  quietEdges,
  quietHint,
  sampleLine,
  settingsSummaries,
  stepQuietFrom,
  townHint,
  typedWord,
} from "./settings-model";

// Tuesday 6 October 2026, midday, on this device's clock.
const NOW = new Date(2026, 9, 6, 12, 0).getTime();
const DAY = 86_400_000;
const settings = (patch: Partial<CommunitySettings> = {}): CommunitySettings => ({ ...defaultCommunitySettings(), ...patch });

describe("Community settings: the line under each section", () => {
  it("sums up the settings as they start", () => {
    expect(settingsSummaries(settings(), "", NOW)).toEqual({
      appear: ["No town added", "online dot on", "drawn face"],
      friends: ["Requests from everyone", "messages from friends only"],
      see: ["Gentle mode on", "2 hidden words"],
      read: ["Read aloud off", "normal text"],
      quiet: ["Quiet from 9 pm to 8 am"],
    });
  });

  it("follows each change", () => {
    const changed = settings({
      showTown: false, showOnline: false, picture: "initial", requestsFrom: "noOne", messagesFrom: "friendsAndGroups",
      gentleMode: false, hiddenWords: ["money"], readAloud: true, textSize: "bigger", quietFrom: 23, breakChoice: "week", breakUntil: NOW + 7 * DAY,
    });
    expect(settingsSummaries(changed, "Leeds", NOW)).toEqual({
      appear: ["Town hidden", "online dot off", "initial"],
      friends: ["No new requests", "messages from friends and groups"],
      see: ["Gentle mode off", "1 hidden word"],
      read: ["Read aloud on", "bigger text"],
      quiet: ["Quiet from 11 pm to 8 am", "on a break until 13 October"],
    });
    expect(settingsSummaries(settings({ hiddenWords: [], requestsFrom: "friendsOfFriends" }), "Leeds", NOW).see).toEqual(["Gentle mode on", "no hidden words"]);
    expect(settingsSummaries(settings({ requestsFrom: "friendsOfFriends" }), "Leeds", NOW).friends[0]).toBe("Requests from friends of friends");
    expect(settingsSummaries(settings(), "Leeds", NOW).appear[0]).toBe("Town shown");
  });
});

describe("Community settings: quiet time and breaks", () => {
  it("moves quiet time an hour at a time, between 7 pm and 11 pm", () => {
    expect(stepQuietFrom(21, -1)).toBe(20);
    expect(stepQuietFrom(21, 1)).toBe(22);
    expect(stepQuietFrom(19, -1)).toBe(19);
    expect(stepQuietFrom(23, 1)).toBe(23);
    expect(stepQuietFrom(5, 1)).toBe(21);
    expect(quietEdges(19)).toEqual({ earliest: true, latest: false });
    expect(quietEdges(23)).toEqual({ earliest: false, latest: true });
    expect(quietEdges(21)).toEqual({ earliest: false, latest: false });
  });

  it("says what quiet time and a break do, and nothing more", () => {
    expect(quietHint(settings(), new Date(NOW))).toBe("The Alerts badge stays quiet from 9 pm to 8 am");
    expect(quietHint(settings({ quietFrom: 19 }), new Date(NOW))).toBe("The Alerts badge stays quiet from 7 pm to 8 am");
    expect(quietHint(settings(), new Date(2026, 9, 6, 22, 15))).toBe("The Alerts badge stays quiet from 9 pm to 8 am. It's quiet time now.");
    expect(quietHint(settings({ quietFrom: 23 }), new Date(2026, 9, 6, 22, 15))).toBe("The Alerts badge stays quiet from 11 pm to 8 am");
    expect(breakHint(settings(), NOW)).toBe("During a break, the Alerts badge stays quiet. Nothing is deleted.");
    expect(breakHint(settings({ breakChoice: "day", breakUntil: NOW + DAY }), NOW)).toBe("The Alerts badge stays quiet until Wednesday 7 October. Nothing is deleted.");
    for (const text of [breakHint(settings(), NOW), quietHint(settings(), new Date(NOW))]) expect(text).not.toMatch(/friends see|told|notified/i);
  });

  it("treats a break that has ended as no break", () => {
    expect(breakNow(settings({ breakChoice: "week", breakUntil: NOW + DAY }), NOW)).toBe("week");
    expect(breakNow(settings({ breakChoice: "day", breakUntil: NOW - 1 }), NOW)).toBe("none");
    expect(breakNow(settings(), NOW)).toBe("none");
    expect(breakHint(settings({ breakChoice: "day", breakUntil: NOW - 1 }), NOW)).toBe("During a break, the Alerts badge stays quiet. Nothing is deleted.");
    expect(settingsSummaries(settings({ breakChoice: "day", breakUntil: NOW - 1 }), "", NOW).quiet).toEqual(["Quiet from 9 pm to 8 am"]);
  });

  it("names days on this device's calendar", () => {
    expect(dayLabel(new Date(2026, 9, 13, 9, 30).getTime())).toBe("13 October");
    expect(dayLabel(new Date(2026, 9, 13, 9, 30).getTime(), true)).toBe("Tuesday 13 October");
    expect(dayLabel(new Date(2027, 0, 1).getTime(), true)).toBe("Friday 1 January");
  });
});

describe("Community settings: the card preview", () => {
  it("puts the town (when shown), the groups and the friends under the name", () => {
    expect(cardLine(true, "Leeds", 4, 3)).toBe("Leeds · In 4 groups · 3 friends");
    expect(cardLine(false, "Leeds", 4, 3)).toBe("In 4 groups · 3 friends");
    expect(cardLine(true, "", 1, 1)).toBe("In 1 group · 1 friend");
    expect(cardLine(true, "", 0, 0)).toBe("No groups yet · No friends yet");
  });

  it("never invents a town, and keeps the card hypothetical", () => {
    expect(townHint("")).toBe("Your profile doesn't have a town yet.");
    expect(townHint("Leeds")).toBe("Puts “Leeds” under your name on your card");
    expect(townHint("")).not.toContain("Bristol");
    expect(cardNote("friends")).toBe("What other members would see when they tap your name. Only friends could message you.");
    expect(cardNote("friendsAndGroups")).toBe("What other members would see when they tap your name.");
  });

  it("takes the sample post from someone the person still sees, without a hidden word", () => {
    const memory = blankCommunityMemory();
    expect(sampleLine(memory)).toEqual({ who: "margaret", text: "First tomatoes off the windowsill!" });
    memory.blocks = { margaret: NOW };
    expect(sampleLine(memory).who).toBe("joan");
    memory.muted = { joan: NOW };
    expect(sampleLine(memory).who).toBe("david");
    const words = blankCommunityMemory();
    words.settings.hiddenWords = ["tomatoes", "cardigan", "biscuit"];
    expect(sampleLine(words)).toEqual({ who: null, text: "This is the size posts are in My community." });
  });
});

describe("Community settings: hidden words", () => {
  it("explains why a word can't be added", () => {
    expect(hiddenWordProblem("", [])).toBe("Write a word or a short phrase first.");
    expect(hiddenWordProblem("   ", [])).toBe("Write a word or a short phrase first.");
    expect(hiddenWordProblem("!!!", [])).toBe("Use letters and numbers. Spaces, apostrophes and hyphens are fine too.");
    expect(hiddenWordProblem("Hospital", ["hospital"])).toBe("Posts that mention “hospital” are already hidden.");
    const full = Array.from({ length: LIMITS.hiddenWords }, (_, index) => `word${index}`);
    expect(hiddenWordProblem("money", full)).toBe("You can hide up to 20 words. Remove one to add another.");
    expect(hiddenWordProblem("bad news", ["hospital"])).toBeNull();
  });

  it("accepts a curly apostrophe, as phones type it", () => {
    expect(typedWord("don’t")).toBe("don't");
    expect(hiddenWordProblem("don’t", [])).toBeNull();
    expect(hiddenWordProblem("Don’t", ["don't"])).toBe("Posts that mention “don't” are already hidden.");
  });

  it("offers the suggested words in turn, then any starting word taken off", () => {
    expect(nextSuggestedWord(["hospital", "falls"])).toBe("money");
    expect(nextSuggestedWord(["hospital", "falls", "money"])).toBe("cure");
    expect(nextSuggestedWord(["hospital", "money", "cure", "politics"])).toBe("falls");
    expect(nextSuggestedWord(["hospital", "falls", "money", "cure", "politics"])).toBeNull();
  });
});
