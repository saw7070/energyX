/** Convert the project-local form time, never the browser machine timezone. Ambiguous DST requires explicit resolution. */
export function actionLocalInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose the execution date and time.");
  const target = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(target)) throw new Error("Invalid date.");
  const format = new Intl.DateTimeFormat("sv-SE", { timeZone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" });
  const matches: number[] = [];
  // IANA modern offsets fall on 15-minute boundaries; require an exact roundtrip.
  for(let minutes=-14*60;minutes<=14*60;minutes+=15) {
    const candidate=target-minutes*60000;
    if(format.format(new Date(candidate)).replace(" ","T")===value) matches.push(candidate);
  }
  if(matches.length!==1) throw new Error("This local time is unavailable or ambiguous. Choose a different time.");
  return new Date(matches[0]!).toISOString();
}
