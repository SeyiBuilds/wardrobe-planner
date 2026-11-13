import { buildProfile, describeStyle, type Reading } from "./styleProfile";

function reading(day: Reading["day_type"], pieces: [string, string, boolean?][], formality: Reading["formality"] = "smart"): Reading {
  return { day_type: day, formality, pieces: pieces.map(([kind, colour, patterned]) => ({ kind, colour, patterned: !!patterned })) };
}

describe("buildProfile", () => {
  it("counts pictures overall and per kind of day", () => {
    const profile = buildProfile([
      reading("corporate", [["top", "white"], ["trousers", "navy"]]),
      reading("corporate", [["top", "light blue"], ["trousers", "grey"]]),
      reading("church", [["suit", "charcoal"], ["top", "white"]]),
    ]);

    expect(profile.all.count).toBe(3);
    expect(profile.byDay.corporate.count).toBe(2);
    expect(profile.byDay.church.count).toBe(1);
    expect(profile.byDay.casual.count).toBe(0);
  });

  it("records which colours go together, top first", () => {
    const profile = buildProfile([
      reading("corporate", [["top", "white"], ["trousers", "navy"]]),
      reading("corporate", [["top", "white"], ["trousers", "navy"], ["shoes", "brown"]]),
      reading("church", [["top", "white"], ["suit", "charcoal"]]),
    ]);

    expect(profile.byDay.corporate.pairs).toEqual({ "white|navy": 2 });
    expect(profile.all.pairs).toEqual({ "white|navy": 2, "white|charcoal": 1 });
    expect(profile.byDay.corporate.colours).toEqual({ white: 2, navy: 2, brown: 1 });
  });

  it("counts near-identical colours as one family", () => {
    const profile = buildProfile([reading("casual", [["top", "beige"], ["trousers", "camel"]])]);

    expect(profile.all.pairs).toEqual({ "cream|tan": 1 });
  });

  it("measures contrast, and spots tonal looks", () => {
    const profile = buildProfile([
      reading("casual", [["top", "white"], ["trousers", "black"]]),
      reading("casual", [["top", "cream"], ["trousers", "beige"]]),
    ]);

    expect(profile.all.contrastCount).toBe(2);
    expect(profile.all.contrastTotal / profile.all.contrastCount).toBeGreaterThan(40);
    expect(profile.all.tonal).toBe(1);
  });

  it("counts bold colours and patterns", () => {
    const profile = buildProfile([
      reading("casual", [["top", "red"], ["trousers", "navy"]]),
      reading("casual", [["top", "white", true], ["trousers", "navy"]]),
      reading("casual", [["top", "white"], ["trousers", "navy"]]),
    ]);

    expect(profile.all.bold).toBe(1);
    expect(profile.all.patterned).toBe(1);
  });

  it("averages how dressed up the looks are", () => {
    const profile = buildProfile([
      reading("church", [["suit", "navy"]], "formal"),
      reading("church", [["native_set", "burgundy"]], "smart"),
    ]);

    expect(profile.byDay.church.formalityTotal / profile.byDay.church.formalityCount).toBe(1.5);
  });

  it("leaves out readings without a kind of day from the per-day counts", () => {
    const profile = buildProfile([reading(null, [["top", "white"]])]);

    expect(profile.all.count).toBe(1);
    expect(Object.values(profile.byDay).every((day) => day.count === 0)).toBe(true);
  });
});

describe("describeStyle", () => {
  it("puts a style into words", () => {
    const profile = buildProfile([
      reading("corporate", [["top", "white"], ["trousers", "navy"]], "smart"),
      reading("corporate", [["top", "white"], ["trousers", "navy"]], "smart"),
      reading("corporate", [["top", "light blue"], ["trousers", "black"]], "formal"),
      reading("corporate", [["top", "white"], ["trousers", "grey"]], "smart"),
    ]);

    expect(describeStyle(profile.byDay.corporate)).toEqual({
      pairs: ["White and navy", "Light blue and black", "White and grey"],
      colours: ["White", "Navy", "Light blue", "Black", "Grey"],
      contrast: "Strong contrast",
      bold: "Rarely a bold colour",
      patterns: "Rarely a pattern",
      formality: "Smart",
    });
  });
});
