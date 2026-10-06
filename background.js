import { REFRESH_ALARM, REFRESH_MINUTES, reminderAlarmName } from "./lib/config.js";
import { fetchActiveSprint } from "./lib/jira.js";
import {
  getAlerts,
  getCache,
  getReminders,
  getSettings,
  saveAlerts,
  saveCache,
  saveReminders,
  saveSettings,
} from "./lib/storage.js";
import { buildTasks, etaUrgency, isVisibleTask } from "./lib/tasks.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  setupRefreshAlarm();
  reconcileReminders();
});

chrome.runtime.onStartup.addListener(() => {
  setupRefreshAlarm();
  reconcileReminders();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshSprint().catch(() => {});
    return;
  }
  if (alarm.name.startsWith("reminder:")) {
    const issueKey = alarm.name.slice("reminder:".length);
    deliverReminder(issueKey).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Request failed." });
    });
  return true;
});

async function handleMessage(message) {
  if (message?.type === "getState") return readState();
  if (message?.type === "refresh") {
    await refreshSprint();
    return readState();
  }
  if (message?.type === "updateSettings") {
    const current = await getSettings();
    await saveSettings({ ...current, ...message.patch });
    await updateBadge();
    return readState();
  }
  if (message?.type === "setReminder") {
    await setReminder(message.issueKey, message.when);
    return readState();
  }
  if (message?.type === "clearReminder") {
    await clearReminder(message.issueKey);
    return readState();
  }
  if (message?.type === "deliverReminder") {
    await deliverReminder(message.issueKey);
    return readState();
  }
  if (message?.type === "dismissAlert") {
    await dismissAlert(message.issueKey);
    return readState();
  }
  if (message?.type === "pauseReminder") {
    await pauseReminder(message.issueKey);
    return readState();
  }
  if (message?.type === "resumeReminder") {
    await resumeReminder(message.issueKey);
    return readState();
  }
  if (message?.type === "openClock") {
    await openClockWindow();
    return readState();
  }
  if (message?.type === "snoozeReminder") {
    await snoozeReminder(message.issueKey);
    return readState();
  }
  if (message?.type === "openIssue") {
    await openIssue(message.issueKey);
    return readState();
  }
  return readState();
}

async function readState() {
  const [settings, cache, reminders, alerts] = await Promise.all([
    getSettings(),
    getCache(),
    getReminders(),
    getAlerts(),
  ]);
  return { settings, cache, reminders, alerts };
}

function setupRefreshAlarm() {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
}

let refreshPromise = null;

function refreshSprint() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh() {
  const settings = await getSettings();
  const cache = {
    fetchedAt: Date.now(),
    sprint: null,
    myself: null,
    tasks: [],
    jiraError: "",
  };

  if (!settings.boardUrl || !settings.jiraBaseUrl || !settings.boardId) {
    cache.jiraError = "Paste a Jira board link, then load it.";
    await saveCache(cache);
    await updateBadge(cache, settings);
    return cache;
  }

  try {
    const jira = await fetchActiveSprint(settings);
    cache.sprint = {
      id: jira.sprint.id,
      name: jira.sprint.name,
      startDate: jira.sprint.startDate || "",
      endDate: jira.sprint.endDate || "",
      goal: jira.sprint.goal || "",
    };
    cache.myself = jira.myself
      ? {
          accountId: jira.myself.accountId,
          displayName: jira.myself.displayName,
        }
      : null;
    cache.tasks = buildTasks(jira.issues, [], cache.myself?.accountId || "", settings.jiraBaseUrl);
  } catch (error) {
    cache.jiraError = error instanceof Error ? error.message : "Could not read Jira.";
  }

  await saveCache(cache);
  await updateBadge(cache, settings);
  return cache;
}

