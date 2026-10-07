import { parseJiraBoardUrl } from "./lib/config.js";
import {
  daysUntil,
  etaReminderTime,
  formatDateTime,
  formatDisplayDate,
  formatTimeLeft,
  normalizeTimerParts,
  timerDurationMs,
  todayIso,
} from "./lib/dates.js";
import { etaUrgency, isVisibleTask, sortTasks } from "./lib/tasks.js";

const sprintName = document.querySelector("#sprintName");
const sprintMeta = document.querySelector("#sprintMeta");
const stats = document.querySelector("#stats");
const banner = document.querySelector("#banner");
const searchInput = document.querySelector("#searchInput");
const onlyMineInput = document.querySelector("#onlyMine");
const hideDoneInput = document.querySelector("#hideDone");
const taskList = document.querySelector("#taskList");
const emptyState = document.querySelector("#emptyState");
const statusLine = document.querySelector("#statusLine");
const timeUp = document.querySelector("#timeUp");
const refreshButton = document.querySelector("#refreshButton");
const settingsButton = document.querySelector("#settingsButton");
const boardForm = document.querySelector("#boardForm");
const boardUrlInput = document.querySelector("#boardUrlInput");

let state = { settings: {}, cache: null, reminders: {}, alerts: {} };
let query = "";
let countdownFrame = 0;
let lastCountdownPaint = 0;
let openDurationButton = null;
const firedCountdown = new Set();
const hourChoices = Array.from({ length: 70 }, (_, index) => index + 1);
const minuteChoices = [0, 10, 20, 30, 40, 50];
const durationMenu = document.querySelector("#durationMenu");

refreshButton.addEventListener("click", () => load(true));
settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
boardForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let parsed;
  try {
    parsed = parseJiraBoardUrl(boardUrlInput.value);
  } catch (error) {
    showActionError(error);
    return;
  }
  send({
    type: "updateSettings",
    patch: {
      boardUrl: parsed.boardUrl,
      jiraBaseUrl: parsed.jiraBaseUrl,
      boardId: parsed.boardId,
    },
  })
    .then(() => send({ type: "refresh" }))
    .then(applyState)
    .catch(showActionError);
});
searchInput.addEventListener("input", () => {
  query = searchInput.value;
  render();
});
onlyMineInput.addEventListener("change", () => {
  send({ type: "updateSettings", patch: { onlyMine: onlyMineInput.checked } })
    .then(applyState)
    .catch(showActionError);
});
hideDoneInput.addEventListener("change", () => {
  send({ type: "updateSettings", patch: { hideDone: hideDoneInput.checked } })
    .then(applyState)
    .catch(showActionError);
});

taskList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const task = button.closest("[data-key]");
  const issueKey = task?.dataset.key;
  if (!issueKey) return;

  if (button.dataset.action === "preset-reminder") {
    const minutes = Number(button.dataset.minutes);
    if (!Number.isFinite(minutes) || minutes < 1) return;
    send({ type: "setReminder", issueKey, when: Date.now() + minutes * 60 * 1000 })
      .then(applyState)
      .catch(showActionError);
  }

  if (button.dataset.action === "set-reminder") {
    setCustomTimer(task, issueKey);
  }

  if (button.dataset.action === "remind-eta") {
    const when = etaReminderTime(button.dataset.eta, 10);
    if (!when || when <= Date.now()) {
      showActionError(new Error("That ETA is already past 10:00."));
      return;
    }
    send({ type: "setReminder", issueKey, when }).then(applyState).catch(showActionError);
  }

  if (button.dataset.action === "clear-reminder") {
    send({ type: "clearReminder", issueKey }).then(applyState).catch(showActionError);
  }

  if (button.dataset.action === "pause-reminder") {
    send({ type: "pauseReminder", issueKey }).then(applyState).catch(showActionError);
  }

  if (button.dataset.action === "resume-reminder") {
    send({ type: "resumeReminder", issueKey }).then(applyState).catch(showActionError);
  }

  if (button.dataset.action === "open-clock") {
    send({ type: "openClock" }).catch(showActionError);
  }
});

taskList.addEventListener("focusin", (event) => {
  const field = event.target.closest(".duration-value");
  if (field) openDurationMenu(field);
});

