// =====================
// IMPORTS
// =====================
const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");

// =====================
// APP & CONFIG
// =====================
const app = express();
app.use(cors());
app.use(express.json({ limit: "10kb" }));

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "devices.json");
const LOG_FILE = path.join(DATA_DIR, "logs.ndjson");

const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "SECRET123";
const MAX_DEVICE_ID = 40;

// =====================
// STATE & METRICS
// =====================
let devices = {};
let dirty = false; // Flag to trigger disk save
let metrics = [];

function recordMetric(type) {
  metrics.push({ type, time: Date.now() });
  if (metrics.length > 1000) metrics.shift();
}

// =====================
// VALIDATION UTILITIES
// =====================
function validateDuration(d) {
  if (d === undefined || d === null) return;
  if (typeof d !== "number" || d < 0 || d > 3600) {
    throw new Error("Invalid duration (0-3600s)");
  }
}

function validateMoisture(m) {
  if (typeof m !== "number" || m < 0 || m > 100) {
    throw new Error("Invalid moisture (0-100)");
  }
}

function parseTime(str) {
  if (typeof str !== "string" || !str.includes(":")) throw new Error("Invalid time format (HH:mm)");
  const [h, m] = str.split(":").map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) throw new Error("Invalid time range");
  return h * 60 + m;
}

// =====================
// LOGGING SYSTEM
// =====================
let logQueue = [];
let isFlushing = false;

function queueLog(entry) {
  logQueue.push({ ...entry, timestamp: new Date().toISOString() });
}

async function flushLogs() {
  if (isFlushing || logQueue.length === 0) return;
  isFlushing = true;
  const batch = logQueue.splice(0, 50);
  const data = batch.map(e => JSON.stringify(e)).join("\n") + "\n";

  try {
    const stats = await fs.stat(LOG_FILE).catch(() => null);
    if (stats && stats.size > 10 * 1024 * 1024) { // 10MB Rotation
      await fs.rename(LOG_FILE, LOG_FILE + ".old");
    }
    await fs.appendFile(LOG_FILE, data);
  } catch (e) {
    console.error("Log Write Error:", e);
  }
  isFlushing = false;
}

// =====================
// DEVICE MANAGEMENT
// =====================
function initLights() {
  const lights = {};
  const lightTimers = {};
  for (let i = 1; i <= 10; i++) {
    lights["L" + i] = "OFF";
    lightTimers["L" + i] = null;
  }
  return { lights, lightTimers };
}

function ensureDevice(id) {
  if (!id || id.length > MAX_DEVICE_ID) throw new Error("Invalid device_id");
  if (!devices[id]) {
    const { lights, lightTimers } = initLights();
    devices[id] = {
      status: "online",
      lastSeen: Date.now(),
      pump: "OFF",
      lights,
      lightTimers,
      schedule: null,
      manualLockUntil: 0,
      tzOffset: 0,
      aiLastRun: 0,
      activeSession: null,
      lastSuggestion: null
    };
    dirty = true;
  }
}

