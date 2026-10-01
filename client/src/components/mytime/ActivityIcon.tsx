import type { MyTimeActivityId } from "@/lib/my-time";

/** The small picture for each activity on the My Time picker. */
export default function ActivityIcon({ id }: { id: MyTimeActivityId }) {
  return <svg className="mytime-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    {id === "breathing" && <><circle cx="16" cy="16" r="13" fill="#f8e3d6" /><circle cx="16" cy="16" r="9" fill="#f3cdb6" /><circle cx="16" cy="16" r="5" fill="#e3a481" /></>}
    {id === "pond" && <><circle cx="16" cy="16" r="13" fill="#3f7460" /><path d="M9 16 5 12v8Z" fill="#fff6ea" /><path d="M8 16c3-5 11-6 17 0-6 6-14 5-17 0Z" fill="#fff6ea" /><path d="M14 13c3-1 6-1 8 1-3 2-6 1-8-1Z" fill="#e58a5c" /><circle cx="22" cy="15.5" r="1" fill="#2b3b33" /></>}
    {id === "memory_game" && <><rect x="5" y="5" width="22" height="22" rx="6" fill="#3f7460" /><path d="M16 9c2 5 2 9 0 14-2-5-2-9 0-14ZM9 16c5-2 9-2 14 0-5 2-9 2-14 0Z" fill="#e9d29a" /></>}
    {id === "chimes" && <><path d="M6 7h20" stroke="#c99a6b" strokeWidth="3" strokeLinecap="round" /><rect x="7" y="10" width="5" height="16" rx="2.5" fill="#e8bd55" /><rect x="13.5" y="10" width="5" height="12" rx="2.5" fill="#e3a481" /><rect x="20" y="10" width="5" height="8" rx="2.5" fill="#b9a2d6" /></>}
    {id === "colour" && <><path d="M8 27V14a8 8 0 0 1 16 0v13Z" fill="#a9c3df" stroke="#4b4038" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 22c5-4 11-4 16 0v5H8Z" fill="#9cc7a2" stroke="#4b4038" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="16" cy="14.5" r="3.5" fill="#f1cf7a" stroke="#4b4038" strokeWidth="1.5" /></>}
    {id === "postcard" && <><rect x="3.5" y="7.5" width="25" height="18" rx="2" fill="#fffefa" stroke="#c9bca4" /><rect x="6" y="10" width="20" height="13" fill="#f8e4cf" /><circle cx="20" cy="15" r="3" fill="#f1cf7a" /><path d="M6 23c5-7 12-6 20-2v2Z" fill="#8fb39b" /></>}
    {id === "story" && <><path d="M16 9c-3-2-7-2-11 0v16c4-2 8-2 11 0Z" fill="#fff6ea" stroke="#24503f" strokeWidth="1.5" strokeLinejoin="round" /><path d="M16 9c3-2 7-2 11 0v16c-4-2-8-2-11 0Z" fill="#f1cf7a" stroke="#24503f" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 13c2-.7 4-.7 5.5 0M8 17c2-.7 4-.7 5.5 0" stroke="#24503f" strokeWidth="1.2" strokeLinecap="round" /></>}
    {id === "sounds" && <g fill="#2f6851"><rect x="5" y="13" width="3.5" height="6" rx="1.75" /><rect x="10" y="9" width="3.5" height="14" rx="1.75" /><rect x="15" y="5" width="3.5" height="22" rx="1.75" /><rect x="20" y="10" width="3.5" height="12" rx="1.75" /><rect x="25" y="13.5" width="3.5" height="5" rx="1.75" /></g>}
    {id === "lantern" && <><circle cx="16" cy="17" r="13" fill="#183d34" /><path d="M11 8h10l2 13c0 3-3 4.5-7 4.5S9 24 9 21Z" fill="#f4c9a4" /><path d="M11 8h10l.4 2.5H10.6Z" fill="#b86b4d" /><ellipse cx="16" cy="21" rx="3.5" ry="2.5" fill="#fff6dc" /></>}
  </svg>;
}
