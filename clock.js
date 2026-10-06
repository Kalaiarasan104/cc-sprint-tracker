import { formatDateTime, formatTimeLeft } from "./lib/dates.js";

const PAINT_INTERVAL_MS = 250;
const DUE_SOON_MS = 60000;
const PIP_WIDTH = 340;
const PIP_HEIGHT = 320;

const clockApp = document.querySelector("#clockApp");
const clockList = document.querySelector("#clockList");
const clockError = document.querySelector("#clockError");
const clockNote = document.querySelector("#clockNote");
const closeButton = document.querySelector("#closeClock");
const pinButton = document.querySelector("#pinClock");
const firedKeys = new Set();
const pipSupported = "documentPictureInPicture" in window;
let reminders = {};
let frameHost = window;
let frameId = 0;
let lastPaint = 0;
let pipWindow = null;

pinButton.hidden = !pipSupported;
closeButton.addEventListener("click", () => window.close());
pinButton.addEventListener("click", () => {
  if (pipWindow) {
    pipWindow.close();
    return;
  }
  pinOnTop().catch(showError);
});

clockList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const issueKey = button?.dataset.issueKey;
  if (!issueKey) return;
  const messageType = {
    "clear-reminder": "clearReminder",
    "pause-reminder": "pauseReminder",
    "resume-reminder": "resumeReminder",
  }[button.dataset.action];
  if (!messageType) return;
  send({ type: messageType, issueKey }).catch(showError);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.reminders) return;
  load().catch(showError);
});

load().catch(showError);

async function pinOnTop() {
  const nextWindow = await window.documentPictureInPicture.requestWindow({
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
  });
  document.querySelectorAll('link[rel="stylesheet"]').forEach((sheet) => {
    const copy = nextWindow.document.createElement("link");
    copy.rel = "stylesheet";
    copy.href = sheet.href;
    nextWindow.document.head.append(copy);
  });
  nextWindow.document.title = "Sprint clock";
  nextWindow.document.body.className = "float-body pinned";
  nextWindow.document.body.append(clockApp);
  nextWindow.addEventListener("pagehide", unpin, { once: true });
  pipWindow = nextWindow;
  syncPinButton();
  clockNote.textContent = "Pinned above every window.";
  switchFrameHost(nextWindow);
  const current = await chrome.windows.getCurrent();
  await chrome.windows.update(current.id, { state: "minimized" });
}

function unpin() {
  pipWindow = null;
  document.body.append(clockApp);
  syncPinButton();
  clockNote.textContent = "Close this any time. The timer keeps running.";
  switchFrameHost(window);
  chrome.windows
    .getCurrent()
    .then((current) => chrome.windows.update(current.id, { state: "normal", focused: true }))
    .catch(() => {});
}

function syncPinButton() {
  const pinned = Boolean(pipWindow);
  pinButton.classList.toggle("is-pinned", pinned);
  pinButton.setAttribute("aria-pressed", pinned ? "true" : "false");
  pinButton.setAttribute("aria-label", pinned ? "Unpin clock" : "Pin clock on top");
}

function switchFrameHost(nextHost) {
  if (frameId) frameHost.cancelAnimationFrame(frameId);
  frameId = 0;
  frameHost = nextHost;
  ensureTick();
}

async function load() {
  const state = await send({ type: "getState" });
  reminders = state.reminders || {};
  render();
}

function render() {
  const now = Date.now();
  const entries = Object.entries(reminders)
    .filter(([, reminder]) => reminder?.when)
    .sort((left, right) => effectiveWhen(left[1], now) - effectiveWhen(right[1], now));
  clockList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-float";
    empty.textContent = "No timers running.";
    clockList.append(empty);
    return;
  }
  entries.forEach(([issueKey, reminder]) => clockList.append(clockCard(issueKey, reminder)));
  ensureTick();
}

function effectiveWhen(reminder, now) {
  return reminder.paused ? now + (Number(reminder.remainingMs) || 0) : reminder.when;
}

function clockCard(issueKey, reminder) {
  const card = document.createElement("article");
  card.className = reminder.paused ? "float-card clock-card paused" : "float-card clock-card";

  const ring = document.createElement("div");
  ring.className = "clock-ring";
  ring.dataset.durationMs = String(reminder.durationMs || 0);
  const time = document.createElement("span");
  time.className = "clock-time";
  ring.append(time);

  const body = document.createElement("div");
  body.className = "clock-body";
  const title = document.createElement("h2");
  title.textContent = issueKey;
  const summary = document.createElement("p");
  summary.className = "clock-summary";
  summary.textContent = reminder.summary || "Sprint reminder";
  const until = document.createElement("p");
  until.className = "float-note";
  until.textContent = reminder.paused ? "Paused" : `Until ${formatDateTime(reminder.when)}`;

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    actionButton(reminder.paused ? "Resume" : "Pause", reminder.paused ? "resume-reminder" : "pause-reminder", issueKey, true),
    actionButton("Clear", "clear-reminder", issueKey, false),
  );
  body.append(title, summary, until, actions);
  card.append(ring, body);

  if (reminder.paused) {
    paintRing(ring, Number(reminder.remainingMs) || 0);
    time.textContent = shortTime(Number(reminder.remainingMs) || 0);
  } else {
    ring.dataset.countdown = String(reminder.when);
    ring.dataset.issueKey = issueKey;
    paintRing(ring, reminder.when - Date.now());
    time.textContent = shortTime(reminder.when - Date.now());
  }
  return card;
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

function shortTime(remainingMs) {
  return formatTimeLeft(Date.now() + remainingMs).replace(/ left$/, "");
}

function paintRing(ring, remainingMs) {
  const durationMs = Number(ring.dataset.durationMs) || 0;
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / durationMs)) : 0;
  ring.style.setProperty("--progress", String(progress));
  ring.classList.toggle("due", remainingMs <= DUE_SOON_MS);
}

function ensureTick() {
  if (frameId || !clockList.querySelector("[data-countdown]")) return;
  frameId = frameHost.requestAnimationFrame(tick);
}

function tick(now) {
  frameId = 0;
  if (now - lastPaint >= PAINT_INTERVAL_MS || now < lastPaint) {
    lastPaint = now;
    paintCountdowns();
  }
  if (clockList.querySelector("[data-countdown]")) {
    frameId = frameHost.requestAnimationFrame(tick);
  }
}

function paintCountdowns() {
  clockList.querySelectorAll("[data-countdown]").forEach((ring) => {
    const when = Number(ring.dataset.countdown);
    const issueKey = ring.dataset.issueKey;
    const remainingMs = when - Date.now();
    paintRing(ring, remainingMs);
    const time = ring.querySelector(".clock-time");
    if (time) time.textContent = shortTime(remainingMs);
    if (remainingMs > 0) {
      firedKeys.delete(issueKey);
      return;
    }
    if (!issueKey || firedKeys.has(issueKey)) return;
    firedKeys.add(issueKey);
    send({ type: "deliverReminder", issueKey }).catch(() => {
      firedKeys.delete(issueKey);
    });
  });
}

function showError(error) {
  clockError.hidden = false;
  clockError.textContent = error instanceof Error ? error.message : "Could not update the clock.";
}

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "Extension request failed.");
    return response;
  });
}
