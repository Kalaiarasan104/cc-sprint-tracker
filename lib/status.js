const STORY_PIPELINE = [
  "requirement - to do",
  "requirement - wip",
  "requirement - in review",
  "requirement - done",
  "design - to do",
  "design - wip",
  "design - in review",
  "design - done",
  "development - to do",
  "development - wip",
  "development - done",
  "testing - to do",
  "testing wip",
  "testing",
  "qa passed",
  "release line up",
  "released - pre alpha",
  "released - alpha",
  "released - beta",
  "released live",
];

const DEV_DONE_START = STORY_PIPELINE.indexOf("development - done");

const RELEASED_LIVE = new Set(["released live", "bug resolved"]);

const EXTRA_DEV_DONE = new Set([
  "testing passed (staging)",
  "testing passed (production)",
  "testing failed (staging)",
  "testing failed (production)",
  "fixed in staging",
  "fixed in production",
  "done",
  "completed",
  "resolved",
]);

const CLOSED_WITHOUT_SHIP = new Set([
  "rejected",
  "reject confirmed",
  "duplicate",
  "false positive",
  "riskaccepted",
]);

export function statusFlags(statusName) {
  const name = String(statusName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const pipelineIndex = STORY_PIPELINE.indexOf(name);
  const reachedDevDone = pipelineIndex >= DEV_DONE_START;
  const releasedLive = RELEASED_LIVE.has(name);
  const devDone = releasedLive || reachedDevDone || EXTRA_DEV_DONE.has(name);
  const closedWithoutShip = CLOSED_WITHOUT_SHIP.has(name);
  return {
    devDone,
    releasedLive,
    stopTracing: devDone || closedWithoutShip,
  };
}
