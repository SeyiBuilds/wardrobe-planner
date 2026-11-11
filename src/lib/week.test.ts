import { addDays, dayKey, dayName, daysBetween, formatWeekRange, isSameDay, parseDay, planWindow, weekOf } from "./week";

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

describe("day keys", () => {
  it("writes a date as year-month-day in local time", () => {
    expect(dayKey(new Date(2026, 10, 9, 23, 30))).toBe("2026-11-09");
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("reads a key back as local midnight", () => {
    expect(parseDay("2026-11-09")).toEqual(new Date(2026, 10, 9));
  });

  it("adds days across a month and a year", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-09", -1)).toBe("2026-11-08");
  });

  it("counts whole days between two keys", () => {
    expect(daysBetween("2026-11-02", "2026-11-09")).toBe(7);
    expect(daysBetween("2026-11-09", "2026-11-02")).toBe(-7);
  });
});

describe("planWindow", () => {
  it("plans the rest of the current week on a weekday", () => {
    const window = planWindow(new Date(2026, 10, 11, 9)); // Wednesday 11 November

    expect(window.sundayEvening).toBe(false);
    expect(window.today).toBe("2026-11-11");
    expect(window.days).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(window.planFrom).toBe("2026-11-11");
    expect(window.checkUpTo).toBe("2026-11-08");
  });

  it("still plans this week on Sunday afternoon", () => {
    const window = planWindow(new Date(2026, 10, 15, 16, 59)); // Sunday 15 November

    expect(window.sundayEvening).toBe(false);
    expect(window.planFrom).toBe("2026-11-15");
    expect(window.checkUpTo).toBe("2026-11-08");
  });

  it("moves on to next week from 5pm on Sunday, checking today too", () => {
    const window = planWindow(new Date(2026, 10, 15, 17)); // Sunday 15 November

    expect(window.sundayEvening).toBe(true);
    expect(window.days[0]).toBe("2026-11-16");
    expect(window.days[6]).toBe("2026-11-22");
    expect(window.planFrom).toBe("2026-11-16");
    expect(window.checkUpTo).toBe("2026-11-15");
  });
});
