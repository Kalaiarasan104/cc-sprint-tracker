import { DEFAULT_SETTINGS } from "./config.js";

export async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function getCache() {
  const stored = await chrome.storage.local.get("cache");
  return stored.cache || null;
}

export async function saveCache(cache) {
  await chrome.storage.local.set({ cache });
}

export async function getReminders() {
  const stored = await chrome.storage.local.get("reminders");
  return stored.reminders || {};
}

export async function saveReminders(reminders) {
  await chrome.storage.local.set({ reminders });
}

export async function getAlerts() {
  const stored = await chrome.storage.local.get("alerts");
  return stored.alerts || {};
}

export async function saveAlerts(alerts) {
  await chrome.storage.local.set({ alerts });
}