async function updateBadge(existingCache, existingSettings) {
  const alerts = await getAlerts();
  if (Object.keys(alerts).length) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c9372c" });
    return;
  }
  const cache = existingCache || (await getCache());
  const settings = existingSettings || (await getSettings());
  const visible = (cache?.tasks || []).filter((task) =>
    isVisibleTask(task, {
      onlyMine: settings.onlyMine,
      hideDone: settings.hideDone,
      accountId: cache?.myself?.accountId || "",
      query: "",
    }),
  );
  const today = localToday();
  const slipped = visible.some((task) => etaUrgency(task, today) === "slipped");
  chrome.action.setBadgeText({ text: visible.length ? String(visible.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: slipped ? "#c9372c" : "#1d4f91" });
}

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function setReminder(issueKey, when) {
  const timestamp = Number(when);
  if (!issueKey || !Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new Error("Pick a reminder time in the future.");
  }
  await chrome.alarms.create(reminderAlarmName(issueKey), { when: timestamp });
  const reminders = await getReminders();
  const previous = reminders[issueKey] || {};
  reminders[issueKey] = {
    when: timestamp,
    durationMs: timestamp - Date.now(),
    paused: false,
    ...taskSnapshot(await findTask(issueKey), previous),
  };
  await saveReminders(reminders);
}

async function pauseReminder(issueKey) {
  const reminders = await getReminders();
  const reminder = reminders[issueKey];
  if (!reminder?.when || reminder.paused) return;
  const remainingMs = reminder.when - Date.now();
  if (remainingMs <= 0) {
    await deliverReminder(issueKey);
    return;
  }
  await chrome.alarms.clear(reminderAlarmName(issueKey));
  reminders[issueKey] = { ...reminder, paused: true, remainingMs };
  await saveReminders(reminders);
}

async function resumeReminder(issueKey) {
  const reminders = await getReminders();
  const reminder = reminders[issueKey];
  if (!reminder?.paused) return;
  const remainingMs = Math.max(1000, Number(reminder.remainingMs) || 0);
  const when = Date.now() + remainingMs;
  await chrome.alarms.create(reminderAlarmName(issueKey), { when });
  const { remainingMs: _unused, ...rest } = reminder;
  reminders[issueKey] = { ...rest, when, paused: false };
  await saveReminders(reminders);
}

async function clearReminder(issueKey) {
  await chrome.alarms.clear(reminderAlarmName(issueKey));
  const reminders = await getReminders();
  delete reminders[issueKey];
  await saveReminders(reminders);
}

const deliveries = new Map();

async function deliverReminder(issueKey) {
  if (!issueKey) return;
  if (!deliveries.has(issueKey)) {
    deliveries.set(
      issueKey,
      deliverReminderOnce(issueKey).finally(() => deliveries.delete(issueKey)),
    );
  }
  return deliveries.get(issueKey);
}

async function deliverReminderOnce(issueKey) {
  const reminders = await getReminders();
  const reminder = reminders[issueKey];
  if (!reminder || reminder.paused) return;
  delete reminders[issueKey];
  await saveReminders(reminders);
  await chrome.alarms.clear(reminderAlarmName(issueKey));
  await pushAlert(issueKey, reminder);
  await openDueWindow();
  await updateBadge();
}

async function pushAlert(issueKey, reminder = {}) {
  const task = await findTask(issueKey);
  const alerts = await getAlerts();
  alerts[issueKey] = {
    at: Date.now(),
    ...taskSnapshot(task, reminder),
  };
  await saveAlerts(alerts);
}

function taskSnapshot(task, previous = {}) {
  return {
    summary: task?.summary || previous.summary || "",
    status: task?.status || previous.status || "",
    assignee: task?.assignee || previous.assignee || "",
    eta: task?.eta || previous.eta || "",
    url: task?.url || previous.url || "",
    priority: task?.priority || previous.priority || "",
    devDone: task ? Boolean(task.devDone) : Boolean(previous.devDone),
    releasedLive: task ? Boolean(task.releasedLive) : Boolean(previous.releasedLive),
  };
}

async function findTask(issueKey) {
  const cache = await getCache();
  return (cache?.tasks || []).find((entry) => entry.key === issueKey) || null;
}

async function dismissAlert(issueKey) {
  const alerts = await getAlerts();
  delete alerts[issueKey];
  await saveAlerts(alerts);
  await updateBadge();
}

async function snoozeReminder(issueKey) {
  if (!issueKey) return;
  const alerts = await getAlerts();
  const alert = alerts[issueKey] || {};
  const reminders = await getReminders();
  reminders[issueKey] = { ...taskSnapshot(null, alert), when: Date.now() + 30 * 60 * 1000 };
  await saveReminders(reminders);
  await dismissAlert(issueKey);
  await setReminder(issueKey, reminders[issueKey].when);
}

