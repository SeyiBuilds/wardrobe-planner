import { beltMatchesShoes, readColour, sameAccent, standsOut } from "./colourRules";
import { buildProfile, type Reading, type StyleOverrides } from "./styleProfile";
import { defaultWearsFor, type Occasion, type PieceType } from "./pieceTypes";
import { planDays, swapChoices, SLOTS, type DayPlan, type DayType, type KnownOutfit, type PlannerPiece, type Slots } from "./planner";
import { addDays, daysBetween } from "./week";

// A repeatable stand-in for Math.random, so every run of a test plans the same way.
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAVY = "#1b2a4a";
const WHITE = "#f5f5f5";
const GREY = "#808080";
const BLACK = "#151515";
const BROWN = "#5a3a22";
const TAN = "#c49a6c";
const LIGHT_BLUE = "#c6d8ee";
const OLIVE = "#55603a";
const RED = "#c0392b";
const GREEN = "#2e8b57";
const WINE = "#6d1a2a";

let count = 0;
function piece(type: PieceType, hex: string, fields: Partial<PlannerPiece> & { id?: string } = {}): PlannerPiece {
  count++;
  return {
    id: fields.id ?? `${type}-${count}`,
    type,
    formality: "smart",
    occasions: ["casual", "corporate", "church"],
    pattern: "plain",
    colours: [{ hex, share: 1 }],
    wears_before_wash: defaultWearsFor(type),
    wears_since_wash: 0,
    in_wash: false,
    ...fields,
  };
}

const MONDAY = "2026-11-16";
function week(types: DayType[], start = MONDAY) {
  return types.map((dayType, index) => ({ day: addDays(start, index), dayType }));
}
const WEEKDAYS = week(["corporate", "corporate", "corporate", "corporate", "corporate"]);

function plan(days: { day: string; dayType: DayType }[], pieces: PlannerPiece[], outfits: KnownOutfit[] = [], seed = 1) {
  return planDays({ days, pieces, outfits, random: seeded(seed) });
}

function used(plans: DayPlan[], id: string) {
  return plans.filter((day) => Object.values(day.slots).includes(id)).map((day) => day.day);
}

function basicWardrobe() {
  return [
    piece("top", WHITE),
    piece("top", LIGHT_BLUE),
    piece("top", GREY),
    piece("top", WHITE),
    piece("top", LIGHT_BLUE),
    piece("top", OLIVE),
    piece("top", WHITE),
    piece("trousers", NAVY),
    piece("trousers", BLACK),
    piece("trousers", TAN),
    piece("trousers", GREY),
    piece("shoes", BLACK),
    piece("shoes", BROWN),
  ];
}

