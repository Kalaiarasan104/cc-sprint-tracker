import { formatDateTime, formatDisplayDate } from "./lib/dates.js";

const dueList = document.querySelector("#dueList");
const dueError = document.querySelector("#dueError");
const closeButton = document.querySelector("#closeDue");

closeButton.addEventListener("click", () => window.close());

dueList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const issueKey = button.dataset.issueKey;
  const action = button.dataset.action;
  if (!issueKey || !action) return;
  const messageType = {
    "open-issue": "openIssue",
    "snooze-reminder": "snoozeReminder",
    "dismiss-alert": "dismissAlert",
  }[action];
  if (!messageType) return;
  send({ type: messageType, issueKey }).catch(showError);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.alerts) return;
  load().catch(showError);
});

load().catch(showError);

async function load() {
  const state = await send({ type: "getState" });
  const alerts = state.alerts || {};
  const entries = Object.entries(alerts).sort((left, right) => (right[1]?.at || 0) - (left[1]?.at || 0));
  if (!entries.length) {
    window.close();
    return;
  }
  dueList.replaceChildren(...entries.map(([issueKey, alert]) => dueCard(issueKey, alert)));
}

function dueCard(issueKey, alert) {
  const card = document.createElement("article");
  card.className = "float-card due-card";
  const title = document.createElement("h2");
  title.textContent = issueKey;
  const firedAt = document.createElement("span");
  firedAt.className = "fired-at";
  firedAt.textContent = alert.at ? formatDateTime(alert.at) : "";
  const head = document.createElement("div");
  head.className = "card-head";
  head.append(title, firedAt);
  const summary = document.createElement("p");
  summary.className = "due-summary";
  summary.textContent = alert.summary || "Sprint reminder";
  const details = document.createElement("p");
  details.className = "float-note";
  details.textContent = [alert.status || "No status", alert.assignee || "Unassigned", alert.priority]
    .filter(Boolean)
    .join(" · ");
  const flags = document.createElement("div");
  flags.className = "flag-row";
  flags.append(pill(alert.devDone ? "Dev done" : "Still in dev", alert.devDone ? "ok" : ""));
  flags.append(pill(alert.releasedLive ? "Released live" : "Not live", alert.releasedLive ? "ok" : ""));
  if (alert.eta) flags.append(pill(`Due ${formatDisplayDate(alert.eta)}`, ""));
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    actionButton("Open ticket", "open-issue", issueKey, true),
    actionButton("Snooze 30 min", "snooze-reminder", issueKey, false),
    actionButton("Dismiss", "dismiss-alert", issueKey, false),
  );
  card.append(head, summary, details, flags, actions);
  return card;
}

function pill(text, kind) {
  const node = document.createElement("span");
  node.className = kind ? `pill ${kind}` : "pill";
  node.textContent = text;
  return node;
}

function actionButton(text, action, issueKey, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.dataset.issueKey = issueKey;
  button.textContent = text;
  if (primary) button.className = "primary";
  return button;
}

function showError(error) {
  dueError.hidden = false;
  dueError.textContent = error instanceof Error ? error.message : "Could not update the reminder.";
}

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Extension request failed.");
    return response;
  });
}