taskList.addEventListener("input", (event) => {
  const field = event.target.closest(".duration-value");
  if (!field) return;
  const maxDigits = field.dataset.timerPart === "hours" ? 3 : 5;
  const digits = field.value.replace(/\D/g, "").slice(0, maxDigits);
  if (digits !== field.value) field.value = digits;
  field.dataset.value = digits;
  if (field.dataset.timerPart === "minutes") carryExtraMinutes(field.closest("[data-key]"));
  if (openDurationButton === field) highlightDurationChoice(field);
});

taskList.addEventListener("keydown", (event) => {
  const field = event.target.closest(".duration-value");
  if (!field || event.key !== "Enter") return;
  const task = field.closest("[data-key]");
  if (!task?.dataset.key) return;
  event.preventDefault();
  closeDurationMenu();
  setCustomTimer(task, task.dataset.key);
});

durationMenu.addEventListener("mousedown", (event) => {
  if (event.target.closest("button")) event.preventDefault();
});

durationMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-duration-option]");
  if (!option || !openDurationButton) return;
  openDurationButton.dataset.value = option.dataset.durationOption;
  openDurationButton.value = option.dataset.durationOption;
  closeDurationMenu();
});

document.addEventListener("click", (event) => {
  if (!openDurationButton) return;
  if (event.target.closest(".duration-value") || event.target.closest("#durationMenu")) return;
  closeDurationMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDurationMenu();
});

document.addEventListener(
  "scroll",
  (event) => {
    if (event.target instanceof Node && durationMenu.contains(event.target)) return;
    closeDurationMenu();
  },
  true,
);

function carryExtraMinutes(task) {
  if (!task) return;
  const hoursField = task.querySelector('[data-timer-part="hours"]');
  const minutesField = task.querySelector('[data-timer-part="minutes"]');
  const parts = normalizeTimerParts(hoursField.value, minutesField.value);
  if (!parts || Number(minutesField.value) <= 59) return;
  writeTimerPart(hoursField, parts.hours);
  writeTimerPart(minutesField, parts.minutes);
}

function writeTimerPart(field, value) {
  const text = String(value);
  field.value = text;
  field.dataset.value = text;
}

function setCustomTimer(task, issueKey) {
  carryExtraMinutes(task);
  let durationMs;
  try {
    durationMs = timerDurationMs(
      task.querySelector('[data-timer-part="hours"]').value,
      task.querySelector('[data-timer-part="minutes"]').value,
    );
  } catch (error) {
    showActionError(error);
    return;
  }
  send({ type: "setReminder", issueKey, when: Date.now() + durationMs })
    .then(applyState)
    .catch(showActionError);
}

load(false);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.reminders && !changes.alerts) return;
  send({ type: "getState" }).then(applyState).catch(() => {});
});

timeUp.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dismiss-alert]");
  if (!button) return;
  send({ type: "dismissAlert", issueKey: button.dataset.dismissAlert })
    .then(applyState)
    .catch(showActionError);
});

async function load(forceRefresh) {
  refreshButton.disabled = true;
  sprintName.textContent = forceRefresh ? "Refreshing sprint…" : "Loading sprint…";
  try {
    const initial = await send({ type: "getState" });
    applyState(initial);
    const hasBoard = Boolean(initial.settings?.boardUrl && initial.settings?.boardId);
    const stale = !initial.cache || Date.now() - initial.cache.fetchedAt > 5 * 60 * 1000;
    if (forceRefresh || (hasBoard && stale)) {
      sprintName.textContent = "Refreshing sprint…";
      applyState(await send({ type: "refresh" }));
    }
  } catch (error) {
    sprintName.textContent = "Could not load";
    statusLine.textContent = error instanceof Error ? error.message : "Refresh failed.";
  } finally {
    refreshButton.disabled = false;
  }
}

function applyState(next) {
  if (!next?.ok && next?.error) {
    statusLine.textContent = next.error;
    return;
  }
  state = next;
  if (state.settings) {
    onlyMineInput.checked = Boolean(state.settings.onlyMine);
    hideDoneInput.checked = state.settings.hideDone !== false;
    if (document.activeElement !== boardUrlInput) {
      boardUrlInput.value = state.settings.boardUrl || "";
    }
  }
  render();
}

