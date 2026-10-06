import { useCallback, useEffect, useState, useSyncExternalStore, type FocusEvent } from "react";

/** Whether a media query matches, kept up to date as it changes (a window resized, a setting turned on). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches, () => false);
}

export type Turn = {
  /** The one on show. */
  shown: number;
  /** The one that has just left, so it can leave the other way; -1 before the first turn. */
  left: number;
  /** Spread onto the element that holds the turning still while it is pointed at or has the focus. */
  hold: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
  };
};

/**
 * Turns through `count` things, one every `every` milliseconds, while `on`. It holds still while
 * the pointer is over the element given `hold`, or the focus is inside it, and starts the wait
 * afresh when let go, so nothing changes under someone reading or about to press.
 */
export function useTurn(count: number, on: boolean, every = 5000): Turn {
  const [at, setAt] = useState(0);
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const turning = on && count > 1 && !pointed && !focused;

  useEffect(() => {
    if (!turning) return;
    const timer = window.setTimeout(() => setAt(current => current + 1), every);
    return () => window.clearTimeout(timer);
  }, [at, turning, every]);

  return {
    shown: count > 0 ? at % count : 0,
    left: count > 1 && at > 0 ? (at - 1) % count : -1,
    hold: {
      onMouseEnter: () => setPointed(true),
      onMouseLeave: () => setPointed(false),
      onFocus: () => setFocused(true),
      onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); },
    },
  };
}

/** The class for one of the things a `Turn` goes through: on show, just left, or waiting. */
export function turnClass(turn: Turn, index: number, base: string): string {
  return `${base}${index === turn.shown ? " is-shown" : index === turn.left ? " is-gone" : ""}`;
}
