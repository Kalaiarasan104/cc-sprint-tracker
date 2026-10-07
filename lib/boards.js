import { DEFAULT_SETTINGS } from "./config.js";

export function boardFromParsed(parsed) {
  const boardId = Number(parsed?.boardId);
  const jiraBaseUrl = String(parsed?.jiraBaseUrl || "").replace(/\/$/, "");
  if (!jiraBaseUrl || !Number.isInteger(boardId) || boardId < 1) {
    throw new Error("That link has no board id. Open the board in Jira and paste its address.");
  }
  return {
    id: `${jiraBaseUrl}|${boardId}`,
    boardUrl: String(parsed.boardUrl || ""),
    jiraBaseUrl,
    boardId,
  };
}

export function boardLabel(board) {
  try {
    const url = new URL(board.boardUrl || board.jiraBaseUrl);
    const project = url.pathname.match(/\/projects\/([^/]+)/);
    if (project) return decodeURIComponent(project[1]);
    const site = url.hostname.replace(/\.atlassian\.net$/, "");
    return board.boardId ? `${site} · ${board.boardId}` : site;
  } catch {
    return board?.boardId ? `Board ${board.boardId}` : "Board";
  }
}

export function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const boards = (Array.isArray(settings.boards) ? settings.boards : []).filter(isBoard).map(copyBoard);
  if (!boards.length && settings.boardUrl && Number(settings.boardId) > 0 && settings.jiraBaseUrl) {
    boards.push(
      boardFromParsed({
        boardUrl: settings.boardUrl,
        jiraBaseUrl: settings.jiraBaseUrl,
        boardId: settings.boardId,
      }),
    );
  }
  const active = boards.find((board) => board.id === settings.activeBoardId) || boards[0];
  return withActiveBoard(
    {
      ...settings,
      boards,
      morningSummary: settings.morningSummary !== false,
    },
    active,
  );
}

export function addBoard(settings, parsed) {
  const board = boardFromParsed(parsed);
  const boards = settings.boards.some((entry) => entry.id === board.id)
    ? settings.boards.map((entry) => (entry.id === board.id ? board : entry))
    : [...settings.boards, board];
  return withActiveBoard({ ...settings, boards }, board);
}

export function removeBoard(settings, boardId) {
  const boards = settings.boards.filter((board) => board.id !== boardId);
  const active =
    settings.activeBoardId === boardId
      ? boards[0]
      : boards.find((board) => board.id === settings.activeBoardId);
  return withActiveBoard({ ...settings, boards }, active);
}

export function selectBoard(settings, boardId) {
  const active = settings.boards.find((board) => board.id === boardId);
  if (!active) return settings;
  return withActiveBoard(settings, active);
}

export function emptyBoardCache() {
  return {
    fetchedAt: 0,
    sprint: null,
    myself: null,
    tasks: [],
    jiraError: "",
    synced: false,
  };
}

export function normalizeCache(raw, activeBoardId) {
  if (raw?.boards && typeof raw.boards === "object" && !Array.isArray(raw.boards)) {
    return { boards: { ...raw.boards } };
  }
  const hasLegacy = Boolean(raw && (raw.sprint || raw.tasks || raw.jiraError || raw.fetchedAt));
  if (!hasLegacy || !activeBoardId) return { boards: {} };
  return {
    boards: {
      [activeBoardId]: {
        fetchedAt: raw.fetchedAt || 0,
        sprint: raw.sprint || null,
        myself: raw.myself || null,
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        jiraError: raw.jiraError || "",
        synced: Boolean(raw.fetchedAt && !raw.jiraError && Array.isArray(raw.tasks)),
      },
    },
  };
}

export function activeBoardCache(cache, activeBoardId) {
  if (!activeBoardId || !cache?.boards?.[activeBoardId]) return emptyBoardCache();
  return cache.boards[activeBoardId];
}

export function applyBoardFetch(previous, result) {
  const base = previous || emptyBoardCache();
  if (result?.error) {
    return {
      ...base,
      fetchedAt: result.fetchedAt,
      jiraError: result.error,
    };
  }
  return {
    fetchedAt: result.fetchedAt,
    sprint: result.sprint || null,
    myself: result.myself || null,
    tasks: result.tasks || [],
    jiraError: "",
    synced: true,
  };
}

function withActiveBoard(settings, active) {
  return {
    ...settings,
    activeBoardId: active?.id || "",
    boardUrl: active?.boardUrl || "",
    jiraBaseUrl: active?.jiraBaseUrl || "",
    boardId: active?.boardId || 0,
  };
}

function isBoard(board) {
  return Boolean(
    board &&
      board.id &&
      board.boardUrl &&
      board.jiraBaseUrl &&
      Number.isInteger(Number(board.boardId)) &&
      Number(board.boardId) > 0,
  );
}

function copyBoard(board) {
  return {
    id: String(board.id),
    boardUrl: String(board.boardUrl),
    jiraBaseUrl: String(board.jiraBaseUrl).replace(/\/$/, ""),
    boardId: Number(board.boardId),
  };
}
