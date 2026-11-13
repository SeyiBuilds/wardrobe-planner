import { beltMatchesShoes, readColour, sameAccent, sameColour, standsOut } from "./colourRules";

const NEUTRALS = {
  black: "#111111",
  white: "#f5f5f5",
  grey: "#808080",
  charcoal: "#36454f",
  navy: "#1b2a4a",
  denim: "#3b5b8c",
  lightBlue: "#c6d8ee",
  tan: "#c49a6c",
  camel: "#c19a6b",
  beige: "#e8dcc4",
  cream: "#f3ead3",
  khaki: "#c3b091",
  brown: "#5a3a22",
  cognac: "#9a4a20",
  olive: "#55603a",
};

const ACCENTS = {
  red: "#c0392b",
  burgundy: "#6d1a2a",
  royalBlue: "#1e6fd9",
  green: "#2e8b57",
  mustard: "#d4a017",
  pink: "#e8a0b4",
  orange: "#ff8c00",
  purple: "#6a3d9a",
};

describe("readColour", () => {
  it.each(Object.entries(NEUTRALS))("treats %s as a neutral", (_name, hex) => {
    expect(readColour(hex).neutral).toBe(true);
  });

  it.each(Object.entries(ACCENTS))("treats %s as a bold colour", (_name, hex) => {
    expect(readColour(hex).neutral).toBe(false);
  });

  it("knows black and brown leather", () => {
    expect(readColour("#151515").leather).toBe("black");
    expect(readColour(NEUTRALS.brown).leather).toBe("brown");
    expect(readColour(NEUTRALS.tan).leather).toBe("brown");
    expect(readColour(NEUTRALS.cognac).leather).toBe("brown");
    expect(readColour(NEUTRALS.white).leather).toBe("other");
    expect(readColour(NEUTRALS.navy).leather).toBe("other");
  });

  it("measures how light a colour is", () => {
    expect(readColour(NEUTRALS.white).lightness).toBeGreaterThan(90);
    expect(readColour(NEUTRALS.black).lightness).toBeLessThan(10);
  });
});

describe("comparing colours", () => {
  it("sees one colour in two slightly different photos as the same", () => {
    expect(sameColour(readColour("#1b2a4a"), readColour("#1e2d50"))).toBe(true);
  });

  it("tells navy from black", () => {
    expect(sameColour(readColour(NEUTRALS.navy), readColour(NEUTRALS.black))).toBe(false);
  });

  it("needs a top to stand out from the trousers", () => {
    expect(standsOut(readColour(NEUTRALS.white), readColour(NEUTRALS.navy))).toBe(true);
    expect(standsOut(readColour(NEUTRALS.navy), readColour("#1e2d50"))).toBe(false);
  });

  it("groups reds as one bold colour, and tells red from green", () => {
    expect(sameAccent(readColour(ACCENTS.red), readColour(ACCENTS.burgundy))).toBe(true);
    expect(sameAccent(readColour(ACCENTS.red), readColour(ACCENTS.green))).toBe(false);
  });
});

describe("beltMatchesShoes", () => {
  const black = readColour("#151515");
  const brown = readColour(NEUTRALS.brown);
  const tan = readColour(NEUTRALS.tan);
  const white = readColour(NEUTRALS.white);

  it("pairs black with black and brown with brown", () => {
    expect(beltMatchesShoes(black, black)).toBe(true);
    expect(beltMatchesShoes(brown, tan)).toBe(true);
  });

  it("refuses a brown belt with black shoes, and the other way round", () => {
    expect(beltMatchesShoes(brown, black)).toBe(false);
    expect(beltMatchesShoes(black, brown)).toBe(false);
  });

  it("lets any belt go with shoes that aren't leather-coloured, like white sneakers", () => {
    expect(beltMatchesShoes(brown, white)).toBe(true);
    expect(beltMatchesShoes(black, white)).toBe(true);
  });
});
