import { coverBox, quarterTiles } from "./faces";
import { fitWithin } from "./photo";

describe("fitWithin", () => {
  it("shrinks a tall phone photo to the long edge", () => {
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it("shrinks a wide photo to the long edge", () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(640, 480, 1024)).toEqual({ width: 640, height: 480 });
  });
});

describe("coverBox", () => {
  it("grows a face box to cover hair and chin", () => {
    const box = coverBox({ x: 400, y: 300, width: 100, height: 120 }, 1024, 1024);

    expect(box.x).toBeLessThan(400);
    expect(box.y).toBeLessThan(300);
    expect(box.x + box.width).toBeGreaterThan(500);
    expect(box.y + box.height).toBeGreaterThan(420);
  });

  it("covers every corner of the photo with the closer-look tiles", () => {
    const tiles = quarterTiles(1000, 800);

    expect(tiles).toHaveLength(4);
    expect(tiles).toContainEqual({ x: 0, y: 0, width: 600, height: 480 });
    expect(tiles).toContainEqual({ x: 400, y: 320, width: 600, height: 480 });
    for (const tile of tiles) {
      expect(tile.x + tile.width).toBeLessThanOrEqual(1000);
      expect(tile.y + tile.height).toBeLessThanOrEqual(800);
    }
  });

  it("stays inside the photo near its edges", () => {
    const box = coverBox({ x: 5, y: 2, width: 200, height: 200 }, 300, 300);

    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.x + box.width).toBeLessThanOrEqual(300);
    expect(box.y + box.height).toBeLessThanOrEqual(300);
  });
});
