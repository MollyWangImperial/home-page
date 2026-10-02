import { describe, expect, it } from "vitest";
import { buildRunnerUrl, parseRunnerMessage } from "./assessment";

describe("movement results Done return route", () => {
  it.each(["/alira", "/alira?onboarding=1"] as const)("keeps %s for the guest runner", returnTo => {
    const url = new URL(buildRunnerUrl("https://rehyn.onrender.com", {
      affectedSide: "left", guestReview: true, returnTo,
    }));
    expect(url.searchParams.get("return_to")).toBe(returnTo);
    expect(url.searchParams.get("affected_side")).toBe("left");
    expect(url.searchParams.get("task_ids")).toBe("T1,T3,H4,H3,L6");
  });
  it("defaults guest completion to Alira and never adds guest navigation to ordinary runners", () => {
    expect(new URL(buildRunnerUrl("https://rehyn.onrender.com", {affectedSide:"right",guestReview:true})).searchParams.get("return_to")).toBe("/alira");
    expect(new URL(buildRunnerUrl("http://localhost:8001", {affectedSide:"right",returnTo:"/alira?onboarding=1"})).searchParams.has("return_to")).toBe(false);
  });
  it("retains the existing string and object exit message compatibility", () => {
    expect(parseRunnerMessage('{"type":"exit"}')).toEqual({type:"exit"});
    expect(parseRunnerMessage({type:"exit"})).toEqual({type:"exit"});
    expect(parseRunnerMessage('exit')).toBe(null);
  });
});
