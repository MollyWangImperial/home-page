import type { AmbienceKind } from "@/lib/my-time-audio";

export type PostcardId = "lake" | "tea" | "harbour" | "meadow" | "cabin" | "path";
export type Postcard = {
  id: PostcardId;
  title: string;
  /** How tomorrow's card is announced the day before. */
  teaser: string;
  note: string;
  sound: AmbienceKind;
};

// One arrives each day, in this order, and then they come round again.
export const postcards: Postcard[] = [
  { id: "lake", title: "Lake at first light", teaser: "a lake at first light", sound: "lake",
    note: "The water is so still at first light that the hills appear twice. I thought you might like to sit here with me for a minute." },
  { id: "tea", title: "Tea garden in the rain", teaser: "a tea garden in the rain", sound: "rain",
    note: "Rain on the tea leaves sounds like quiet applause. Nobody here is in a hurry, and neither are we." },
  { id: "harbour", title: "Harbour at dusk", teaser: "a harbour at dusk", sound: "sea",
    note: "The boats are all home and the lamp has just come on. It turns once every few breaths." },
  { id: "meadow", title: "Meadow at noon", teaser: "a meadow at noon", sound: "breeze",
    note: "Lie back in the long grass for a while. The only thing moving up here is one slow cloud." },
  { id: "cabin", title: "Cabin in the snow", teaser: "a cabin in the snow", sound: "breeze",
    note: "Snow makes everything quiet. There is a fire going inside, and a chair by the window that is yours." },
  { id: "path", title: "Autumn path", teaser: "a path through autumn trees", sound: "breeze",
    note: "The path is covered in gold leaves and nobody has walked it yet today. Take it as slowly as you like." },
];

