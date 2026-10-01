import { z } from "zod";
import type { StoredAssessment } from "./assessment";
import type { ExerciseCompletion } from "./exercise-completion";
import { placeTranscriptCards } from "./alira-transcript";

export const ALIRA_CHAT_KEY = "rehyn.alira.chat.v1";
const message = z.object({
  id: z.number().int().positive(), from: z.enum(["Alira", "you"]), text: z.string(),
  generated: z.boolean().optional(), localOnly: z.boolean().optional(),
});
const snapshot = z.object({
  version: z.literal(1), context: z.string(),
  messages: z.array(message).refine(messages => messages.every((item, index) => index === 0 || item.id > messages[index - 1].id)),
  presentation: z.object({
    chips: z.enum(["none", "intro", "intro2", "medal", "medalNext", "resume"]),
    started: z.boolean(), done: z.boolean(), qi: z.number().int().min(-1).max(11),
    showQ: z.boolean(), showDone: z.boolean(), showSteps: z.boolean(), paused: z.boolean(),
    sel: z.array(z.string()), otherOpen: z.boolean(), otherText: z.string(), draft: z.string(),
  }),
  positions: z.object({
    firstMessage: z.number().int().positive().nullable(),
    cards: z.array(z.object({ id: z.string().min(1), afterMessage: z.number().int().positive().nullable() })),
  }),
  scrollTop: z.number().finite().nonnegative(), warmUpDay: z.string().nullable(),
  planFailed: z.boolean(), planError: z.string(),
});
export type AliraChatSnapshot = z.infer<typeof snapshot>;
export type AliraChatSave = Omit<AliraChatSnapshot, "version" | "context">;

export function undeliveredArrivalMessages(messages: AliraChatSnapshot["messages"], expected: readonly string[]): string[] {
  return expected.filter(text => !messages.some(message => message.from === "Alira" && message.text === text));
}

/** A new assessment or exercise day is a new event; leaving and returning to the same event is not. */
export function aliraChatContext({ assessment, completion, medalId, day }: {
  assessment: Pick<StoredAssessment, "id" | "completedAt"> | null;
  completion: ExerciseCompletion | null;
  medalId?: string;
  day: string;
}): string {
  if (medalId) return `medal:${medalId}`;
  const result = assessment ? `${assessment.id}:${assessment.completedAt}` : "";
  if (completion) return `exercise:${result}:${day}:${completion.allDone ? "session" : completion.exerciseName}`;
  return assessment ? `assessment:${result}` : "survey";
}

type ChatStorage = Pick<Storage, "getItem" | "setItem">;
export function createAliraChatStore(storage: () => ChatStorage) {
  const fallback = new Map<string, AliraChatSnapshot>();
  const persisted = new Set<string>();
  const keyFor = (context: string) => `${ALIRA_CHAT_KEY}:${encodeURIComponent(context)}`;
  return {
    read(context: string): AliraChatSnapshot | null {
      let saved: AliraChatSnapshot | null;
      try {
        const raw = storage().getItem(keyFor(context));
        const parsed = raw === null ? null : snapshot.safeParse(JSON.parse(raw));
        saved = parsed?.success && parsed.data.context === context ? parsed.data : null;
        if (raw === null) persisted.delete(context);
        else persisted.add(context);
        fallback.delete(context); // A normal account reset must also clear any memory fallback.
      } catch { saved = fallback.get(context) ?? null; }
      if (!saved?.messages.length) return null;
      // Only message content is restored; animation timers and transient typing state are never saved.
      const ids = new Set(saved.messages.map(item => item.id));
      const seen = new Set<string>();
      const cards = saved.positions.cards.filter(card => {
        if (seen.has(card.id) || (card.afterMessage !== null && !ids.has(card.afterMessage))) return false;
        seen.add(card.id);
        return true;
      });
      const positions = placeTranscriptCards({ ...saved.positions, cards }, [...ids], []);
      return { ...saved, positions: { ...positions, cards: [...positions.cards] } };
    },
    save(context: string, chat: AliraChatSave): void {
      const parsed = snapshot.safeParse({ ...chat, version: 1, context });
      if (!parsed.success) return;
      try {
        const disk = storage();
        // Account reset clears these keys before pagehide/unmount. A late save must not recreate them.
        if (persisted.has(context) && disk.getItem(keyFor(context)) === null) { fallback.delete(context); return; }
        disk.setItem(keyFor(context), JSON.stringify(parsed.data));
        persisted.add(context);
        fallback.delete(context);
      } catch { fallback.set(context, parsed.data); }
    },
  };
}

export const aliraChatStore = createAliraChatStore(() => localStorage);
