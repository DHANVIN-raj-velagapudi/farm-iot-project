// =====================
// IMPORTS
// =====================
const express = require("express");
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const cors = require("cors");
const mqtt = require("mqtt");

const mqttClient = mqtt.connect("mqtts://...", {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
});

mqttClient.on("connect", () => {
  mqttClient.on("error", (err) => {
  console.error("MQTT ERROR:", err);
});

mqttClient.on("reconnect", () => {
  console.log("MQTT reconnecting...");
});
  
  console.log("✅ MQTT Connected");
});

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
const DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]+$/; // FIX #8: alphanumeric + dash/underscore only

// =====================
// STATE & METRICS
// =====================
let devices = {};
let dirty = false;
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

// FIX #8: validate device_id content, not just length
function validateDeviceId(id) {
  if (!id || typeof id !== "string" || id.length > MAX_DEVICE_ID || !DEVICE_ID_REGEX.test(id)) {
    throw new Error("Invalid device_id (alphanumeric, dash, underscore only, max 40 chars)");
  }
}

// =====================
// LOGGING SYSTEM
// =====================
let logQueue = [];
let isFlushing = false;

function queueLog(entry) {
  logQueue.push({ ...entry, timestamp: new Date().toISOString() });
}

// FIX #6: synchronous emergency flush for crash/unexpected exit
function flushLogsSync() {
  if (logQueue.length === 0) return;
  const batch = logQueue.splice(0);
  const data = batch.map(e => JSON.stringify(e)).join("\n") + "\n";
  try {
    fs.appendFileSync(LOG_FILE, data);
  } catch (e) {
    console.error("Emergency log flush failed:", e);
  }
}

// FIX #12: timestamped log rotation — keeps up to 5 rotated files
async function rotateLogs() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rotated = `${LOG_FILE}.${ts}`;
  await fsp.rename(LOG_FILE, rotated);

  // Clean up old rotations — keep only the 5 most recent
  const dir = path.dirname(LOG_FILE);
  const base = path.basename(LOG_FILE);
  const files = (await fsp.readdir(dir))
    .filter(f => f.startsWith(base + "."))
    .sort();
  if (files.length > 5) {
    const toDelete = files.slice(0, files.length - 5);
    for (const f of toDelete) {
      await fsp.unlink(path.join(dir, f)).catch(() => {});
    }
  }
}