describe("planDays", () => {
  it("dresses each day with a top, trousers and shoes", () => {
    const plans = plan(WEEKDAYS, basicWardrobe());

    expect(plans).toHaveLength(5);
    for (const day of plans) {
      expect(day.slots.top).toBeDefined();
      expect(day.slots.trousers).toBeDefined();
      expect(day.slots.shoes).toBeDefined();
      expect(day.notes).toEqual([]);
    }
  });

  it("never puts the same top on twice in a week", () => {
    const plans = plan(WEEKDAYS, basicWardrobe());

    const tops = plans.map((day) => day.slots.top);
    expect(new Set(tops).size).toBe(5);
  });

  it("wears trousers at most twice, never on back-to-back days", () => {
    const pieces = [
      ...["a", "b", "c", "d", "e"].map((id) => piece("top", WHITE, { id: `top-${id}` })),
      piece("trousers", NAVY, { id: "navy" }),
      piece("trousers", BLACK, { id: "black" }),
      piece("shoes", BROWN),
      piece("shoes", BLACK),
    ];

    const plans = plan(WEEKDAYS, pieces);

    for (const id of ["navy", "black"]) {
      const days = used(plans, id);
      expect(days.length).toBeLessThanOrEqual(2);
      if (days.length === 2) expect(Math.abs(daysBetween(days[0], days[1]))).toBeGreaterThan(1);
    }
    const bare = plans.filter((day) => !day.slots.trousers);
    expect(bare).toHaveLength(1);
    expect(bare[0].notes).toEqual([{ slot: "trousers", text: "No clean trousers left for corporate days." }]);
  });

  it("leaves out pieces in the wash and counts wears already used", () => {
    const pieces = [
      piece("top", WHITE, { id: "washing", in_wash: true }),
      piece("top", LIGHT_BLUE, { id: "clean" }),
      piece("top", GREY, { id: "clean-2" }),
      piece("trousers", NAVY, { id: "half-worn", wears_since_wash: 1 }),
      piece("shoes", BLACK),
    ];

    const plans = plan(week(["corporate", "corporate", "corporate"]), pieces);

    expect(used(plans, "washing")).toEqual([]);
    expect(used(plans, "half-worn")).toHaveLength(1);
  });

  it("counts wears held by days already planned, and keeps clear of them", () => {
    const pieces = [
      piece("top", WHITE),
      piece("top", LIGHT_BLUE),
      piece("top", GREY),
      piece("trousers", NAVY, { id: "navy" }),
      piece("trousers", BLACK, { id: "black" }),
      piece("shoes", BLACK),
      piece("shoes", BROWN),
    ];
    const monday: KnownOutfit = { day: MONDAY, slots: { trousers: "navy" }, checked: false };

    const plans = plan(week(["corporate", "corporate", "corporate"], addDays(MONDAY, 1)), pieces, [monday]);

    // Navy was worn Monday, so not Tuesday; it has one wear left for later in the week.
    expect(used(plans, "navy")).not.toContain(addDays(MONDAY, 1));
    expect(used(plans, "navy").length).toBeLessThanOrEqual(1);
  });

  it("repeats shoes, but never two days in a row", () => {
    const pieces = [
      piece("top", WHITE),
      piece("top", LIGHT_BLUE),
      piece("top", GREY),
      piece("trousers", NAVY),
      piece("trousers", BLACK),
      piece("trousers", TAN),
      piece("shoes", BROWN, { id: "only-shoes" }),
    ];

    const plans = plan(week(["corporate", "corporate", "corporate"]), pieces);

    expect(used(plans, "only-shoes")).toEqual([MONDAY, addDays(MONDAY, 2)]);
    expect(plans[1].notes).toEqual([{ slot: "shoes", text: "Your corporate shoes were all worn the day before." }]);
  });

  it("only uses pieces marked Good for that kind of day", () => {
    const pieces = [
      piece("top", WHITE, { id: "weekend-top", occasions: ["casual"] }),
      piece("top", LIGHT_BLUE, { id: "office-top", occasions: ["corporate"] }),
      piece("trousers", NAVY),
      piece("shoes", BLACK),
    ];

    const plans = plan(week(["corporate"]), pieces);

    expect(plans[0].slots.top).toBe("office-top");
  });

  it("keeps formality together", () => {
    const pieces = [
      piece("top", WHITE, { formality: "formal" }),
      piece("trousers", NAVY, { formality: "formal" }),
      piece("shoes", WHITE, { id: "sneakers", formality: "relaxed" }),
      piece("shoes", BLACK, { id: "oxfords", formality: "formal" }),
    ];

    for (const seed of [1, 2, 3, 4, 5]) {
      expect(plan(week(["corporate"]), pieces, [], seed)[0].slots.shoes).toBe("oxfords");
    }
  });

  it("builds on a neutral with at most one bold colour", () => {
    const pieces = [
      piece("top", RED, { id: "red" }),
      piece("trousers", GREEN, { id: "green" }),
      piece("trousers", NAVY, { id: "navy" }),
      piece("shoes", BLACK),
    ];

    for (const seed of [1, 2, 3, 4, 5]) {
      expect(plan(week(["casual"]), pieces, [], seed)[0].slots).toMatchObject({ top: "red", trousers: "navy" });
    }
  });

  it("allows only one patterned piece", () => {
    const pieces = [
      piece("top", WHITE, { id: "checked-shirt", pattern: "patterned" }),
      piece("trousers", NAVY, { id: "plaid", pattern: "patterned" }),
      piece("trousers", GREY, { id: "plain" }),
      piece("shoes", BLACK),
    ];

    for (const seed of [1, 2, 3, 4, 5]) {
      expect(plan(week(["casual"]), pieces, [], seed)[0].slots.trousers).toBe("plain");
    }
  });

  it("makes the top stand out from the trousers", () => {
    const pieces = [
      piece("top", NAVY, { id: "navy-top" }),
      piece("trousers", "#1e2d50", { id: "navy-trousers" }),
      piece("trousers", GREY, { id: "grey-trousers" }),
      piece("shoes", BLACK),
    ];

    for (const seed of [1, 2, 3, 4, 5]) {
      expect(plan(week(["corporate"]), pieces, [], seed)[0].slots.trousers).toBe("grey-trousers");
    }
  });

  it("matches the belt to the shoes, and adds a watch", () => {
    const pieces = [
      piece("top", WHITE),
      piece("trousers", NAVY),
      piece("shoes", BLACK, { id: "black-shoes" }),
      piece("belt", BROWN, { id: "brown-belt" }),
      piece("belt", BLACK, { id: "black-belt" }),
      piece("watch", GREY, { id: "watch" }),
    ];

    const [day] = plan(week(["corporate"]), pieces);

    expect(day.slots).toMatchObject({ shoes: "black-shoes", belt: "black-belt", watch: "watch" });
  });

  it("leaves out a watch or belt quietly when none fits", () => {
    const pieces = [piece("top", WHITE), piece("trousers", NAVY), piece("shoes", BLACK), piece("belt", BROWN)];

    const [day] = plan(week(["corporate"]), pieces);

    expect(day.slots.belt).toBeUndefined();
    expect(day.slots.watch).toBeUndefined();
    expect(day.notes).toEqual([]);
  });

  it("dresses native days in a native set, without a belt", () => {
    const pieces = [
      piece("top", WHITE),
      piece("trousers", NAVY),
      piece("native_set", WINE, { id: "agbada", occasions: ["native", "church"] }),
      piece("shoes", BROWN, { id: "loafers", occasions: ["native", "church", "corporate"] }),
      piece("belt", BROWN, { occasions: ["native", "corporate"] }),
    ];

    const [day] = plan(week(["native"]), pieces);

    expect(day.slots).toEqual({ native_set: "agbada", shoes: "loafers" });
  });

  it("may use a suit with a shirt on corporate days", () => {
    const pieces = [piece("top", WHITE, { id: "shirt" }), piece("suit", NAVY, { id: "suit" }), piece("shoes", BLACK)];

    const [day] = plan(week(["corporate"]), pieces);

    expect(day.slots).toMatchObject({ top: "shirt", suit: "suit" });
    expect(day.slots.trousers).toBeUndefined();
  });

  it("plans nothing for days set to no outfit", () => {
    const [day] = plan(week(["none"]), basicWardrobe());

    expect(day).toEqual({ day: MONDAY, dayType: "none", slots: {}, notes: [] });
  });

  it("says when nothing is marked Good for that kind of day", () => {
    const pieces = [piece("top", WHITE, { occasions: ["casual"] }), piece("trousers", NAVY), piece("shoes", BLACK)];

    const [day] = plan(week(["church"]), pieces);

    expect(day.slots.top).toBeUndefined();
    expect(day.notes).toContainEqual({ slot: "top", text: "None of your tops are marked Good for church." });
  });

  it("ignores pieces the AI hasn't read yet", () => {
    const pieces = [
      piece("top", WHITE, { id: "unread", formality: null, occasions: [] }),
      piece("top", GREY, { id: "read" }),
      piece("trousers", NAVY),
      piece("shoes", BLACK),
    ];

    expect(plan(week(["corporate"]), pieces)[0].slots.top).toBe("read");
  });

  it("changes combinations from recent weeks", () => {
    const pieces = [
      piece("top", WHITE, { id: "A" }),
      piece("top", LIGHT_BLUE, { id: "B" }),
      piece("trousers", NAVY, { id: "X" }),
      piece("trousers", GREY, { id: "Y" }),
      piece("shoes", BLACK),
    ];
    const lastWeek: KnownOutfit = { day: addDays(MONDAY, -7), slots: { top: "A", trousers: "X" }, checked: true };

    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const [day] = plan(week(["corporate"]), pieces, [lastWeek], seed);
      expect([day.slots.top, day.slots.trousers]).not.toEqual(["A", "X"]);
    }
  });

  it("reuses the oldest combination when it has to, and says so", () => {
    const pieces = [
      piece("top", WHITE, { id: "A" }),
      piece("trousers", NAVY, { id: "X" }),
      piece("trousers", GREY, { id: "Y" }),
      piece("shoes", BLACK),
    ];
    const history: KnownOutfit[] = [
      { day: addDays(MONDAY, -7), slots: { top: "A", trousers: "X" }, checked: true },
      { day: addDays(MONDAY, -14), slots: { top: "A", trousers: "Y" }, checked: true },
    ];

    const [day] = plan(week(["corporate"]), pieces, history);

    expect(day.slots).toMatchObject({ top: "A", trousers: "Y" });
    expect(day.notes).toEqual([
      { text: "Same top and trousers as on Monday 2 November: there weren't enough clean pieces for a new pair." },
    ]);
  });

  it("spreads wear to pieces you haven't worn lately", () => {
    const pieces = [
      piece("top", WHITE, { id: "recent" }),
      piece("top", WHITE, { id: "rested" }),
      piece("trousers", NAVY),
      piece("shoes", BLACK),
    ];
    const history: KnownOutfit[] = [{ day: addDays(MONDAY, -3), slots: { top: "recent" }, checked: true }];

    const picks = [...Array(20).keys()].map((seed) => plan(week(["corporate"]), pieces, history, seed)[0].slots.top);

    expect(picks.filter((id) => id === "rested").length).toBeGreaterThanOrEqual(18);
  });

  it("varies from week to week", () => {
    const pieces = basicWardrobe();

    const plans = [1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(plan(WEEKDAYS, pieces, [], seed).map((day) => day.slots)));

    expect(new Set(plans).size).toBeGreaterThan(1);
  });

  it("picks something different when asked to avoid the current outfit", () => {
    const pieces = basicWardrobe();
    const [first] = plan(week(["corporate"]), pieces);

    for (const seed of [1, 2, 3, 4, 5]) {
      const [again] = planDays({
        days: week(["corporate"]),
        pieces,
        outfits: [],
        random: seeded(seed),
        avoid: { [MONDAY]: first.slots },
      });
      expect([again.slots.top, again.slots.trousers]).not.toEqual([first.slots.top, first.slots.trousers]);
    }
  });

  it("can avoid several outfits already seen for a day", () => {
    const pieces = basicWardrobe();
    const seen: Slots[] = [];
    for (let i = 0; i < 3; i++) {
      const [next] = planDays({
        days: week(["corporate"]),
        pieces,
        outfits: [],
        random: seeded(i + 1),
        avoid: { [MONDAY]: seen },
      });
      for (const old of seen) {
        expect([next.slots.top, next.slots.trousers]).not.toEqual([old.top, old.trousers]);
      }
      seen.push(next.slots);
    }
  });

  it("replaces any outfit already saved for the days it plans", () => {
    const pieces = [piece("top", WHITE, { id: "only-top" }), piece("trousers", NAVY), piece("shoes", BLACK)];
    const old: KnownOutfit = { day: MONDAY, slots: { top: "only-top" }, checked: false };

    const [day] = plan(week(["corporate"]), pieces, [old]);

    expect(day.slots.top).toBe("only-top");
  });
});

