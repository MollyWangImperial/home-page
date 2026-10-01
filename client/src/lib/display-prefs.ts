import { useSyncExternalStore } from "react";

// Larger text and stronger contrast, shared by the page shell's buttons and Alira, who can switch
// them when asked. They last while the app is open, like before, and are not saved.

export type DisplayPrefs = { largeText: boolean; strongContrast: boolean };

let prefs: DisplayPrefs = { largeText: false, strongContrast: false };
const listeners = new Set<() => void>();

export function getDisplayPrefs(): DisplayPrefs {
  return prefs;
}

export function setDisplayPrefs(change: Partial<DisplayPrefs>): DisplayPrefs {
  prefs = { ...prefs, ...change };
  listeners.forEach(listener => listener());
  return prefs;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, getDisplayPrefs, getDisplayPrefs);
}
