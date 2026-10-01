export type CardPosition = { id: string; afterMessage: number | null };
export type TranscriptPositions = { firstMessage: number | null; cards: readonly CardPosition[] };
export type TranscriptEntry = { kind: "message"; id: number } | { kind: "card"; id: string };

export const EMPTY_TRANSCRIPT_POSITIONS: TranscriptPositions = { firstMessage: null, cards: [] };

/** A card belongs after the last message present when it first appears, including after a temporary hide. */
export function placeTranscriptCards(previous: TranscriptPositions, messageIds: readonly number[], cardIds: readonly string[]): TranscriptPositions {
  const firstMessage = messageIds[0] ?? null;
  // Replaying the welcome or starting a new completion chat clears the old transcript.
  const reset = previous.firstMessage !== null && previous.firstMessage !== firstMessage;
  const cards = reset ? [] : previous.cards;
  const known = new Set(cards.map(card => card.id));
  const added: CardPosition[] = [];
  for (const id of cardIds) {
    if (known.has(id)) continue;
    known.add(id);
    added.push({ id, afterMessage: messageIds.at(-1) ?? null });
  }
  if (!reset && firstMessage === previous.firstMessage && !added.length) return previous;
  return { firstMessage, cards: [...cards, ...added] };
}

/** Interleave current cards with messages; typing indicators can follow the resulting transcript. */
export function orderedTranscript(messageIds: readonly number[], positions: TranscriptPositions, visibleCardIds: readonly string[]): TranscriptEntry[] {
  const visible = new Set(visibleCardIds);
  const cardsAfter = new Map<number | null, TranscriptEntry[]>();
  for (const card of positions.cards) {
    if (!visible.has(card.id)) continue;
    const entries = cardsAfter.get(card.afterMessage) ?? [];
    entries.push({ kind: "card", id: card.id });
    cardsAfter.set(card.afterMessage, entries);
  }
  return [
    ...(cardsAfter.get(null) ?? []),
    ...messageIds.flatMap(id => [{ kind: "message" as const, id }, ...(cardsAfter.get(id) ?? [])]),
  ];
}
