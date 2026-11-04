import { dayName, formatWeekRange, isSameDay, weekOf } from "./week";

describe("weekOf", () => {
  it("starts on Monday and has seven days", () => {
    const days = weekOf(new Date(2026, 10, 4)); // Wednesday 4 November 2026

    expect(days).toHaveLength(7);
    expect(dayName(days[0])).toBe("Monday");
    expect(days[0].getDate()).toBe(2);
    expect(dayName(days[6])).toBe("Sunday");
    expect(days[6].getDate()).toBe(8);
  });

  it("keeps Sunday in the week that began the Monday before", () => {
    const days = weekOf(new Date(2026, 10, 8)); // Sunday 8 November 2026

    expect(days[0].getDate()).toBe(2);
    expect(days[6].getDate()).toBe(8);
  });

  it("treats Monday as the first day of its own week", () => {
    const days = weekOf(new Date(2026, 10, 9)); // Monday 9 November 2026

    expect(days[0].getDate()).toBe(9);
  });

  it("crosses a year boundary", () => {
    const days = weekOf(new Date(2027, 0, 1)); // Friday 1 January 2027

    expect(days[0]).toEqual(new Date(2026, 11, 28));
    expect(days[6]).toEqual(new Date(2027, 0, 3));
  });
});

describe("isSameDay", () => {
  it("ignores the time of day", () => {
    expect(isSameDay(new Date(2026, 10, 4, 1), new Date(2026, 10, 4, 23))).toBe(true);
  });

  it("tells neighbouring days apart", () => {
    expect(isSameDay(new Date(2026, 10, 4), new Date(2026, 10, 5))).toBe(false);
  });
});

describe("formatWeekRange", () => {
  it("names the month once when the week stays inside it", () => {
    expect(formatWeekRange(weekOf(new Date(2026, 10, 4)))).toBe("2 to 8 November");
  });

  it("names both months when the week crosses one", () => {
    expect(formatWeekRange(weekOf(new Date(2026, 10, 30)))).toBe("30 November to 6 December");
  });
});