async function openIssue(issueKey) {
  if (!issueKey) return;
  const [settings, reminders, alerts] = await Promise.all([getSettings(), getReminders(), getAlerts()]);
  const task = await findTask(issueKey);
  const saved = reminders[issueKey] || alerts[issueKey] || {};
  const base = String(settings.jiraBaseUrl || "").replace(/\/$/, "");
  const url = task?.url || saved.url || (base ? `${base}/browse/${issueKey}` : "");
  if (!url) return;

  const openTab = await findIssueTab(url);
  if (openTab?.id != null) {
    await chrome.tabs.update(openTab.id, { active: true });
    await focusWindow(openTab.windowId);
    return;
  }

  const browserWindow = await lastNormalWindow();
  if (!browserWindow) {
    await chrome.windows.create({ url, type: "normal", focused: true, state: "normal" });
    return;
  }
  await chrome.tabs.create({ url, windowId: browserWindow.id, active: true });
  await focusWindow(browserWindow.id);
}

async function findIssueTab(url) {
  try {
    const parsed = new URL(url);
    const tabs = await chrome.tabs.query({ url: `${parsed.origin}${parsed.pathname}*` });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

async function lastNormalWindow() {
  try {
    return await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    return windows[0] || null;
  }
}

async function focusWindow(windowId) {
  if (windowId == null) return;
  const browserWindow = await chrome.windows.get(windowId);
  const update = { focused: true, drawAttention: true };
  if (browserWindow.state === "minimized") update.state = "normal";
  await chrome.windows.update(windowId, update);
}

const CLOCK_PAGE = "clock.html";
const DUE_PAGE = "due.html";

async function openClockWindow() {
  await openPopup(CLOCK_PAGE, { width: 340, height: 320, focused: true, anchor: "corner" });
}

async function openDueWindow() {
  await openPopup(DUE_PAGE, { width: 420, height: 480, focused: true, anchor: "center" });
}

async function openPopup(page, { width, height, focused, anchor }) {
  const existing = await findExtensionWindow(page);
  if (existing?.id != null) {
    if (focused) {
      const update = { focused: true, drawAttention: true };
      if (existing.state === "minimized") update.state = "normal";
      await chrome.windows.update(existing.id, update);
    }
    return existing.id;
  }
  const bounds = await popupBounds(width, height, anchor);
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL(page),
    type: "popup",
    width,
    height,
    focused,
    ...bounds,
  });
  return created?.id;
}

async function findExtensionWindow(page) {
  const windows = await chrome.windows.getAll({ populate: true });
  const marker = `/${page}`;
  return windows.find((browserWindow) =>
    (browserWindow.tabs || []).some((tab) => typeof tab.url === "string" && tab.url.includes(marker)),
  );
}

async function popupBounds(width, height, anchor) {
  try {
    const displays = await chrome.system.display.getInfo();
    const primary = displays.find((display) => display.isPrimary) || displays[0];
    const area = primary?.workArea;
    if (!area) return {};
    if (anchor === "corner") {
      return {
        left: Math.round(area.left + area.width - width - 24),
        top: Math.round(area.top + area.height - height - 24),
      };
    }
    return {
      left: Math.round(area.left + (area.width - width) / 2),
      top: Math.round(area.top + Math.max(24, (area.height - height) / 3)),
    };
  } catch {
    return {};
  }
}

async function reconcileReminders() {
  const reminders = await getReminders();
  const alarms = await chrome.alarms.getAll();
  const alarmNames = new Set(alarms.map((alarm) => alarm.name));
  const dueNow = [];

  for (const [issueKey, reminder] of Object.entries(reminders)) {
    const name = reminderAlarmName(issueKey);
    if (!reminder?.when) {
      delete reminders[issueKey];
      continue;
    }
    if (reminder.paused) continue;
    if (reminder.when <= Date.now()) {
      if (!alarmNames.has(name)) dueNow.push(issueKey);
      continue;
    }
    if (!alarmNames.has(name)) {
      await chrome.alarms.create(name, { when: reminder.when });
    }
  }

  await saveReminders(reminders);
  for (const issueKey of dueNow) {
    await deliverReminder(issueKey);
  }
}
