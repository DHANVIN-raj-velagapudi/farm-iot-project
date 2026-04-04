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
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

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
const LOG_FILE = path.join(DATA_DIR, "logs.ndjson"); // append-only

const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "SECRET123";

const MAX_EVENTS = 500;
const MAX_DEVICE_ID = 40;
const MAX_DIRTY = 1000;
const VALID = ["ON", "OFF"];

// =====================
// STATE (HOT)
// =====================
let devices = {};
let dirtyDevices = new Set();
let dirtyLogs = new Set();

// =====================
// METRICS (ROLLING)
// =====================
let metrics = [];

function recordMetric(type) {
  metrics.push({ type, time: Date.now() });

  // keep last 5 min
  const cutoff = Date.now() - 5 * 60 * 1000;
  metrics = metrics.filter(m => m.time > cutoff);
}

function getMetrics() {
  const now = Date.now();
  const lastMin = metrics.filter(m => now - m.time < 60000);

  return {
    requests_per_min: lastMin.filter(m => m.type === "req").length,
    errors_per_min: lastMin.filter(m => m.type === "err").length,
    ai_triggers_per_min: lastMin.filter(m => m.type === "ai").length
  };
}

// =====================
// LIGHT SYSTEM (MODULE)
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

function handleLightCommand(d, { light_id, state, duration }) {
  if (!d.lights.hasOwnProperty(light_id)) {
    throw new Error("Invalid light_id");
  }

  d.lights[light_id] = state;

  if (state === "ON" && duration) {
    d.lightTimers[light_id] = {
      ends_at: Date.now() + duration * 1000
    };
  } else {
    d.lightTimers[light_id] = null;
  }
}

function processLightTimers(device_id, d, currentTime) {
  for (let lid in d.lightTimers) {
    const t = d.lightTimers[lid];

    if (t && currentTime >= t.ends_at) {
      d.lights[lid] = "OFF";
      d.lightTimers[lid] = null;

      appendLog({
        device_id,
        type: "light",
        light_id: lid,
        event: "AUTO_OFF",
        time: currentTime
      });
    }
  }
}

// =====================
// SAFE STATE WRITE
// =====================
async function saveState() {
  const temp = STATE_FILE + ".tmp";
  await fs.writeFile(temp, JSON.stringify(devices));
  await fs.rename(temp, STATE_FILE);
}

