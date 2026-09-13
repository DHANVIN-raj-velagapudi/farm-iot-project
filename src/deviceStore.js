// In-memory device state + its persistence to disk. This is the only place
// that reads or writes `devices`, so every rule about what a "device" is
// lives in one file.
//
// Internal shape per device (NOT what the API returns — see serialize()):
//   {
//     lastSeen: ms epoch,
//     pump: "ON" | "OFF",
//     lights: { L1: "ON"|"OFF", ... },
//     lightTimers: { L1: { endsAt } | null, ... },
//     schedule: { startTime, endTime } | null,
//     manualLockUntil: ms epoch,      // schedule won't override a manual
//                                     // command until this time passes
//     activeSession: { startedAt, endsAt } | null, // timed pump run
//     lowMoistureSuggestion: { message, time } | null,
//     lowMoistureCheckedAt: ms epoch, // cooldown for the low-moisture hint
//     lastMoisture: number | null,
//     lastMoistureTime: ms epoch | null,
//   }

const fs = require("fs");
const fsp = fs.promises;
const {
  STATE_FILE,
  DATA_DIR,
  LIGHT_COUNT,
  DEVICE_OFFLINE_MS,
  MOISTURE_STALE_MS,
  MANUAL_LOCK_ON_MS,
  MANUAL_LOCK_OFF_MS,
  LOW_MOISTURE_THRESHOLD,
  SUGGESTION_COOLDOWN_MS,
} = require("./config");
const { validateDeviceId, parseTimeToMinutes } = require("./validation");
const eventLog = require("./eventLog");
const logger = require("./logger");

let devices = Object.create(null);
let dirty = false;

function makeLights() {
  const lights = {};
  const lightTimers = {};
  for (let i = 1; i <= LIGHT_COUNT; i++) {
    lights[`L${i}`] = "OFF";
    lightTimers[`L${i}`] = null;
  }
  return { lights, lightTimers };
}

function markDirty() {
  dirty = true;
}

// Creates a device on first contact. Never overwrites an existing device
// (so a reconnecting device doesn't lose its schedule/state).
function ensureDevice(id) {
  validateDeviceId(id);
  if (!devices[id]) {
    const { lights, lightTimers } = makeLights();
    devices[id] = {
      lastSeen: Date.now(),
      pump: "OFF",
      lights,
      lightTimers,
      schedule: null,
      manualLockUntil: 0,
      activeSession: null,
      lowMoistureSuggestion: null,
      lowMoistureCheckedAt: 0,
      lastMoisture: null,
      lastMoistureTime: null,
    };
    markDirty();
    eventLog.push({ deviceId: id, type: "system", event: "DEVICE_CREATED" });
  }
  return devices[id];
}

function getDevice(id) {
  return devices[id] || null;
}

function getAllDevices() {
  return devices;
}

function recordPing(id) {
  const device = ensureDevice(id);
  device.lastSeen = Date.now();
  markDirty();
}

function recordMoisture(id, moisture) {
  const device = ensureDevice(id);
  const now = Date.now();
  device.lastMoisture = moisture;
  device.lastMoistureTime = now;
  markDirty();

  let suggestionCreated = false;
  if (moisture < LOW_MOISTURE_THRESHOLD && now - device.lowMoistureCheckedAt > SUGGESTION_COOLDOWN_MS) {
    device.lowMoistureSuggestion = { message: "Low moisture detected.", time: now };
    device.lowMoistureCheckedAt = now;
    suggestionCreated = true;
  }
  return { suggestionCreated };
}

function setPump(id, action, { durationSec, reason } = {}) {
  const device = ensureDevice(id);
  const now = Date.now();

  device.pump = action;
  if (action === "ON") {
    device.manualLockUntil = now + MANUAL_LOCK_ON_MS;
    device.activeSession = durationSec
      ? { startedAt: now, endsAt: now + durationSec * 1000 }
      : null;
  } else {
    device.manualLockUntil = now + MANUAL_LOCK_OFF_MS;
    device.activeSession = null;
  }

  markDirty();
  eventLog.push({ deviceId: id, type: "pump", event: action, reason: reason || "manual" });
}

function setLight(id, lightId, state, { durationSec, reason } = {}) {
  const device = ensureDevice(id);
  if (!(lightId in device.lights)) {
    throw new Error(`Invalid light_id (use L1-L${LIGHT_COUNT})`);
  }

  const now = Date.now();
  device.lights[lightId] = state;
  device.lightTimers[lightId] = state === "ON" && durationSec
    ? { endsAt: now + durationSec * 1000 }
    : null;

  markDirty();
  eventLog.push({ deviceId: id, type: "light", event: state, lightId, reason: reason || "manual" });
}

function setSchedule(id, { startTime, endTime, enabled }) {
  const device = ensureDevice(id);

  if (enabled === false) {
    device.schedule = null;
    eventLog.push({ deviceId: id, type: "schedule", event: "DISABLED" });
  } else {
    // Validate before saving so a malformed schedule never lands in state.
    parseTimeToMinutes(startTime);
    parseTimeToMinutes(endTime);
    device.schedule = { startTime, endTime };
    eventLog.push({ deviceId: id, type: "schedule", event: "SET", startTime, endTime });
  }

  markDirty();
  return device.schedule;
}

