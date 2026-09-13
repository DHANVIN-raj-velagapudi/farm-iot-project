// Append-only event log (devices going on/off, schedule changes, crashes).
// Written as newline-delimited JSON so it can be tailed or grep'd directly
// on the host. Batched + rotated so a busy device can't grow this file
// unbounded or hammer the disk on every single event.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { LOG_FILE, LOG_ROTATE_SIZE_BYTES, LOG_ROTATE_KEEP } = require("./config");
const logger = require("./logger");

let queue = [];
let flushing = false;

function push(entry) {
  queue.push({ ...entry, timestamp: new Date().toISOString() });
}

async function rotate() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatedPath = `${LOG_FILE}.${stamp}`;
  await fsp.rename(LOG_FILE, rotatedPath);

  const dir = path.dirname(LOG_FILE);
  const base = path.basename(LOG_FILE);
  const rotatedFiles = (await fsp.readdir(dir))
    .filter((f) => f.startsWith(base + "."))
    .sort();

  const excess = rotatedFiles.length - LOG_ROTATE_KEEP;
  if (excess > 0) {
    await Promise.all(
      rotatedFiles.slice(0, excess).map((f) => fsp.unlink(path.join(dir, f)).catch(() => {}))
    );
  }
}

// Batches up to 50 queued entries per call; called on an interval from
// index.js. Failed writes are re-queued rather than dropped.
async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, 50);
  const data = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";

  try {
    const stats = await fsp.stat(LOG_FILE).catch(() => null);
    if (stats && stats.size > LOG_ROTATE_SIZE_BYTES) {
      await rotate();
    }
    await fsp.appendFile(LOG_FILE, data);
  } catch (e) {
    logger.error("Event log write failed, re-queueing batch", { error: e.message });
    queue.unshift(...batch);
  } finally {
    flushing = false;
  }
}

// Synchronous last-resort flush for crash/shutdown paths, where we can't
// wait on a promise.
function flushSync() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  const data = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";
  try {
    fs.appendFileSync(LOG_FILE, data);
  } catch (e) {
    logger.error("Emergency synchronous log flush failed", { error: e.message });
  }
}

module.exports = { push, flush, flushSync };