// =====================
// APPEND LOG (FAST)
// =====================
async function appendLog(entry) {
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(LOG_FILE, line);
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
// HELPERS
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
      activeSession: null
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
// CONTROL WRITE
// =====================
app.post("/control", auth, async (req, res) => {
  try {
    const { device_id, action, duration } = req.body;

    ensureDevice(device_id);
    const d = devices[device_id];

    if (action === "ON") {
      d.pump = "ON";
      d.manualLockUntil = Date.now() + 10 * 60 * 1000;

      if (duration) {
        d.activeSession = {
          started_at: Date.now(),
          ends_at: Date.now() + duration * 1000
        };
      }

      await appendLog({
        device_id,
        event: "ON",
        time: Date.now(),
        duration: duration || null
      });
    }

    if (action === "OFF") {
      d.pump = "OFF";
      d.manualLockUntil = Date.now() + 10 * 60 * 1000;

      //  CLEAR SESSION
      d.activeSession = null;

      await appendLog({
        device_id,
        event: "OFF",
        time: Date.now()
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
// LIGHT CONTROL
// =====================
app.post("/lights", auth, async (req, res) => {
  try {
    const { device_id, light_id, state, duration } = req.body;

    ensureDevice(device_id);
    const d = devices[device_id];

    handleLightCommand(d, { light_id, state, duration });

    await appendLog({
      device_id,
      type: "light",
      light_id,
      state,
      duration: duration || null,
      time: Date.now()
    });

    dirtyDevices.add(device_id);

    res.json({ ok: true });

  } catch (e) {
    recordMetric("err");
    res.status(400).json({ error: e.message });
  }
});

// =====================
// SENSOR + AI
// =====================
app.post("/data", auth, async (req, res) => {
  try {
    const { device_id, moisture } = req.body;

    ensureDevice(device_id);
    const d = devices[device_id];

    await appendLog({
      device_id,
      type: "moisture",
      value: moisture,
      time: Date.now()
    });

    // simple AI with cooldown
    if (
      moisture < 30 &&
      d.pump === "OFF" &&
      Date.now() - d.aiLastRun > 10 * 60 * 1000 &&
      Date.now() > d.manualLockUntil
    ) {
      d.pump = "ON";
      d.aiLastRun = Date.now();

      recordMetric("ai");

      await appendLog({ device_id, event: "AI_ON", time: Date.now() });
    }

    dirtyDevices.add(device_id);

    res.json({ ok: true });
  } catch (e) {
    recordMetric("err");
    res.status(400).json({ error: e.message });
  }
});

// =====================
// CONTROL READ
// =====================
app.get("/control", auth, (req, res) => {
  try {
    const { device_id } = req.query;
    ensureDevice(device_id);

    res.json({
      ...devices[device_id],
      server_time: Date.now()
    });
  } catch (e) {
    recordMetric("err");
    res.status(400).json({ error: e.message });
  }
});

// =====================
// LOOP 
// =====================
setInterval(() => {
  const currentTime = Date.now(); // ✅ single source of time

  for (let id in devices) {
    const d = devices[id];

    // =====================
    // LIGHT TIMERS
    // =====================
    processLightTimers(id, d, currentTime);

    // =====================
    // PUMP AUTO OFF 
    // =====================
    if (d.activeSession?.ends_at && currentTime >= d.activeSession.ends_at) {
      d.pump = "OFF";
      d.activeSession = null;

      appendLog({
        device_id: id,
        event: "AUTO_OFF",
        time: currentTime
      });
    }

    // =====================
    // SCHEDULE LOGIC (TIMEZONE AWARE)
    // =====================
    if (d.schedule && currentTime > d.manualLockUntil) {
      const t = new Date(currentTime + d.tzOffset * 60000);
      const cur = t.getHours() * 60 + t.getMinutes();

      const [sh, sm] = d.schedule.start_time.split(":").map(Number);
      const [eh, em] = d.schedule.end_time.split(":").map(Number);

      const start = sh * 60 + sm;
      const end = eh * 60 + em;

      const active = start <= end
        ? cur >= start && cur <= end
        : cur >= start || cur <= end;

      // =====================
      // SCHEDULE ON
      // =====================
      if (active && d.pump !== "ON" && currentTime > d.manualLockUntil) {
        d.pump = "ON";

        appendLog({
          device_id: id,
          event: "SCHEDULE_ON",
          time: currentTime
        });
      }

      // =====================
      // SCHEDULE OFF
      // =====================
      if (!active && d.pump !== "OFF" && currentTime > d.manualLockUntil) {
        d.pump = "OFF";

        appendLog({
          device_id: id,
          event: "SCHEDULE_OFF",
          time: currentTime
        });
      }
    }
  }
}, 5000);

// =====================
// FIREBASE (SAFE)
// =====================
setInterval(async () => {
  if (dirtyDevices.size > MAX_DIRTY) return;

  const tasks = [];

  for (let id of dirtyDevices) {
    tasks.push(db.collection("devices").doc(id).set(devices[id]));
  }

  try {
    await Promise.all(tasks);
    dirtyDevices.clear();
  } catch (e) {
    recordMetric("err");
  }
}, 15000);

// =====================
// HEALTH
// =====================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    devices: Object.keys(devices).length,
    metrics: getMetrics()
  });
});

// =====================
// GRACEFUL SHUTDOWN
// =====================
async function shutdown() {
  console.log("Saving before shutdown...");
  await saveState();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// =====================
// START
// =====================
init().then(() => {
  app.listen(3000, () => {
    console.log("🚀 FINAL V4 BACKEND RUNNING");
  });
});
