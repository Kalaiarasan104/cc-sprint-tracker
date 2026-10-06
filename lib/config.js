export const DEFAULT_SETTINGS = {
  boardUrl: "",
  jiraBaseUrl: "",
  boardId: 0,
  jiraEmail: "",
  jiraApiToken: "",
  onlyMine: true,
  hideDone: true,
};

export const REFRESH_ALARM = "sprint-refresh";
export const REFRESH_MINUTES = 15;
export const REMINDER_PREFIX = "reminder:";

export function issueUrl(jiraBaseUrl, issueKey) {
  return `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issueKey}`;
}

export function reminderAlarmName(issueKey) {
  return `${REMINDER_PREFIX}${issueKey}`;
}

export function parseJiraBoardUrl(raw) {
  const value = String(raw || "").trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a full Jira board link.");
  }
  if (!url.hostname.endsWith(".atlassian.net")) {
    throw new Error("Paste an Atlassian board link from your site, ending in .atlassian.net.");
  }
  const boardMatch = url.pathname.match(/\/boards\/(\d+)/);
  const rapidView = url.searchParams.get("rapidView");
  const boardId = Number(boardMatch?.[1] || rapidView);
  if (!Number.isInteger(boardId) || boardId < 1) {
    throw new Error("That link has no board id. Open the board in Jira and paste its address.");
  }
  return {
    boardUrl: value,
    jiraBaseUrl: `${url.protocol}//${url.host}`,
    boardId,
  };
}
