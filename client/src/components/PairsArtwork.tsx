export type PairPicture = "Leaf" | "Sun" | "Flower" | "Butterfly" | "Moon" | "Shell";

export function PairCover() {
  return <svg className="pair-cover-art" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <rect x="6" y="6" width="68" height="68" rx="12" stroke="#d9e8c8" strokeOpacity=".32" />
    <path d="M12 57c17-3 9-29 25-35M68 23c-17 3-9 29-25 35" stroke="#bdd6ba" strokeWidth="1.1" />
    <path d="M18 51c-7-1-8-8-7-11 6 1 10 4 7 11Zm4-10c-2-7 3-12 8-12 0 6-2 11-8 12Zm40-12c7 1 8 8 7 11-6-1-10-4-7-11Zm-4 10c2 7-3 12-8 12 0-6 2-11 8-12Z" fill="#a9c9aa" fillOpacity=".65" />
    <circle cx="40" cy="40" r="14" fill="#f7e5ac" fillOpacity=".1" stroke="#e6ce91" strokeOpacity=".65" />
    <path d="M40 29c6 7 6 15 0 22-6-7-6-15 0-22Z" fill="#e9d29a" />
    <path d="M29 40c7-6 15-6 22 0-7 6-15 6-22 0Z" fill="#e9d29a" />
    <circle cx="40" cy="40" r="3" fill="#315d4d" />
    <path d="m56 13 1.3 3.7L61 18l-3.7 1.3L56 23l-1.3-3.7L51 18l3.7-1.3ZM24 57l1.3 3.7L29 62l-3.7 1.3L24 67l-1.3-3.7L19 62l3.7-1.3Z" fill="#e9d29a" fillOpacity=".8" />
  </svg>;
}

export function PairFace({ picture }: { picture: PairPicture }) {
  return <svg className="pair-face-art" viewBox="0 0 64 64" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {picture === "Leaf" && <g stroke="#426e4b"><path d="M12 48C5 24 24 12 52 10c2 28-13 46-35 39" fill="#b8d4a7" /><path d="m12 54 32-32M23 42V28m0 14h14m-4-24v14h13" /></g>}
    {picture === "Sun" && <g stroke="#a8752e"><circle cx="32" cy="32" r="15" fill="#f4cb76" /><path d="M32 5v7m0 40v7M5 32h7m40 0h7M13 13l5 5m28 28 5 5m0-38-5 5M18 46l-5 5" /><path d="M25 36q7 7 14 0" /></g>}
    {picture === "Flower" && <g stroke="#a96969"><path d="M32 24C12 0 5 32 24 32 0 52 32 59 32 40c20 24 27-8 8-8C64 12 32 5 32 24Z" fill="#edbcc0" /><circle cx="32" cy="32" r="8" fill="#f1d18a" /></g>}
    {picture === "Butterfly" && <g stroke="#7b6d96"><path d="M30 30C18-1 0 11 13 31 0 48 17 60 30 37m4-7C46-1 64 11 51 31c13 17-4 29-17 6" fill="#d7c7e6" /><path d="M32 24v24m0-24-7-9m7 9 7-9M18 26l5 5m23-5-5 5" /></g>}
    {picture === "Moon" && <g stroke="#64748f"><path d="M39 9a23 23 0 1 0 16 33C34 48 21 24 39 9Z" fill="#c9d5e6" /><path d="m48 10 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#f1d18a" /></g>}
    {picture === "Shell" && <g stroke="#a76e50"><path d="M25 51 8 35C-1 20 15 8 25 14c8-13 25-4 25 5 15 4 13 21 3 26L39 54Z" fill="#eac4aa" /><path d="m30 48-7-25m11 26 4-30m-1 31 14-19M28 47 14 28M25 51l1 6h14l-1-3" /></g>}
  </svg>;
}
