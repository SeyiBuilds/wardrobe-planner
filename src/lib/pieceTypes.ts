// Used by the app and the labelling function, so both agree on what a piece can be.

export const PIECE_TYPES = [
  { id: "top", label: "Tops", singular: "Top", defaultWears: 1 },
  { id: "trousers", label: "Trousers", singular: "Trousers", defaultWears: 2 },
  { id: "jacket", label: "Jackets", singular: "Jacket", defaultWears: 5 },
  { id: "suit", label: "Suits", singular: "Suit", defaultWears: 3 },
  { id: "native_set", label: "Native sets", singular: "Native set", defaultWears: 1 },
  { id: "shoes", label: "Shoes", singular: "Shoes", defaultWears: null },
  { id: "socks", label: "Socks", singular: "Socks", defaultWears: null },
  { id: "watch", label: "Watches", singular: "Watch", defaultWears: null },
  { id: "belt", label: "Belts", singular: "Belt", defaultWears: null },
  { id: "accessory", label: "Accessories", singular: "Accessory", defaultWears: null },
] as const;

export type PieceType = (typeof PIECE_TYPES)[number]["id"];

export const FORMALITIES = [
  { id: "relaxed", label: "Relaxed" },
  { id: "smart", label: "Smart" },
  { id: "formal", label: "Formal" },
] as const;

export type Formality = (typeof FORMALITIES)[number]["id"];

export const OCCASIONS = [
  { id: "casual", label: "Casual" },
  { id: "corporate", label: "Corporate" },
  { id: "native", label: "Native" },
  { id: "church", label: "Church" },
] as const;

export type Occasion = (typeof OCCASIONS)[number]["id"];

export const PATTERNS = [
  { id: "plain", label: "Plain" },
  { id: "patterned", label: "Patterned" },
] as const;

export type Pattern = (typeof PATTERNS)[number]["id"];

export function defaultWearsFor(type: PieceType): number | null {
  return PIECE_TYPES.find((entry) => entry.id === type)?.defaultWears ?? null;
}

export function singularLabel(type: PieceType): string {
  return PIECE_TYPES.find((entry) => entry.id === type)?.singular ?? "Piece";
}
