import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { PairCover, PairFace, type PairPicture } from "@/components/PairsArtwork";

const pictures: PairPicture[] = ["Leaf", "Sun", "Flower", "Butterfly", "Moon", "Shell"];
function makeDeck() {
  const deck = [...pictures, ...pictures];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export default function MemoryPairs() {
  const [tiles, setTiles] = useState(makeDeck);
  const [selected, setSelected] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [turns, setTurns] = useState(0);
  const [hintTile, setHintTile] = useState<number | null>(null);
  const lastHint = useRef<number | null>(null);
  const complete = matched.length === tiles.length;

  useEffect(() => {
    if (selected.length !== 2) return;
    const timer = window.setTimeout(() => {
      if (tiles[selected[0]] === tiles[selected[1]]) setMatched((current) => [...current, ...selected]);
      setSelected([]);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [selected, tiles]);

  useEffect(() => {
    setHintTile(null);
    if (selected.length || complete) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const available = tiles.map((_, index) => index).filter((index) => !matched.includes(index) && index !== lastHint.current);
      if (!available.length) return;
      const next = available[Math.floor(Math.random() * available.length)];
      lastHint.current = next;
      setHintTile(next);
    }, 4600);
    return () => window.clearInterval(timer);
  }, [matched, selected.length, complete, tiles]);

  const selectTile = (index: number) => {
    if (selected.includes(index) || matched.includes(index) || selected.length === 2) return;
    setSelected((current) => [...current, index]);
    if (selected.length === 1) setTurns((current) => current + 1);
  };
  const playAgain = () => {
    setSelected([]); setMatched([]); setTurns(0); setHintTile(null); setTiles(makeDeck());
  };

  return <section className="pairs-card" aria-labelledby="pairs-title">
    <div className="pairs-intro">
      <div><h2 id="pairs-title">A gentle game for a busy mind.</h2><p>Turn over two tiles to find a pair. No timer, and no way to lose.</p></div>
      <div className="pairs-stat"><span>Pairs found</span><b key={matched.length}>{matched.length / 2} of 6</b></div>
      <div className="pairs-stat"><span>Turns</span><b>{turns}</b></div>
    </div>
    <div className="pairs-grid" aria-label="Memory pairs game">
      {tiles.map((picture, index) => {
        const isMatched = matched.includes(index);
        const isVisible = selected.includes(index) || isMatched;
        return <button key={index} className={`${isVisible ? "is-open" : ""} ${isMatched ? "is-matched" : ""} ${!isVisible && hintTile === index ? "is-inviting" : ""}`} onClick={() => selectTile(index)} aria-disabled={isMatched || selected.includes(index) || selected.length === 2} aria-label={isVisible ? `Tile ${index + 1}: ${picture}${isMatched ? ", matched" : ""}` : `Hidden tile ${index + 1}`}>
          <span className="pair-tile-inner" aria-hidden="true">
            <span className="pair-tile-cover"><PairCover /></span>
            <span className="pair-tile-face"><PairFace picture={picture} />{isMatched && <i className="pair-match-check"><Check size={12} /></i>}</span>
          </span>
        </button>;
      })}
    </div>
    <div className="pairs-feedback" role="status">
      {complete ? <div className="pairs-complete"><span><Sparkles size={18} />All six pairs, beautifully found.</span><button onClick={playAgain}><RotateCcw size={14} /> Play again</button></div> : matched.length > 0 && <span key={matched.length}><Check size={14} />{matched.length / 2} {matched.length === 2 ? "pair" : "pairs"} found. Take your time.</span>}
    </div>
  </section>;
}
