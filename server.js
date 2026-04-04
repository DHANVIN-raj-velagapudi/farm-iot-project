// =====================
// IMPORTS
// =====================
const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const admin = require("firebase-admin");

// =====================
// FIREBASE
// =====================
let db = null;

if (process.env.FIREBASE_KEY) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();

    console.log("🔥 Firebase ENABLED");

  } catch (e) {
    console.log("⚠ Firebase init failed, running without it");
  }
} else {
  console.log("⚠ Firebase DISABLED (no key)");
}

// =====================
// APP
// =====================
const app = express();
app.use(cors());
app.use(express.json({ limit: "10kb" }));

// =====================
// CONFIG
// =====================
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "devices.json");
const LOG_FILE = path.join(DATA_DIR, "logs.ndjson");

const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "SECRET123";

const MAX_DEVICE_ID = 40;

// =====================
// STATE
// =====================
let devices = {};
let dirtyDevices = new Set();

// =====================
// METRICS (HARD CAPPED)
// =====================
let metrics = [];

function recordMetric(type) {
  metrics.push({ type, time: Date.now() });

  if (metrics.length > 1000) metrics.shift();
}

function getMetrics() {
  const now = Date.now();
  const lastMin = metrics.filter(m => now - m.time < 60000);

  return {
    req: lastMin.filter(m => m.type === "req").length,
    err: lastMin.filter(m => m.type === "err").length,
    ai: lastMin.filter(m => m.type === "ai").length
  };
}

// =====================
// VALIDATION
// =====================
function validateDuration(d) {
  if (d == null) return;
  if (typeof d !== "number" || d < 0 || d > 3600) {
    throw new Error("Invalid duration");
  }
}

function validateMoisture(m) {
  if (typeof m !== "number" || m < 0 || m > 100) {
    throw new Error("Invalid moisture");
  }
}

function parseTime(str) {
  if (typeof str !== "string") throw new Error("Invalid time");

  const [h, m] = str.split(":").map(Number);

  if (
    isNaN(h) || isNaN(m) ||
    h < 0 || h > 23 ||
    m < 0 || m > 59
  ) throw new Error("Invalid time");

  return h * 60 + m;
}

// =====================
// RATE LIMIT (SINGLE DEVICE SAFE)
// =====================
let lastRequestTime = 0;

function rateLimit(req, res, next) {
  const now = Date.now();
  if (now - lastRequestTime < 100) {
    return res.status(429).json({ error: "Too fast" });
  }
  lastRequestTime = now;
  next();
}

app.use(rateLimit);

// =====================
// LOG QUEUE + ROTATION
// =====================
let logQueue = [];
let isFlushing = false;

function queueLog(entry) {
  logQueue.push(entry);
}

async function flushLogs() {
  if (isFlushing || logQueue.length === 0) return;

  isFlushing = true;

  const batch = logQueue.splice(0, 50);
  const data = batch.map(e => JSON.stringify(e)).join("\n") + "\n";

  try {
    const stats = await fs.stat(LOG_FILE).catch(() => null);

    if (stats && stats.size > 5 * 1024 * 1024) {
      await fs.rename(LOG_FILE, LOG_FILE + ".old");
    }

    await fs.appendFile(LOG_FILE, data);
  } catch {
    recordMetric("err");
  }

  isFlushing = false;
}

setInterval(flushLogs, 2000);

// =====================
// LIGHT SYSTEM
// =====================
function initLights() {
  const lights = {};
  const timers = {};

  for (let i = 1; i <= 10; i++) {
    lights["L" + i] = "OFF";
    timers["L" + i] = null;
  }

  return { lights, timers };
}

function handleLightCommand(d, { light_id, state, duration }, now) {
  if (!(light_id in d.lights)) throw new Error("Invalid light_id");

  validateDuration(duration);

  d.lights[light_id] = state;

  if (state === "ON" && duration) {
    d.lightTimers[light_id] = {
      ends_at: now + duration * 1000
    };
  } else {
    d.lightTimers[light_id] = null;
  }
}

function processLightTimers(device_id, d, now) {
  for (let lid in d.lightTimers) {
    const t = d.lightTimers[lid];

    if (t && now >= t.ends_at) {
      d.lights[lid] = "OFF";
      d.lightTimers[lid] = null;
      dirtyDevices.add(device_id);
      queueLog({ device_id, type: "light", event: "AUTO_OFF", reason: "timer", time: now });
    }
  }
}

// =====================
// STORAGE
// =====================
async function saveState() {
  const temp = STATE_FILE + ".tmp";
  await fs.writeFile(temp, JSON.stringify(devices));
  await fs.rename(temp, STATE_FILE);
}

// =====================
// INIT
// =====================
async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    devices = JSON.parse(await fs.readFile(STATE_FILE));
  } catch {
    devices = {};
  }
}

// =====================
// DEVICE
// =====================
function ensureDevice(id) {
  if (!id || id.length > MAX_DEVICE_ID) {
    throw new Error("Invalid device_id");
  }

  if (!devices[id]) {
    const { lights, timers } = initLights();

    devices[id] = {
      pump: "OFF",
      lights,
      lightTimers: timers,
      schedule: null,
      manualLockUntil: 0,
      tzOffset: 0,
      aiLastRun: 0,
      activeSession: null,
      lastSuggestion: null
    };
  }
}

// =====================
// AUTH
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
// PING (HEARTBEAT)
// =====================
app.post("/ping", auth, (req, res) => {
  const now = Date.now();
  const { device_id } = req.body;

  ensureDevice(device_id);
  devices[device_id].lastSeen = now;

  dirtyDevices.add(device_id);

  res.json({ ok: true });
});

