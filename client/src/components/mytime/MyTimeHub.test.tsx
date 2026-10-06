import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { learnArticles } from "@/content/my-time-learn";
import { survivorStories } from "@/content/my-time-stories";
import { alsoAsked, countWord, doorTurn, HUB_LEARN_TURN, HUB_STORY_TURN } from "@/lib/my-time";
import MyTimeHub, { type MyTimeHubProps } from "./MyTimeHub";

const article = learnArticles.find(item => item.id === "fatigue")!;
const story = survivorStories.find(item => item.id === "david")!;
const props: MyTimeHubProps = {
  suggestion: { id: "story", line: "Evening already. Shall we read a little?" },
  article,
  story,
  alsoAsked: alsoAsked(learnArticles, article.id, []),
  articles: doorTurn(learnArticles, HUB_LEARN_TURN, article.id),
  stories: doorTurn(survivorStories, HUB_STORY_TURN, story.id),
  onGo: vi.fn(),
};
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("The front of My Time", () => {
  const html = renderToStaticMarkup(createElement(MyTimeHub, props));
  const doors = html.slice(0, html.indexOf('class="mytime-phone-hub"'));
  const phone = html.slice(html.indexOf('class="mytime-phone-hub"'));

  it("opens three doors, two of them turning through three things each, quietly", () => {
    expect(count(doors, /class="hub-card /g)).toBe(3);
    expect(count(doors, /aria-live="off"/g)).toBe(2);
    expect(count(doors, /class="hub-turn-item[ "]/g)).toBe(6);
    expect(count(doors, /class="hub-turn-item is-shown"/g)).toBe(2);
    for (const id of HUB_LEARN_TURN) expect(doors).toContain(`hub-glyph-${id}`);
    for (const name of ["David", "Margaret", "Lin"]) expect(doors).toContain(`>${name}</b>`);
  });

  it("acts only through its buttons, which say what they open", () => {
    expect(doors).not.toMatch(/<a /);
    expect(doors).toContain("Open Story");
    expect(doors).toContain('aria-describedby="hub-question-fatigue"');
    expect(doors).toContain("Read the answer");
    expect(doors).toContain('aria-describedby="hub-voice-david"');
    expect(doors).toContain("Read the story");
    expect(doors).toContain("min read · Alira can read it to you");
    expect(doors).not.toContain("survivor&#x27;s story");
  });

  it("floats five activities round the one suggested for now", () => {
    expect(count(doors, /class="hub-cluster-\d"/g)).toBe(5);
    expect(doors).toContain('class="hub-cluster-main"');
  });

  it("gives a phone an accordion of real buttons, with the first panel open", () => {
    expect(count(phone, /aria-expanded="true"/g)).toBe(1);
    expect(count(phone, /aria-expanded="false"/g)).toBe(2);
    for (const id of ["play", "learn", "stories"]) {
      expect(phone).toContain(`aria-controls="phone-${id}-body"`);
      expect(phone).toContain(`id="phone-${id}-body"`);
    }
    expect(phone).toMatch(/class="phone-panel phone-play is-open"/);
  });

  it("puts today's question, other questions, and today's story behind the phone's doors", () => {
    expect(phone).toContain("Today&#x27;s question · Energy");
    expect(phone).toContain(article.question);
    expect(count(phone, /class="phone-also-item[ "]/g)).toBe(3);
    expect(phone).not.toContain(`phone-also-item is-shown"><span>${article.question}`);
    expect(phone).toContain("Read or listen");
    expect(phone).toContain(`All ${countWord(learnArticles.length)} questions`);
    expect(phone).toContain("Touch the water");
    expect(phone).toContain("How this helps.</b> Reaching out to touch a spot is gentle, unhurried practice in aiming your hand.<");
    // The phone says "Read his story", as the design does; the byline beside it names him.
    expect(phone).toContain("Read his story");
    expect(phone).toContain(`All ${countWord(survivorStories.length)} stories`);
    expect(phone).toMatch(/>David<\/b>, 63<br[^>]*\/>Eight months after his stroke/);
  });
});
