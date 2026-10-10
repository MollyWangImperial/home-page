// "Add to calendar" for the circles coming up: the next meeting, put straight into the person's own
// calendar (Google, Outlook, or a calendar file for Apple Calendar and the rest), repeating weekly,
// with a reminder half an hour before. Only the circle's name and time go into the calendar.

export type CircleMeeting = { id: string; name: string; detail: string; day: number; hour: number; minutes: number };

const MINUTE = 60_000;

/** The next time a weekly circle meets, from `now`. One that has already started today is next week's. */
export function nextMeeting(meeting: Pick<CircleMeeting, "day" | "hour">, now = new Date()): Date {
  const start = new Date(now);
  start.setHours(meeting.hour, 0, 0, 0);
  let days = (meeting.day - start.getDay() + 7) % 7;
  if (days === 0 && start.getTime() <= now.getTime()) days = 7;
  start.setDate(start.getDate() + days);
  return start;
}

/** "TUE" and "13", for the little calendar page beside a circle. */
export function calendarPage(date: Date): { day: string; date: string } {
  return { day: date.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(), date: String(date.getDate()) };
}

/** 20261013T140000Z */
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function about(meeting: CircleMeeting, origin: string) {
  return `${meeting.detail}. Join from My community in Rehyn${origin ? `: ${origin}/community?space=circle` : "."}`;
}

/** A Google Calendar page with the circle filled in, ready to save. */
export function googleCalendarUrl(meeting: CircleMeeting, start: Date, origin = ""): string {
  const end = new Date(start.getTime() + meeting.minutes * MINUTE);
  const query = new URLSearchParams({ action: "TEMPLATE", text: meeting.name, dates: `${utc(start)}/${utc(end)}`, details: about(meeting, origin), recur: "RRULE:FREQ=WEEKLY" });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

/** An Outlook calendar page with the circle filled in, ready to save. */
export function outlookCalendarUrl(meeting: CircleMeeting, start: Date, origin = ""): string {
  const end = new Date(start.getTime() + meeting.minutes * MINUTE);
  const query = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: meeting.name, startdt: start.toISOString(), enddt: end.toISOString(), body: about(meeting, origin) });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${query.toString()}`;
}

/** Text in a calendar file: commas, semicolons and backslashes escaped, new lines as \n. */
const icsText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** A calendar file (.ics) for Apple Calendar and most others: weekly, with a reminder 30 minutes before. */
export function circleIcs(meeting: CircleMeeting, start: Date, origin = "", now = new Date()): string {
  const end = new Date(start.getTime() + meeting.minutes * MINUTE);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rehyn//My community//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${meeting.id}-${utc(start)}@rehyn`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    "RRULE:FREQ=WEEKLY",
    `SUMMARY:${icsText(meeting.name)}`,
    `DESCRIPTION:${icsText(about(meeting, origin))}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`${meeting.name} starts in 30 minutes`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Opens a calendar's own page in a new tab. */
export function openCalendar(url: string) {
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}

/** Saves the calendar file, which the device then offers to add to its calendar. */
export function downloadIcs(meeting: CircleMeeting, start: Date) {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const file = new Blob([circleIcs(meeting, start, window.location.origin)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${meeting.id}-circle.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