function render() {
  const cache = state.cache;
  const settings = state.settings || {};
  if (!cache) {
    sprintName.textContent = state.settings?.boardUrl ? "Sprint Tracker" : "Paste a Jira board link";
    sprintMeta.textContent = state.settings?.boardUrl ? "Fetching the active sprint." : "";
    renderTimeUp();
    return;
  }

  sprintName.textContent = cache.sprint?.name || (state.settings?.boardUrl ? "No active sprint" : "Paste a Jira board link");
  sprintMeta.textContent = sprintLine(cache);
  renderBanner(cache);
  renderTimeUp();
  renderStats(cache, settings);
  renderTasks(cache, settings);
  statusLine.textContent = footerLine(cache);
  startCountdown();
}

function sprintLine(cache) {
  if (!cache.sprint) return cache.jiraError || "";
  const start = cache.sprint.startDate ? formatDisplayDate(cache.sprint.startDate.slice(0, 10)) : "";
  const end = cache.sprint.endDate ? formatDisplayDate(cache.sprint.endDate.slice(0, 10)) : "";
  const left = daysUntil(cache.sprint.endDate);
  const leftLabel = left == null ? "" : left >= 0 ? `${left} days left` : `${Math.abs(left)} days past the end`;
  return [start && end ? `${start} – ${end}` : "", leftLabel].filter(Boolean).join(" · ");
}

function renderBanner(cache) {
  banner.replaceChildren();
  const messages = [cache.jiraError].filter(Boolean);
  if (!cache.myself && cache.tasks?.length && state.settings?.onlyMine) {
    messages.push("Could not detect your Jira user, so Mine is showing every assignee.");
  }
  if (!messages.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  messages.forEach((message) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    banner.append(paragraph);
  });
  if (cache.jiraError && state.settings?.boardUrl) {
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      linkButton("Open Jira board", state.settings.boardUrl),
      actionButton("Open settings", () => chrome.runtime.openOptionsPage()),
    );
    banner.append(actions);
  }
}

function renderStats(cache, settings) {
  const tasks = (cache.tasks || []).filter((task) =>
    isVisibleTask(task, {
      onlyMine: settings.onlyMine,
      hideDone: false,
      accountId: cache.myself?.accountId || "",
      query: "",
    }),
  );
  const today = todayIso();
  const inDev = tasks.filter((task) => !task.stopTracing);
  const slipped = inDev.filter((task) => etaUrgency(task, today) === "slipped").length;
  const devDone = tasks.filter((task) => task.devDone && !task.releasedLive).length;
  const releasedLive = tasks.filter((task) => task.releasedLive).length;
  stats.hidden = false;
  stats.replaceChildren(
    stat(String(inDev.length), slipped ? `In dev · ${slipped} slipped` : "In dev"),
    stat(String(devDone), "Dev done"),
    stat(String(releasedLive), "Released live"),
  );
}

function renderTasks(cache, settings) {
  closeDurationMenu();
  const today = todayIso();
  const visible = sortByTimeLeft(
    sortTasks(cache.tasks || [], today).filter((task) =>
      isVisibleTask(task, {
        onlyMine: settings.onlyMine,
        hideDone: settings.hideDone,
        accountId: cache.myself?.accountId || "",
        query,
      }),
    ),
  );
  taskList.replaceChildren();
  emptyState.hidden = visible.length > 0;
  emptyState.textContent = settings.hideDone
    ? "Every tracked ticket has reached dev done."
    : "No tasks match this view.";
  visible.forEach((task) => taskList.append(renderTask(task, today)));
}

function sortByTimeLeft(tasks) {
  const now = Date.now();
  return [...tasks].sort((left, right) => {
    const leftWhen = effectiveWhen(state.reminders?.[left.key], now);
    const rightWhen = effectiveWhen(state.reminders?.[right.key], now);
    if (leftWhen === rightWhen) return 0;
    return leftWhen - rightWhen;
  });
}

function effectiveWhen(reminder, now) {
  if (!reminder?.when) return Number.POSITIVE_INFINITY;
  return reminder.paused ? now + (Number(reminder.remainingMs) || 0) : reminder.when;
}