// The shape returned to API clients — deliberately narrower than the
// internal record above so implementation details (timers, lock windows,
// suggestion cooldowns) never leak over the wire.
function serialize(device, now = Date.now()) {
  const isOnline = now - device.lastSeen <= DEVICE_OFFLINE_MS;
  const moistureIsFresh =
    device.lastMoistureTime && now - device.lastMoistureTime <= MOISTURE_STALE_MS;

  return {
    status: isOnline ? "online" : "offline",
    lastSeen: device.lastSeen,
    pump: device.pump,
    lights: { ...device.lights },
    moisture: moistureIsFresh ? device.lastMoisture : "OFFLINE",
    schedule: device.schedule,
    lastSuggestion: device.lowMoistureSuggestion,
  };
}

// =====================
// Background tick — timers, offline detection, schedule evaluation.
// Pure function of `devices` + wall clock; side effects are limited to
// mutating `devices` and queueing log entries.
// =====================
function tick(now = Date.now()) {
  for (const id of Object.keys(devices)) {
    const device = devices[id];

    for (const lightId of Object.keys(device.lightTimers)) {
      const timer = device.lightTimers[lightId];
      if (timer && now >= timer.endsAt) {
        device.lights[lightId] = "OFF";
        device.lightTimers[lightId] = null;
        markDirty();
        eventLog.push({ deviceId: id, type: "light", event: "AUTO_OFF", lightId });
      }
    }

    if (device.activeSession && now >= device.activeSession.endsAt) {
      device.pump = "OFF";
      device.activeSession = null;
      markDirty();
      eventLog.push({ deviceId: id, type: "pump", event: "AUTO_OFF", reason: "timer" });
    }

    if (device.schedule && now > device.manualLockUntil) {
      applySchedule(id, device, now);
    }
  }
}

function applySchedule(id, device, now) {
  let shouldBeOn;
  try {
    const localMinutes = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
    const start = parseTimeToMinutes(device.schedule.startTime);
    const end = parseTimeToMinutes(device.schedule.endTime);
    shouldBeOn = start <= end
      ? localMinutes >= start && localMinutes <= end
      : localMinutes >= start || localMinutes <= end; // overnight wrap, e.g. 22:00-06:00
  } catch (e) {
    logger.warn(`Malformed schedule skipped for device ${id}`, { error: e.message });
    return;
  }

  if (shouldBeOn && device.pump !== "ON") {
    device.pump = "ON";
    markDirty();
    eventLog.push({ deviceId: id, type: "pump", event: "SCHEDULE_ON" });
  } else if (!shouldBeOn && device.pump !== "OFF") {
    device.pump = "OFF";
    markDirty();
    eventLog.push({ deviceId: id, type: "pump", event: "SCHEDULE_OFF" });
  }
}

// =====================
// Persistence
// =====================
async function load() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(STATE_FILE, "utf-8");
    devices = JSON.parse(raw);
    logger.info("Device state loaded from disk", { deviceCount: Object.keys(devices).length });
    rearmTimersAfterRestart();
  } catch {
    logger.info("No existing state file — starting fresh");
    devices = Object.create(null);
  }
}

// Timers are wall-clock based (endsAt), so a timer that expired while the
// process was down needs to be resolved on startup rather than left ON
// forever.
function rearmTimersAfterRestart() {
  const now = Date.now();
  for (const id of Object.keys(devices)) {
    const device = devices[id];

    if (device.activeSession && now >= device.activeSession.endsAt) {
      device.pump = "OFF";
      device.activeSession = null;
      markDirty();
      eventLog.push({ deviceId: id, type: "pump", event: "AUTO_OFF", reason: "expired_during_restart" });
    }

    for (const lightId of Object.keys(device.lightTimers || {})) {
      const timer = device.lightTimers[lightId];
      if (timer && now >= timer.endsAt) {
        device.lights[lightId] = "OFF";
        device.lightTimers[lightId] = null;
        markDirty();
        eventLog.push({ deviceId: id, type: "light", event: "AUTO_OFF", lightId, reason: "expired_during_restart" });
      }
    }
  }
}

async function persistIfDirty() {
  if (!dirty) return;
  const tmpFile = STATE_FILE + ".tmp";
  try {
    await fsp.writeFile(tmpFile, JSON.stringify(devices, null, 2));
    await fsp.rename(tmpFile, STATE_FILE);
    dirty = false;
  } catch (e) {
    logger.error("Failed to persist device state", { error: e.message });
  }
}

async function persistNow() {
  try {
    await fsp.writeFile(STATE_FILE, JSON.stringify(devices, null, 2));
  } catch (e) {
    logger.error("Final state save on shutdown failed", { error: e.message });
  }
}

module.exports = {
  load,
  tick,
  persistIfDirty,
  persistNow,
  ensureDevice,
  getDevice,
  getAllDevices,
  recordPing,
  recordMoisture,
  setPump,
  setLight,
  setSchedule,
  serialize,
};
