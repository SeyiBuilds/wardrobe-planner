import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { usePlanning } from "../lib/planning";
import { DAY_TYPES, type DayType } from "../lib/planner";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function UsualWeekScreen() {
  const planning = usePlanning();
  const navigate = useNavigate();
  const [week, setWeek] = useState<DayType[]>(planning.usualWeek);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (await planning.saveUsualWeek(week)) navigate("/");
  }

  return (
    <>
      <Link to="/" className="back-link">
        ← Week
      </Link>
      <h1 className="screen-title">Usual week</h1>
      <p className="placeholder-body">
        The planner uses this for days it hasn't planned yet. Planned days keep their outfits; to change one, open that
        day.
      </p>

      <form className="piece-form" onSubmit={handleSave}>
        {DAY_NAMES.map((name, index) => (
          <label key={name} className="form-field">
            <span className="form-label">{name}</span>
            <select
              value={week[index]}
              onChange={(event) =>
                setWeek((current) => current.map((type, i) => (i === index ? (event.target.value as DayType) : type)))
              }
            >
              {DAY_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
        ))}

        {planning.error && (
          <p className="note is-alert" role="alert">
            {planning.error}
          </p>
        )}

        <button type="submit" className="primary-button is-dark" disabled={planning.working}>
          {planning.working ? "Saving…" : "Save"}
        </button>
      </form>
    </>
  );
}
