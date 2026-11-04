import { WeekRail } from "../components/WeekRail";
import { dayName, formatWeekRange, isSameDay, shortDate, weekOf } from "../lib/week";

export function WeekScreen() {
  const today = new Date();
  const days = weekOf(today);

  return (
    <>
      <h1 className="screen-title">This week</h1>
      <p className="screen-subtitle">{formatWeekRange(days)}</p>

      <WeekRail days={days} today={today} />

      <p className="screen-note">
        No outfits planned yet. They'll appear here once your clothes are in.
      </p>

      <ol className="days">
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <li key={day.toISOString()} className={isToday ? "day is-today" : "day"}>
              <div className="day-text">
                <h2 className="day-name">{dayName(day)}</h2>
                <p className="day-date">
                  {shortDate(day)}
                  {isToday && <span className="day-today"> · Today</span>}
                </p>
              </div>
              <div className="day-slot" role="img" aria-label="No outfit planned" />
            </li>
          );
        })}
      </ol>
    </>
  );
}
