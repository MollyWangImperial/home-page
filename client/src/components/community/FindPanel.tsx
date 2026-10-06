import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useCommunity, type CommunityPlace } from "@/lib/community-store";
import { findInCommunity, foundLabel } from "./alerts-helpers";
import CommunitySearch from "./CommunitySearch";
import CommunityDialog from "./dialog";
import { CloseIcon, SearchIcon } from "./icons";

// Find: people, groups and places in My community, by name, as you type. Before anything is
// typed it shows the places, one tap each. A group opens My groups with that group; a place
// opens it (the Friends ones open the drawer over the view the person is on); a person can be
// asked to be a friend, or their request or the friends list opened. Blocked people are never
// found. Everything it finds is on this page already, and nothing typed here leaves the device.

export type FindPanelProps = {
  /** Closes the panel. Call it from each result's link too. */
  onClose: () => void;
  /** The toolbar's Find button, which the panel drops down from. Pass it to CommunityDialog. */
  anchor: HTMLElement | null;
  /** The view the person is on, so a result can open the Friends drawer over it (`friendsHref(tab, over)`). */
  over: CommunityPlace;
  /** Where the focus goes on closing if the Find button has gone. Pass it to CommunityDialog. */
  fallbackFocus: () => HTMLElement | null | undefined;
};

export default function FindPanel({ onClose, anchor, over, fallbackFocus }: FindPanelProps) {
  const memory = useCommunity();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const results = findInCommunity(memory, query, over);
  const searching = results.words.length > 0;

  // Escape clears the words first, and the panel stays open; a second Escape closes it.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };
  const clear = () => {
    setQuery("");
    field.current?.focus();
  };

  return (
    <CommunityDialog kind="panel" labelledBy={titleId} onClose={onClose} anchor={anchor} fallbackFocus={fallbackFocus} className="cm-al-find">
      <div className="cm-dialog-head">
        <span className="cm-round-icon cm-round-icon-small" aria-hidden="true"><SearchIcon size={22} /></span>
        <div className="cm-dialog-titles">
          <h2 id={titleId} className="cm-dialog-title cm-dialog-title-small" tabIndex={-1}>Find</h2>
          <p>People, groups and places in My community</p>
        </div>
        <button type="button" className="cm-dialog-close" aria-label="Close" onClick={onClose}><CloseIcon size={22} /></button>
      </div>

      <div className="cm-al-find-search">
        <div className="cm-al-find-box">
          <label className="cm-al-find-label">
            <SearchIcon size={20} />
            <span className="cm-sr">Search for a name, a group or a place</span>
            <input
              ref={field}
              type="search"
              value={query}
              placeholder="A name, a group or a place"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              maxLength={60}
              data-autofocus
              onChange={event => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </label>
          {query && <button type="button" className="cm-al-find-clear" aria-label="Clear the search" onClick={clear}><CloseIcon size={18} /></button>}
        </div>
        <p className="cm-al-find-count" role="status">{searching ? foundLabel(results) : ""}</p>
      </div>

      <CommunitySearch results={results} over={over} onClose={onClose} />
    </CommunityDialog>
  );
}
