import type { Piece } from "../lib/pieces";
import { DAY_TYPES, type DayType, type Slot } from "../lib/planner";
import type { Outfit } from "../lib/plans";

export const SLOT_LABELS: Record<Slot, string> = {
  top: "Top",
  trousers: "Trousers",
  suit: "Suit",
  native_set: "Native set",
  shoes: "Shoes",
  watch: "Watch",
  belt: "Belt",
};

export function dayTypeLabel(type: DayType): string {
  return DAY_TYPES.find((entry) => entry.id === type)?.label ?? type;
}

// The slots a day's outfit is made of, empty ones included, so you can fill them yourself.
export function slotsToShow(outfit: Outfit): Slot[] {
  if (outfit.day_type === "none") return [];
  const native = outfit.native_set_id || (outfit.day_type === "native" && !outfit.top_id && !outfit.trousers_id && !outfit.suit_id);
  if (native) return ["native_set", "shoes", "watch"];
  if (outfit.suit_id) return ["top", "suit", "shoes", "belt", "watch"];
  return ["top", "trousers", "shoes", "belt", "watch"];
}

// A small photo of a piece, or a plain box while its link is loading. Pass alt="" when the
// piece's name is already written next to it.
export function Thumb({ piece, src, alt }: { piece: Piece; src: string | undefined; alt?: string }) {
  return <span className="thumb">{src ? <img src={src} alt={alt ?? (piece.name || "Unnamed piece")} loading="lazy" /> : null}</span>;
}

// The main pieces of a day, side by side, for the week list.
export function OutfitStrip({
  outfit,
  pieces,
  links,
}: {
  outfit: Outfit | undefined;
  pieces: Map<string, Piece>;
  links: Record<string, string>;
}) {
  const ids = outfit
    ? [outfit.top_id, outfit.trousers_id, outfit.suit_id, outfit.native_set_id, outfit.shoes_id].filter((id): id is string => !!id)
    : [];
  const shown = ids.map((id) => pieces.get(id)).filter((piece): piece is Piece => !!piece);
  if (shown.length === 0) return <span className="day-slot" aria-hidden="true" />;
  return (
    <span className="outfit-strip">
      {shown.map((piece) => (
        <Thumb key={piece.id} piece={piece} src={links[piece.photo_path]} />
      ))}
    </span>
  );
}
