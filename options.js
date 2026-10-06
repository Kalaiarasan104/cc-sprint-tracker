const form = document.querySelector("#settingsForm");
const saveStatus = document.querySelector("#saveStatus");

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const current = await chrome.runtime.sendMessage({ type: "getState" });
  const previous = current?.settings || {};
  const patch = {
    jiraEmail: String(data.get("jiraEmail") || "").trim(),
    onlyMine: previous.onlyMine !== false,
    hideDone: previous.hideDone !== false,
  };

  if (data.get("clearToken")) {
    patch.jiraApiToken = "";
  } else if (String(data.get("jiraApiToken") || "").trim()) {
    patch.jiraApiToken = String(data.get("jiraApiToken")).trim();
  } else {
    patch.jiraApiToken = previous.jiraApiToken || "";
  }

  const response = await chrome.runtime.sendMessage({ type: "updateSettings", patch });
  saveStatus.textContent = response?.ok ? "Saved." : response?.error || "Could not save.";
  form.elements.jiraApiToken.value = "";
  form.elements.clearToken.checked = false;
});

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: "getState" });
  const settings = response?.settings;
  if (!settings) {
    saveStatus.textContent = "Open this page from the extension so it can read saved settings.";
    return;
  }
  form.elements.jiraEmail.value = settings.jiraEmail || "";
  if (settings.jiraApiToken) {
    form.elements.jiraApiToken.placeholder = "Token saved. Type a new one to replace it.";
  }
}
