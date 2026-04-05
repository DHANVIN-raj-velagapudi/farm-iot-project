# 🌱 Farm IoT Backend (Pump + Lights + Moisture)

A real-time IoT backend for controlling farm devices (pump, lights) and monitoring soil moisture using **MQTT + HTTP hybrid system**.

---

## 🚀 Features

* ⚡ Real-time control using MQTT (no delay)
* 💧 Soil moisture monitoring (HTTP updates)
* 🔄 Device status tracking (ONLINE / OFFLINE)
* 💡 Multi-light control (L1, L2, L3…)
* 🛑 Fail-safe support (device auto-off if offline)
* 📊 Dashboard-ready API

---

## 🧠 Architecture

```
Mobile App / Dashboard
        ↓
     Backend (Node.js)
        ↓
   MQTT Broker (HiveMQ / Public)
        ↓
      Arduino (R4 WiFi)
        ↓
 Pump + Lights + Sensor
```

---

## 📦 Installation

```bash
git clone <your-repo>
cd farm-iot-backend
npm install
```

---

## ▶️ Run Server

```bash
npm start
```

---

## 🌐 Environment (Recommended)

Set environment variables:

```
MQTT_USER=your_username
MQTT_PASS=your_password
PORT=3000
```

---

## 🔌 API Endpoints

### 1. Ping (keep device alive)

```
POST /ping
```

Body:

```json
{
  "device_id": "Device_1"
}
```

---

### 2. Control Pump

```
POST /control
```

Body:

```json
{
  "device_id": "Device_1",
  "action": "ON"
}
```

---

### 3. Control Lights

```
POST /lights
```

Body:

```json
{
  "device_id": "Device_1",
  "light_id": "L1",
  "state": "ON"
}
```

---

### 4. Send Moisture Data

```
POST /data
```

Body:

```json
{
  "device_id": "Device_1",
  "moisture": 45
}
```

---

### 5. Get State

```
GET /state
```

Response:

```json
{
  "Device_1": {
    "pump": "ON",
    "lights": {
      "L1": "OFF"
    },
    "moisture": 45
  }
}
```

---

## ⚡ MQTT Topics

| Action | Topic               | Payload  |
| ------ | ------------------- | -------- |
| Pump   | `Device_1/pump`     | ON / OFF |
| Light  | `Device_1/light/L1` | ON / OFF |

---

## 🧪 Device Status Logic

* Moisture updated within **5 min** → shows value
* No update > 5 min → shows `"OFFLINE"`

---

## ☁️ Deployment

Tested on:

* Railway ✅
* Render ✅

---

## ⚠️ Notes

* MQTT handles **real-time control**
* HTTP handles **data + keep-alive**
* Arduino R4 works best **without SSL (HTTP + MQTT 1883)**

---

## 🧑‍💻 Author

**Velagapudi Dhanvin Raj**

---

## 🔥 Future Scope

* Auto irrigation (based on moisture)
* Alerts & notifications
* Multi-device scaling
* AI-based watering decisions

---
