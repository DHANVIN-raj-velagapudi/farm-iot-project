# 🌱 Smart IoT Farm Backend

A real-world IoT backend for controlling irrigation pumps and multiple lights using ESP32 and a Node.js server.

---

# 🚀 Features

* Pump control (manual + timer + schedule)
* Multi-light control (individual + all)
* Conflict-safe logic (timer > manual > schedule)
* 7-day data retention
* JSON-based storage (no database)
* Platform-independent deployment (Fly.io, Render, VPS, etc.)

---

# ⚠️ Current Limitation

* Multi-device (multiple farms) is **not fully supported yet**
* Currently designed for **one physical unit with multiple actuators**
* Multi-farm support will be added in future versions

---

# 📁 Project Structure

```
project/
│── server.js
│── package.json
│── fly.toml
│── .gitignore
│
├── data/
│    ├── devices.json
│    ├── logs.json
```

* `devices.json` → current system state
* `logs.json` → historical data

---

# 🛠️ Setup Instructions

## 1. Clone repository

```bash
git clone https://github.com/YOUR_USERNAME/farm-iot-project.git
cd farm-iot-project
```

---

## 2. Install dependencies

```bash
npm install
```

---

## 3. Create data folder

```bash
mkdir data
```

---

## 4. Run server

```bash
node server.js
```

---

# 🔐 Authentication

All requests require header:

```
x-device-token: SECRET123
```

## ⚙️ Changing the Token

Update this in `server.js`:

```js
const DEVICE_TOKEN = "YOUR_SECRET_TOKEN";
```

👉 For production, use environment variables instead of hardcoding.

---

# 📡 API Documentation

---

## 1. Send Sensor Data

### POST `/data`

**Request:**

```json
{
  "device_id": "farm_1",
  "moisture": 45
}
```

**Response:**

```json
{
  "ok": true
}
```

---

## 2. Pump Control

### POST `/control`

### Turn ON with timer (1 hour)

```json
{
  "device_id": "farm_1",
  "action": "ON",
  "duration": 3600
}
```

---

### Turn OFF

```json
{
  "device_id": "farm_1",
  "action": "OFF"
}
```

---

### Schedule

```json
{
  "device_id": "farm_1",
  "start_time": "14:00",
  "end_time": "16:00"
}
```

---

### Response:

```json
{
  "ok": true,
  "device": {
    "pump": "ON",
    "activeSession": {
      "started_at": 1710000000,
      "ends_at": 1710003600
    }
  }
}
```

---

## 3. Lights Control

### Add Light

```json
{
  "device_id": "farm_1",
  "add_light": "light_1"
}
```

---

### Turn All Lights ON

```json
{
  "device_id": "farm_1",
  "all_lights": "ON"
}
```

---

### Control Single Light

```json
{
  "device_id": "farm_1",
  "light_id": "light_1",
  "state": "OFF"
}
```

---

### Response:

```json
{
  "ok": true,
  "lights": {
    "light_1": "ON",
    "light_2": "OFF"
  },
  "allLights": "MIXED"
}
```

---

## 4. Device Poll (ESP)

### GET `/control?device_id=farm_1`

**Response:**

```json
{
  "pump": "ON",
  "lights": {
    "light_1": "ON"
  },
  "allLights": "ON",
  "activeSession": {
    "started_at": 1710000000,
    "ends_at": 1710003600
  },
  "schedule": {
    "start_time": "14:00",
    "end_time": "16:00"
  }
}
```

---

# ⚡ Quick Test (cURL)

### Send moisture data

```bash
curl -X POST http://localhost:3000/data \
-H "Content-Type: application/json" \
-H "x-device-token: SECRET123" \
-d '{
  "device_id": "farm_1",
  "moisture": 50
}'
```

---

### Turn pump ON

```bash
curl -X POST http://localhost:3000/control \
-H "Content-Type: application/json" \
-H "x-device-token: SECRET123" \
-d '{
  "device_id": "farm_1",
  "action": "ON",
  "duration": 60
}'
```

---

# ⚙️ System Behavior

## Priority Rules

1. Timer (highest priority)
2. Manual control
3. Schedule (lowest priority)

---

### Example 1

* Schedule ON
* User presses OFF

👉 Pump remains OFF (manual override)

---

### Example 2

* Timer active
  👉 Schedule is ignored

---

# 💡 Lights Behavior

* Supports dynamic lights (max 30)
* `allLights` values:

  * `ON` → all lights ON
  * `OFF` → all lights OFF
  * `MIXED` → partial ON/OFF

---

# 🧠 Architecture Overview

## Storage

* `devices.json` → current system state
* `logs.json` → historical logs

## Backend Logic

* Write queue → prevents data corruption
* Atomic writes → safe file updates
* Background loop (every 5 seconds):

  * Handles timer expiry
  * Applies schedule logic

---

# ☁️ Deployment

This backend is platform-independent and can run on:

* Fly.io
* Render
* Railway
* VPS (Node.js)
* Docker

---

## ⚙️ Requirements

* Node.js (v18+ recommended)
* Persistent storage (for JSON files)

---

## 📦 Important Notes

### PORT configuration

```js
const PORT = process.env.PORT || 3000;
```

---

### Persistent storage (CRITICAL)

If using platforms with ephemeral storage:

* Fly.io → use volumes (`/data`)
* Render → use disk storage
* VPS → no changes required

---

### Storage path

```js
const DATA_DIR = process.env.NODE_ENV === "production"
  ? "/data"
  : "./data";
```

---

# 🗄️ Optional: Database Upgrade

You can replace JSON storage with:

* MongoDB
* PostgreSQL
* Firebase / Supabase

---

### Required changes:

* Remove file write logic
* Replace with database queries

---

### Mapping:

| JSON         | Database      |
| ------------ | ------------- |
| devices.json | devices table |
| logs.json    | logs table    |

---

# 👨‍💻 Author

**VELAGAPUDI DHANVIN RAJ**

* Web Developer
* IoT Project Builder
* Android App Developer

📺 YouTube: https://www.youtube.com/@TeluguCircuitLab
👉 Follow for project tutorials and real-world builds (Telugu with English subtitle support)
