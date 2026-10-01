import { createContext } from "react";

export type SettingsView = "profile" | "exercise" | "molly" | "howitworks" | "learning" | "privacy" | "data" | "terms";
export type OpenSettings = (opener: HTMLElement | null, view?: SettingsView) => void;

// Keep the context identity stable when the settings UI reloads during development.
export const SettingsContext = createContext<OpenSettings | null>(null);
