export const HOW_IT_WORKS_VISIT_KEY = "rehyn.how-it-works.visit.v1";
type VisitStorage = Pick<Storage, "getItem" | "setItem">;

/** Opening the tab consumes its greeting animation, including when it is closed mid-message. */
export function createHowItWorksVisitStore(storage: () => VisitStorage) {
  let fallback = false;
  return {
    hasVisited() {
      try { return storage().getItem(HOW_IT_WORKS_VISIT_KEY) === "1" || fallback; }
      catch { return fallback; }
    },
    remember() {
      try { storage().setItem(HOW_IT_WORKS_VISIT_KEY, "1"); fallback = false; }
      catch { fallback = true; }
    },
  };
}

export const howItWorksVisitStore = createHowItWorksVisitStore(() => localStorage);
