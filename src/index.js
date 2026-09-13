const { createApp } = require("./app");
const store = require("./deviceStore");
const eventLog = require("./eventLog");
const logger = require("./logger");
const {
  PORT,
  DEVICE_TOKEN,
  TICK_INTERVAL_MS,
  LOG_FLUSH_INTERVAL_MS,
  STATE_SAVE_INTERVAL_MS,
} = require("./config");

let server;
const intervals = [];

async function start() {
  if (!DEVICE_TOKEN) {
    logger.error("DEVICE_TOKEN env var is not set. Refusing to start with no auth token.");
    process.exit(1);
  }

  await store.load();
  eventLog.push({ type: "system", event: "SERVER_START", pid: process.pid });

  intervals.push(setInterval(() => store.tick(), TICK_INTERVAL_MS));
  intervals.push(setInterval(() => eventLog.flush(), LOG_FLUSH_INTERVAL_MS));
  intervals.push(setInterval(() => store.persistIfDirty(), STATE_SAVE_INTERVAL_MS));

  const app = createApp();
  server = app.listen(PORT, () => {
    logger.info(`Farm IoT backend listening on port ${PORT}`);
  });
}

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down`);
  eventLog.push({ type: "system", event: "SERVER_STOP", signal });

  intervals.forEach(clearInterval);
  if (server) await new Promise((resolve) => server.close(resolve));

  await store.persistNow();
  eventLog.flushSync();
  process.exit(0);
}

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  eventLog.push({ type: "system", event: "CRASH", error: err.message });
  eventLog.flushSync();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: String(reason) });
  eventLog.push({ type: "system", event: "UNHANDLED_REJECTION", error: String(reason) });
  eventLog.flushSync();
  process.exit(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((err) => {
  logger.error("Failed to start server", { error: err.message });
  process.exit(1);
});
