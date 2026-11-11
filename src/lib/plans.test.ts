import type { Piece } from "./pieces";
import type { DayType } from "./planner";
import {
  afterSwap,
  DEFAULT_WEEK,
  dayTypeFor,
  knownOutfits,
  laundryAfterCheck,
  rowFromPlan,
  slotsOf,
  weekStatus,
  type Outfit,
} from "./plans";

function outfit(day: string, fields: Partial<Outfit> = {}): Outfit {
  return {
    id: `outfit-${day}`,
    user_id: "u1",
    day,
    day_type: "corporate",
    top_id: null,
    trousers_id: null,
    suit_id: null,
    native_set_id: null,
    shoes_id: null,
    watch_id: null,
    belt_id: null,
    notes: [],
    worn: null,
    checked_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

function piece(id: string, fields: Partial<Piece> = {}): Piece {
  return {
    id,
    user_id: "u1",
    type: "top",
    name: "",
    colour_name: "",
    colours: [],
    formality: "smart",
    occasions: ["corporate"],
    pattern: "plain",
    wears_before_wash: 1,
    wears_since_wash: 0,
    in_wash: false,
    photo_path: `u1/${id}.jpg`,
    label_status: "done",
    reviewed: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

describe("slots and rows", () => {
  it("reads an outfit's filled slots", () => {
    expect(slotsOf(outfit(WEEK[0], { top_id: "t", trousers_id: "b", shoes_id: "s" }))).toEqual({
      top: "t",
      trousers: "b",
      shoes: "s",
    });
  });

  it("turns a day's plan into a row with every slot set", () => {
    const row = rowFromPlan(
      { day: WEEK[0], dayType: "corporate", slots: { top: "t", shoes: "s" }, notes: [{ slot: "trousers", text: "None left." }] },
      "u1",
    );

    expect(row).toEqual({
      user_id: "u1",
      day: WEEK[0],
      day_type: "corporate",
      top_id: "t",
      trousers_id: null,
      suit_id: null,
      native_set_id: null,
      shoes_id: "s",
      watch_id: null,
      belt_id: null,
      notes: [{ slot: "trousers", text: "None left." }],
    });
  });

  it("gives the planner what was actually worn on checked days", () => {
    const known = knownOutfits([
      outfit(WEEK[0], { top_id: "t", trousers_id: "b", worn: ["b"], checked_at: "2026-11-15T18:00:00Z" }),
      outfit(WEEK[1], { top_id: "t2" }),
      outfit(WEEK[2], { top_id: "t3" }),
    ], WEEK[2]);

    expect(known).toEqual([
      { day: WEEK[0], slots: { trousers: "b" }, checked: true },
      { day: WEEK[1], slots: { top: "t2" }, checked: false },
    ]);
  });

  it("drops the notes about a slot once you choose its piece yourself", () => {
    const changes = afterSwap(
      outfit(WEEK[0], {
        notes: [
          { text: "Same top and trousers as on Monday 2 November." },
          { slot: "trousers", text: "No clean trousers left." },
          { slot: "shoes", text: "Shoes were all worn the day before." },
        ],
      }),
      "trousers",
      "b",
    );

    expect(changes).toEqual({ trousers_id: "b", notes: [{ slot: "shoes", text: "Shoes were all worn the day before." }] });
  });
});

describe("dayTypeFor", () => {
  const week: DayType[] = ["corporate", "corporate", "corporate", "corporate", "native", "casual", "church"];

  it("reads Monday first and Sunday last", () => {
    expect(dayTypeFor("2026-11-09", week)).toBe("corporate");
    expect(dayTypeFor("2026-11-13", week)).toBe("native");
    expect(dayTypeFor("2026-11-15", week)).toBe("church");
  });

  it("starts from weekdays corporate, Saturday casual and Sunday church", () => {
    expect(DEFAULT_WEEK).toEqual(["corporate", "corporate", "corporate", "corporate", "corporate", "casual", "church"]);
  });
});

describe("weekStatus", () => {
  it("offers to plan the rest of the week the first time", () => {
    const status = weekStatus(new Date(2026, 10, 11, 9), [], DEFAULT_WEEK);

    expect(status.due).toEqual([]);
    expect(status.toPlan).toEqual([
      { day: "2026-11-11", dayType: "corporate" },
      { day: "2026-11-12", dayType: "corporate" },
      { day: "2026-11-13", dayType: "corporate" },
      { day: "2026-11-14", dayType: "casual" },
      { day: "2026-11-15", dayType: "church" },
    ]);
    expect(status.shownDays).toEqual(WEEK);
    expect(status.showingNextWeek).toBe(false);
  });

  it("has nothing to do midweek once the week is planned", () => {
    const status = weekStatus(new Date(2026, 10, 11, 9), WEEK.map((day) => outfit(day)), DEFAULT_WEEK);

    expect(status.due).toEqual([]);
    expect(status.toPlan).toEqual([]);
  });

  it("asks for the check from Sunday at 5pm, covering Sunday too", () => {
    const outfits = WEEK.map((day) => outfit(day));

    const status = weekStatus(new Date(2026, 10, 15, 17, 30), outfits, DEFAULT_WEEK);

    expect(status.due.map((o) => o.day)).toEqual(WEEK);
    expect(status.toPlan.map((d) => d.day)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(status.shownDays).toEqual(WEEK);
  });

  it("shows next week once it's planned on Sunday evening", () => {
    const outfits = [
      ...WEEK.map((day) => outfit(day, { checked_at: "2026-11-15T18:00:00Z", worn: [] })),
      outfit("2026-11-16"),
    ];

    const status = weekStatus(new Date(2026, 10, 15, 19), outfits, DEFAULT_WEEK);

    expect(status.due).toEqual([]);
    expect(status.showingNextWeek).toBe(true);
    expect(status.shownDays[0]).toBe("2026-11-16");
  });

  it("keeps waiting for a missed check the next time you open the app", () => {
    const status = weekStatus(new Date(2026, 10, 17, 8), WEEK.map((day) => outfit(day)), DEFAULT_WEEK);

    expect(status.due).toHaveLength(7);
    expect(status.toPlan[0]).toEqual({ day: "2026-11-17", dayType: "corporate" });
  });
});

describe("laundryAfterCheck", () => {
  it("lists what's already in the wash and what this week used up", () => {
    const pieces = [
      piece("washing", { in_wash: true }),
      piece("worn-top", { wears_before_wash: 1 }),
      piece("trousers-once", { type: "trousers", wears_before_wash: 2 }),
      piece("trousers-twice", { type: "trousers", wears_before_wash: 2, wears_since_wash: 1 }),
      piece("shoes", { type: "shoes", wears_before_wash: null }),
      piece("unworn-top"),
    ];
    const worn = { a: ["worn-top", "trousers-once", "shoes"], b: ["trousers-twice"] };

    expect(laundryAfterCheck(pieces, worn).map((p) => p.id)).toEqual(["washing", "worn-top", "trousers-twice"]);
  });
});
