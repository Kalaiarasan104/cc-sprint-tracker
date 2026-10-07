import { isVisibleTask } from "./tasks.js";

export function statusChanges(previousTasks, nextTasks, options) {
  const previousByKey = new Map((previousTasks || []).map((task) => [task.key, task]));
  const changes = [];
  for (const task of nextTasks || []) {
    const previous = previousByKey.get(task.key);
    if (!previous?.status || previous.status === task.status) continue;
    if (!isTracked(previous, options) && !isTracked(task, options)) continue;
    changes.push({
      key: task.key,
      fromStatus: previous.status,
      toStatus: task.status,
      summary: task.summary || "",
      url: task.url || "",
    });
  }
  return changes;
}

export function movesFromRefresh(previous, next, options) {
  if (!previous?.synced || !next?.synced) return [];
  return statusChanges(previous.tasks, next.tasks, options);
}

function isTracked(task, options) {
  return isVisibleTask(task, {
    onlyMine: Boolean(options?.onlyMine),
    hideDone: false,
    accountId: options?.accountId || "",
    query: "",
  });
}
