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
