const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
// =====================
// FIREBASE SETUP
// =====================
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();     // ✅ FIRST create app

app.use(cors());           // ✅ THEN use middleware
app.use(express.json());
// =====================
// CONFIG
// =====================
const DATA_DIR = path.join(__dirname, "data");

const DEVICES_FILE = path.join(DATA_DIR, "devices.json");
const LOGS_FILE = path.join(DATA_DIR, "logs.json");

const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "SECRET123";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const MAX_LIGHTS = 30;

// =====================
// STATE
// =====================
let devices = {};
let logs = {};

// =====================
// SAFE WRITE QUEUE
// =====================
let queue = [];
let writing = false;

async function safeWrite(file, data) {
  const temp = file + ".tmp";
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, file);
}

function enqueueWrite() {
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (writing || queue.length === 0) return;

  writing = true;
  const job = queue.shift();

  try {
    await safeWrite(DEVICES_FILE, devices);
    await safeWrite(LOGS_FILE, logs);
    job.resolve();
  } catch (err) {
    job.reject(err);
  } finally {
    writing = false;
    processQueue();
  }
}

// =====================
// INIT
// =====================
async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    devices = JSON.parse(await fs.readFile(DEVICES_FILE));
  } catch {
    devices = {};
  }

  try {
    logs = JSON.parse(await fs.readFile(LOGS_FILE));
  } catch {
    logs = {};
  }

  recoverState();
}

// =====================
// HELPERS
// =====================
function now() {
  return Date.now();
}

function ensureDevice(id) {
  if (!devices[id]) {
    devices[id] = {
      pump: "OFF",
      lights: {
  light_1: "OFF",
  light_2: "OFF",
  light_3: "OFF",
  light_4: "OFF",
  light_5: "OFF",
  light_6: "OFF",
  light_7: "OFF",
  light_8: "OFF",
  light_9: "OFF",
  light_10: "OFF"
},
      allLights: "OFF",
      activeSession: null,
      schedule: null,
      manualOverrideUntil: null,
      lastSeen: null
    };
  }

  if (!logs[id]) {
    logs[id] = {
      moisture: [],
      pumpEvents: [],
      lightEvents: []
    };
  }
}

function cleanOld(arr) {
  const cutoff = now() - SEVEN_DAYS;
  return arr.filter(e => e.time >= cutoff);
}

// =====================
// VALIDATION
// =====================
function isValidMoisture(m) {
  return typeof m === "number" && m >= 0 && m <= 100;
}

function isValidDuration(d) {
  return typeof d === "number" && d > 0 && d <= 21600;
}

function isValidTime(t) {
  return /^\d{2}:\d{2}$/.test(t);
}

function isValidLightId(id) {
  return typeof id === "string" &&
    id.length > 0 &&
    id.length < 30 &&
    /^[a-zA-Z0-9_]+$/.test(id);
}