// Checks every rule independently of the planner, so the stress test below can't just agree with itself.
function breaksARule(plans: DayPlan[], pieces: PlannerPiece[], dayTypes: Record<string, DayType>): string | null {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const level = { relaxed: 0, smart: 1, formal: 2 };
  const uses = new Map<string, string[]>();

  for (const day of plans) {
    const outfit = SLOTS.map((slot) => day.slots[slot]).filter((id): id is string => !!id).map((id) => byId.get(id)!);
    for (const p of outfit) {
      if (!p.occasions.includes(dayTypes[day.day] as Occasion)) return `${p.id} isn't marked for ${day.day}`;
      if (p.in_wash) return `${p.id} is in the wash`;
      uses.set(p.id, [...(uses.get(p.id) ?? []), day.day]);
    }
    const levels = outfit.map((p) => level[p.formality!]);
    if (Math.max(...levels) - Math.min(...levels) > 1) return `${day.day} mixes formality`;
    const accents = outfit
      .map((p) => readColour(p.colours[0].hex))
      .filter((colour) => !colour.neutral)
      .reduce<ReturnType<typeof readColour>[]>((groups, colour) => (groups.some((g) => sameAccent(g, colour)) ? groups : [...groups, colour]), []);
    if (accents.length > 1) return `${day.day} has ${accents.length} bold colours`;
    if (outfit.filter((p) => p.pattern === "patterned").length > 1) return `${day.day} has two patterns`;
    const colour = (slot: "top" | "trousers" | "suit" | "shoes" | "belt") =>
      day.slots[slot] ? readColour(byId.get(day.slots[slot]!)!.colours[0].hex) : null;
    const top = colour("top");
    const bottom = colour("trousers") ?? colour("suit");
    if (top && bottom && !standsOut(top, bottom)) return `${day.day} top blends into trousers`;
    if (top && bottom && !top.neutral && !bottom.neutral) return `${day.day} has no neutral base`;
    const shoes = colour("shoes");
    const belt = colour("belt");
    if (shoes && belt && !beltMatchesShoes(belt, shoes)) return `${day.day} belt doesn't match shoes`;
  }

  for (const [id, days] of uses) {
    const p = byId.get(id)!;
    if (p.wears_before_wash !== null && days.length > p.wears_before_wash - p.wears_since_wash) return `${id} worn too often`;
    const sorted = [...days].sort();
    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(sorted[i - 1], sorted[i]) < 2) return `${id} worn on back-to-back days`;
    }
  }
  return null;
}

