import { useId, useState, type KeyboardEvent } from "react";
import { RotateCcw } from "lucide-react";
import { myTimeStore, type WindowFills } from "@/lib/my-time";

type Pane = { id: string; name: string; d?: string; circle?: [number, number, number] };
type WindowDesign = { id: string; name: string; picture: string; panes: Pane[] };

const ARCH = "M6 400V150a144 144 0 0 1 288 0v250Z";
const BLANK = "#fbf5e6";
const COLOURS: [string, string][] = [
  ["#f1cf7a", "Gold"], ["#eeb89c", "Peach"], ["#e6a9ae", "Rose"], ["#c9b6de", "Lilac"],
  ["#a9c3df", "Sky blue"], ["#9cc7a2", "Leaf green"], ["#5d8f74", "Deep green"],
];
const colourName = (fill: string | undefined) => COLOURS.find(([hex]) => hex === fill)?.[1].toLowerCase() ?? "empty";

// Panes are drawn in order, so later ones sit on top of earlier ones where they overlap.
const DESIGNS: WindowDesign[] = [
  {
    id: "sunrise", name: "Sunrise", picture: "a sunrise over hills and a lake",
    panes: [
      { id: "r1", name: "Sky, far left", d: "M150 170 0 262V120Z" },
      { id: "r2", name: "Sky, upper left", d: "M150 170 0 120V0h60Z" },
      { id: "r3", name: "Sky, top left", d: "M150 170 60 0h90Z" },
      { id: "r4", name: "Sky, top right", d: "M150 170V0h90Z" },
      { id: "r5", name: "Sky, upper right", d: "M150 170 240 0h60v120Z" },
      { id: "r6", name: "Sky, far right", d: "M150 170 300 120v142Z" },
      { id: "glow", name: "Horizon", d: "M0 262 150 170 300 262V302H0Z" },
      { id: "sun", name: "Sun", circle: [150, 170, 46] },
      { id: "h1", name: "Left hill", d: "M0 262C50 205 105 215 150 250V302H0Z" },
      { id: "h2", name: "Right hill", d: "M150 250C195 215 250 205 300 262V302H150Z" },
      { id: "b1", name: "Left bank", d: "M0 302H110C120 340 95 370 70 400H0Z" },
      { id: "lake", name: "Lake", d: "M110 302H190C180 340 205 370 230 400H70C95 370 120 340 110 302Z" },
      { id: "b2", name: "Right bank", d: "M190 302H300V400H230C205 370 180 340 190 302Z" },
    ],
  },
  {
    id: "tree", name: "Hill tree", picture: "a round tree on a hill",
    panes: [
      { id: "s1", name: "Sky, upper left", d: "M0 0H150V150H0Z" },
      { id: "s2", name: "Sky, upper right", d: "M150 0H300V150H150Z" },
      { id: "s3", name: "Sky, lower left", d: "M0 150H150V300H0Z" },
      { id: "s4", name: "Sky, lower right", d: "M150 150H300V300H150Z" },
      { id: "sun", name: "Sun", circle: [236, 78, 26] },
      { id: "g1", name: "Left of the hill", d: "M0 296C50 270 100 258 150 258V400H0Z" },
      { id: "g2", name: "Right of the hill", d: "M150 258C200 258 250 270 300 296V400H150Z" },
      { id: "trunk", name: "Trunk", d: "M137 196H163V272H137Z" },
      { id: "c1", name: "Leaves, left", circle: [108, 168, 52] },
      { id: "c2", name: "Leaves, right", circle: [192, 168, 52] },
      { id: "c3", name: "Leaves, top", circle: [150, 122, 58] },
    ],
  },
  {
    id: "moon", name: "Moon water", picture: "the moon over mountains and water",
    panes: [
      { id: "n1", name: "Sky, top", d: "M0 0H300V92H0Z" },
      { id: "n2", name: "Sky, middle", d: "M0 92H300V172H0Z" },
      { id: "n3", name: "Sky, low", d: "M0 172H300V252H0Z" },
      { id: "moon", name: "Moon", circle: [196, 112, 44] },
      { id: "m1", name: "Left mountain", d: "M0 252 82 158 164 252Z" },
      { id: "m2", name: "Right mountain", d: "M118 252 212 140 300 244V252Z" },
      { id: "w1", name: "Water, far", d: "M0 252H300V302C250 292 200 312 150 302C100 292 50 312 0 302Z" },
      { id: "w2", name: "Water, middle", d: "M0 302C50 312 100 292 150 302C200 312 250 292 300 302V352C250 342 200 362 150 352C100 342 50 362 0 352Z" },
      { id: "w3", name: "Water, near", d: "M0 352C50 362 100 342 150 352C200 362 250 342 300 352V400H0Z" },
    ],
  },
];

