import test from "node:test";
import assert from "node:assert/strict";
import { parseJiraBoardUrl } from "../lib/config.js";
import { parseCsv } from "../lib/csv.js";
import { parseSheetDate, toIsoDate, formatTimeLeft, timerDurationMs } from "../lib/dates.js";
import { columnLabel, extractIssueKeys, parseSheet } from "../lib/sheet.js";
import { statusFlags } from "../lib/status.js";
import { buildTasks, chooseActiveSprint, etaUrgency, isVisibleTask, sortTasks } from "../lib/tasks.js";

test("parseCsv keeps quoted commas and escaped quotes", () => {
  const rows = parseCsv('Ticket,Summary\nCC-1,"Hello, ""team"""\n');
  assert.deepEqual(rows, [
    ["Ticket", "Summary"],
    ["CC-1", 'Hello, "team"'],
  ]);
});

test("timerDurationMs combines hours and minutes", () => {
  const minuteMs = 60 * 1000;
  assert.equal(timerDurationMs("4", ""), 240 * minuteMs);
  assert.equal(timerDurationMs("1", "30"), 90 * minuteMs);
  assert.equal(timerDurationMs("", "45"), 45 * minuteMs);
  assert.equal(timerDurationMs(" 2 ", "05"), 125 * minuteMs);
  assert.equal(timerDurationMs("168", "0"), 168 * 60 * minuteMs);
  assert.throws(() => timerDurationMs("0", "0"), /at least 1 minute/);
  assert.throws(() => timerDurationMs("", ""), /at least 1 minute/);
  assert.throws(() => timerDurationMs("1", "60"), /59 or less/);
  assert.throws(() => timerDurationMs("-1", "10"), /whole numbers/);
  assert.throws(() => timerDurationMs("1.5", "0"), /whole numbers/);
  assert.throws(() => timerDurationMs("168", "1"), /up to 168 hours/);
});

test("parseSheetDate prefers day-month for ambiguous numbers", () => {
  assert.equal(parseSheetDate("01/10/2026", "dmy"), "2026-10-01");
  assert.equal(parseSheetDate("01/10/2026", "mdy"), "2026-01-10");
  assert.equal(parseSheetDate("1 Oct 2026"), "2026-10-01");
  assert.equal(parseSheetDate("2026-10-06 18:00:00"), "2026-10-06");
  assert.equal(parseSheetDate("TBD"), "");
  assert.equal(toIsoDate(2026, 10, 1), "2026-10-01");
});

test("parseSheet maps ticket, ETA, and dev done columns", () => {
  const csv = [
    "Sprint tracker",
    "Jira,Owner,ETA,Dev done date",
    "https://anywhereworks.atlassian.net/browse/CC-3592,Kalai,03/10/2026,01/10/2026",
    "BC-17377,Kalai,02/10/2026,",
  ].join("\n");

  const parsed = parseSheet(csv, { dateOrder: "dmy" });
  assert.equal(columnLabel(parsed.headers, parsed.mapping.ticket), "Jira");
  assert.equal(columnLabel(parsed.headers, parsed.mapping.eta), "ETA");
  assert.equal(columnLabel(parsed.headers, parsed.mapping.devDone), "Dev done date");
  assert.deepEqual(parsed.rows[0], {
    issueKeys: ["CC-3592"],
    eta: "2026-10-03",
    devDoneDate: "2026-10-01",
    storyPoints: "",
  });
  assert.deepEqual(extractIssueKeys(parsed.rows[1].issueKeys.join(" ")), ["BC-17377"]);
  assert.equal(parsed.rows[1].devDoneDate, "");
  assert.equal(parsed.warning, "");
});

test("details and meta columns are not treated as ETA", () => {
  const parsed = parseSheet("Owner,Details,Meta,Dev done\nCC-1,foo,bar,01/10/2026\n", {
    dateOrder: "dmy",
  });
  assert.equal(parsed.mapping.eta, -1);
  assert.equal(parsed.mapping.devDone >= 0, true);
  assert.equal(parsed.warning, "");
});

test("story points sheet maps a bare ticket number to a CC key", () => {
  const parsed = parseSheet("Ticket number,Story points,ETA\n3592,5,03/10/2026\n", {
    dateOrder: "dmy",
  });
  assert.equal(columnLabel(parsed.headers, parsed.mapping.ticket), "Ticket number");
  assert.equal(columnLabel(parsed.headers, parsed.mapping.storyPoints), "Story points");
  assert.deepEqual(parsed.rows[0].issueKeys, ["CC-3592"]);
  assert.equal(parsed.rows[0].storyPoints, "5");
  assert.equal(parsed.rows[0].eta, "2026-10-03");
});

