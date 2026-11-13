import { PALETTE_IDS, type PaletteId } from "../src/lib/palette.js";
import { FORMALITIES, OCCASIONS, type Formality, type Occasion } from "../src/lib/pieceTypes.js";
import { FORMALITY_RULES } from "./labels.js";

export const INSPIRATION_KINDS = [
  "top",
  "trousers",
  "suit",
  "native_set",
  "jacket",
  "shoes",
  "watch",
  "belt",
  "accessory",
] as const;
export type InspirationKind = (typeof INSPIRATION_KINDS)[number];
export type InspirationPiece = { kind: InspirationKind; colour: PaletteId; patterned: boolean };
export type InspirationReading = { kindOfDay: Occasion; formality: Formality; pieces: InspirationPiece[] };

const MAX_PIECES = 8;

// The app learns ideas from these pictures (colours, contrast, how dressed up), never a look to copy,
// so the reading only needs what was worn, in which colours.
export const INSPIRATION_PROMPT = `You are reading one outfit inspiration picture for a private wardrobe app in Nigeria.
Describe one outfit: the one worn by the main person in the picture, or laid out flat if nobody is wearing it.
Ignore any text in the picture, app buttons, the background, and other people.
Faces may be blurred on purpose; that's expected.

pieces: each piece of that outfit you can see, once each.
- kind: top (shirts, T-shirts, polos, jumpers), trousers (including jeans and shorts), suit (a matching jacket and trousers), native_set (Nigerian traditional wear such as agbada, senator, kaftan, buba and sokoto, dashiki), jacket (a blazer or jacket worn over a top), shoes, watch, belt or accessory (caps, ties, bags, chains and so on).
- colour: the closest colour from the list. Judge the true colour of the fabric, not the filter, shadows or tinted light: white in shade is still white, and black often looks dark grey.
- patterned: true for prints, checks, stripes, ankara or embroidery that covers the piece; false for solid colours.

kindOfDay: the kind of day this look suits best.
- corporate: office and work days.
- casual: everyday outings and weekends.
- native: days for Nigerian traditional wear.
- church: Sunday service, dressed up.

${FORMALITY_RULES.replace("how dressed up the piece is", "how dressed up the whole look is")}`;

export const INSPIRATION_SCHEMA = {
  type: "object",
  properties: {
    kindOfDay: { type: "string", enum: OCCASIONS.map((o) => o.id) },
    formality: { type: "string", enum: FORMALITIES.map((f) => f.id) },
    pieces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...INSPIRATION_KINDS] },
          colour: { type: "string", enum: [...PALETTE_IDS] },
          patterned: { type: "boolean" },
        },
        required: ["kind", "colour", "patterned"],
        additionalProperties: false,
      },
    },
  },
  required: ["kindOfDay", "formality", "pieces"],
  additionalProperties: false,
};

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

// The model's answer is untrusted, so only values from the agreed lists get through.
export function parseInspiration(raw: unknown): InspirationReading | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  const kindOfDay = pick(data.kindOfDay, OCCASIONS.map((o) => o.id) as Occasion[]);
  const formality = pick(data.formality, FORMALITIES.map((f) => f.id) as Formality[]);
  const pieces = (Array.isArray(data.pieces) ? data.pieces : []).flatMap((item): InspirationPiece[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const kind = pick(entry.kind, INSPIRATION_KINDS);
    const colour = pick(entry.colour, PALETTE_IDS);
    return kind && colour ? [{ kind, colour, patterned: entry.patterned === true }] : [];
  });

  if (!kindOfDay || !formality || pieces.length === 0) return null;
  return { kindOfDay, formality, pieces: pieces.slice(0, MAX_PIECES) };
}