describe("planDays under stress", () => {
  const HEXES = [NAVY, WHITE, GREY, BLACK, BROWN, TAN, LIGHT_BLUE, OLIVE, RED, GREEN, WINE];
  const FORMALITY = ["relaxed", "smart", "formal"] as const;
  const OCCASION_SETS: Occasion[][] = [["casual"], ["corporate", "church"], ["casual", "corporate", "church"], ["native", "church"]];

  function randomWardrobe(seed: number) {
    const random = seeded(seed);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    const counts: [PieceType, number][] = [
      ["top", 14],
      ["trousers", 7],
      ["suit", 2],
      ["native_set", 3],
      ["shoes", 5],
      ["watch", 2],
      ["belt", 3],
    ];
    return counts.flatMap(([type, n]) =>
      Array.from({ length: n }, () =>
        piece(type, pick(HEXES), {
          formality: pick(FORMALITY),
          occasions: pick(OCCASION_SETS),
          pattern: random() < 0.2 ? "patterned" : "plain",
          in_wash: random() < 0.1,
        }),
      ),
    );
  }

  it("keeps every rule across 30 random wardrobes and weeks", () => {
    const days = week(["corporate", "corporate", "corporate", "native", "corporate", "casual", "church"]);
    const dayTypes = Object.fromEntries(days.map((d) => [d.day, d.dayType]));

    for (let seed = 1; seed <= 30; seed++) {
      const pieces = randomWardrobe(seed);
      const plans = plan(days, pieces, [], seed);
      expect(breaksARule(plans, pieces, dayTypes), `seed ${seed}`).toBeNull();
    }
  });

  it("plans a full week quickly", () => {
    const pieces = randomWardrobe(99);
    const started = performance.now();

    plan(week(["corporate", "corporate", "corporate", "corporate", "corporate", "casual", "church"]), pieces);

    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("swapChoices", () => {
  const pieces = [
    piece("top", WHITE, { id: "white-top" }),
    piece("trousers", NAVY, { id: "navy" }),
    piece("trousers", "#f2f2f0", { id: "white-trousers" }),
    piece("trousers", GREY, { id: "grey", in_wash: true }),
    piece("trousers", TAN, { id: "weekend", occasions: ["casual"] }),
    piece("trousers", BLACK, { id: "worn-yesterday" }),
    piece("shoes", BLACK, { id: "shoes" }),
  ];
  const yesterday: KnownOutfit = { day: addDays(MONDAY, -1), slots: { trousers: "worn-yesterday" }, checked: false };
  const today = { top: "white-top", trousers: "navy", shoes: "shoes" };

  function choices() {
    return swapChoices({ day: MONDAY, dayType: "corporate", slots: today, slot: "trousers", pieces, outfits: [yesterday] });
  }

  it("leaves out pieces that are in the wash", () => {
    expect(choices().map((choice) => choice.id)).not.toContain("grey");
  });

  it("lists pieces that fit first, including the one already there", () => {
    expect(choices()[0]).toEqual({ id: "navy", clash: null });
  });

  it("still offers pieces that break a rule, saying which", () => {
    expect(choices()).toEqual(
      expect.arrayContaining([
        { id: "white-trousers", clash: "Too close to the top's colour" },
        { id: "weekend", clash: "Not marked Good for corporate" },
        { id: "worn-yesterday", clash: "Worn the day before" },
      ]),
    );
  });
});

describe("planDays with your style", () => {
  function readings(n: number, day: Reading["day_type"], top: string, bottom: string): Reading[] {
    return Array.from({ length: n }, () => ({
      day_type: day,
      formality: "smart" as const,
      pieces: [
        { kind: "top", colour: top, patterned: false },
        { kind: "trousers", colour: bottom, patterned: false },
      ],
    }));
  }

  function styled(list: Reading[], overrides: StyleOverrides = {}) {
    return { profile: buildProfile(list), overrides };
  }

  const pairWardrobe = () => [
    piece("top", WHITE, { id: "white-top" }),
    piece("top", LIGHT_BLUE, { id: "blue-top" }),
    piece("trousers", NAVY, { id: "navy" }),
    piece("trousers", GREY, { id: "grey" }),
    piece("shoes", BLACK),
  ];

  it("prefers the colour pairs your pictures show", () => {
    const pieces = pairWardrobe();
    const style = styled(readings(10, "corporate", "white", "grey"));

    const picks = [...Array(10).keys()].map((seed) => {
      const [day] = planDays({ days: week(["corporate"]), pieces, outfits: [], random: seeded(seed), style });
      return `${day.slots.top}+${day.slots.trousers}`;
    });

    expect(picks.filter((pick) => pick === "white-top+grey").length).toBeGreaterThanOrEqual(9);
  });

  it("says why in one line", () => {
    const [day] = planDays({
      days: week(["corporate"]),
      pieces: pairWardrobe(),
      outfits: [],
      random: seeded(1),
      style: styled(readings(10, "corporate", "white", "grey")),
    });

    expect(day.notes).toContainEqual({ kind: "why", text: "White and grey, like 10 of your corporate pictures." });
  });

  it("uses all your pictures for a kind of day that has none of its own", () => {
    const [day] = planDays({
      days: week(["casual"]),
      pieces: pairWardrobe(),
      outfits: [],
      random: seeded(1),
      style: styled(readings(10, "corporate", "white", "grey")),
    });

    expect(day.notes).toContainEqual({ kind: "why", text: "White and grey, like 10 of your pictures." });
  });

  const tonalWardrobe = () => [
    piece("top", "#e3d5b8", { id: "beige-top" }),
    piece("trousers", "#f3ead3", { id: "cream-trousers" }),
    piece("shoes", BROWN),
  ];

  it("keeps a top that blends into the trousers out, without pictures of tonal looks", () => {
    const [day] = planDays({ days: week(["casual"]), pieces: tonalWardrobe(), outfits: [], random: seeded(1) });

    expect(day.slots.trousers).toBeUndefined();
  });

  it("allows tonal looks once your pictures show them", () => {
    const [day] = planDays({
      days: week(["casual"]),
      pieces: tonalWardrobe(),
      outfits: [],
      random: seeded(1),
      style: styled(readings(3, "casual", "beige", "cream")),
    });

    expect(day.slots).toMatchObject({ top: "beige-top", trousers: "cream-trousers" });
  });

  it("follows your choice over the pictures", () => {
    const never = planDays({
      days: week(["casual"]),
      pieces: tonalWardrobe(),
      outfits: [],
      random: seeded(1),
      style: styled(readings(3, "casual", "beige", "cream"), { tonal: "never" }),
    });
    const always = planDays({
      days: week(["casual"]),
      pieces: tonalWardrobe(),
      outfits: [],
      random: seeded(1),
      style: styled([], { tonal: "always" }),
    });

    expect(never[0].slots.trousers).toBeUndefined();
    expect(always[0].slots.trousers).toBe("cream-trousers");
  });

  it("uses bold colours less when your pictures rarely have them", () => {
    const pieces = [piece("top", RED, { id: "red" }), piece("top", WHITE, { id: "white" }), piece("trousers", NAVY), piece("shoes", BLACK)];
    // The white top was worn last week, so on freshness alone the red one would usually win.
    const history: KnownOutfit[] = [{ day: addDays(MONDAY, -7), slots: { top: "white" }, checked: true }];
    const style = styled(readings(10, "casual", "grey", "black"));
    const picks = (withStyle: boolean) =>
      [...Array(20).keys()].map(
        (seed) =>
          planDays({ days: week(["casual"]), pieces, outfits: history, random: seeded(seed), style: withStyle ? style : undefined })[0]
            .slots.top,
      );

    expect(picks(false).filter((id) => id === "red").length).toBeGreaterThanOrEqual(11);
    expect(picks(true).filter((id) => id === "white").length).toBeGreaterThanOrEqual(18);
  });

  it("plans just as before when there are no pictures yet", () => {
    const pieces = basicWardrobe();

    const plain = plan(WEEKDAYS, pieces, [], 3);
    const empty = planDays({ days: WEEKDAYS, pieces, outfits: [], random: seeded(3), style: styled([]) });

    expect(empty).toEqual(plain);
  });
});
