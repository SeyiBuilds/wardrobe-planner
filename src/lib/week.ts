const LOCALE = "en-GB";

// The seven days of the week containing `date`, Monday first.
export function weekOf(date: Date): Date[] {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return Array.from(
    { length: 7 },
    (_, index) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday + index),
  );
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dayName(date: Date): string {
  return date.toLocaleDateString(LOCALE, { weekday: "long" });
}

export function dayLetter(date: Date): string {
  return date.toLocaleDateString(LOCALE, { weekday: "narrow" });
}

export function shortDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

// "2 to 8 November", or "30 November to 6 December" when the week crosses a month.
export function formatWeekRange(days: Date[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  const lastLabel = last.toLocaleDateString(LOCALE, { day: "numeric", month: "long" });

  if (first.getMonth() === last.getMonth()) return `${first.getDate()} to ${lastLabel}`;

  const firstLabel = first.toLocaleDateString(LOCALE, { day: "numeric", month: "long" });
  return `${firstLabel} to ${lastLabel}`;
}

// Days are stored as "2026-11-09" in the phone's own time zone, so a day never shifts at midnight UTC.
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(key: string, days: number): string {
  const date = parseDay(key);
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

export function daysBetween(from: string, to: string): number {
  // Rounding absorbs the hour lost or gained when clocks change.
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

// The weekly check opens from this hour on Sunday, and planning moves on to next week.
export const CHECK_HOUR = 17;

export type PlanWindow = {
  today: string;
  sundayEvening: boolean;
  // The week the app is planning for: this week, or next week from Sunday evening.
  days: string[];
  // The first day still to plan; earlier days of the week have already happened.
  planFrom: string;
  // The weekly check covers unchecked days up to and including this one: the whole week from
  // Sunday evening, and otherwise only earlier weeks whose check was missed.
  checkUpTo: string;
};

export function planWindow(now: Date): PlanWindow {
  const today = dayKey(now);
  const sundayEvening = now.getDay() === 0 && now.getHours() >= CHECK_HOUR;
  const thisMonday = dayKey(weekOf(now)[0]);
  const weekStart = sundayEvening ? addDays(today, 1) : thisMonday;
  return {
    today,
    sundayEvening,
    days: Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    planFrom: sundayEvening ? weekStart : today,
    checkUpTo: sundayEvening ? today : addDays(thisMonday, -1),
  };
}