function renderTimeUp() {
  const alerts = state.alerts || {};
  const issueKeys = Object.keys(alerts);
  timeUp.replaceChildren();
  if (!issueKeys.length) {
    timeUp.hidden = true;
    return;
  }
  timeUp.hidden = false;
  issueKeys.forEach((issueKey) => {
    const row = document.createElement("p");
    const text = document.createElement("span");
    const summary = alerts[issueKey]?.summary ? ` ${alerts[issueKey].summary}` : "";
    text.textContent = `Time is up for ${issueKey}.${summary}`;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.dismissAlert = issueKey;
    button.textContent = "Dismiss";
    row.append(text, button);
    timeUp.append(row);
  });
}
function renderTask(task, today) {
  const urgency = etaUrgency(task, today);
  const item = document.createElement("li");
  item.className = `task ${taskClass(task, urgency)}`;
  item.dataset.key = task.key;

  const head = document.createElement("div");
  head.className = "task-head";
  const link = document.createElement("a");
  link.href = task.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = task.storyPoints ? `${task.key} · ${task.storyPoints} pts` : task.key;
  const priority = document.createElement("span");
  priority.className = "pill";
  priority.textContent = task.priority || task.status || "No status";
  head.append(link, priority);

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = task.summary;

  const foot = document.createElement("div");
  foot.className = "task-foot";
  const who = document.createElement("span");
  who.textContent = `${task.assignee} · ${task.status}`;
  foot.append(who, datePills(task, urgency));

  item.append(head, summary, foot, flagRow(task), reminderBlock(task));
  return item;
}

function taskClass(task, urgency) {
  if (task.releasedLive) return "live";
  if (task.devDone) return "dev-done";
  return urgency;
}

function devFlagLabel(task) {
  if (task.devDone) return "Dev done";
  if (task.stopTracing) return "Closed";
  return "In dev";
}

function flagRow(task) {
  const row = document.createElement("div");
  row.className = "flags";
  row.append(pill(devFlagLabel(task), task.devDone ? "ok" : ""));
  row.append(pill(task.releasedLive ? "Released live" : "Not live", task.releasedLive ? "ok" : ""));
  return row;
}

function datePills(task, urgency) {
  const wrap = document.createElement("span");
  wrap.append(pill(task.eta ? `Due ${formatDisplayDate(task.eta)}` : "No due date", urgency === "none" ? "" : urgency));
  if (task.devDoneDate) {
    wrap.append(document.createTextNode(" "));
    const late = task.eta && task.devDoneDate > task.eta;
    wrap.append(pill(`Sheet ${formatDisplayDate(task.devDoneDate)}${late ? " after ETA" : ""}`, "ok"));
  }
  return wrap;
}

function reminderBlock(task) {
  const existing = state.reminders?.[task.key];
  if (existing?.when) {
    const row = document.createElement("div");
    row.className = existing.paused ? "remind-active paused" : "remind-active";
    const label = document.createElement("span");
    label.className = "countdown";
    if (existing.paused) {
      label.textContent = `Paused · ${formatTimeLeft(Date.now() + existing.remainingMs)}`;
    } else {
      label.dataset.countdown = String(existing.when);
      label.dataset.issueKey = task.key;
      label.textContent = countdownLabel(existing.when);
    }
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.dataset.action = existing.paused ? "resume-reminder" : "pause-reminder";
    toggle.textContent = existing.paused ? "Resume" : "Pause";
    const showClock = document.createElement("button");
    showClock.type = "button";
    showClock.dataset.action = "open-clock";
    showClock.textContent = "Show clock";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.dataset.action = "clear-reminder";
    clear.textContent = "Clear";
    row.append(label, toggle, showClock, clear);
    return row;
  }

  const row = document.createElement("div");
  row.className = "remind";
  [15, 60, 120].forEach((minutes) => {
    const preset = document.createElement("button");
    preset.type = "button";
    preset.dataset.action = "preset-reminder";
    preset.dataset.minutes = String(minutes);
    preset.textContent = minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
    row.append(preset);
  });
  const duration = document.createElement("span");
  duration.className = "duration";
  duration.append(
    timerPart("hours", "h", "1", `Reminder hours for ${task.key}`),
    timerPart("minutes", "m", "0", `Reminder minutes for ${task.key}`),
  );
  const set = document.createElement("button");
  set.type = "button";
  set.dataset.action = "set-reminder";
  set.textContent = "Set timer";
  row.append(duration, set);

  if (task.eta) {
    const onEta = document.createElement("button");
    onEta.type = "button";
    onEta.dataset.action = "remind-eta";
    onEta.dataset.eta = task.eta;
    onEta.textContent = "On due date";
    row.append(onEta);
  }
  return row;
}

