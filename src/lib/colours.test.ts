import { labToHex, measureColours, rgbToLab } from "./colours";

type Rgb = [number, number, number];

// Paints a test photo: `fill` decides each pixel's colour.
function image(width: number, height: number, fill: (x: number, y: number) => Rgb) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      pixels.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { pixels, width, height };
}

const WHITE: Rgb = [245, 245, 245];
const NAVY: Rgb = [27, 42, 74];
const TAN: Rgb = [196, 154, 108];

function closeTo(hex: string, [r, g, b]: Rgb) {
  const value = Number.parseInt(hex.slice(1), 16);
  const got = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return got.every((channel, i) => Math.abs(channel - [r, g, b][i]) <= 3);
}

describe("measureColours", () => {
  it("finds a navy shirt and ignores the white background", () => {
    const { pixels, width, height } = image(40, 40, (x, y) =>
      x > 8 && x < 32 && y > 6 && y < 34 ? NAVY : WHITE,
    );

    const colours = measureColours(pixels, width, height);

    expect(colours).toHaveLength(1);
    expect(closeTo(colours[0].hex, NAVY)).toBe(true);
    expect(colours[0].share).toBe(1);
  });

  it("finds both colours of a two-tone piece, largest first", () => {
    const { pixels, width, height } = image(40, 40, (x, y) => {
      if (x <= 5 || x >= 35 || y <= 5 || y >= 35) return WHITE;
      return y < 26 ? NAVY : TAN;
    });

    const colours = measureColours(pixels, width, height);

    expect(colours).toHaveLength(2);
    expect(closeTo(colours[0].hex, NAVY)).toBe(true);
    expect(closeTo(colours[1].hex, TAN)).toBe(true);
    expect(colours[0].share).toBeGreaterThan(colours[1].share);
  });

  it("still measures a piece that fills the whole frame", () => {
    const { pixels, width, height } = image(20, 20, () => TAN);

    const colours = measureColours(pixels, width, height);

    expect(colours).toHaveLength(1);
    expect(closeTo(colours[0].hex, TAN)).toBe(true);
  });

  it("ignores specks too small to matter", () => {
    const { pixels, width, height } = image(40, 40, (x, y) => {
      if (x <= 5 || x >= 35 || y <= 5 || y >= 35) return WHITE;
      return x === 20 && y === 20 ? TAN : NAVY;
    });

    expect(measureColours(pixels, width, height)).toHaveLength(1);
  });

  it("gives the same answer every time", () => {
    const { pixels, width, height } = image(30, 30, (x, y) => (x < 15 ? NAVY : y < 15 ? TAN : WHITE));

    expect(measureColours(pixels, width, height)).toEqual(measureColours(pixels, width, height));
  });

  it("returns nothing for a fully transparent image", () => {
    expect(measureColours(new Uint8ClampedArray(16), 2, 2)).toEqual([]);
  });
});

describe("colour conversion", () => {
  it.each<[string, Rgb]>([
    ["white", [255, 255, 255]],
    ["black", [0, 0, 0]],
    ["navy", NAVY],
    ["tan", TAN],
  ])("round-trips %s", (_name, rgb) => {
    expect(closeTo(labToHex(rgbToLab(...rgb)), rgb)).toBe(true);
  });
});
