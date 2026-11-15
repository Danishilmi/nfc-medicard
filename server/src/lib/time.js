// Dates and times in Malaysia (UTC+8). The server runs on UTC, which is still
// "yesterday" until 8 am Malaysian time, so anything that depends on "today"
// or "now" goes through here.
const TZ = "Asia/Kuala_Lumpur";

// { date: "YYYY-MM-DD", time: "HH:MM" } for now (or a given Date) in Malaysia.
export function malaysiaNow(at = new Date()) {
  return {
    date: at.toLocaleDateString("en-CA", { timeZone: TZ }),
    time: at.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

// "YYYY-MM-DD" plus n days.
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
