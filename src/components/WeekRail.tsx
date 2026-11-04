import { dayLetter, dayName, isSameDay } from "../lib/week";
import { Hanger } from "./Hanger";

type WeekRailProps = {
  days: Date[];
  today: Date;
};

const SPACING = 50;
const WIDTH = SPACING * 7;

// One hanger per day. A hanger stays bare until that day has an outfit.
export function WeekRail({ days, today }: WeekRailProps) {
  const todayIndex = days.findIndex((day) => isSameDay(day, today));
  const label =
    todayIndex === -1
      ? "A rail of seven empty hangers, one for each day."
      : `A rail of seven empty hangers, one for each day. Today is ${dayName(days[todayIndex])}.`;

  return (
    <svg className="week-rail" viewBox={`0 0 ${WIDTH} 62`} role="img" aria-label={label}>
      <line className="week-rail-bar" x1="0" y1="5" x2={WIDTH} y2="5" />
      {days.map((day, index) => {
        const x = SPACING * index + SPACING / 2;
        const isToday = index === todayIndex;
        return (
          <g key={day.toISOString()} className={isToday ? "is-today" : undefined}>
            <g transform="translate(0 2)">
              <Hanger x={x} className="week-rail-hanger" />
            </g>
            <text className="week-rail-letter" x={x} y="54" textAnchor="middle">
              {dayLetter(day)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
