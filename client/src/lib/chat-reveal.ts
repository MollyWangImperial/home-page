/** Reveal one Unicode character per tick; cancellation also cancels completion. */
export function revealCharacters(text: string, onFrame: (text: string) => void, onComplete: () => void, delayMs = 12): () => void {
  const characters = Array.from(text);
  let position = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    if (cancelled) return;
    position += 1;
    onFrame(characters.slice(0, position).join(""));
    if (position >= characters.length) onComplete();
    else timer = setTimeout(tick, delayMs);
  };
  timer = setTimeout(tick, delayMs);
  return () => { cancelled = true; clearTimeout(timer); };
}
