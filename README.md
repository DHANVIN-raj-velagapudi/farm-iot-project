# 🌱 Smart IoT Farm Backend

A real-world IoT backend for controlling irrigation pumps and multiple lights using ESP32 and a Node.js server.

---

# 🚀 Features

* Pump control (manual + timer + schedule)
* Multi-light control (individual + all)
* Conflict-safe logic (timer > manual > schedule)
* 7-day data retention
* JSON-based storage (no database)
* Fly.io deployment ready

---

# ⚠️ Current Limitation

* Multi-device (multiple farms) is **not fully supported yet**
* Current system works for **one physical unit with multiple actuators**
* Multi-farm support will be added later

---

# 🛠️ Setup Instructions

## 1. Clone repo

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

## 5. Authentication

All requests require header:

```json
x-device-token: SECRET123
```

---

# 📡 API Documentation

---

## 1. Send Sensor Data

### POST `/data`

```json
{
  "device_id": "farm_1",
  "moisture": 45
}
```

---

## 2. Pump Control

### POST `/control`

### Turn ON with timer (example: 1 hour)

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

## 3. Lights Control

### Add light

```json
{
  "device_id": "farm_1",
  "add_light": "light_1"
}
```

---

### Turn all ON

```json
{
  "device_id": "farm_1",
  "all_lights": "ON"
}
```

---

### Control single light

```json
{
  "device_id": "farm_1",
  "light_id": "light_1",
  "state": "OFF"
}
```

---

## 4. Device Poll (ESP)

### GET `/control?device_id=farm_1`

### Response:

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

# ⚙️ System Behavior (IMPORTANT)

## Priority Rules

1. Timer (highest priority)
2. Manual control
3. Schedule (lowest)

---

### Example 1

* Schedule ON
* User presses OFF

👉 Pump stays OFF (manual override)

---

### Example 2

* Timer active
  👉 Schedule is ignored

---

---

# 💡 Lights Behavior

* Supports unlimited lights (max 30)
* `allLights` values:

  * `ON` → all lights ON
  * `OFF` → all lights OFF
  * `MIXED` → some ON, some OFF

---

---

# 🧠 Architecture Overview

## Storage

### devices.json

* Current state (pump, lights, schedule)

### logs.json

* Moisture history
* Pump events
* Light events

---

## Backend Logic

* Write queue → prevents file corruption
* Atomic writes → safe storage
* Background loop (every 5 sec):

  * checks timer expiry
  * handles schedule

---

---

# ☁️ Deployment

Backend is designed for:

* Fly.io deployment
* Persistent storage via volume

---

# 👨‍💻 Author

**VELAGAPUDI DHANVIN RAJ**

* Web Developer
* IoT Project Builder
* Android App Developer

📺 YouTube: https://www.youtube.com/@TeluguCircuitLab
👉 Follow for project tutorials and real-world builds (Telugu with english subtitles support)
