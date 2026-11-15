import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { SLOT_LABELS, slotsToShow, Thumb } from "../components/OutfitParts";
import { fingerSwipe, type Touch } from "../lib/gestures";
import { useGestures, useHandControl } from "../lib/handControl";
import { usePlanning } from "../lib/planning";
import { DAY_TYPES, type DayType, type Slot } from "../lib/planner";
import { slotsOf } from "../lib/plans";
import { useWardrobe } from "../lib/wardrobe";
import { addDays, dayName, parseDay, shortDate } from "../lib/week";

type Direction = "next" | "previous";

export function DayScreen() {
  const { day = "" } = useParams();
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const hands = useHandControl();
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState<Slot | null>(null);
  const touchStart = useRef<Touch | null>(null);

  const date = parseDay(day);
  const isToday = planning.status?.window.today === day;
  const outfit = planning.outfits?.find((o) => o.day === day);
  const locked = outfit ? outfit.checked_at !== null : false;
  const dressed = outfit !== undefined && outfit.day_type !== "none" && Object.keys(slotsOf(outfit)).length > 0;
  const pending = planning.pendingWorn === day;
  const canMarkWorn = isToday && dressed && !locked && !pending;

  // Moves a day along, staying within the week on show.
  function goTo(direction: Direction): string {
    const week = planning.status?.shownDays ?? [];
    const target = addDays(day, direction === "next" ? 1 : -1);
    if (week.includes(day) && !week.includes(target)) {
      return direction === "next" ? "That's the last day of the week" : "That's the first day of the week";
    }
    setChoosing(null);
    navigate(`/day/${target}`);
    return direction === "next" ? "Next day" : "Day before";
  }

  useGestures((gesture) => {
    switch (gesture) {
      case "next":
      case "previous":
        return goTo(gesture);
      case "another":
        if (!outfit) return "This day hasn't been planned yet";
        if (locked) return "This day is done, so it can't change";
        if (outfit.day_type === "none") return "No outfit planned for this day";
        void planning.anotherOutfit(day);
        return "Another outfit";
      case "back":
        if (locked) return "This day is done, so it can't change";
        if (!planning.canGoBack(day)) return "No earlier outfit to go back to";
        void planning.previousOutfit(day);
        return "Back to the one before";
      case "thumbsUp":
        if (!isToday) return "Thumbs up works on today's outfit";
        if (pending) return "Already marked as worn";
        if (locked) return "Today is already counted as worn";
        if (!canMarkWorn) return "There's no outfit to mark as worn";
        planning.markWorn(day);
        return "Marked as worn";
    }
  });

  function onTouchStart(event: TouchEvent) {
    const touch = event.changedTouches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : null;
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const swipe = fingerSwipe(start, { x: touch.clientX, y: touch.clientY, time: event.timeStamp });
    if (swipe) goTo(swipe);
  }

  const page = (content: ReactNode) => (
    <div className="day-page" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <Link to="/" className="back-link">
        ← Week
      </Link>
      <h1 className="screen-title">{dayName(date)}</h1>
      <p className="screen-subtitle">
        {shortDate(date)}
        {isToday && " · Today"}
      </p>
      {hands.status === "off" && (
        <div className="hand-row">
          <button type="button" className="action-button is-quiet" onClick={hands.start}>
            Use hand control
          </button>
          <span className="hint">Or swipe left and right to change day.</span>
        </div>
      )}
      {hands.problem && <p className="note">{hands.problem}</p>}
      {content}
    </div>
  );

  if (!planning.outfits) return page(<p className="screen-note">Loading…</p>);

  const error = planning.error && (
    <p className="note is-alert" role="alert">
      {planning.error}
    </p>
  );

  if (!outfit) {
    return page(
      <>
        <p className="placeholder-body">This day hasn't been planned yet.</p>
        <div className="button-row">
          <button type="button" className="action-button" disabled={planning.working} onClick={() => void planning.replanDay(day)}>
            {planning.working ? "Planning…" : "Plan this day"}
          </button>
        </div>
        {error}
      </>,
    );
  }

  const pieces = new Map((wardrobe.pieces ?? []).map((piece) => [piece.id, piece]));
  const slots = slotsOf(outfit);

  async function choose(slot: Slot, id: string | null) {
    if (await planning.swap(day, slot, id)) setChoosing(null);
  }

  return page(
    <>
      {locked ? (
        <p className="screen-note">This day is done: what you wore has been counted, so it can't be changed.</p>
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

      {pending && (
        <div className="note" role="status">
          <p>Marked as worn. It's counted in a few seconds.</p>
          <button type="button" className="text-button is-strong" onClick={planning.undoWorn}>
            Undo
          </button>
        </div>
      )}

      {outfit.notes
        .filter((note) => note.kind === "why")
        .map((note) => (
          <p key={note.text} className="why-line">
            {note.text}
          </p>
        ))}
      {outfit.notes
        .filter((note) => note.kind !== "why")
        .map((note) => (
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

      {canMarkWorn && (
        <div className="button-row">
          <button type="button" className="action-button" disabled={planning.working} onClick={() => planning.markWorn(day)}>
            I wore this
          </button>
        </div>
      )}

      {!locked && outfit.day_type !== "none" && (
        // Both change the screen straight away and save in order behind it, so they stay
        // usable while an earlier change is still saving.
        <div className="button-row">
          {planning.canGoBack(day) && (
            <button type="button" className="action-button is-quiet" onClick={() => void planning.previousOutfit(day)}>
              Back
            </button>
          )}
          <button type="button" className="action-button is-quiet" onClick={() => void planning.anotherOutfit(day)}>
            Another outfit
          </button>
        </div>
      )}
    </>,
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
