import { Link } from "react-router";
import { dayTypeLabel, OutfitStrip } from "../components/OutfitParts";
import { WeekRail } from "../components/WeekRail";
import { usePlanning } from "../lib/planning";
import { useWardrobe } from "../lib/wardrobe";
import { dayName, formatWeekRange, parseDay, shortDate } from "../lib/week";

// What the week needs next: the weekly check, planning, or nothing.
function WeekAction() {
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const status = planning.status!;

  if (status.due.length > 0) {
    return (
      <div className="note">
        <p>
          Weekly check: tell the app what you wore and what's been washed. Then it plans{" "}
          {status.window.sundayEvening ? "next week" : "your week"}.
        </p>
        <Link to="/check" className="action-button">
          Start the check
        </Link>
      </div>
    );
  }

  if (status.toPlan.length === 0 || wardrobe.pieces === null) return null;

  if (wardrobe.pieces.length === 0) {
    return <p className="note">Add your clothes in the Wardrobe tab, and the planner can fill your week.</p>;
  }

  const label = status.window.sundayEvening
    ? "Plan next week"
    : status.toPlan.length === 7
      ? "Plan this week"
      : "Plan the rest of this week";
  return (
    <div className="note">
      <p>The planner picks outfits from your clean clothes. You can change any day afterwards.</p>
      <button type="button" className="action-button" disabled={planning.working} onClick={() => void planning.planMissing()}>
        {planning.working ? "Planning…" : label}
      </button>
    </div>
  );
}

export function WeekScreen() {
  const planning = usePlanning();
  const wardrobe = useWardrobe();
  const { status } = planning;

  if (planning.loadError) {
    return (
      <>
        <h1 className="screen-title">This week</h1>
        <div className="note is-alert" role="alert">
          <p>{planning.loadError}</p>
          <button type="button" className="text-button is-strong" onClick={planning.reload}>
            Try again
          </button>
        </div>
      </>
    );
  }

  if (!status || !planning.outfits) {
    return (
      <>
        <h1 className="screen-title">This week</h1>
        <p className="screen-note">Loading…</p>
      </>
    );
  }

  const days = status.shownDays.map(parseDay);
  const outfits = new Map(planning.outfits.map((outfit) => [outfit.day, outfit]));
  const pieces = new Map((wardrobe.pieces ?? []).map((piece) => [piece.id, piece]));

  return (
    <>
      <h1 className="screen-title">{status.showingNextWeek ? "Next week" : "This week"}</h1>
      <p className="screen-subtitle">{formatWeekRange(days)}</p>

      <WeekRail days={days} today={parseDay(status.window.today)} />

      <WeekAction />
      {planning.error && (
        <p className="note is-alert" role="alert">
          {planning.error}
        </p>
      )}

      <ol className="days">
        {status.shownDays.map((day, index) => {
          const outfit = outfits.get(day);
          const isToday = day === status.window.today;
          return (
            <li key={day}>
              <Link to={`/day/${day}`} className={isToday ? "day is-today" : "day"}>
                <span className="day-text">
                  <span className="day-name">{dayName(days[index])}</span>
                  <span className="day-date">
                    {shortDate(days[index])}
                    {isToday && <span className="day-today"> · Today</span>}
                  </span>
                  <span className="day-kind">
                    {outfit ? dayTypeLabel(outfit.day_type) : day < status.window.today ? "Not planned" : "Not planned yet"}
                  </span>
                </span>
                <OutfitStrip outfit={outfit} pieces={pieces} links={wardrobe.links} />
              </Link>
            </li>
          );
        })}
      </ol>

      <Link to="/week/usual" className="text-link">
        Change your usual week
      </Link>
    </>
  );
}
