import { issueUrl } from "./config.js";
import { todayIso } from "./dates.js";
import { statusFlags } from "./status.js";

const PRIORITY_RANK = {
  Highest: 0,
  High: 1,
  Medium: 2,
  Normal: 3,
  Low: 4,
};

const URGENCY_RANK = {
  slipped: 0,
  today: 1,
  upcoming: 2,
  none: 3,
};

export function chooseActiveSprint(sprints) {
  const active = (sprints || []).filter((sprint) => sprint.state === "active");
  if (!active.length) return null;
  return [...active].sort((left, right) =>
    String(right.endDate || "").localeCompare(String(left.endDate || "")),
  )[0];
}

export function indexSheetRows(rows) {
  const byKey = new Map();
  (rows || []).forEach((row) => {
    row.issueKeys.forEach((issueKey) => {
      const existing = byKey.get(issueKey);
      if (!existing) {
        byKey.set(issueKey, row);
        return;
      }
      byKey.set(issueKey, {
        issueKeys: existing.issueKeys,
        eta: existing.eta || row.eta,
        devDoneDate: existing.devDoneDate || row.devDoneDate,
        storyPoints: existing.storyPoints || row.storyPoints || "",
      });
    });
  });
  return byKey;
}

export function buildTasks(issues, sheetRows, accountId, jiraBaseUrl) {
  const issuesByKey = new Map((issues || []).map((issue) => [issue.key, issue]));
  const sheetByKey = indexSheetRows(sheetRows);
  if (!sheetByKey.size) {
    return (issues || []).map((issue) => toTask(issue, null, accountId, jiraBaseUrl));
  }

  return [...sheetByKey.keys()].map((issueKey) =>
    toTask(issuesByKey.get(issueKey), sheetByKey.get(issueKey), accountId, jiraBaseUrl, issueKey),
  );
}

function toTask(issue, sheetRow, accountId, jiraBaseUrl, fallbackKey) {
  const fields = issue?.fields || {};
  const assignee = fields.assignee || {};
  const issueKey = issue?.key || fallbackKey;
  const status = fields.status?.name || "";
  const flags = statusFlags(status);
  return {
    key: issueKey,
    summary: fields.summary || (issue ? "" : "Not found in Jira"),
    status,
    statusCategory: fields.status?.statusCategory?.key || "",
    assignee: assignee.displayName || "Unassigned",
    assigneeAccountId: assignee.accountId || "",
    priority: fields.priority?.name || "",
    jiraDueDate: fields.duedate || "",
    eta: sheetRow?.eta || String(fields.duedate || "").slice(0, 10),
    devDoneDate: sheetRow?.devDoneDate || "",
    storyPoints: sheetRow?.storyPoints || "",
    devDone: flags.devDone,
    releasedLive: flags.releasedLive,
    stopTracing: flags.stopTracing,
    missingInJira: !issue,
    isMine: Boolean(accountId) && assignee.accountId === accountId,
    url: issueUrl(jiraBaseUrl, issueKey),
  };
}

export function etaUrgency(task, today = todayIso()) {
  if (!task.eta || task.devDone || task.releasedLive) return "none";
  if (task.eta < today) return "slipped";
  if (task.eta === today) return "today";
  return "upcoming";
}

export function isVisibleTask(task, options) {
  const { onlyMine, hideDone, accountId, query } = options;
  if (hideDone && task.stopTracing) return false;
  if (onlyMine && accountId && task.assigneeAccountId !== accountId) return false;
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${task.key} ${task.summary} ${task.status} ${task.assignee}`.toLowerCase();
  return haystack.includes(needle);
}

function stageRank(task) {
  if (task.releasedLive) return 2;
  if (task.devDone || task.stopTracing) return 1;
  return 0;
}

export function sortTasks(tasks, today = todayIso()) {
  return [...tasks].sort((left, right) => {
    const leftStage = stageRank(left);
    const rightStage = stageRank(right);
    if (leftStage !== rightStage) return leftStage - rightStage;

    const leftUrgency = URGENCY_RANK[etaUrgency(left, today)];
    const rightUrgency = URGENCY_RANK[etaUrgency(right, today)];
    if (leftUrgency !== rightUrgency) return leftUrgency - rightUrgency;

    if (left.eta !== right.eta) {
      if (!left.eta) return 1;
      if (!right.eta) return -1;
      return left.eta < right.eta ? -1 : 1;
    }

    const leftPriority = PRIORITY_RANK[left.priority] ?? 5;
    const rightPriority = PRIORITY_RANK[right.priority] ?? 5;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.key.localeCompare(right.key);
  });
}
