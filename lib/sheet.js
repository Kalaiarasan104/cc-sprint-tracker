import { parseCsv } from "./csv.js";
import { parseSheetDate } from "./dates.js";

const ISSUE_KEY_PATTERN = /\b(?:CC|BC|SET)-\d+\b/gi;

const TICKET_HINTS = ["ticket number", "ticket no", "ticket", "jira", "issue key", "issue id", "issue"];
const ETA_HINTS = ["eta", "dev eta", "target date", "planned date"];
const STORY_POINT_HINTS = ["story points", "story point", "points", "sp"];
const DEV_DONE_HINTS = [
  "dev done date",
  "dev done",
  "devdone",
  "development done",
  "dev completed",
  "dev complete",
];

export function extractIssueKeys(value) {
  const matches = String(value ?? "").match(ISSUE_KEY_PATTERN) || [];
  return [...new Set(matches.map((key) => key.toUpperCase()))];
}

export function parseSheet(csvText, settings = {}) {
  const table = parseCsv(csvText);
  if (!table.length) {
    return {
      rows: [],
      headers: [],
      mapping: { ticket: -1, eta: -1, devDone: -1, storyPoints: -1 },
      warning: "The sheet did not contain any rows.",
    };
  }

  const headerRowIndex = findHeaderRow(table);
  const headers = table[headerRowIndex] || [];
  const mapping = {
    ticket: findColumn(headers, settings.ticketHeader, TICKET_HINTS),
    eta: findColumn(headers, settings.etaHeader, ETA_HINTS),
    devDone: findColumn(headers, settings.devDoneHeader, DEV_DONE_HINTS),
    storyPoints: findColumn(headers, settings.storyPointsHeader, STORY_POINT_HINTS),
  };

  if (mapping.ticket < 0) {
    mapping.ticket = columnWithMostKeys(table, headerRowIndex);
  }

  const rows = [];
  for (let index = headerRowIndex + 1; index < table.length; index += 1) {
    const cells = table[index];
    const keySource = mapping.ticket >= 0 ? cells[mapping.ticket] : cells.join(" ");
    const issueKeys = keysFromTicketCell(keySource);
    const fallbackKeys = issueKeys.length ? issueKeys : extractIssueKeys(cells.join(" "));
    if (!fallbackKeys.length) continue;
    rows.push({
      issueKeys: fallbackKeys,
      eta: mapping.eta >= 0 ? parseSheetDate(cells[mapping.eta], settings.dateOrder) : "",
      devDoneDate:
        mapping.devDone >= 0
          ? parseSheetDate(cells[mapping.devDone], settings.dateOrder)
          : "",
      storyPoints: mapping.storyPoints >= 0 ? parseStoryPoints(cells[mapping.storyPoints]) : "",
    });
  }

  const warning = buildWarning(headers, rows.length);
  return { rows, headers, mapping, warning };
}

function findHeaderRow(table) {
  const limit = Math.min(table.length, 10);
  let bestIndex = 0;
  let bestScore = 0;
  for (let index = 0; index < limit; index += 1) {
    const score = scoreHeader(table[index]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore >= 3 ? bestIndex : 0;
}

function scoreHeader(row) {
  const cells = row.map((cell) => cell.toLowerCase());
  let score = 0;
  if (cells.some((cell) => headerMatches(cell, "eta"))) score += 3;
  if (cells.some((cell) => headerMatches(cell, "dev done") || headerMatches(cell, "devdone"))) {
    score += 3;
  }
  if (cells.some((cell) => headerMatches(cell, "ticket") || headerMatches(cell, "jira"))) {
    score += 3;
  }
  return score;
}

function findColumn(headers, override, hints) {
  const normalized = headers.map((header) => header.toLowerCase().trim());
  const wanted = String(override || "").toLowerCase().trim();
  if (wanted) {
    const exact = normalized.findIndex((header) => header === wanted);
    if (exact >= 0) return exact;
    const partial = normalized.findIndex((header) => headerMatches(header, wanted));
    if (partial >= 0) return partial;
  }
  for (const hint of hints) {
    const match = normalized.findIndex((header) => headerMatches(header, hint));
    if (match >= 0) return match;
  }
  return -1;
}

function headerMatches(header, hint) {
  const pattern = new RegExp(
    `(^|[^a-z0-9])${hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
  );
  return pattern.test(header);
}

function columnWithMostKeys(table, headerRowIndex) {
  const width = Math.max(...table.map((row) => row.length));
  let bestColumn = -1;
  let bestCount = 0;
  for (let column = 0; column < width; column += 1) {
    let count = 0;
    for (let rowIndex = headerRowIndex + 1; rowIndex < table.length; rowIndex += 1) {
      count += extractIssueKeys(table[rowIndex][column]).length;
    }
    if (count > bestCount) {
      bestCount = count;
      bestColumn = column;
    }
  }
  return bestCount > 0 ? bestColumn : -1;
}

function buildWarning(headers, rowCount) {
  if (!rowCount) {
    const found = headers.filter(Boolean).join(", ") || "none";
    return `No Jira ticket numbers were found in the sheet. Headers seen: ${found}.`;
  }
  return "";
}

export function parseStoryPoints(value) {
  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)(?:\s*pts?)?$/i);
  if (!match) return "";
  const points = Number(match[1]);
  if (!Number.isFinite(points) || points <= 0 || points > 100) return "";
  return String(points);
}

function keysFromTicketCell(value) {
  const keys = extractIssueKeys(value);
  if (keys.length) return keys;
  const bareNumber = String(value ?? "").trim().match(/^#?(\d{3,6})$/);
  if (!bareNumber) return [];
  return [`CC-${bareNumber[1]}`];
}

export function columnLabel(headers, index) {
  if (index < 0) return "not found";
  return headers[index] || `column ${index + 1}`;
}
