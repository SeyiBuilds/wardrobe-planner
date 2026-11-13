import { rgbToLab } from "./colours.js";

// The everyday colours the AI picks from when it reads an inspiration picture. Your clothes'
// measured colours are matched to the same list, so both sides speak the same colour language.
// Colours that look alike share a family, like camel and tan.
export const PALETTE = [
  { id: "black", hex: "#151515", family: "black" },
  { id: "charcoal", hex: "#36454f", family: "charcoal" },
  { id: "grey", hex: "#808080", family: "grey" },
  { id: "light grey", hex: "#c8c8c8", family: "grey" },
  { id: "white", hex: "#f5f5f5", family: "white" },
  { id: "cream", hex: "#f3ead3", family: "cream" },
  { id: "beige", hex: "#e3d5b8", family: "cream" },
  { id: "khaki", hex: "#c3b091", family: "khaki" },
  { id: "tan", hex: "#c49a6c", family: "tan" },
  { id: "camel", hex: "#b8895a", family: "tan" },
  { id: "brown", hex: "#5a3a22", family: "brown" },
  { id: "dark brown", hex: "#3b2618", family: "brown" },
  { id: "olive", hex: "#55603a", family: "olive" },
  { id: "navy", hex: "#1b2a4a", family: "navy" },
  { id: "denim", hex: "#3b5b8c", family: "denim" },
  { id: "light blue", hex: "#c6d8ee", family: "light blue" },
  { id: "blue", hex: "#1e6fd9", family: "blue" },
  { id: "teal", hex: "#2a7f7f", family: "teal" },
  { id: "green", hex: "#2e8b57", family: "green" },
  { id: "forest green", hex: "#1f4d2b", family: "green" },
  { id: "mint", hex: "#b8e0c8", family: "mint" },
  { id: "burgundy", hex: "#6d1a2a", family: "burgundy" },
  { id: "red", hex: "#c0392b", family: "red" },
  { id: "pink", hex: "#e8a0b4", family: "pink" },
  { id: "orange", hex: "#e07b28", family: "orange" },
  { id: "rust", hex: "#a0471d", family: "rust" },
  { id: "mustard", hex: "#d4a017", family: "mustard" },
  { id: "yellow", hex: "#f2d03b", family: "yellow" },
  { id: "purple", hex: "#6a3d9a", family: "purple" },
  { id: "lavender", hex: "#c8b6e2", family: "lavender" },
  { id: "gold", hex: "#c9a227", family: "gold" },
  { id: "silver", hex: "#b9bcc2", family: "silver" },
] as const;

export type PaletteId = (typeof PALETTE)[number]["id"];
export const PALETTE_IDS = PALETTE.map((entry) => entry.id) as PaletteId[];

function labOf(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return rgbToLab((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

const LABS = PALETTE.map((entry) => ({ family: entry.family, lab: labOf(entry.hex) }));

export function nearestFamily(hex: string): string {
  const lab = labOf(hex);
  let best = LABS[0];
  let bestDistance = Infinity;
  for (const entry of LABS) {
    const distance = Math.hypot(lab[0] - entry.lab[0], lab[1] - entry.lab[1], lab[2] - entry.lab[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best.family;
}

export function paletteHex(id: string): string {
  return PALETTE.find((entry) => entry.id === id)?.hex ?? "#808080";
}

// A family's swatch is its first colour in the list.
export function familyHex(family: string): string {
  return PALETTE.find((entry) => entry.family === family)?.hex ?? "#808080";
}

export function familyLabel(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1);
}
