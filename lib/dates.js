const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const EMPTY_DATE = /^(?:n\/a|na|tbd|tba|nil|none|—|-|–)$/i;

export function todayIso(now = new Date()) {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toIsoDate(year, month, day) {
  if (!year || !month || !day) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const fullYear = year < 100 ? 2000 + year : year;
  return `${String(fullYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseSheetDate(raw, dateOrder = "dmy", now = new Date()) {
  const value = String(raw ?? "").trim();
  if (!value || EMPTY_DATE.test(value)) return "";

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  if (/^\d{4,6}(?:\.\d+)?$/.test(value)) {
    return fromSheetSerial(Number(value));
  }

  const named = value.match(
    /^(\d{1,2})[\s\-/]+([A-Za-z]{3,9})[\s\-/]+(\d{2,4})$/,
  );
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    return toIsoDate(Number(named[3]), month, Number(named[1]));
  }

  const namedMonthFirst = value.match(
    /^([A-Za-z]{3,9})[\s\-/]+(\d{1,2})(?:st|nd|rd|th)?(?:,)?[\s\-/]+(\d{2,4})$/,
  );
  if (namedMonthFirst) {
    const month = MONTHS[namedMonthFirst[1].toLowerCase()];
    return toIsoDate(Number(namedMonthFirst[3]), month, Number(namedMonthFirst[2]));
  }

  const namedWithoutYear = value.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3,9})$/);
  if (namedWithoutYear) {
    const month = MONTHS[namedWithoutYear[2].toLowerCase()];
    return toIsoDate(now.getFullYear(), month, Number(namedWithoutYear[1]));
  }

  const numeric = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!numeric) return "";

  const first = Number(numeric[1]);
  const second = Number(numeric[2]);
  const year = Number(numeric[3]);
  let day = first;
  let month = second;
  if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else if (second > 12 && first <= 12) {
    day = second;
    month = first;
  } else if (dateOrder === "mdy") {
    day = second;
    month = first;
  }

  return toIsoDate(year, month, day);
}

function fromSheetSerial(serial) {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return "";
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86400000);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function formatDisplayDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimeLeft(targetMs, now = Date.now()) {
  const remainingMs = Number(targetMs) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Time's up";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m left`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s left`;
  return `${seconds}s left`;
}

export const MAX_TIMER_HOURS = 168;

export function timerDurationMs(hoursInput, minutesInput) {
  const hours = parseTimerPart(hoursInput);
  const minutes = parseTimerPart(minutesInput);
  if (hours == null || minutes == null) {
    throw new Error("Hours and minutes must be whole numbers.");
  }
  if (minutes > 59) throw new Error("Minutes must be 59 or less. Use the hours box for more.");
  const totalMinutes = hours * 60 + minutes;
  if (totalMinutes < 1) throw new Error("Set at least 1 minute.");
  if (totalMinutes > MAX_TIMER_HOURS * 60) {
    throw new Error(`Timers can run up to ${MAX_TIMER_HOURS} hours.`);
  }
  return totalMinutes * 60 * 1000;
}

function parseTimerPart(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

export function etaReminderTime(isoDate, hour = 10) {
  const [year, month, day] = String(isoDate || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

export function daysUntil(isoTimestamp, now = new Date()) {
  if (!isoTimestamp) return null;
  const end = new Date(isoTimestamp).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - now.getTime()) / 86400000);
}