test("buildTasks marks slipped ETA and keeps released work hidden", () => {
  const issues = [
    issue("CC-1", "Ship it", "Development - WIP", "indeterminate", "Highest", "me"),
    issue("CC-2", "Released", "Released Live", "done", "High", "me"),
    issue("CC-3", "Other person", "Open", "new", "Medium", "other"),
  ];
  const tasks = buildTasks(
    issues,
    [
      { issueKeys: ["CC-1"], eta: "2026-09-01", devDoneDate: "" },
      { issueKeys: ["CC-2"], eta: "2026-09-01", devDoneDate: "2026-09-02" },
    ],
    "me",
    "https://anywhereworks.atlassian.net",
  );

  assert.equal(etaUrgency(tasks[0], "2026-10-01"), "slipped");
  assert.equal(tasks[0].devDone, false);
  assert.equal(tasks[0].releasedLive, false);
  assert.equal(tasks[1].devDone, true);
  assert.equal(tasks[1].releasedLive, true);
  assert.equal(tasks[0].url, "https://anywhereworks.atlassian.net/browse/CC-1");

  const visible = sortTasks(tasks, "2026-10-01").filter((task) =>
    isVisibleTask(task, {
      onlyMine: true,
      hideDone: true,
      accountId: "me",
      query: "",
    }),
  );
  assert.deepEqual(visible.map((task) => task.key), ["CC-1"]);
});

test("dev done starts at Development - Done and released live is separate", () => {
  assert.deepEqual(statusFlags("Development - WIP"), {
    devDone: false,
    releasedLive: false,
    stopTracing: false,
  });
  assert.deepEqual(statusFlags("Development - Done"), {
    devDone: true,
    releasedLive: false,
    stopTracing: true,
  });
  assert.equal(statusFlags("Testing - To Do").devDone, true);
  assert.equal(statusFlags("Testing WIP").devDone, true);
  assert.equal(statusFlags("Testing WIP").releasedLive, false);
  assert.equal(statusFlags("QA Passed").devDone, true);
  assert.equal(statusFlags("Released - Alpha").releasedLive, false);
  assert.equal(statusFlags("Released Live").releasedLive, true);
  assert.equal(statusFlags("Released Live").devDone, true);
  assert.equal(statusFlags("Bug Resolved").releasedLive, true);
  assert.equal(statusFlags("Bug Resolved").devDone, true);
});

test("formatTimeLeft counts down to zero", () => {
  const now = Date.parse("2026-10-01T12:00:00");
  assert.equal(formatTimeLeft(now + 45000, now), "45s left");
  assert.equal(formatTimeLeft(now + 90000, now), "1m 30s left");
  assert.equal(formatTimeLeft(now + 3661000, now), "1h 01m left");
  assert.equal(formatTimeLeft(now, now), "Time's up");
});
test("parseJiraBoardUrl reads the site and board id from a pasted link", () => {
  const parsed = parseJiraBoardUrl(
    "https://anywhereworks.atlassian.net/jira/software/c/projects/CC/boards/193?sprint=16537",
  );
  assert.equal(parsed.jiraBaseUrl, "https://anywhereworks.atlassian.net");
  assert.equal(parsed.boardId, 193);

  const rapidView = parseJiraBoardUrl(
    "https://acme.atlassian.net/secure/RapidBoard.jspa?rapidView=42",
  );
  assert.equal(rapidView.jiraBaseUrl, "https://acme.atlassian.net");
  assert.equal(rapidView.boardId, 42);
  assert.throws(() => parseJiraBoardUrl("https://example.com/boards/1"), /atlassian\.net/);
});

test("chooseActiveSprint picks the latest active sprint", () => {
  const sprint = chooseActiveSprint([
    { name: "CBA 102", state: "active", endDate: "2026-10-20T00:00:00.000Z" },
    { name: "CC Sprint 108", state: "active", endDate: "2026-10-06T12:30:00.000Z" },
    { name: "CC Sprint 107", state: "closed", endDate: "2026-09-22T12:00:00.000Z" },
  ]);
  assert.equal(sprint.name, "CBA 102");
});

function issue(key, summary, status, category, priority, accountId) {
  return {
    key,
    fields: {
      summary,
      status: { name: status, statusCategory: { key: category } },
      assignee: { accountId, displayName: accountId },
      priority: { name: priority },
    },
  };
}