function WindowArt({ design, fills, onPaint }: { design: WindowDesign; fills: WindowFills; onPaint?: (pane: string) => void }) {
  const clip = useId();
  const press = (pane: string) => (event: KeyboardEvent<SVGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPaint?.(pane);
  };
  return <svg className="window-art" viewBox="0 0 300 400" fill="none" role={onPaint ? "group" : "img"} aria-label={onPaint ? `A window of ${design.panes.length} glass panes showing ${design.picture}` : undefined} aria-hidden={onPaint ? undefined : true}>
    <defs><clipPath id={clip}><path d={ARCH} /></clipPath></defs>
    <g clipPath={`url(#${clip})`} stroke="#4b4038" strokeWidth="4" strokeLinejoin="round">
      {design.panes.map(pane => {
        const shared = onPaint
          ? { className: "window-pane", role: "button", tabIndex: 0, "aria-label": `${pane.name}, ${colourName(fills[pane.id])}`, onClick: () => onPaint(pane.id), onKeyDown: press(pane.id) }
          : {};
        const fill = fills[pane.id] ?? BLANK;
        return pane.circle
          ? <circle key={pane.id} cx={pane.circle[0]} cy={pane.circle[1]} r={pane.circle[2]} fill={fill} {...shared} />
          : <path key={pane.id} d={pane.d} fill={fill} {...shared} />;
      })}
    </g>
    <path d={ARCH} stroke="#4b4038" strokeWidth="9" strokeLinejoin="round" />
  </svg>;
}

// A stained-glass window to colour pane by pane. Each window keeps its colours until it is started again.
export default function ColourWindow() {
  const [windows, setWindows] = useState(() => myTimeStore.load().windows);
  const [designId, setDesignId] = useState(DESIGNS[0].id);
  const [colour, setColour] = useState(COLOURS[5][0]);
  const design = DESIGNS.find(candidate => candidate.id === designId) ?? DESIGNS[0];
  const fills = windows[design.id] ?? {};
  const done = design.panes.filter(pane => fills[pane.id]).length;

  return <section className="mt-card colour-card" aria-labelledby="colour-title">
    <div className="colour-frame"><WindowArt design={design} fills={fills} onPaint={pane => setWindows(myTimeStore.paint(design.id, pane, colour))} /></div>
    <div className="mt-copy">
      <div>
        <h2 id="colour-title">Colour a window, one pane at a time.</h2>
        <p>Pick a colour, then touch a pane. There is no right answer, and you can change your mind.</p>
      </div>
      <div className="colour-palette" role="radiogroup" aria-label="Choose a colour">
        {COLOURS.map(([hex, name]) => <button key={hex} type="button" role="radio" aria-checked={colour === hex} aria-label={name} className={`colour-swatch ${colour === hex ? "is-selected" : ""}`} style={{ background: hex }} onClick={() => setColour(hex)} />)}
      </div>
      <div className="colour-progress">
        <b role="status">{done === design.panes.length ? "Finished. It is yours to keep." : `${done} of ${design.panes.length} panes coloured`}</b>
        <button type="button" disabled={done === 0} onClick={() => setWindows(myTimeStore.clearWindow(design.id))}><RotateCcw size={14} />Start again</button>
      </div>
      <div className="colour-gallery">
        <b>Your windows</b>
        <div role="radiogroup" aria-label="Choose a window">
          {DESIGNS.map(option => <button key={option.id} type="button" role="radio" aria-checked={option.id === design.id} className={option.id === design.id ? "is-selected" : ""} onClick={() => setDesignId(option.id)}>
            <WindowArt design={option} fills={windows[option.id] ?? {}} />
            <span>{option.name}</span>
          </button>)}
        </div>
      </div>
    </div>
  </section>;
}
