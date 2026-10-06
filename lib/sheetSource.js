import { parseSheet } from "./sheet.js";

const SHEET_AUTH_ERROR =
  "Could not read the tracker sheet. Open it once in this Chrome profile while signed in to Google, then refresh. You can also paste a CSV export in Settings.";

export async function loadSheet(settings) {
  let csvText = "";
  let source = "live";
  try {
    csvText = await fetchSheetCsv(settings);
  } catch (error) {
    if (!settings.pastedCsv) throw error;
    csvText = settings.pastedCsv;
    source = "pasted";
  }

  const parsed = parseSheet(csvText, settings);
  return { ...parsed, source };
}

async function fetchSheetCsv(settings) {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/export?format=csv&gid=${settings.sheetGid}`,
    `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/gviz/tq?tqx=out:csv&gid=${settings.sheetGid}`,
  ];

  let lastError = new Error(SHEET_AUTH_ERROR);
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "include" });
      const text = await response.text();
      if (!response.ok || looksLikeHtml(text)) {
        lastError = new Error(SHEET_AUTH_ERROR);
        continue;
      }
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }
  throw lastError;
}

function looksLikeHtml(text) {
  const sample = text.trim().slice(0, 200).toLowerCase();
  return sample.startsWith("<") || sample.includes("<html") || sample.includes("accounts.google.com");
}
