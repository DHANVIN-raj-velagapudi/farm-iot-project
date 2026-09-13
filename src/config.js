// Central place for every tunable value and every piece of config read from
// the environment. Nothing outside this file should touch `process.env`
// directly — that keeps the rest of the codebase testable and makes it
// obvious, in one place, what this service needs to run.

try {
  // Optional: loads a local .env file for development. In production
  // (Railway/Fly/etc.) env vars are injected by the platform and this is a
  // harmless no-op if no .env file exists.
  require("dotenv").config();
} catch {
  // dotenv not installed / not needed — fine.
}

const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

module.exports = {
  PORT: Number(process.env.PORT) || 3000,

  // Intentionally NOT validated here (no insecure default either, though) —
  // this file is imported by pure modules like validation.js that have
  // nothing to do with auth and must stay side-effect-free so they can be
  // unit tested without a full environment. src/index.js checks this is
  // actually set before the server starts accepting traffic.
  DEVICE_TOKEN: process.env.DEVICE_TOKEN,

  DATA_DIR,
  STATE_FILE: path.join(DATA_DIR, "devices.json"),
  LOG_FILE: path.join(DATA_DIR, "events.ndjson"),

  MAX_DEVICE_ID_LENGTH: 40,
  DEVICE_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  LIGHT_COUNT: 10,

  // A device stops being "online" if it hasn't called /ping or /data in
  // this long.
  DEVICE_OFFLINE_MS: 2 * 60 * 1000,

  // A moisture reading older than this is considered stale and reported as
  // "OFFLINE" rather than a possibly-wrong last value. This is separate
  // from DEVICE_OFFLINE_MS: the sensor reports on its own 10s cadence, so
  // it gets more slack before being treated as stale.
  MOISTURE_STALE_MS: 5 * 60 * 1000,

  MANUAL_LOCK_ON_MS: 10 * 60 * 1000,
  MANUAL_LOCK_OFF_MS: 2 * 60 * 1000,
  MAX_CONTROL_DURATION_SEC: 3600,

  LOW_MOISTURE_THRESHOLD: 30,
  SUGGESTION_COOLDOWN_MS: 10 * 60 * 1000,

  TICK_INTERVAL_MS: 5000,
  LOG_FLUSH_INTERVAL_MS: 5000,
  STATE_SAVE_INTERVAL_MS: 15000,

  LOG_ROTATE_SIZE_BYTES: 10 * 1024 * 1024,
  LOG_ROTATE_KEEP: 5,

  JSON_BODY_LIMIT: "10kb",
};
