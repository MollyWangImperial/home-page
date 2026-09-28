import type { LegalSection } from "./legal-content";

// Informational wording from the existing app's data-permissions screen.
// Account consent controls remain in the authenticated app, not this public page.
export const DATA_SECTIONS: LegalSection[] = [
  {
    title: "Using my health information to build my plan",
    paragraphs: [
      "Rehyn uses your movement videos, the measurements taken from them, your assessment answers and your goals to build and adapt your rehabilitation plan and show your progress. This is sensitive information, so we need your permission to use it.",
      "Turning this off means we can no longer provide your rehabilitation plan. Your account will stay open and you can turn it back on whenever you want.",
    ],
  },
  {
    title: "Help improve Rehyn",
    paragraphs: [
      "Optional",
      "When this is on, we may use your movement measurements, assessment results, activity completion and feedback to train, test and improve Rehyn's technology and accuracy. Before we do, we remove your name, email address and account details and replace them with a code.",
      "Your raw videos are used only to take the measurements and are then deleted. They are not used for training.",
      "This is optional. Every feature and your full rehabilitation plan work exactly the same either way. Turning it off stops any further use from the moment you switch it.",
    ],
  },
  {
    title: "Reminders and encouragement",
    paragraphs: ["Prompts from Alira to help you keep going with your plan."],
  },
  {
    title: "Updates about Rehyn",
    paragraphs: [
      "Optional · Off by default",
      "Occasional emails about new features and how Rehyn is developing. Nothing about your health is included.",
    ],
  },
  {
    title: "Device permissions",
    paragraphs: ["Manage in device settings"],
    bullets: [
      "Camera: Needed to record your movement assessments.",
      "Notifications: Needed to send you reminders.",
    ],
  },
  {
    title: "Your data",
    paragraphs: [],
    bullets: [
      "Download my data: Get a copy of the information Rehyn holds about you, in a format you can open and keep.",
      "Correct my information: Tell us about anything that is wrong or out of date, and we will fix it.",
      "Delete my account and data: Permanently close your account and delete your information. This cannot be undone.",
    ],
  },
  {
    title: "Documents and contact",
    paragraphs: [
      "Questions about your information: info@rehyn.com",
      "If you are unhappy with how we have handled your information, please tell us first so we can put it right. You can also complain to the Information Commissioner's Office at ico.org.uk.",
    ],
  },
];
