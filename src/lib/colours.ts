export type MeasuredColour = { hex: string; share: number };

type Lab = [number, number, number];

// Pixels this close to the background colour are treated as background.
const BACKGROUND_DISTANCE = 14;
// Clusters closer than this read as one colour to the eye.
const MERGE_DISTANCE = 10;
const MIN_SHARE = 0.08;
const MAX_COLOURS = 3;

// The piece's main colours, from RGBA pixels. Assumes a plain background, as the photo tips ask:
// the colour around the edges is taken as background and left out.
export function measureColours(pixels: Uint8ClampedArray, width: number, height: number): MeasuredColour[] {
  const all: Lab[] = [];
  const border: Lab[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 128) continue;
      const lab = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
      all.push(lab);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border.push(lab);
    }
  }
  if (all.length === 0) return [];

  const background = median(border.length ? border : all);
  const piece = all.filter((lab) => distance(lab, background) > BACKGROUND_DISTANCE);
  // A piece that fills the frame, or matches the background, still gets measured.
  const sample = piece.length >= all.length * 0.05 ? piece : all;

  return cluster(sample)
    .filter((entry) => entry.share >= MIN_SHARE)
    .slice(0, MAX_COLOURS)
    .map((entry) => ({ hex: labToHex(entry.centre), share: Math.round(entry.share * 100) / 100 }));
}

function cluster(points: Lab[]): { centre: Lab; share: number }[] {
  // Farthest-first starting points keep the result the same on every run.
  const centres: Lab[] = [points[0]];
  while (centres.length < 4) {
    let farthest = points[0];
    let best = -1;
    for (const point of points) {
      const nearest = Math.min(...centres.map((centre) => distance(point, centre)));
      if (nearest > best) {
        best = nearest;
        farthest = point;
      }
    }
    if (best < MERGE_DISTANCE) break;
    centres.push(farthest);
  }

  let counts = centres.map(() => 0);
  for (let round = 0; round < 12; round++) {
    const sums = centres.map((): Lab => [0, 0, 0]);
    counts = centres.map(() => 0);
    for (const point of points) {
      const index = nearestIndex(point, centres);
      counts[index]++;
      sums[index][0] += point[0];
      sums[index][1] += point[1];
      sums[index][2] += point[2];
    }
    centres.forEach((_, index) => {
      if (counts[index]) centres[index] = sums[index].map((sum) => sum / counts[index]) as Lab;
    });
  }

  const groups = centres
    .map((centre, index) => ({ centre, count: counts[index] }))
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count);

  const merged: { centre: Lab; count: number }[] = [];
  for (const group of groups) {
    const near = merged.find((existing) => distance(existing.centre, group.centre) < MERGE_DISTANCE);
    if (!near) {
      merged.push({ ...group });
      continue;
    }
    const total = near.count + group.count;
    near.centre = near.centre.map((value, i) => (value * near.count + group.centre[i] * group.count) / total) as Lab;
    near.count = total;
  }

  return merged.map((group) => ({ centre: group.centre, share: group.count / points.length }));
}

function nearestIndex(point: Lab, centres: Lab[]): number {
  let index = 0;
  let best = Infinity;
  centres.forEach((centre, i) => {
    const d = distance(point, centre);
    if (d < best) {
      best = d;
      index = i;
    }
  });
  return index;
}

function median(points: Lab[]): Lab {
  const middle = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return [middle(points.map((p) => p[0])), middle(points.map((p) => p[1])), middle(points.map((p) => p[2]))];
}

function distance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// sRGB to CIE Lab (D65), so distances match how different colours look.
export function rgbToLab(r: number, g: number, b: number): Lab {
  const linear = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function labToHex([l, a, b]: Lab): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inverse(fx) * 0.95047;
  const y = inverse(fy);
  const z = inverse(fz) * 1.08883;
  const linear = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ];
  return (
    "#" +
    linear
      .map((c) => {
        const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}