// =====================
// CONTROL
// =====================
app.post("/control", auth, async (req, res) => {
  try {
    const now = Date.now();
    const { device_id, action, duration, reason } = req.body;

    validateDuration(duration);

    ensureDevice(device_id);
    const d = devices[device_id];
    
    devices[device_id].lastSeen = now;

    if (action === "ON") {
      d.pump = "ON";
      d.manualLockUntil = now + 10 * 60 * 1000;

      if (duration) {
        d.activeSession = {
          started_at: now,
          ends_at: now + duration * 1000
        };
      }

      queueLog({ device_id, event: "ON", reason: reason || "manual", time: now });
    }

    if (action === "OFF") {
      d.pump = "OFF";
      d.manualLockUntil = now + 10 * 60 * 1000;
      d.activeSession = null;
       dirtyDevices.add(device_id);
      
      queueLog({ device_id, event: "OFF", reason: reason || "manual", time: now });
    }

    res.json({ ok: true });

  } catch (e) {
    recordMetric("err");
    res.status(400).json({ error: e.message });
  }
});
// =====================
// LIGHTS  
// =====================
app.post("/lights", auth, async (req, res) => {
  try {
    const now = Date.now();
    const { device_id, light_id, state, duration, reason } = req.body;

    ensureDevice(device_id);
    const d = devices[device_id];

    devices[device_id].lastSeen = now;
    
    handleLightCommand(d, { light_id, state, duration }, now);

    queueLog({
  device_id,
  type: "light",
  light_id,
  state,
  duration,
  reason: reason || "manual",
  time: now
});

    dirtyDevices.add(device_id);

    res.json({ ok: true });

  } catch (e) {
    recordMetric("err");
    res.status(400).json({ error: e.message });
  }
});

// =====================
// SENSOR + AI (FIXED)
// =====================
app.post("/data", auth, async (req, res) => {
  try {
    const now = Date.now();
    const { device_id, moisture } = req.body;

    validateMoisture(moisture);

    ensureDevice(device_id);
    devices[device_id].lastSeen = now;
    const d = devices[device_id];

    queueLog({ device_id, type: "moisture", value: moisture, time: now });

    // ✅ SUGGESTION ONLY (NO AUTOMATION)
    if (
      moisture < 30 &&
      now - d.aiLastRun > 10 * 60 * 1000
    ) {
      d.lastSuggestion = {
        message: "Moisture low. Consider watering.",
        level: "warning",
        time: now
      };

      d.aiLastRun = now;

      recordMetric("ai");

      queueLog({
        device_id,
        event: "AI_SUGGEST",
        time: now
      });
    }

    dirtyDevices.add(device_id);
    res.json({ ok: true });

  } catch (e) {
    recordMetric("err");
    res.status(400).json({ error: e.message });
  }
});

// =====================
// STATE (DEBUG)
// =====================
app.get("/state", (req, res) => {
  res.json(devices);
});

// =====================
// LOOP (SAFE)
// =====================
setInterval(() => {
  const now = Date.now();

  for (let id in devices) {
    try {
      const d = devices[id];
      
      if (!d.lastSeen) {
  d.status = "unknown";
} else if (now - d.lastSeen > 120000) {
  d.status = "offline";
} else {
  d.status = "online";
}
     dirtyDevices.add(id);
      
      processLightTimers(id, d, now);

      if (d.activeSession?.ends_at && now >= d.activeSession.ends_at) {
        d.pump = "OFF";
        d.activeSession = null;
        dirtyDevices.add(id);
        
        queueLog({ device_id: id, event: "AUTO_OFF", reason: "timer", time: now });
      }

      if (d.schedule && now > d.manualLockUntil) {
        const t = new Date(now + d.tzOffset * 60000);
        const cur = t.getHours() * 60 + t.getMinutes();

        const start = parseTime(d.schedule.start_time);
        const end = parseTime(d.schedule.end_time);

        const active = start <= end
          ? cur >= start && cur <= end
          : cur >= start || cur <= end;

        if (active && d.pump !== "ON") {
          d.pump = "ON";
          queueLog({ device_id: id, event: "SCHEDULE_ON", reason: "schedule", time: now });
        }

        if (!active && d.pump !== "OFF") {
          d.pump = "OFF";
          queueLog({ device_id: id, event: "SCHEDULE_OFF", reason: "schedule", time: now });
        }
        
      }

    } catch (e) {
      recordMetric("err");
    }
  }
}, 5000);

// =====================
// FIRESTORE (NO FREEZE)
// =====================
setInterval(async () => {
  const ids = Array.from(dirtyDevices).slice(0, 50);

  if (db) {
  try {
    await db.collection("devices").doc(id).set(devices[id]);
  } catch {
    recordMetric("err");
  }
}

// =====================
// SHUTDOWN (SAFE)
// =====================
async function shutdown() {
  try {
    await saveState();
    await flushLogs();

    const tasks = [];
    for (let id of dirtyDevices) {
      if (db) {
  tasks.push(db.collection("devices").doc(id).set(devices[id]));
}
    }

    await Promise.all(tasks);

  } catch (e) {
    console.error(e);
  }

  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// =====================
// START
// =====================
init().then(() => {
  app.listen(3000, () => {
    console.log("🚀 BACKEND RUNNING");
  });
});

app.get("/test", (req, res) => {
  res.send("NEW VERSION RUNNING a ");
});
