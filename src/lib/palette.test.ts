import { familyLabel, nearestFamily, PALETTE, paletteHex } from "./palette";

describe("palette", () => {
  it("names each colour once", () => {
    const ids = PALETTE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every colour's own swatch back its family", () => {
    for (const entry of PALETTE) expect(nearestFamily(entry.hex)).toBe(entry.family);
  });

  it("matches colours measured from your photos to the nearest family", () => {
    expect(nearestFamily("#1e2d50")).toBe("navy");
    expect(nearestFamily("#f2f2f0")).toBe("white");
    expect(nearestFamily("#7a1c2e")).toBe("burgundy");
    expect(nearestFamily("#be9466")).toBe("tan");
  });

  it("groups near-identical colours, like camel with tan and beige with cream", () => {
    expect(PALETTE.find((e) => e.id === "camel")!.family).toBe("tan");
    expect(PALETTE.find((e) => e.id === "beige")!.family).toBe("cream");
  });

  it("finds a colour's swatch, and names families for people", () => {
    expect(paletteHex("navy")).toBe("#1b2a4a");
    expect(familyLabel("light blue")).toBe("Light blue");
  });
});
