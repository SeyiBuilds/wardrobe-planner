import { readColour, standsOut } from "./colourRules";
import { familyLabel, PALETTE, paletteHex } from "./palette";
import type { Formality, Occasion } from "./pieceTypes";

// Your style, summed up from the readings of your inspiration pictures. It keeps ideas, such as
// which colours you pair and how much contrast you like, never a particular look.

export type ReadingPiece = { kind: string; colour: string; patterned: boolean };
export type Reading = { day_type: Occasion | null; formality: Formality | null; pieces: ReadingPiece[] };

export type DayStyle = {
  // How many pictures this is built from.
  count: number;
  // Colour family → how many pictures have it.
  colours: Record<string, number>;
  // "top family|trousers family" → how many pictures pair them.
  pairs: Record<string, number>;
  // Lightness gap between top and trousers, summed, to average later.
  contrastTotal: number;
  contrastCount: number;
  // Pictures whose top and trousers are nearly the same colour.
  tonal: number;
  // Pictures with a bold (non-neutral) colour, and with a pattern.
  bold: number;
  patterned: number;
  // How dressed up, as 0 relaxed, 1 smart, 2 formal, summed.
  formalityTotal: number;
  formalityCount: number;
};

export type StyleProfile = { all: DayStyle; byDay: Record<Occasion, DayStyle> };

// You can override what the pictures say. Missing means "go by the pictures".
export type StyleOverrides = { tonal?: "always" | "never"; bold?: "less" | "more"; patterns?: "less" | "more" };

const CLOTHING = new Set(["top", "trousers", "suit", "native_set", "jacket", "shoes"]);
const LEVEL: Record<Formality, number> = { relaxed: 0, smart: 1, formal: 2 };
const FAMILY = new Map<string, string>(PALETTE.map((entry) => [entry.id, entry.family]));

function emptyStyle(): DayStyle {
  return {
    count: 0,
    colours: {},
    pairs: {},
    contrastTotal: 0,
    contrastCount: 0,
    tonal: 0,
    bold: 0,
    patterned: 0,
    formalityTotal: 0,
    formalityCount: 0,
  };
}

function add(style: DayStyle, reading: Reading) {
  style.count++;
  const pieces = reading.pieces.filter((piece) => FAMILY.has(piece.colour));
  const clothing = pieces.filter((piece) => CLOTHING.has(piece.kind));

  for (const family of new Set(clothing.map((piece) => FAMILY.get(piece.colour)!))) {
    style.colours[family] = (style.colours[family] ?? 0) + 1;
  }

  const top = pieces.find((p) => p.kind === "top") ?? pieces.find((p) => p.kind === "jacket");
  const bottom = pieces.find((p) => p.kind === "trousers" || p.kind === "suit");
  if (top && bottom) {
    const key = `${FAMILY.get(top.colour)}|${FAMILY.get(bottom.colour)}`;
    style.pairs[key] = (style.pairs[key] ?? 0) + 1;
    const topColour = readColour(paletteHex(top.colour));
    const bottomColour = readColour(paletteHex(bottom.colour));
    style.contrastTotal += Math.abs(topColour.lightness - bottomColour.lightness);
    style.contrastCount++;
    if (!standsOut(topColour, bottomColour)) style.tonal++;
  }

  if (clothing.some((piece) => !readColour(paletteHex(piece.colour)).neutral)) style.bold++;
  if (pieces.some((piece) => piece.patterned)) style.patterned++;

  if (reading.formality) {
    style.formalityTotal += LEVEL[reading.formality];
    style.formalityCount++;
  }
}

export function buildProfile(readings: Reading[]): StyleProfile {
  const profile: StyleProfile = {
    all: emptyStyle(),
    byDay: { casual: emptyStyle(), corporate: emptyStyle(), native: emptyStyle(), church: emptyStyle() },
  };
  for (const reading of readings) {
    add(profile.all, reading);
    if (reading.day_type) add(profile.byDay[reading.day_type], reading);
  }
  return profile;
}

function mostCommon(counts: Record<string, number>, limit: number): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

function howOften(share: number, thing: string): string {
  if (share >= 0.5) return `Often ${thing}`;
  if (share >= 0.2) return `Sometimes ${thing}`;
  return `Rarely ${thing}`;
}

export function describeStyle(style: DayStyle) {
  const contrast = style.contrastCount ? style.contrastTotal / style.contrastCount : null;
  const formality = style.formalityCount ? Math.round(style.formalityTotal / style.formalityCount) : null;
  return {
    pairs: mostCommon(style.pairs, 3).map((key) => {
      const [top, bottom] = key.split("|");
      return `${familyLabel(top)} and ${bottom}`;
    }),
    colours: mostCommon(style.colours, 5).map(familyLabel),
    contrast:
      contrast === null ? null : contrast >= 40 ? "Strong contrast" : contrast >= 20 ? "Some contrast" : "Soft, tonal contrast",
    bold: howOften(style.count ? style.bold / style.count : 0, "a bold colour"),
    patterns: howOften(style.count ? style.patterned / style.count : 0, "a pattern"),
    formality: formality === null ? null : (["Relaxed", "Smart", "Formal"] as const)[formality],
  };
}