async function flushLogs() {
  if (isFlushing || logQueue.length === 0) return;
  isFlushing = true;
  const batch = logQueue.splice(0, 50);
  const data = batch.map(e => JSON.stringify(e)).join("\n") + "\n";

  try {
    const stats = await fsp.stat(LOG_FILE).catch(() => null);
    if (stats && stats.size > 10 * 1024 * 1024) {
      await rotateLogs(); // FIX #12: timestamped rotation
    }
    await fsp.appendFile(LOG_FILE, data);
  } catch (e) {
    console.error("Log Write Error:", e);
    // Re-queue failed batch so it's not silently lost
    logQueue.unshift(...batch);
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

// FIX #7: ensureDevice only initializes truly new devices — never clobbers loaded state
function ensureDevice(id) {
  validateDeviceId(id); // FIX #8
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
    queueLog({ device_id: id, type: "system", event: "DEVICE_CREATED" }); // FIX #15
  }
}

// FIX #2 & #3: re-arm timers from persisted state on startup
function rearmTimers() {
  const now = Date.now();
  for (const id in devices) {
    const d = devices[id];

    // Re-arm pump session
    if (d.activeSession) {
      if (now >= d.activeSession.ends_at) {
        // Session already expired while we were down
        d.pump = "OFF";
        d.activeSession = null;
        
        mqttClient.publish(`${device_id}pump", "OFF");
        
        dirty = true;
        queueLog({ device_id: id, type: "pump", event: "AUTO_OFF", reason: "expired_during_restart" });
      }
      // If still valid, the background loop will handle it naturally — no action needed
    }

    // Re-arm light timers
    for (const lid in d.lightTimers || {}) {
      if (d.lightTimers[lid] && now >= d.lightTimers[lid].ends_at) {
        // Timer already expired while we were down
        d.lights[lid] = "OFF";
        d.lightTimers[lid] = null;
        dirty = true;
        queueLog({ device_id: id, type: "light", event: "AUTO_OFF", light_id: lid, reason: "expired_during_restart" });
      }
    }
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

// FIX #10: consistent JSON content-type check for POST routes
function requireJson(req, res, next) {
  if (req.method !== "GET" && !req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json" });
  }
  next();
}

app.use(requireJson);

// =====================
// ROUTES
// =====================

// FIX #1: /state now requires auth
app.get("/state", auth, (req, res) => {
  res.json(devices);
});

app.post("/ping", auth, (req, res) => {
  const { device_id } = req.body;
  try {
    ensureDevice(device_id);
    devices[device_id].lastSeen = Date.now();
    devices[device_id].status = "online";
    dirty = true;
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/control", auth, (req, res) => {
  try {
    const now = Date.now();
    const { device_id, action, duration, reason } = req.body;

    if (!["ON", "OFF"].includes(action)) throw new Error("action must be ON or OFF");
    validateDuration(duration);
    ensureDevice(device_id);
    const d = devices[device_id];

    if (action === "ON") {
      d.pump = "ON";
      d.manualLockUntil = now + 10 * 60 * 1000;
      
      mqttClient.publish("device1/pump", "ON");
      
      if (duration) {
        d.activeSession = { started_at: now, ends_at: now + duration * 1000 };
      }
    } else {
      d.pump = "OFF";
      // FIX #11: shorter lock on manual OFF (2 min) so schedule resumes sooner
      d.manualLockUntil = now + 2 * 60 * 1000;
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

    if (!(light_id in d.lights)) throw new Error("Invalid light_id (use L1–L10)");
    if (!["ON", "OFF"].includes(state)) throw new Error("state must be ON or OFF");
    validateDuration(duration);

    d.lights[light_id] = state;
    if (state === "ON" && duration) {
      d.lightTimers[light_id] = { ends_at: now + duration * 1000 };
    } else {
      d.lightTimers[light_id] = null;
    }
    
    mqttClient.publish(`device1/light/${light_id}`, state);

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

    // FIX #4: aiLastRun is already persisted to disk — just use it as-is
    if (moisture < 30 && now - d.aiLastRun > 10 * 60 * 1000) {
      d.lastSuggestion = { message: "Low moisture detected.", time: now };
      d.aiLastRun = now;
      recordMetric("ai");
      dirty = true;
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// FIX #14: /schedule POST route to set schedule via API
app.post("/schedule", auth, (req, res) => {
  try {
    const { device_id, start_time, end_time, enabled } = req.body;

    ensureDevice(device_id);
    const d = devices[device_id];

    if (enabled === false) {
      d.schedule = null;
      queueLog({ device_id, type: "schedule", event: "DISABLED" });
    } else {
      // Validate times before saving
      parseTime(start_time);
      parseTime(end_time);
      d.schedule = { start_time, end_time };
      queueLog({ device_id, type: "schedule", event: "SET", start_time, end_time });
    }

    dirty = true;
    res.json({ ok: true, schedule: d.schedule });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// FIX #5 & #13: /metrics GET route, auth-protected
app.get("/metrics", auth, (req, res) => {
  const summary = metrics.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {});
  res.json({
    total: metrics.length,
    summary,
    recent: metrics.slice(-20)
  });
});

// =====================
// CORE BACKGROUND LOOP
// =====================
setInterval(() => {
  const now = Date.now();

  for (const id in devices) {
    const d = devices[id];

    // 1. Connection status
    if (now - d.lastSeen > 120000) d.status = "offline";
    else d.status = "online";

    // 2. Light timers
    for (const lid in d.lightTimers) {
      if (d.lightTimers[lid] && now >= d.lightTimers[lid].ends_at) {
        d.lights[lid] = "OFF";
        d.lightTimers[lid] = null;
        dirty = true;
        queueLog({ device_id: id, type: "light", event: "AUTO_OFF", light_id: lid });
      }
    }

    // 3. Pump session timer
    if (d.activeSession && now >= d.activeSession.ends_at) {
      d.pump = "OFF";
      d.activeSession = null;
      dirty = true;
      queueLog({ device_id: id, type: "pump", event: "AUTO_OFF", reason: "timer" });
    }

    // 4. Scheduling (only if not manually locked)
    if (d.schedule && now > d.manualLockUntil) {
      try {
        const localTime = new Date(now + d.tzOffset * 60000);
        const cur = localTime.getUTCHours() * 60 + localTime.getUTCMinutes();
        const start = parseTime(d.schedule.start_time);
        const end = parseTime(d.schedule.end_time);

        const shouldBeOn = start <= end
          ? (cur >= start && cur <= end)
          : (cur >= start || cur <= end); // overnight wrap

        if (shouldBeOn && d.pump !== "ON") {
          d.pump = "ON";
          dirty = true;
          queueLog({ device_id: id, type: "pump", event: "SCHEDULE_ON" });
        } else if (!shouldBeOn && d.pump !== "OFF") {
          d.pump = "OFF";
          dirty = true;
          queueLog({ device_id: id, type: "pump", event: "SCHEDULE_OFF" });
        }
      } catch (e) {
        // FIX #9: log malformed schedule warnings instead of silently ignoring
        console.warn(`[${id}] Malformed schedule skipped:`, e.message);
      }
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
    await fsp.writeFile(temp, JSON.stringify(devices, null, 2));
    await fsp.rename(temp, STATE_FILE);
    dirty = false;
  } catch (e) {
    console.error("Save Error:", e);
  }
}, 15000);

// =====================
// STARTUP & SHUTDOWN
// =====================
async function start() {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  try {
    const saved = await fsp.readFile(STATE_FILE, "utf-8");
    devices = JSON.parse(saved);
    console.log("💾 State loaded from disk");
    rearmTimers(); // FIX #2 & #3: resolve any timers that expired during downtime
  } catch (e) {
    console.log("🆕 Starting with fresh state");
  }

  // FIX #15: startup marker in logs
  queueLog({ type: "system", event: "SERVER_START", pid: process.pid });

  app.listen(3000, () => {
    console.log("🚀 IOT BACKEND ONLINE ON PORT 3000");
  });
}

async function shutdown() {
  console.log("Shutting down...");
  queueLog({ type: "system", event: "SERVER_STOP" }); // FIX #15
  try {
    await fsp.writeFile(STATE_FILE, JSON.stringify(devices, null, 2));
  } catch (e) {
    console.error("Final state save failed:", e);
  }
  flushLogsSync(); // FIX #6: synchronous flush on clean shutdown
  process.exit(0);
}

// FIX #6: catch unexpected crashes and flush logs before dying
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  queueLog({ type: "system", event: "CRASH", error: err.message });
  flushLogsSync();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  queueLog({ type: "system", event: "UNHANDLED_REJECTION", error: String(reason) });
  flushLogsSync();
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
