import { boardLabel } from "./boards.js";
import { daysUntil, todayIso } from "./dates.js";
import { etaUrgency, isVisibleTask } from "./tasks.js";

export const MORNING_HOUR = 9;
export const MORNING_MINUTE = 0;

export function nextWeekdayMorning(now = new Date(), hour = MORNING_HOUR, minute = MORNING_MINUTE) {
  const next = new Date(now.getTime());
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  next.setHours(hour, minute, 0, 0);
  return next.getTime();
}

export function morningSummaryText(boards, cachesById, settings, now = new Date()) {
  const lines = (boards || [])
    .map((board) => boardSummaryLine(board, cachesById?.[board.id], settings, now))
    .filter(Boolean);
  if (!lines.length) return "";
  if (lines.length <= 4) return lines.join("\n");
  return [...lines.slice(0, 3), `${lines.length - 3} more boards`].join("\n");
}

function boardSummaryLine(board, cache, settings, now) {
  const label = boardLabel(board);
  if (!cache?.synced && cache?.jiraError) return `${label}: ${cache.jiraError}`;
  if (!cache?.sprint) return `${label}: no active sprint`;
  const today = todayIso(now);
  const accountId = cache.myself?.accountId || "";
  const tasks = (cache.tasks || []).filter((task) =>
    isVisibleTask(task, {
      onlyMine: settings?.onlyMine !== false,
      hideDone: false,
      accountId,
      query: "",
    }),
  );
  const inDev = tasks.filter((task) => !task.stopTracing);
  const slipped = inDev.filter((task) => etaUrgency(task, today) === "slipped").length;
  const dueToday = inDev.filter((task) => etaUrgency(task, today) === "today").length;
  const left = daysUntil(cache.sprint.endDate, now);
  const leftLabel = left == null ? "" : left >= 0 ? `${left} days left` : `${Math.abs(left)} days past the end`;
  const name = cache.sprint.name || label;
  const parts = [name, leftLabel, `${inDev.length} in dev`, `${slipped} slipped`, `${dueToday} due today`];
  if (cache.jiraError) parts.push("update failed");
  return parts.filter(Boolean).join(" · ");
}
