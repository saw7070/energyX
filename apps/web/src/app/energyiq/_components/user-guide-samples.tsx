import type { GuideSample } from "./user-guide-content";
import styles from "./user-guide.module.css";

/**
 * Small drawn examples of the app's charts. They are drawings rather than screenshots so they stay
 * true when the app changes, read well in dark mode, and carry no site's real figures.
 */
const HEAT = ["#dff0e4", "#cfe8d6", "#f2e2b8", "#f1c98c", "#e8a36a", "#d97a55", "#c9553f"];
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
/** Two devices: one that follows the working day, one that never stops. */
const ROWS: Array<{ name: string; hours: number[] }> = [
  { name: "Meeting room TV", hours: [0, 0, 0, 0, 1, 4, 6, 5, 3, 1, 0, 0] },
  { name: "Showroom display", hours: [5, 5, 5, 5, 6, 6, 6, 6, 6, 5, 5, 5] },
];
const DAYS = [
  { kwh: 88, closed: false }, { kwh: 92, closed: false }, { kwh: 90, closed: false }, { kwh: 95, closed: false },
  { kwh: 86, closed: false }, { kwh: 61, closed: true }, { kwh: 58, closed: true }, { kwh: 91, closed: false },
  { kwh: 34, closed: false }, { kwh: 93, closed: false },
];
const SHARES = [
  { name: "Showroom display", pct: 21 }, { name: "Lighting, level 1", pct: 18 },
  { name: "Air conditioning", pct: 15 }, { name: "No separate meter", pct: 8, faint: true },
];

function Heatmap() {
  return <svg viewBox="0 0 320 96" role="img" aria-label="Heatmap example: one row per device, one cell per hour" className={styles.figure}>
    {ROWS.map((row, rowIndex) => <g key={row.name}>
      <text x="0" y={rowIndex * 34 + 30} className={styles.figureLabel}>{row.name}</text>
      {row.hours.map((level, index) => <rect key={index} x={104 + index * 18} y={rowIndex * 34 + 18} width="16" height="16" rx="3"
        fill={index === 10 && rowIndex === 0 ? "#e4e8e6" : HEAT[level]} />)}
    </g>)}
    <g>
      {HOURS.map((hour, index) => <text key={hour} x={106 + index * 27} y="88" className={styles.figureAxis}>{String(hour).padStart(2, "0")}</text>)}
      <rect x="104" y="8" width="72" height="6" rx="3" fill="#eadfc8" />
      <rect x="176" y="8" width="90" height="6" rx="3" fill="#cfe4d5" />
      <rect x="266" y="8" width="54" height="6" rx="3" fill="#eadfc8" />
    </g>
  </svg>;
}

function DailyBars() {
  const tallest = Math.max(...DAYS.map(day => day.kwh));
  return <svg viewBox="0 0 320 96" role="img" aria-label="Daily bars example: one bar per day, closed days marked" className={styles.figure}>
    {DAYS.map((day, index) => {
      const height = Math.round(day.kwh / tallest * 58);
      return <g key={index}>
        <rect x={index * 31 + 6} y={72 - height} width="20" height={height} rx="3" fill={day.closed ? "#b9cdbf" : "#2f7a5b"} />
        {day.closed && <rect x={index * 31 + 6} y="76" width="20" height="4" rx="2" fill="#c8b184" />}
        {day.kwh < 40 && <text x={index * 31 + 16} y={66 - height} textAnchor="middle" className={styles.figureAxis}>?</text>}
      </g>;
    })}
    <line x1="0" y1="72" x2="320" y2="72" stroke="#cdd7d1" strokeWidth="1" />
  </svg>;
}

function Ranking() {
  return <svg viewBox="0 0 320 96" role="img" aria-label="Ranking example: each device's share of the site total" className={styles.figure}>
    {SHARES.map((item, index) => <g key={item.name}>
      <text x="0" y={index * 23 + 16} className={styles.figureLabel}>{item.name}</text>
      <rect x="140" y={index * 23 + 6} width="170" height="12" rx="4" fill="#eef2ef" />
      <rect x="140" y={index * 23 + 6} width={item.pct / 21 * 170} height="12" rx="4" fill={item.faint ? "#a9c4b3" : "#2f7a5b"} />
      <text x="316" y={index * 23 + 16} textAnchor="end" className={styles.figureAxis}>{item.pct}%</text>
    </g>)}
  </svg>;
}

function Plan() {
  return <svg viewBox="0 0 320 120" role="img" aria-label="Floor plan example: areas, rooms and equipment" className={styles.figure}>
    <rect x="4" y="10" width="150" height="100" rx="8" fill="#fbeee9" stroke="#d98f74" />
    <text x="16" y="28" className={styles.figureLabel}>DB2 · Showroom area</text>
    <rect x="16" y="38" width="80" height="40" rx="5" fill="#fff" stroke="#e3b8a6" />
    <text x="24" y="62" className={styles.figureAxis}>Showroom</text>
    <rect x="24" y="84" width="118" height="18" rx="5" fill="none" stroke="#2f7a5b" strokeDasharray="4 3" />
    <text x="32" y="97" className={styles.figureAxis}>3 display panels</text>
    <rect x="166" y="10" width="150" height="100" rx="8" fill="#eaf0f7" stroke="#7d9ec4" />
    <text x="178" y="28" className={styles.figureLabel}>DB1 · Office area</text>
    <rect x="178" y="38" width="60" height="64" rx="5" fill="#fff" stroke="#b7c9de" />
    <text x="186" y="74" className={styles.figureAxis}>Open office</text>
    <rect x="246" y="38" width="58" height="28" rx="5" fill="#fff" stroke="#b7c9de" />
    <text x="254" y="56" className={styles.figureAxis}>Meeting</text>
  </svg>;
}

const FIGURES: Record<GuideSample["figure"], () => React.JSX.Element> = { heatmap: Heatmap, daily: DailyBars, ranking: Ranking, plan: Plan };

export function GuideFigure({ figure }: { figure: GuideSample["figure"] }) {
  const Drawing = FIGURES[figure];
  return <Drawing />;
}
