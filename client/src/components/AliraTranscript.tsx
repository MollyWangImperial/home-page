import { Fragment, useLayoutEffect, useState, type ReactElement, type ReactNode } from "react";
import { EMPTY_TRANSCRIPT_POSITIONS, orderedTranscript, placeTranscriptCards, type TranscriptPositions } from "@/lib/alira-transcript";

/** Cards keep their original place while their content and actions still use the current conversation state. */
export default function AliraTranscript({ messages, cards, initialPositions = EMPTY_TRANSCRIPT_POSITIONS, onPositionsChange }: {
  messages: readonly { id: number; node: ReactNode }[];
  cards: readonly ReactElement[];
  initialPositions?: TranscriptPositions;
  onPositionsChange?: (positions: TranscriptPositions) => void;
}) {
  const messageIds = messages.map(message => message.id);
  const cardIds = cards.map(card => String(card.key));
  const [positions, setPositions] = useState(() => placeTranscriptCards(initialPositions, messageIds, cardIds));
  const currentPositions = placeTranscriptCards(positions, messageIds, cardIds);
  // Derive positions before rendering children, so a new card never flashes below later messages.
  if (currentPositions !== positions) setPositions(currentPositions);
  useLayoutEffect(() => { onPositionsChange?.(currentPositions); }, [currentPositions, onPositionsChange]);
  const messageNodes = new Map(messages.map(message => [message.id, message.node]));
  const cardNodes = new Map(cards.map(card => [String(card.key), card]));

  return <div className="ao-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages with Alira">
    {orderedTranscript(messageIds, currentPositions, cardIds).map(entry => (
      <Fragment key={`${entry.kind}-${entry.id}`}>
        {entry.kind === "message" ? messageNodes.get(entry.id) : cardNodes.get(entry.id)}
      </Fragment>
    ))}
  </div>;
}