function timerPart(part, unitLabel, defaultValue, ariaLabel) {
  const wrap = document.createElement("label");
  wrap.className = "duration-part";
  const field = document.createElement("input");
  field.type = "text";
  field.inputMode = "numeric";
  field.autocomplete = "off";
  field.className = "duration-value";
  field.dataset.timerPart = part;
  field.dataset.value = defaultValue;
  field.value = defaultValue;
  field.setAttribute("aria-label", ariaLabel);
  field.setAttribute("aria-haspopup", "listbox");
  field.setAttribute("aria-expanded", "false");
  const unit = document.createElement("span");
  unit.textContent = unitLabel;
  wrap.append(field, unit);
  return wrap;
}

function openDurationMenu(field) {
  if (openDurationButton === field && !durationMenu.hidden) return;
  closeDurationMenu();
  openDurationButton = field;
  field.setAttribute("aria-expanded", "true");
  const choices = field.dataset.timerPart === "hours" ? hourChoices : minuteChoices;
  durationMenu.replaceChildren(
    ...choices.map((choice) => {
      const option = document.createElement("button");
      option.type = "button";
      option.dataset.durationOption = String(choice);
      option.textContent = String(choice);
      return option;
    }),
  );
  const rect = field.getBoundingClientRect();
  const menuHeight = Math.min(240, choices.length * 36 + 8);
  const spaceBelow = window.innerHeight - rect.bottom;
  durationMenu.hidden = false;
  durationMenu.style.left = `${Math.round(rect.left)}px`;
  durationMenu.style.minWidth = `${Math.round(Math.max(rect.width, 72))}px`;
  durationMenu.style.top =
    spaceBelow < menuHeight + 8
      ? `${Math.round(rect.top - menuHeight - 4)}px`
      : `${Math.round(rect.bottom + 4)}px`;
  highlightDurationChoice(field);
}

function highlightDurationChoice(field) {
  const value = field.value.trim();
  durationMenu.querySelectorAll("button").forEach((option) => {
    option.classList.toggle("is-selected", option.dataset.durationOption === value);
  });
  const selected = durationMenu.querySelector(".is-selected");
  if (!selected) return;
  durationMenu.scrollTop = selected.offsetTop - durationMenu.clientHeight / 2 + selected.offsetHeight / 2;
}

function closeDurationMenu() {
  if (openDurationButton) openDurationButton.setAttribute("aria-expanded", "false");
  openDurationButton = null;
  durationMenu.hidden = true;
  durationMenu.replaceChildren();
}

function countdownLabel(when, now = Date.now()) {
  if (when <= now) return "Time's up";
  return `${formatTimeLeft(when, now)} · until ${formatDateTime(when)}`;
}

function startCountdown() {
  if (!document.querySelector("[data-countdown]")) return;
  paintCountdowns();
  if (countdownFrame) return;
  const tick = (frameTime) => {
    if (frameTime - lastCountdownPaint >= 250) {
      lastCountdownPaint = frameTime;
      if (!paintCountdowns()) {
        countdownFrame = 0;
        return;
      }
    }
    countdownFrame = requestAnimationFrame(tick);
  };
  countdownFrame = requestAnimationFrame(tick);
}

function paintCountdowns() {
  const labels = document.querySelectorAll("[data-countdown]");
  if (!labels.length) return false;
  labels.forEach((label) => {
    const when = Number(label.dataset.countdown);
    const issueKey = label.dataset.issueKey;
    label.textContent = countdownLabel(when);
    label.classList.toggle("due", when - Date.now() <= 60000);
    if (when > Date.now()) {
      firedCountdown.delete(issueKey);
      return;
    }
    if (issueKey && !firedCountdown.has(issueKey)) {
      firedCountdown.add(issueKey);
      send({ type: "deliverReminder", issueKey })
        .then(applyState)
        .catch((error) => {
          firedCountdown.delete(issueKey);
          showActionError(error);
        });
    }
  });
  return true;
}

function footerLine(cache) {
  return cache.fetchedAt ? `Updated ${formatDateTime(cache.fetchedAt)}` : "";
}

function stat(value, label) {
  const node = document.createElement("div");
  node.className = "stat";
  const strong = document.createElement("b");
  strong.textContent = value;
  const caption = document.createElement("span");
  caption.textContent = label;
  node.append(strong, caption);
  return node;
}

function pill(text, kind) {
  const node = document.createElement("span");
  node.className = kind ? `pill ${kind}` : "pill";
  node.textContent = text;
  return node;
}

function linkButton(text, url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  link.append(button);
  return link;
}

function actionButton(text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function showActionError(error) {
  statusLine.textContent = error instanceof Error ? error.message : "Could not update the reminder.";
}

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Extension request failed.");
    return response;
  });
}
