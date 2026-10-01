import { describe, expect, it } from "vitest";
import { ALIRA_CHAT_KEY, aliraChatContext, createAliraChatStore, undeliveredArrivalMessages, type AliraChatSave } from "./alira-chat-history";
import { orderedTranscript } from "./alira-transcript";
import { createAccountResetStore } from "./account-reset";

function storage() {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
const chat = (): AliraChatSave => ({
  messages: [
    { id: 1, from: "Alira", text: "Your plan is ready", localOnly: true },
    { id: 4, from: "you", text: "How long does it take?" },
    { id: 6, from: "Alira", text: "A few minutes.", generated: true },
  ],
  presentation: { chips: "none", started: true, done: true, qi: -1, showQ: false, showDone: false,
    showSteps: false, paused: false, sel: [], otherOpen: false, otherText: "", draft: "Another question" },
  positions: { firstMessage: 1, cards: [{ id: "plan-ready", afterMessage: 1 }] },
  scrollTop: 125, warmUpDay: null, planFailed: false, planError: "",
});

describe("saved Alira conversation", () => {
  it("restores the exact messages, draft, scroll position, and card order across store instances", () => {
    const disk = storage();
    createAliraChatStore(() => disk).save("assessment:one", chat());
    const saved = createAliraChatStore(() => disk).read("assessment:one")!;
    expect(saved.messages).toEqual(chat().messages);
    expect(saved.presentation).toEqual(chat().presentation);
    expect(saved.scrollTop).toBe(125);
    expect(orderedTranscript(saved.messages.map(message => message.id), saved.positions, ["plan-ready"])).toEqual([
      { kind: "message", id: 1 }, { kind: "card", id: "plan-ready" }, { kind: "message", id: 4 }, { kind: "message", id: 6 },
    ]);
  });

  it("saves delivered text without character animations or transient typing state", () => {
    const disk = storage();
    const save = { ...chat(), messages: [{ id: 1, from: "Alira" as const, text: "Hello", chars: [{ ch: "H", d: 0 }] }], typing: true, typingId: 1 };
    const store = createAliraChatStore(() => disk);
    store.save("survey", save);
    const saved = store.read("survey")!;
    expect(saved.messages).toEqual([{ id: 1, from: "Alira", text: "Hello" }]);
    expect(JSON.stringify(saved)).not.toMatch(/chars|typingId|"typing"/);
  });

  it("finishes only the undelivered part of an interrupted arrival", () => {
    const messages = [{ id: 1, from: "Alira" as const, text: "Congratulations" }, { id: 2, from: "you" as const, text: "Rest well" }];
    expect(undeliveredArrivalMessages(messages, ["Congratulations", "Rest well"])).toEqual(["Rest well"]);
    expect(undeliveredArrivalMessages([...messages, { id: 3, from: "Alira", text: "Rest well" }], ["Congratulations", "Rest well"])).toEqual([]);
  });

  it("keeps assessment, survey, and medal conversations separate", () => {
    const disk = storage();
    const sameDisk = createAliraChatStore(() => disk);
    sameDisk.save("survey", chat());
    sameDisk.save("medal:one", { ...chat(), messages: [{ id: 1, from: "Alira", text: "A medal invitation" }] });
    expect(sameDisk.read("survey")?.messages).toEqual(chat().messages);
    expect(sameDisk.read("medal:one")?.messages[0].text).toBe("A medal invitation");
    expect(sameDisk.read("assessment:new")).toBeNull();
  });

  it("uses the same event on a return but a new event for a new assessment or exercise day", () => {
    const assessment = { id: "one", completedAt: "2026-10-01T10:00:00Z" };
    const base = { assessment, completion: null, day: "2026-10-01" };
    expect(aliraChatContext(base)).toBe(aliraChatContext({ ...base, day: "2026-10-02" }));
    expect(aliraChatContext({ ...base, assessment: { ...assessment, completedAt: "2026-10-02T10:00:00Z" } })).not.toBe(aliraChatContext(base));
    const completed = { ...base, completion: { exerciseName: "Reach", allDone: true } };
    expect(aliraChatContext(completed)).toBe(aliraChatContext({ ...completed, completion: { exerciseName: null, allDone: true } }));
    expect(aliraChatContext(completed)).not.toBe(aliraChatContext({ ...completed, day: "2026-10-02" }));
    expect(aliraChatContext({ ...completed, completion: { exerciseName: "Reach", allDone: false } })).not.toBe(aliraChatContext(completed));
  });

  it("rejects malformed, mismatched, and duplicate-id history", () => {
    const disk = storage();
    const key = `${ALIRA_CHAT_KEY}:survey`;
    const store = createAliraChatStore(() => disk);
    for (const raw of ["broken json", "null", JSON.stringify({ ...chat(), version: 1, context: "other" }),
      JSON.stringify({ ...chat(), version: 1, context: "survey", messages: [{ id: 1, from: "Alira", text: "a" }, { id: 1, from: "you", text: "b" }] })]) {
      disk.setItem(key, raw);
      expect(store.read("survey")).toBeNull();
    }
  });

  it("drops orphan and duplicate card anchors while preserving valid messages", () => {
    const disk = storage();
    const store = createAliraChatStore(() => disk);
    store.save("survey", { ...chat(), positions: { firstMessage: 1, cards: [
      { id: "plan-ready", afterMessage: 1 }, { id: "plan-ready", afterMessage: 4 }, { id: "old", afterMessage: 99 },
    ] } });
    expect(store.read("survey")?.positions.cards).toEqual([{ id: "plan-ready", afterMessage: 1 }]);
  });

  it("retains same-tab history when browser storage is unavailable", () => {
    const store = createAliraChatStore(() => { throw new Error("Blocked storage"); });
    expect(store.read("survey")).toBeNull();
    expect(() => store.save("survey", chat())).not.toThrow();
    expect(store.read("survey")?.messages).toEqual(chat().messages);
    expect(store.read("other")).toBeNull();
  });

  it("includes history in account reset and prevents a late cleanup save from restoring it", () => {
    const disk = storage();
    const store = createAliraChatStore(() => disk);
    store.save("survey", chat());
    disk.setItem("other.app", "keep");
    const reset = createAccountResetStore(() => ({ local: disk, session: storage() }));
    expect(reset.reset()).toBe(true);
    store.save("survey", chat()); // pagehide from the departing Alira page
    expect(store.read("survey")).toBeNull();
    expect(disk.getItem("other.app")).toBe("keep");
    store.save("survey", { ...chat(), messages: [{ id: 1, from: "Alira", text: "Fresh welcome" }] });
    expect(store.read("survey")?.messages[0].text).toBe("Fresh welcome");
  });

  it("keeps an interrupted-plan error for an explicit retry instead of replaying the opening", () => {
    const disk = storage();
    const store = createAliraChatStore(() => disk);
    store.save("assessment:one", { ...chat(), planFailed: true, planError: "Please try preparing your plan again." });
    expect(store.read("assessment:one")?.planFailed).toBe(true);
    expect(store.read("assessment:one")?.planError).toBe("Please try preparing your plan again.");
  });
});
