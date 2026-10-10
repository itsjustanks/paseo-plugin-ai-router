/** Future moments in the viewer's local calendar; server strings include a UTC date. */
export type WhenOptions = {
  timeZone?: string;
  locale?: string;
  /** Include the date and named zone even for today; use UTC for server strings. */
  sayZone?: boolean;
};

const DAY_MS = 86_400_000;

/** Calendar day count, independent of 23-hour and 25-hour daylight-saving days. */
function dayNumber(ms: number, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY_MS;
}

export function daysFrom(ms: number, now: number, timeZone?: string): number {
  return dayNumber(ms, timeZone) - dayNumber(now, timeZone);
}

/** "2:10 pm", "tomorrow 2:10 pm", "Fri 2:10 pm (in 6 days)", "Sat 17 Oct, 2:10 pm". */
export function whenWords(ms: number, now: number = Date.now(), options: WhenOptions = {}): string {
  if (!Number.isFinite(new Date(ms).getTime())) return "unknown time";
  const { timeZone, locale = "en-AU", sayZone = false } = options;
  const date = new Date(ms);
  const clock = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).toLowerCase();
  const parts = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dated = `${part("weekday")} ${part("day")} ${part("month")}, ${clock}`;
  if (sayZone && timeZone) return `${dated} ${timeZone}`;
  const days = daysFrom(ms, now, timeZone);
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  if (days === -1) return `yesterday ${clock}`;
  if (days > 1 && days < 7) return `${part("weekday")} ${clock} (in ${days} days)`;
  return dated;
}
