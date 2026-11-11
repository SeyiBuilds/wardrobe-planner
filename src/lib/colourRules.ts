import { rgbToLab } from "./colours";

// How the planner sees one measured colour: how light and how strong it is, whether it's a neutral
// that goes with most things, and whether it reads as black or brown leather.
export type ColourRead = {
  hex: string;
  lab: [number, number, number];
  lightness: number;
  chroma: number;
  hue: number;
  neutral: boolean;
  leather: "black" | "brown" | "other";
};

// Colours further apart than this (in Lab units) look clearly different side by side.
const CLEARLY_DIFFERENT = 15;
// Bold colours within this many degrees of hue count as one colour, like red and burgundy.
const ACCENT_HUE_RANGE = 30;

export function readColour(hex: string): ColourRead {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const lab = rgbToLab((value >> 16) & 255, (value >> 8) & 255, value & 255);
  const [lightness, a, b] = lab;
  const chroma = Math.hypot(a, b);
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return {
    hex,
    lab,
    lightness,
    chroma,
    hue,
    neutral: isNeutral(lightness, chroma, hue),
    leather: leatherOf(lightness, chroma, hue),
  };
}

function isNeutral(lightness: number, chroma: number, hue: number): boolean {
  // Black, white and greys.
  if (chroma < 12) return true;
  // Earth tones: cream, beige, khaki, tan, camel, cognac and browns.
  if (hue >= 35 && hue <= 105 && chroma < 55) return true;
  // Olive and army green.
  if (hue > 105 && hue <= 135 && chroma < 35 && lightness < 65) return true;
  // Navy, denim and pale shirt blue.
  if (hue >= 230 && hue <= 300 && (lightness < 45 || (lightness > 70 && chroma < 30))) return true;
  return false;
}

function leatherOf(lightness: number, chroma: number, hue: number): ColourRead["leather"] {
  if (lightness < 30 && chroma < 12) return "black";
  if (hue >= 15 && hue <= 100 && chroma >= 10 && lightness < 75) return "brown";
  return "other";
}

function distance(a: ColourRead, b: ColourRead): number {
  return Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2]);
}

export function sameColour(a: ColourRead, b: ColourRead): boolean {
  return distance(a, b) < CLEARLY_DIFFERENT;
}

// A top that blends into the trousers makes the outfit look like one block.
export function standsOut(top: ColourRead, bottom: ColourRead): boolean {
  return !sameColour(top, bottom);
}

export function sameAccent(a: ColourRead, b: ColourRead): boolean {
  const gap = Math.abs(a.hue - b.hue) % 360;
  return Math.min(gap, 360 - gap) < ACCENT_HUE_RANGE;
}

// Brown with brown and black with black. Shoes that aren't leather-coloured, like white sneakers,
// go with either.
export function beltMatchesShoes(belt: ColourRead, shoes: ColourRead): boolean {
  return shoes.leather === "other" || belt.leather === shoes.leather;
}
