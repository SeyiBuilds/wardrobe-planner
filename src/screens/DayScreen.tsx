import { useState } from "react";
import { Link, useParams } from "react-router";
import { SLOT_LABELS, slotsToShow, Thumb } from "../components/OutfitParts";
import { usePlanning } from "../lib/planning";
import { DAY_TYPES, type DayType, type Slot } from "../lib/planner";
import { slotsOf } from "../lib/plans";
import { useWardrobe } from "../lib/wardrobe";
import { dayName, parseDay, shortDate } from "../lib/week";

export function DayScreen() {
  const { day = "" } = useParams();
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const [choosing, setChoosing] = useState<Slot | null>(null);

  const date = parseDay(day);
  const isToday = planning.status?.window.today === day;
  const header = (
    <>
      <Link to="/" className="back-link">
        ← Week
      </Link>
      <h1 className="screen-title">{dayName(date)}</h1>
      <p className="screen-subtitle">
        {shortDate(date)}
        {isToday && " · Today"}
      </p>
    </>
  );

  if (!planning.outfits) {
    return (
      <>
        {header}
        <p className="screen-note">Loading…</p>
      </>
    );
  }

  const outfit = planning.outfits.find((o) => o.day === day);
  const error = planning.error && (
    <p className="note is-alert" role="alert">
      {planning.error}
    </p>
  );

  if (!outfit) {
    return (
      <>
        {header}
        <p className="placeholder-body">This day hasn't been planned yet.</p>
        <div className="button-row">
          <button type="button" className="action-button" disabled={planning.working} onClick={() => void planning.replanDay(day)}>
            {planning.working ? "Planning…" : "Plan this day"}
          </button>
        </div>
        {error}
      </>
    );
  }

  const pieces = new Map((wardrobe.pieces ?? []).map((piece) => [piece.id, piece]));
  const slots = slotsOf(outfit);
  const locked = outfit.checked_at !== null;

  async function choose(slot: Slot, id: string | null) {
    if (await planning.swap(day, slot, id)) setChoosing(null);
  }

  return (
    <>
      {header}

      {locked ? (
        <p className="screen-note">This day has been through the weekly check, so it can't be changed.</p>
      ) : (
        <label className="form-field day-kind-field">
          <span className="form-label">Kind of day</span>
          <select
            value={outfit.day_type}
            disabled={planning.working}
            onChange={(event) => void planning.setDayType(day, event.target.value as DayType)}
          >
            {DAY_TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {outfit.notes.map((note) => (
        <p key={note.text} className="note">
          {note.text}
        </p>
      ))}
      {error}

      {outfit.day_type === "none" ? (
        <p className="placeholder-body">No outfit planned for this day.</p>
      ) : (
        <ul className="outfit-grid">
          {slotsToShow(outfit).map((slot) => {
            const piece = slots[slot] ? pieces.get(slots[slot]!) : undefined;
            const content = (
              <>
                {piece ? (
                  <Thumb piece={piece} src={wardrobe.links[piece.photo_path]} alt="" />
                ) : (
                  <span className="thumb is-empty" aria-hidden="true" />
                )}
                <span className="outfit-slot-label">{SLOT_LABELS[slot]}</span>
                <span className="outfit-slot-name">{piece ? piece.name || "Unnamed piece" : "Empty"}</span>
                {piece?.in_wash && <span className="badge">In the wash</span>}
              </>
            );
            return (
              <li key={slot}>
                {locked ? (
                  <div className="outfit-slot">{content}</div>
                ) : (
                  <button
                    type="button"
                    className="outfit-slot"
                    aria-label={`Change ${SLOT_LABELS[slot].toLowerCase()} (${piece ? piece.name || "unnamed piece" : "empty"})`}
                    aria-expanded={choosing === slot}
                    onClick={() => setChoosing(choosing === slot ? null : slot)}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {choosing && !locked && (
        <section className="choices-panel" aria-label={`Choose the ${SLOT_LABELS[choosing].toLowerCase()}`}>
          <h2 className="section-title">Choose the {SLOT_LABELS[choosing].toLowerCase()}</h2>
          <ChoiceList day={day} slot={choosing} current={slots[choosing]} onChoose={(id) => void choose(choosing, id)} />
          <div className="button-row">
            <button type="button" className="text-button" onClick={() => void choose(choosing, null)}>
              Leave it empty
            </button>
            <button type="button" className="text-button" onClick={() => setChoosing(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {!locked && outfit.day_type !== "none" && (
        <div className="button-row">
          <button type="button" className="action-button is-quiet" disabled={planning.working} onClick={() => void planning.replanDay(day)}>
            {planning.working ? "Planning…" : "Plan this day again"}
          </button>
        </div>
      )}
    </>
  );
}

function ChoiceList({
  day,
  slot,
  current,
  onChoose,
}: {
  day: string;
  slot: Slot;
  current: string | undefined;
  onChoose: (id: string) => void;
}) {
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const choices = planning.choicesFor(day, slot);

  if (choices.length === 0) {
    return <p className="hint">No clean {SLOT_LABELS[slot].toLowerCase()} pieces are free for this day.</p>;
  }

  return (
    <ul className="choice-list">
      {choices.map(({ piece, clash }) => (
        <li key={piece.id}>
          <button type="button" className="choice-row" disabled={planning.working} onClick={() => onChoose(piece.id)}>
            <Thumb piece={piece} src={wardrobe.links[piece.photo_path]} alt="" />
            <span className="choice-text">
              <span className="choice-name">{piece.name || "Unnamed piece"}</span>
              {piece.id === current && <span className="choice-note">Chosen now</span>}
              {clash && <span className="choice-note is-clash">{clash}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
