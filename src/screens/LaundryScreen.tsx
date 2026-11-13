import { useState } from "react";
import { Thumb } from "../components/OutfitParts";
import { usePlanning } from "../lib/planning";
import { useWardrobe } from "../lib/wardrobe";

export function LaundryScreen() {
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  if (!wardrobe.pieces) {
    return (
      <>
        <h1 className="screen-title">Laundry</h1>
        <p className="screen-note">Loading…</p>
      </>
    );
  }

  const inWash = wardrobe.pieces.filter((piece) => piece.in_wash);

  async function markClean() {
    if (await planning.markClean([...ticked])) setTicked(new Set());
  }

  return (
    <>
      <h1 className="screen-title">Laundry</h1>
      <p className="screen-subtitle">{inWash.length === 1 ? "1 piece in the wash" : `${inWash.length} pieces in the wash`}</p>

      {inWash.length === 0 ? (
        <p className="placeholder-body">
          Nothing's in the wash. Pieces land here once they've used up their wears, or when you send one from its page.
        </p>
      ) : (
        <>
          <p className="hint">Tick what's clean again. It goes back into your outfits.</p>
          <ul className="check-list">
            {inWash.map((piece) => (
              <li key={piece.id}>
                <label className="check-piece">
                  <input
                    type="checkbox"
                    checked={ticked.has(piece.id)}
                    onChange={() =>
                      setTicked((current) => {
                        const next = new Set(current);
                        if (next.has(piece.id)) next.delete(piece.id);
                        else next.add(piece.id);
                        return next;
                      })
                    }
                  />
                  <Thumb piece={piece} src={wardrobe.links[piece.photo_path]} alt="" />
                  <span>{piece.name || "Unnamed piece"}</span>
                </label>
              </li>
            ))}
          </ul>

          {planning.error && (
            <p className="note is-alert" role="alert">
              {planning.error}
            </p>
          )}

          <div className="button-row">
            <button
              type="button"
              className="action-button"
              disabled={ticked.size === 0 || planning.working}
              onClick={() => void markClean()}
            >
              {planning.working ? "Saving…" : "Mark clean"}
            </button>
            <button type="button" className="action-button is-quiet" onClick={() => setTicked(new Set(inWash.map((p) => p.id)))}>
              Tick all
            </button>
          </div>
        </>
      )}
    </>
  );
}
