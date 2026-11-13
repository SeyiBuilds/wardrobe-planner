import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Thumb } from "../components/OutfitParts";
import { usePlanning } from "../lib/planning";
import { laundryAfterCheck, slotsOf } from "../lib/plans";
import { useWardrobe } from "../lib/wardrobe";
import { dayName, parseDay, shortDate } from "../lib/week";

// The weekly check: what you actually wore, then what's been washed. Finishing it plans the week ahead.
export function CheckScreen() {
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  // Pieces you unticked in step 1, as "outfit id:piece id".
  const [notWorn, setNotWorn] = useState<Set<string>>(new Set());
  const [washed, setWashed] = useState<Set<string>>(new Set());

  if (!planning.status || !wardrobe.pieces) {
    return (
      <>
        <h1 className="screen-title">Weekly check</h1>
        <p className="screen-note">Loading…</p>
      </>
    );
  }

  const due = planning.status.due;
  if (due.length === 0) {
    return (
      <>
        <h1 className="screen-title">Weekly check</h1>
        <p className="placeholder-body">There's nothing to check right now. The check opens on Sunday from 5pm.</p>
        <Link to="/" className="text-link">
          Back to your week
        </Link>
      </>
    );
  }

  const pieces = new Map(wardrobe.pieces.map((piece) => [piece.id, piece]));
  const worn = Object.fromEntries(
    due.map((outfit) => [outfit.id, Object.values(slotsOf(outfit)).filter((id) => !notWorn.has(`${outfit.id}:${id}`))]),
  );
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  async function finish() {
    if (await planning.finishCheck(worn, [...washed])) navigate("/");
  }

  if (step === 1) {
    return (
      <>
        <h1 className="screen-title">Weekly check</h1>
        <p className="screen-subtitle">Step 1 of 2: what did you wear?</p>
        <p className="hint">Untick anything you didn't wear.</p>

        {due.map((outfit) => {
          const ids = Object.values(slotsOf(outfit)).filter((id) => pieces.has(id));
          if (ids.length === 0) return null;
          const date = parseDay(outfit.day);
          return (
            <fieldset key={outfit.id} className="check-day">
              <legend className="section-title">
                {dayName(date)} {shortDate(date)}
              </legend>
              <ul className="check-list">
                {ids.map((id) => {
                  const piece = pieces.get(id)!;
                  const key = `${outfit.id}:${id}`;
                  return (
                    <li key={key}>
                      <label className="check-piece">
                        <input
                          type="checkbox"
                          name={id}
                          checked={!notWorn.has(key)}
                          onChange={() => setNotWorn((current) => toggle(current, key))}
                        />
                        <Thumb piece={piece} src={wardrobe.links[piece.photo_path]} alt="" />
                        <span>{piece.name || "Unnamed piece"}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        <div className="button-row">
          <button type="button" className="primary-button is-dark" onClick={() => setStep(2)}>
            Next
          </button>
        </div>
      </>
    );
  }

  const laundry = laundryAfterCheck(wardrobe.pieces, worn);
  return (
    <>
      <h1 className="screen-title">Weekly check</h1>
      <p className="screen-subtitle">Step 2 of 2: what's been washed?</p>

      {laundry.length === 0 ? (
        <p className="placeholder-body">Nothing is waiting to be washed.</p>
      ) : (
        <fieldset className="check-day">
          <legend className="hint">Tick what's been washed and is clean again.</legend>
          <ul className="check-list">
            {laundry.map((piece) => (
              <li key={piece.id}>
                <label className="check-piece">
                  <input
                    type="checkbox"
                    name={piece.id}
                    checked={washed.has(piece.id)}
                    onChange={() => setWashed((current) => toggle(current, piece.id))}
                  />
                  <Thumb piece={piece} src={wardrobe.links[piece.photo_path]} alt="" />
                  <span>{piece.name || "Unnamed piece"}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {planning.error && (
        <p className="note is-alert" role="alert">
          {planning.error}
        </p>
      )}

      <div className="button-row">
        <button type="button" className="primary-button is-dark" disabled={planning.working} onClick={() => void finish()}>
          {planning.working ? "Saving and planning…" : "Finish and plan"}
        </button>
        <button type="button" className="text-button" disabled={planning.working} onClick={() => setStep(1)}>
          Back
        </button>
      </div>
    </>
  );
}
