import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { PERSON_IDS, people, suggestedGroups, type PersonId, type SampleGroup, type SuggestedGroupId } from "@/content/community-samples";
import { communityHref, communityStore, useCommunity } from "@/lib/community-store";
import { myGroups, type GroupModel } from "./group-model";
import { CloseIcon, NextIcon, SearchIcon } from "./icons";
import { Cover, Face, FriendButton } from "./parts";

const spaces = [
  { label: "The lounge", note: "Drop in for a chat", href: communityHref("lounge") },
  { label: "Sunday circle", note: "Open now", href: communityHref("circle") },
];

/** Finds the example people, groups and spaces by name. Everything it finds is on this page already. */
export default function CommunitySearch() {
  const memory = useCommunity();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const words = query.trim().toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(words);

  const found: { people: PersonId[]; groups: GroupModel[]; suggested: SampleGroup[]; spaces: typeof spaces } = {
    people: words ? PERSON_IDS.filter(id => has(people[id].name) || has(people[id].about)) : [],
    groups: words ? myGroups(memory).filter(group => has(group.name)) : [],
    suggested: words ? suggestedGroups.filter(group => !memory.joined.includes(group.id as SuggestedGroupId) && has(group.name)) : [],
    spaces: words ? spaces.filter(space => has(space.label)) : [],
  };
  const total = found.people.length + found.groups.length + found.suggested.length + found.spaces.length;
  const open = shown && !!words;

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) setShown(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const done = () => { setQuery(""); setShown(false); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (open) { setShown(false); field.current?.focus(); } else if (query) setQuery("");
  };
  const onBlur = (event: FocusEvent) => { if (!wrap.current?.contains(event.relatedTarget as Node | null)) setShown(false); };

  return (
    <div className="cm-search" ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
      <label className="cm-search-box">
        <SearchIcon />
        <span className="cm-sr">Find people or groups</span>
        <input ref={field} type="search" value={query} placeholder="Find people or groups" autoComplete="off" aria-controls={open ? resultsId : undefined}
          onFocus={() => setShown(true)} onChange={event => { setQuery(event.target.value); setShown(true); }} />
        {query && <button type="button" className="cm-search-clear" aria-label="Clear the search" onClick={() => { setQuery(""); field.current?.focus(); }}><CloseIcon size={16} /></button>}
      </label>
      <p className="cm-sr" role="status">{open ? (total ? `${total} found` : "Nothing found") : ""}</p>
      {open && (
        // Pressing a result keeps the focus where it is, so the list stays open until the press lands.
        <div className="cm-search-results" id={resultsId} onMouseDown={event => event.preventDefault()}>
          {total === 0 && <p className="cm-search-empty">No one by that name here. Try another name, or a group like Garden gang.</p>}
          {found.people.length > 0 && (
            <>
              <h3>People</h3>
              <ul>
                {found.people.map(id => (
                  <li key={id}>
                    <Face who={id} size={40} />
                    <span className="cm-search-text"><b>{people[id].name}</b><span>{people[id].about}</span></span>
                    <FriendButton who={id} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {(found.groups.length > 0 || found.suggested.length > 0) && (
            <>
              <h3>Groups</h3>
              <ul>
                {found.groups.map(group => (
                  <li key={group.id}>
                    <Cover cover={group.cover} className="cm-cover-thumb cm-cover-small" />
                    <span className="cm-search-text"><b>{group.name}</b><span>{group.kind === "started" ? "Started by you" : "One of your groups"}</span></span>
                    <Link className="cm-search-go" href={communityHref("groups", group.id)} onClick={done}>Open<span className="cm-sr">{` ${group.name}`}</span><NextIcon size={18} /></Link>
                  </li>
                ))}
                {found.suggested.map(group => (
                  <li key={group.id}>
                    <Cover cover={group.cover} className="cm-cover-thumb cm-cover-small" />
                    <span className="cm-search-text"><b>{group.name}</b><span>{group.why}</span></span>
                    <button type="button" className="cm-join" onClick={() => communityStore.toggleJoined(group.id as SuggestedGroupId)}>Join<span className="cm-sr">{` ${group.name}`}</span></button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {found.spaces.length > 0 && (
            <>
              <h3>Spaces</h3>
              <ul>
                {found.spaces.map(space => (
                  <li key={space.label}>
                    <span className="cm-search-text"><b>{space.label}</b><span>{space.note}</span></span>
                    <Link className="cm-search-go" href={space.href} onClick={done}>Go<span className="cm-sr">{` to ${space.label}`}</span><NextIcon size={18} /></Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
