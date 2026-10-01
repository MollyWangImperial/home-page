import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import MedalArtwork from "@/components/MedalArtwork";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  allMedals,
  earnedLabel,
  earnedMedals,
  findMedal,
  medalCategories,
  medalGuides,
  withinReachNext,
  type EarnedMedal,
  type MedalId,
  type MedalWithCategory,
} from "@/lib/medals";
import "./medal-collection.css";

const SHAKE_EVERY_MS = 2600;

type MedalCollectionProps = {
  earned?: EarnedMedal[];
  reachNext?: MedalId[];
};

// The Medals tab (design canvas, board A · Start here): every medal shown by icon and name,
// earned ones glowing, one medal still to collect giving a small shake at a time. A medal's
// details open in a pop-up, and "Start with Alira" hands the next step over to Alira.
export default function MedalCollection({ earned = earnedMedals, reachNext = withinReachNext }: MedalCollectionProps) {
  const [, navigate] = useLocation();
  const [openId, setOpenId] = useState<MedalId | null>(null);
  const [upNext, setUpNext] = useState<MedalId | null>(null);
  const [shaking, setShaking] = useState<MedalId | null>(null);
  const upNextRef = useRef(upNext);
  upNextRef.current = upNext;
  const lastOpen = useRef<MedalId | null>(null);
  if (openId) lastOpen.current = openId;

  const earnedOn = new Map(earned.map(medal => [medal.id, medal.on]));
  const latest = earned.length ? findMedal(earned[earned.length - 1].id) : null;
  const next = reachNext.map(id => findMedal(id)).filter((medal): medal is MedalWithCategory => medal !== null && !earnedOn.has(medal.id));
  const toCollect = allMedals.filter(medal => !earnedOn.has(medal.id)).map(medal => medal.id);
  const toCollectKey = toCollect.join(",");
  const shown = findMedal(openId ?? lastOpen.current);
  const shownEarnedOn = shown ? earnedOn.get(shown.id) ?? null : null;

  // Every few seconds one medal still to collect gives a small shake, never the same one twice in a row.
  useEffect(() => {
    if (!toCollect.length || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const shakeOne = () =>
      setShaking(previous => {
        const pool = toCollect.filter(id => id !== previous && id !== upNextRef.current);
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      });
    shakeOne();
    const timer = window.setInterval(shakeOne, SHAKE_EVERY_MS);
    return () => window.clearInterval(timer);
    // The pool only changes when a medal is earned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toCollectKey]);

  return (
    <section className="medal-collection" aria-label="Your medals">
      <div className="medal-collection-catalog">
        {medalCategories.map(category => (
          <section key={category.name} className="medal-collection-category mc-tone" data-tone={category.tone} aria-labelledby={`medal-category-${category.tone}`}>
            <h2 id={`medal-category-${category.tone}`}><i aria-hidden="true" />{category.name} <small>{category.note}</small></h2>
            <div className="medal-collection-grid">
              {category.medals.map(medal => {
                const on = earnedOn.get(medal.id);
                const isUpNext = !on && upNext === medal.id;
                const state = on ? "is-earned" : isUpNext ? "is-up-next" : "is-locked";
                return (
                  <button key={medal.id} type="button" className={`medal-tile ${state}`} aria-haspopup="dialog" onClick={() => setOpenId(medal.id)}>
                    {isUpNext && <span className="medal-tile-badge">Up next</span>}
                    <MedalCoin id={medal.id} earned={Boolean(on)} shaking={shaking === medal.id} />
                    <b>{medal.name}</b>
                    <span className="sr-only">{on ? earnedLabel(on) : "Not earned yet"}</span>
                    {isUpNext && <span className="medal-tile-action">{medalGuides[medal.id].upNext}<ChevronRight size={14} aria-hidden="true" /></span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <aside className="medal-collection-side">
        <section className="medal-collection-count" aria-labelledby="medal-collection-count">
          <span className="medal-collection-overline">YOUR COLLECTION</span>
          <p id="medal-collection-count"><b>{earned.length}</b> {earned.length === 1 ? "medal" : "medals"} collected</p>
        </section>
        {(latest || next.length > 0) && (
          <section className="medal-collection-latest mc-tone" data-tone={latest?.tone} aria-label={latest ? "Latest medal" : "Within reach next"}>
            {latest && (
              <>
                <span className="medal-collection-overline">LATEST MEDAL</span>
                <MedalCoin id={latest.id} earned size="large" />
                <h2>{latest.name}</h2>
                <p>{latest.celebration ?? latest.description}</p>
              </>
            )}
            {next.length > 0 && (
              <div className="medal-collection-next">
                <h3>Within reach next</h3>
                {next.map(medal => (
                  <button
                    key={medal.id}
                    type="button"
                    className={`mc-tone ${upNext === medal.id ? "is-selected" : ""}`}
                    data-tone={medal.tone}
                    aria-pressed={upNext === medal.id}
                    onClick={() => setUpNext(current => (current === medal.id ? null : medal.id))}
                  >
                    <MedalCoin id={medal.id} earned={false} size="small" />
                    <span className="medal-collection-next-text"><b>{medal.name}</b><small>{medal.description.replace(/\.$/, "")}</small></span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </aside>

      <Dialog open={openId !== null} onOpenChange={isOpen => { if (!isOpen) setOpenId(null); }}>
        {shown && (
          <DialogContent className="medal-collection-dialog mc-tone" data-tone={shown.tone}>
            <span className="medal-collection-chip">{shown.category}</span>
            <MedalCoin id={shown.id} earned={shownEarnedOn !== null} size="dialog" />
            <DialogTitle className="medal-collection-dialog-title">{shown.name}</DialogTitle>
            <DialogDescription className="medal-collection-dialog-text">{shown.description}</DialogDescription>
            {shownEarnedOn ? (
              <p className="medal-collection-earned"><Check size={18} strokeWidth={2.6} aria-hidden="true" />{earnedLabel(shownEarnedOn)}</p>
            ) : (
              <button type="button" className="medal-collection-cta" onClick={() => navigate(`/alira?medal=${shown.id}`)}>Start with Alira</button>
            )}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

export function MedalCoin({ id, earned, shaking = false, size }: { id: MedalId; earned: boolean; shaking?: boolean; size?: "small" | "large" | "dialog" }) {
  const classes = ["medal-coin", earned && "is-earned", shaking && "is-shaking", size && `is-${size}`].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">
      <span className="medal-coin-face"><MedalArtwork icon={id} /></span>
      {earned && <span className="medal-coin-check"><Check strokeWidth={3} /></span>}
    </span>
  );
}