function Scene({ id }: { id: PostcardId }) {
  if (id === "lake") return <>
    <rect width="376" height="256" fill="#f8e4cf" /><rect y="60" width="376" height="80" fill="#f6d9c4" />
    <circle cx="268" cy="96" r="34" fill="#f1cf7a" />
    <path d="M0 150C40 108 84 104 128 132 168 96 222 92 262 124 300 104 344 108 376 138V170H0Z" fill="#bcd0c2" />
    <path d="M0 166C54 132 110 138 160 160 214 136 300 134 376 164V190H0Z" fill="#8fb39b" />
    <rect y="176" width="376" height="80" fill="#d5e3e6" />
    <path className="postcard-shimmer" d="M244 190h48M236 202h64M248 214h40M256 226h24" stroke="#f1cf7a" strokeWidth="4" strokeLinecap="round" />
    <path d="M40 196h70M150 208h54M20 224h44M300 236h50" stroke="#fffefa" strokeWidth="2" strokeLinecap="round" opacity=".8" />
    <g className="postcard-bob"><path d="M112 194h56l-9 12h-38Z" fill="#9b5b42" /><path d="M140 194v-34l22 30Z" fill="#fffefa" /></g>
    <path d="M0 256V226C40 210 76 216 104 240 116 248 130 252 150 256Z" fill="#3f7460" />
    <path d="M22 226V186M34 222V176M46 226V192M60 232V198" stroke="#3f7460" strokeWidth="3" strokeLinecap="round" />
    <path d="M22 186c-2-8 4-8 2 0ZM34 176c-2-9 4-9 2 0ZM46 192c-2-8 4-8 2 0Z" fill="#9b5b42" stroke="#9b5b42" strokeWidth="3" strokeLinejoin="round" />
  </>;
  if (id === "tea") return <>
    <rect width="376" height="256" fill="#e3e9e3" />
    <path d="M0 110C60 70 120 78 170 104 220 70 300 66 376 100V150H0Z" fill="#c4d4c8" />
    <path d="M0 132C80 104 180 108 376 126V256H0Z" fill="#a9cba9" />
    <path d="M0 160C90 132 200 138 376 156V256H0Z" fill="#8fc08e" />
    <path d="M0 190C100 162 220 168 376 188V256H0Z" fill="#6fa57a" />
    <path d="M0 222C110 196 230 202 376 222V256H0Z" fill="#4f8a66" />
    <path d="M0 146C90 118 200 124 376 142M0 175C100 147 220 153 376 172M0 206C110 179 230 185 376 205" stroke="#fffefa" strokeWidth="1.5" opacity=".35" fill="none" />
    <path d="M262 112h34v20h-34Z" fill="#fff6ea" /><path d="M255 114l24-17 24 17Z" fill="#9b5b42" /><path d="M275 120h8v12h-8Z" fill="#9b5b42" />
    <g className="postcard-rain" stroke="#fffefa" strokeWidth="2" strokeLinecap="round" opacity=".75">
      <path d="M40 20l-7 20M96 50l-7 20M146 14l-7 20M206 44l-7 20M256 18l-7 20M326 40l-7 20M66 96l-7 20M176 86l-7 20M306 70l-7 20M352 112l-7 20M120 136l-7 20M232 150l-7 20M24 160l-7 20M290 190l-7 20M160 200l-7 20" />
    </g>
  </>;
  if (id === "harbour") return <>
    <rect width="376" height="256" fill="#f6d9c4" /><rect width="376" height="72" fill="#f1c4a8" />
    <circle cx="120" cy="150" r="40" fill="#f6e7b4" />
    <rect y="150" width="376" height="106" fill="#8fb0c4" />
    <path className="postcard-shimmer" d="M84 164h72M96 177h48M106 190h28" stroke="#f6e7b4" strokeWidth="4" strokeLinecap="round" />
    <path d="M20 214h60M180 226h70M110 240h44" stroke="#fffefa" strokeWidth="2" strokeLinecap="round" opacity=".6" />
    <path className="postcard-beam" d="M304 87 150 54V120Z" fill="#f6e7b4" />
    <path d="M246 256C258 204 298 178 338 180 362 184 376 196 376 210V256Z" fill="#3f5f58" />
    <path d="M300 96h24l6 88h-36Z" fill="#fff6ea" /><path d="M298.4 122h27.2l1.1 17h-29.4Z" fill="#b86b4d" /><path d="M296.2 156h31.6l1.1 17h-33.8Z" fill="#b86b4d" />
    <rect x="302" y="78" width="20" height="18" fill="#f1cf7a" /><path d="M297 78h30l-15-13Z" fill="#b86b4d" />
    <g className="postcard-bob"><path d="M38 198h46l-7 11H46Z" fill="#3f5f58" /><path d="M61 198v-28l19 25Z" fill="#fffefa" /></g>
    <path d="M186 172h30l-5 8h-20Z" fill="#3f5f58" /><path d="M201 172v-17l12 15Z" fill="#fff6ea" />
  </>;
  if (id === "meadow") return <>
    <rect width="376" height="256" fill="#d3e6ec" />
    <g className="postcard-cloud" fill="#fffefa"><circle cx="92" cy="58" r="20" /><circle cx="118" cy="48" r="26" /><circle cx="148" cy="58" r="20" /><rect x="88" y="56" width="64" height="22" rx="11" /></g>
    <circle cx="310" cy="46" r="24" fill="#f1cf7a" />
    <path d="M0 150C70 112 150 116 210 140 260 118 330 120 376 144V190H0Z" fill="#bcd9b0" />
    <path d="M0 178C80 150 190 154 376 172V256H0Z" fill="#9cc7a2" />
    <path d="M0 212C110 190 240 194 376 210V256H0Z" fill="#7fb486" />
    <path d="M296 176v-40" stroke="#6d5644" strokeWidth="7" strokeLinecap="round" /><circle cx="296" cy="118" r="30" fill="#5d8f74" /><circle cx="276" cy="134" r="18" fill="#5d8f74" /><circle cx="316" cy="134" r="18" fill="#5d8f74" />
    <g className="postcard-sway" stroke="#4f8a66" strokeWidth="2" strokeLinecap="round"><path d="M40 256v-30M70 256v-24M120 256v-34M170 256v-22M230 256v-30M340 256v-26" /></g>
    <g><circle cx="40" cy="224" r="5" fill="#edbcc0" /><circle cx="70" cy="230" r="5" fill="#f1cf7a" /><circle cx="120" cy="220" r="5" fill="#fffefa" /><circle cx="170" cy="232" r="5" fill="#edbcc0" /><circle cx="230" cy="224" r="5" fill="#f1cf7a" /><circle cx="340" cy="228" r="5" fill="#fffefa" /></g>
  </>;
  if (id === "cabin") return <>
    <rect width="376" height="256" fill="#35525e" />
    <g fill="#f7edbd"><circle className="postcard-shimmer" cx="60" cy="40" r="1.8" /><circle cx="130" cy="24" r="1.4" /><circle className="postcard-shimmer" cx="210" cy="52" r="1.6" /><circle cx="340" cy="90" r="1.4" /><circle cx="26" cy="96" r="1.3" /></g>
    <path d="M300 36a26 26 0 1 0 22 40c-18 3-32-17-22-40Z" fill="#f7edbd" />
    <path d="M0 170C60 130 130 134 190 158 250 128 320 130 376 156V200H0Z" fill="#c9d7dc" />
    <path d="M0 196C90 168 220 172 376 190V256H0Z" fill="#eef3f2" />
    <path d="M40 196l18-44 18 44ZM84 204l14-36 14 36ZM300 198l18-46 18 46Z" fill="#2f6851" />
    <path d="M49 172l9-22 9 22ZM309 172l9-22 9 22Z" fill="#eef3f2" />
    <path d="M168 168h76v44h-76Z" fill="#9b5b42" /><path d="M158 170l48-34 48 34Z" fill="#eef3f2" />
    <rect x="182" y="180" width="20" height="18" fill="#f1cf7a" /><path d="M216 184h16v28h-16Z" fill="#6d3f2e" />
    <rect x="226" y="134" width="10" height="20" fill="#6d3f2e" />
    <g className="postcard-smoke" fill="#eef3f2" opacity=".7"><circle cx="232" cy="124" r="5" /><circle cx="238" cy="110" r="7" /><circle cx="232" cy="94" r="9" /></g>
    <path d="M150 224C190 214 240 214 290 224" stroke="#c9d7dc" strokeWidth="3" strokeLinecap="round" fill="none" />
  </>;
  return <>
    <rect width="376" height="256" fill="#f8e4cf" />
    <circle cx="70" cy="60" r="26" fill="#f6e7b4" />
    <path d="M0 150C60 116 130 118 190 140 250 112 320 116 376 140V180H0Z" fill="#e3c9a8" />
    <rect y="170" width="376" height="86" fill="#d9a877" />
    <path d="M150 256C168 226 226 214 204 190 194 178 204 170 214 166L196 166C180 172 172 182 180 194 190 210 120 224 96 256Z" fill="#fff3d6" />
    <path d="M60 178v-34M118 174v-28M268 176v-36M330 180v-30" stroke="#6d5644" strokeWidth="7" strokeLinecap="round" />
    <circle cx="60" cy="122" r="34" fill="#e58a5c" /><circle cx="118" cy="128" r="26" fill="#f1cf7a" /><circle cx="268" cy="116" r="36" fill="#f1cf7a" /><circle cx="330" cy="132" r="28" fill="#eeb89c" />
    <g className="postcard-leaves"><path d="M150 96l5 3-5 3-5-3ZM230 70l5 3-5 3-5-3ZM200 130l5 3-5 3-5-3ZM300 60l5 3-5 3-5-3Z" fill="#e58a5c" /></g>
    <g fill="#e58a5c"><circle cx="150" cy="232" r="3" /><circle cx="176" cy="212" r="3" /><circle cx="120" cy="246" r="3" /></g><g fill="#f1cf7a"><circle cx="164" cy="244" r="3" /><circle cx="194" cy="198" r="3" /></g>
  </>;
}

/** The picture side of a postcard, drawn rather than photographed so it needs no image files. */
export default function PostcardArt({ id }: { id: PostcardId }) {
  return <svg className="postcard-art" viewBox="0 0 376 256" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><Scene id={id} /></svg>;
}
