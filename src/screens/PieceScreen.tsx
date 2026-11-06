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
import { useWardrobe } from "../lib/wardrobe";

type Draft = {
  name: string;
  type: PieceType;
  colourName: string;
  formality: Formality | null;
  occasions: Occasion[];
  pattern: Pattern | null;
  wears: number | null;
};

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
  };
}

export function PieceScreen() {
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const wardrobe = useWardrobe();
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

  const photo = wardrobe.links[piece.photo_path];

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
