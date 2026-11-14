import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Piece } from "../lib/pieces";
import {
  defaultWearsFor,
  FORMALITIES,
  OCCASIONS,
  PATTERNS,
  PIECE_TYPES,
  type Formality,
  type Occasion,
  type Pattern,
  type PieceType,
} from "../lib/pieceTypes";
import { usePlanning } from "../lib/planning";
import { useWardrobe } from "../lib/wardrobe";

type Draft = {
  name: string;
  type: PieceType;
  colourName: string;
  formality: Formality | null;
  occasions: Occasion[];
  pattern: Pattern | null;
  wears: number | null;
  // The other half of a matching set, such as a native top's own trousers.
  match: string | null;
};

// A top can be matched with trousers, and trousers with a top.
const MATCHES_WITH: Partial<Record<PieceType, PieceType>> = { top: "trousers", trousers: "top" };

const WEAR_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10];

function draftFrom(piece: Piece): Draft {
  return {
    name: piece.name,
    type: piece.type,
    colourName: piece.colour_name,
    formality: piece.formality,
    occasions: piece.occasions,
    pattern: piece.pattern,
    wears: piece.wears_before_wash,
    match: piece.match_id ?? null,
  };
}

export function PieceScreen() {
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const wardrobe = useWardrobe();
  const planning = usePlanning();
  const piece = wardrobe.pieces?.find((p) => p.id === pieceId);

  const [draft, setDraft] = useState<Draft | null>(piece ? draftFrom(piece) : null);
  const [touched, setTouched] = useState(false);
  const [wearsTouched, setWearsTouched] = useState(false);
  const [pending, setPending] = useState<"save" | "delete" | "read" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Labels arriving from the AI fill the form, unless you've started editing.
  useEffect(() => {
    if (piece && !touched) setDraft(draftFrom(piece));
  }, [piece, touched]);

  if (wardrobe.pieces === null) return <p className="screen-note">Loading…</p>;
  if (!piece || !draft) {
    return (
      <>
        <Link to="/wardrobe" className="back-link">
          ← Wardrobe
        </Link>
        <p className="placeholder-body">This piece isn't in your wardrobe any more.</p>
      </>
    );
  }

  const photo = wardrobe.links[piece.photo_path];
  const matchType = MATCHES_WITH[draft.type];
  const candidates = matchType ? wardrobe.pieces.filter((p) => p.type === matchType) : [];
  // The match only counts if it's still the right kind of piece for the type chosen.
  const match = candidates.some((p) => p.id === draft.match) ? draft.match : null;

  function change(next: Partial<Draft>) {
    setTouched(true);
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function changeType(type: PieceType) {
    change(wearsTouched ? { type } : { type, wears: defaultWearsFor(type) });
  }

  function toggleOccasion(occasion: Occasion) {
    const occasions = draft!.occasions.includes(occasion)
      ? draft!.occasions.filter((o) => o !== occasion)
      : [...draft!.occasions, occasion];
    change({ occasions });
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setPending("save");
    setError(null);
    try {
      await wardrobe.save(piece!.id, {
        name: draft!.name.trim(),
        type: draft!.type,
        colour_name: draft!.colourName.trim(),
        formality: draft!.formality,
        occasions: draft!.occasions,
        pattern: draft!.pattern,
        wears_before_wash: draft!.wears,
        reviewed: true,
      });
      if (match !== (piece!.match_id ?? null)) await wardrobe.setMatch(piece!.id, match);
      navigate("/wardrobe");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your changes couldn't be saved.");
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this piece and its photo? This can't be undone.")) return;
    setPending("delete");
    setError(null);
    try {
      await wardrobe.remove(piece!);
      navigate("/wardrobe");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The piece couldn't be deleted.");
      setPending(null);
    }
  }

  async function handleReadAgain() {
    setPending("read");
    setError(null);
    try {
      await wardrobe.readAgain(piece!.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photo couldn't be sent for reading.");
    }
    setPending(null);
  }


  return (
    <>
      <Link to="/wardrobe" className="back-link">
        ← Wardrobe
      </Link>

      <div className="piece-detail-photo">{photo && <img src={photo} alt={piece.name || "Your photo"} />}</div>

      {piece.colours.length > 0 && (
        <div className="swatches">
          <ul aria-label="Colours measured from the photo">
            {piece.colours.map((colour) => (
              <li key={colour.hex}>
                <svg className="swatch" viewBox="0 0 10 10" role="img" aria-label={colour.hex}>
                  <rect width="10" height="10" fill={colour.hex} />
                </svg>
              </li>
            ))}
          </ul>
          <span className="swatches-label">Measured from the photo</span>
        </div>
      )}

      {piece.in_wash ? (
        <div className="note" role="status">
          <p>In the wash. It stays out of your outfits until it's clean.</p>
          <button
            type="button"
            className="text-button is-strong"
            disabled={planning.working}
            onClick={() => void planning.markClean([piece.id])}
          >
            Mark clean
          </button>
        </div>
      ) : (
        piece.wears_before_wash !== null && (
          <div className="wash-row">
            <p className="hint">
              {piece.wears_since_wash === 0
                ? "Not worn since its last wash."
                : `Worn ${piece.wears_since_wash} of ${piece.wears_before_wash} times since its last wash.`}
            </p>
            <button
              type="button"
              className="text-button is-strong"
              disabled={planning.working}
              onClick={() => void planning.sendToWash(piece.id)}
            >
              Send to the wash
            </button>
          </div>
        )
      )}

      {!piece.reviewed && piece.label_status === "waiting" && (
        <p className="note" role="status">
          The AI hasn't read this photo yet. You can fill it in yourself, or leave it and it'll be filled in for you.
        </p>
      )}
      {!piece.reviewed && piece.label_status === "failed" && (
        <div className="note" role="status">
          <p>The AI couldn't read this photo. Fill it in yourself, or try again.</p>
          <button type="button" className="text-button is-strong" disabled={pending !== null} onClick={handleReadAgain}>
            {pending === "read" ? "Sending…" : "Try reading again"}
          </button>
        </div>
      )}
      {!piece.reviewed && piece.label_status === "done" && (
        <p className="note" role="status">
          The AI filled this in. Check it, change anything that's wrong, then save.
        </p>
      )}

      <form className="piece-form" onSubmit={handleSave}>
        <label className="form-field">
          <span className="form-label">Name</span>
          <input
            type="text"
            value={draft.name}
            maxLength={60}
            placeholder="Navy Oxford shirt"
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>

        <label className="form-field">
          <span className="form-label">Type</span>
          <select value={draft.type} onChange={(event) => changeType(event.target.value as PieceType)}>
            {PIECE_TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.singular}
              </option>
            ))}
          </select>
        </label>

        {matchType && (
          <div>
            <label className="form-field">
              <span className="form-label">Matching piece</span>
              <select value={match ?? ""} onChange={(event) => change({ match: event.target.value || null })}>
                <option value="">None</option>
                {candidates.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name || "Unnamed piece"}
                    {other.match_id && other.match_id !== piece.id ? " (in another set)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              {matchType === "trousers"
                ? "Pick its own trousers, like a native top's. The planner always puts the two together, and never with anything else."
                : "Pick its own top, like a native top's trousers. The planner always puts the two together, and never with anything else."}
            </p>
          </div>
        )}

        <label className="form-field">
          <span className="form-label">Colour</span>
          <input
            type="text"
            value={draft.colourName}
            maxLength={30}
            placeholder="navy"
            onChange={(event) => change({ colourName: event.target.value })}
          />
        </label>

        <fieldset className="form-field">
          <legend className="form-label">How formal</legend>
          <div className="choices">
            {FORMALITIES.map((option) => (
              <label key={option.id} className="choice">
                <input
                  type="radio"
                  name="formality"
                  checked={draft.formality === option.id}
                  onChange={() => change({ formality: option.id })}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-field">
          <legend className="form-label">Good for</legend>
          <div className="choices">
            {OCCASIONS.map((option) => (
              <label key={option.id} className="choice">
                <input
                  type="checkbox"
                  checked={draft.occasions.includes(option.id)}
                  onChange={() => toggleOccasion(option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-field">
          <legend className="form-label">Pattern</legend>
          <div className="choices">
            {PATTERNS.map((option) => (
              <label key={option.id} className="choice">
                <input
                  type="radio"
                  name="pattern"
                  checked={draft.pattern === option.id}
                  onChange={() => change({ pattern: option.id })}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="form-field">
          <span className="form-label">Wears before washing</span>
          <select
            value={draft.wears ?? "repeat"}
            onChange={(event) => {
              setWearsTouched(true);
              change({ wears: event.target.value === "repeat" ? null : Number(event.target.value) });
            }}
          >
            <option value="repeat">Can repeat, never needs a wash break</option>
            {WEAR_CHOICES.map((count) => (
              <option key={count} value={count}>
                {count === 1 ? "1 wear" : `${count} wears`}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="note is-alert" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary-button is-dark" disabled={pending !== null}>
          {pending === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="text-button is-danger" disabled={pending !== null} onClick={handleDelete}>
          {pending === "delete" ? "Deleting…" : "Delete piece"}
        </button>
      </form>
    </>
  );
}