// =====================
// MIDDLEWARE
// =====================
function auth(req, res, next) {
  recordMetric("req");
  if (req.headers["x-device-token"] !== DEVICE_TOKEN) {
    recordMetric("err");
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

// =====================
// ROUTES
// =====================

app.post("/ping", auth, (req, res) => {
  const { device_id } = req.body;
  try {
    ensureDevice(device_id);
    devices[device_id].lastSeen = Date.now();
    devices[device_id].status = "online";
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/control", auth, (req, res) => {
  try {
    const now = Date.now();
    const { device_id, action, duration, reason } = req.body;
    
    validateDuration(duration);
    ensureDevice(device_id);
    const d = devices[device_id];

    if (action === "ON") {
      d.pump = "ON";
      d.manualLockUntil = now + 10 * 60 * 1000; // 10 min lock
      if (duration) {
        d.activeSession = { started_at: now, ends_at: now + duration * 1000 };
      }
    } else {
      d.pump = "OFF";
      d.manualLockUntil = now + 10 * 60 * 1000;
      d.activeSession = null;
    }

    queueLog({ device_id, type: "pump", event: action, reason: reason || "manual" });
    dirty = true;
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/lights", auth, (req, res) => {
  try {
    const now = Date.now();
    const { device_id, light_id, state, duration, reason } = req.body;

    ensureDevice(device_id);
    const d = devices[device_id];

    if (!(light_id in d.lights)) throw new Error("Invalid light_id");
    validateDuration(duration);

    d.lights[light_id] = state;
    if (state === "ON" && duration) {
      d.lightTimers[light_id] = { ends_at: now + duration * 1000 };
    } else {
      d.lightTimers[light_id] = null;
    }

    queueLog({ device_id, type: "light", light_id, state, reason: reason || "manual" });
    dirty = true;
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/data", auth, (req, res) => {
  try {
    const now = Date.now();
    const { device_id, moisture } = req.body;

    validateMoisture(moisture);
    ensureDevice(device_id);
    const d = devices[device_id];

    queueLog({ device_id, type: "moisture", value: moisture });

    // Suggestion logic
    if (moisture < 30 && now - d.aiLastRun > 10 * 60 * 1000) {
      d.lastSuggestion = { message: "Low moisture detected.", time: now };
      d.aiLastRun = now;
      recordMetric("ai");
    }

    dirty = true;
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/state", (req, res) => {
  res.json(devices);
});

// =====================
// CORE BACKGROUND LOOP
// =====================
setInterval(() => {
  const now = Date.now();

  for (let id in devices) {
    const d = devices[id];

    // 1. Connection Status
    if (now - d.lastSeen > 120000) d.status = "offline";
    else d.status = "online";

    // 2. Light Timers
    for (let lid in d.lightTimers) {
      if (d.lightTimers[lid] && now >= d.lightTimers[lid].ends_at) {
        d.lights[lid] = "OFF";
        d.lightTimers[lid] = null;
        dirty = true;
        queueLog({ device_id: id, type: "light", event: "AUTO_OFF", light_id: lid });
      }
    }

    // 3. Pump Session Timer
    if (d.activeSession && now >= d.activeSession.ends_at) {
      d.pump = "OFF";
      d.activeSession = null;
      dirty = true;
      queueLog({ device_id: id, type: "pump", event: "AUTO_OFF", reason: "timer" });
    }

    // 4. Scheduling (Only if not manually locked)
    if (d.schedule && now > d.manualLockUntil) {
      try {
        const localTime = new Date(now + d.tzOffset * 60000);
        const cur = localTime.getUTCHours() * 60 + localTime.getUTCMinutes();
        const start = parseTime(d.schedule.start_time);
        const end = parseTime(d.schedule.end_time);

        const shouldBeOn = start <= end ? (cur >= start && cur <= end) : (cur >= start || cur <= end);

        if (shouldBeOn && d.pump !== "ON") {
          d.pump = "ON";
          dirty = true;
          queueLog({ device_id: id, type: "pump", event: "SCHEDULE_ON" });
        } else if (!shouldBeOn && d.pump !== "OFF") {
          d.pump = "OFF";
          dirty = true;
          queueLog({ device_id: id, type: "pump", event: "SCHEDULE_OFF" });
        }
      } catch (e) { /* Ignore malformed schedules */ }
    }
  }
}, 5000);

// =====================
// PERSISTENCE LOOPS
// =====================
setInterval(flushLogs, 5000);

setInterval(async () => {
  if (!dirty) return;
  try {
    const temp = STATE_FILE + ".tmp";
    await fs.writeFile(temp, JSON.stringify(devices, null, 2));
    await fs.rename(temp, STATE_FILE);
    dirty = false;
  } catch (e) {
    console.error("Save Error:", e);
  }
}, 15000);

// =====================
// STARTUP & SHUTDOWN
// =====================
async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const saved = await fs.readFile(STATE_FILE, "utf-8");
    devices = JSON.parse(saved);
    console.log("💾 State loaded from disk");
  } catch (e) {
    console.log("🆕 Starting with fresh state");
  }

  app.listen(3000, () => {
    console.log("🚀 IOT BACKEND ONLINE ON PORT 3000");
  });
}

async function shutdown() {
  console.log("Shutting down...");
  await fs.writeFile(STATE_FILE, JSON.stringify(devices));
  await flushLogs();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