// =====================
// AUTH
// =====================
function auth(req, res, next) {
  if (req.headers["x-device-token"] !== DEVICE_TOKEN) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

// =====================
// CRASH RECOVERY
// =====================
function recoverState() {
  const current = now();

  for (let id in devices) {
    const d = devices[id];

    if (d.activeSession?.ends_at && current >= d.activeSession.ends_at) {
      d.pump = "OFF";
      d.activeSession = null;
    }
  }
}

// =====================
// SENSOR DATA
// =====================
app.post("/data", auth, async (req, res) => {
  const { device_id, moisture } = req.body;

  if (!device_id || !isValidMoisture(moisture)) {
    return res.status(400).json({ error: "Invalid input" });
  }

  ensureDevice(device_id);

  logs[device_id].moisture.push({
    value: moisture,
    time: now()
  });

  logs[device_id].moisture = cleanOld(logs[device_id].moisture);

  devices[device_id].lastSeen = now();

  await enqueueWrite();

  res.json({ ok: true });
});

// =====================
// PUMP CONTROL 
// =====================
app.get("/control", auth, async (req, res) => {
  const { device_id } = req.query;

  if (!device_id) {
    return res.status(400).json({ error: "device_id required" });
  }

  ensureDevice(device_id);
  const d = devices[device_id];

  try {
    const doc = await db.collection("devices").doc(device_id).get();

    if (doc.exists) {
      const data = doc.data();

      d.pump = data.pump || d.pump;
      d.lights = data.lights || d.lights;
      d.allLights = data.allLights || d.allLights;
    }

  } catch (err) {
    console.error("Firestore fetch failed:", err);
  }

  res.json({
    pump: d.pump,
    lights: d.lights,
    allLights: d.allLights,
    activeSession: d.activeSession,
    schedule: d.schedule,
    server_time: now()
  });
});

  try {

    // =====================
    // TURN ON
    // =====================
    if (action === "ON") {
      let endsAt = null;

      if (duration) {
        if (!isValidDuration(duration)) {
          return res.status(400).json({ error: "Invalid duration" });
        }
        endsAt = now() + duration * 1000;
      }

      if (d.pump !== "ON") {
        d.pump = "ON";

        const event = { event: "ON", time: now() };
        logs[device_id].pumpEvents.push(event);

        // 🔥 FIREBASE WRITE (ONLY ONCE)
        await db.collection("devices").doc(device_id).set({
          pump: "ON"
        }, { merge: true });

        await db.collection("logs").doc(device_id).set({
          pumpEvents: admin.firestore.FieldValue.arrayUnion(event)
        }, { merge: true });
      }

      d.activeSession = {
        started_at: now(),
        ends_at: endsAt
      };

      d.manualOverrideUntil = now() + 6 * 60 * 60 * 1000;
    }

    // =====================
    // TURN OFF
    // =====================
    if (action === "OFF") {
      if (d.pump !== "OFF") {
        d.pump = "OFF";

        const event = { event: "OFF", time: now() };
        logs[device_id].pumpEvents.push(event);

        // 🔥 FIREBASE WRITE (ONLY ONCE)
        await db.collection("devices").doc(device_id).set({
          pump: "OFF"
        }, { merge: true });

        await db.collection("logs").doc(device_id).set({
          pumpEvents: admin.firestore.FieldValue.arrayUnion(event)
        }, { merge: true });
      }

      d.activeSession = null;
      d.manualOverrideUntil = now() + 6 * 60 * 60 * 1000;
    }

    // =====================
    // SCHEDULE
    // =====================
    if (start_time && end_time) {
      if (!isValidTime(start_time) || !isValidTime(end_time)) {
        return res.status(400).json({ error: "Invalid time format" });
      }

      d.schedule = { start_time, end_time };
    }

    await enqueueWrite();

    res.json({ ok: true, device: d });

  } catch (err) {
    console.error("Firebase error:", err);
    res.status(500).json({ error: "Firebase failed" });
  }
});
// =====================
// LIGHT CONTROL
// =====================
app.post("/lights", auth, async (req, res) => {
  const { device_id, all_lights, light_id, state, add_light } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: "device_id required" });
  }

  ensureDevice(device_id);
  const d = devices[device_id];

  if (add_light) {
    if (!isValidLightId(add_light)) {
      return res.status(400).json({ error: "Invalid light id" });
    }

    if (Object.keys(d.lights).length >= MAX_LIGHTS) {
      return res.status(400).json({ error: "Max lights reached" });
    }

    if (!d.lights[add_light]) {
      d.lights[add_light] = "OFF";
    }
  }

  if (all_lights) {
    if (!["ON", "OFF"].includes(all_lights)) {
      return res.status(400).json({ error: "Invalid value" });
    }

    for (let l in d.lights) {
      if (d.lights[l] !== all_lights) {
        d.lights[l] = all_lights;
        logs[device_id].lightEvents.push({ light: l, state: all_lights, time: now() });
      }
    }
  }

  if (light_id && state) {
    if (!isValidLightId(light_id) || !["ON", "OFF"].includes(state)) {
      return res.status(400).json({ error: "Invalid input" });
    }

    if (!d.lights[light_id]) {
      return res.status(400).json({ error: "Light not found" });
    }

    if (d.lights[light_id] !== state) {
      d.lights[light_id] = state;
      logs[device_id].lightEvents.push({ light: light_id, state, time: now() });
    }
  }

  const values = Object.values(d.lights);

  if (values.length === 0) d.allLights = "OFF";
  else if (values.every(v => v === "ON")) d.allLights = "ON";
  else if (values.every(v => v === "OFF")) d.allLights = "OFF";
  else d.allLights = "MIXED";

  logs[device_id].lightEvents = cleanOld(logs[device_id].lightEvents);

  await enqueueWrite();

  res.json({
    ok: true,
    lights: d.lights,
    allLights: d.allLights
  });
});

// =====================
// DEVICE POLL
// =====================
app.get("/control", auth, (req, res) => {
  const { device_id } = req.query;

  if (!device_id) {
    return res.status(400).json({ error: "device_id required" });
  }

  ensureDevice(device_id);
  const d = devices[device_id];

  res.json({
    pump: d.pump,
    lights: d.lights,
    allLights: d.allLights,
    activeSession: d.activeSession,
    schedule: d.schedule,
    server_time: now()
  });
});

// =====================
// LOOP
// =====================
function isWithinSchedule(start, end, current) {
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

setInterval(async () => {
  const current = now();

  for (let id in devices) {
    const d = devices[id];

    if (d.activeSession?.ends_at && current >= d.activeSession.ends_at) {
      d.pump = "OFF";
      d.activeSession = null;
      logs[id].pumpEvents.push({ event: "AUTO_OFF", time: current });
    }

    if (d.schedule && (!d.manualOverrideUntil || current > d.manualOverrideUntil)) {
      const nowDate = new Date();
      const cur = nowDate.getHours() * 60 + nowDate.getMinutes();

      const [sh, sm] = d.schedule.start_time.split(":").map(Number);
      const [eh, em] = d.schedule.end_time.split(":").map(Number);

      const start = sh * 60 + sm;
      const end = eh * 60 + em;

      const active = isWithinSchedule(start, end, cur);

      if (active && d.pump !== "ON") {
        d.pump = "ON";
        logs[id].pumpEvents.push({ event: "SCHEDULE_ON", time: current });
      }

      if (!active && d.pump !== "OFF") {
        d.pump = "OFF";
        logs[id].pumpEvents.push({ event: "SCHEDULE_OFF", time: current });
      }
    }

    logs[id].pumpEvents = cleanOld(logs[id].pumpEvents);
  }

  await enqueueWrite();
}, 5000);

// =====================
// START
// =====================
init().then(() => {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log("🚀 Backend running on", PORT);
  });
});
