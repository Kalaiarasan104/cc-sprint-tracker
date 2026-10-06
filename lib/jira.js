import { chooseActiveSprint } from "./tasks.js";

const JIRA_AUTH_ERROR =
  "Jira rejected the request. Stay signed in to that Atlassian site in this Chrome profile, or add an API token in Settings.";

export async function fetchActiveSprint(settings) {
  const board = await jiraFetch(
    settings,
    `/rest/agile/1.0/board/${settings.boardId}/sprint?state=active`,
  );
  const sprint = chooseActiveSprint(board.values);
  if (!sprint) {
    throw new Error("No active sprint was found on this board.");
  }

  const [issues, myself] = await Promise.all([
    fetchAllSprintIssues(settings, sprint.id),
    fetchMyself(settings),
  ]);

  return { sprint, issues, myself };
}

export async function fetchIssuesByKeys(settings, issueKeys) {
  const unique = [...new Set((issueKeys || []).map((key) => String(key).toUpperCase()))].filter(
    (key) => /^(?:CC|BC|SET)-\d+$/.test(key),
  );
  const issues = [];
  for (let index = 0; index < unique.length; index += 40) {
    const batch = unique.slice(index, index + 40);
    const jql = `key in (${batch.join(",")})`;
    const query = `jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,assignee,priority,duedate`;
    const data = await searchIssues(settings, query);
    issues.push(...(data.issues || []));
  }
  return issues;
}

async function searchIssues(settings, query) {
  try {
    return await jiraFetch(settings, `/rest/api/3/search/jql?${query}`);
  } catch {
    return await jiraFetch(settings, `/rest/api/3/search?${query}`);
  }
}

async function fetchAllSprintIssues(settings, sprintId) {
  const issues = [];
  let startAt = 0;
  const fields = "summary,status,assignee,priority,duedate";

  for (let page = 0; page < 20; page += 1) {
    const data = await jiraFetch(
      settings,
      `/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=50&fields=${fields}`,
    );
    const batch = data.issues || [];
    issues.push(...batch);
    const total = Number(data.total ?? issues.length);
    if (!batch.length || issues.length >= total) break;
    startAt += batch.length;
  }

  return issues;
}

async function fetchMyself(settings) {
  try {
    return await jiraFetch(settings, "/rest/api/3/myself");
  } catch {
    return null;
  }
}

async function jiraFetch(settings, path) {
  const headers = { Accept: "application/json", "X-Atlassian-Token": "no-check" };
  const hasToken = Boolean(settings.jiraEmail && settings.jiraApiToken);
  if (hasToken) {
    headers.Authorization = `Basic ${btoa(`${settings.jiraEmail}:${settings.jiraApiToken}`)}`;
  }

  const response = await fetch(`${settings.jiraBaseUrl.replace(/\/$/, "")}${path}`, {
    headers,
    credentials: hasToken ? "omit" : "include",
  });
  const text = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new Error(JIRA_AUTH_ERROR);
  }
  if (!response.ok) {
    throw new Error(`Jira request failed (${response.status}).`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Jira did not return sprint data. Sign in to that Atlassian site in this Chrome profile and refresh.",
    );
  }
}
