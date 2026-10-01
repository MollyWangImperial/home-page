export const JOURNEY_VISITS_KEY = "rehyn.journey.visits.v1";
export type JourneyView = "locked" | "Progress" | "Journal" | "Medals";
const views: JourneyView[] = ["locked", "Progress", "Journal", "Medals"];
type VisitStorage = Pick<Storage, "getItem" | "setItem">;

/** Each Journey view has one entrance, including across route changes and reloads. */
export function createJourneyVisitStore(storage: () => VisitStorage) {
  const fallback = new Set<JourneyView>();
  const read = (): Set<JourneyView> => {
    try {
      const saved: unknown = JSON.parse(storage().getItem(JOURNEY_VISITS_KEY) ?? "null");
      const valid = Array.isArray(saved) ? views.filter(view => saved.includes(view)) : [];
      return new Set([...valid, ...fallback]);
    } catch { return new Set(fallback); }
  };
  return {
    hasVisited: (view: JourneyView) => read().has(view),
    remember(view: JourneyView) {
      const seen = read();
      seen.add(view);
      try {
        storage().setItem(JOURNEY_VISITS_KEY, JSON.stringify([...seen]));
        fallback.clear();
      } catch { fallback.add(view); }
    },
  };
}

export const journeyVisitStore = createJourneyVisitStore(() => localStorage);
