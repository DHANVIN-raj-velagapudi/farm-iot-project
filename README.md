🌱 Smart IoT Farm Backend

A production-ready Node.js backend for IoT irrigation systems, built for reliability, control, and real-world deployment.

Designed for ESP32/NodeMCU devices, supporting pump automation, multi-channel lighting, and intelligent decision support.

🚀 Key Features
Manual-first pump control with timer support
10-channel light system with independent timers
AI-powered suggestions (no forced automation)
High-performance logging system with auto-rotation
Non-blocking Firestore sync
Safe state management with atomic writes
Built-in rate limiting for stability
⚡ Quick Start
git clone https://github.com/YOUR_USERNAME/farm-iot-backend.git
cd farm-iot-backend
npm install
mkdir data
export DEVICE_TOKEN=SECRET123
export FIREBASE_KEY='{}'
npm start

Server → http://localhost:3000

🧪 Test API (Working Example)
Turn Pump ON
curl -X POST http://localhost:3000/control \
-H "Content-Type: application/json" \
-H "x-device-token: SECRET123" \
-d '{
  "device_id": "farm_1",
  "action": "ON",
  "duration": 10
}'

Response:

{ "ok": true }
📡 API Overview
/data → Sensor Input
{
  "device_id": "farm_1",
  "moisture": 45
}
/control → Pump Control
{
  "device_id": "farm_1",
  "action": "ON",
  "duration": 60
}
/lights → Light Control
{
  "device_id": "farm_1",
  "light_id": "L1",
  "state": "ON",
  "duration": 120
}
/state → Debug State

Returns full system state.

🧠 System Design
Hybrid storage (RAM + JSON + logs + Firestore)
Background processing loop (5s)
Timer + manual + schedule priority system
Append-only logging for reliability
⚙️ Behavior Rules

Priority:

Timer
Manual
Schedule
📌 Project Status

This project is currently Version 1.0.

Actively evolving to support:

Multi-device architecture
Enhanced security
Scalable database systems
⚠️ Limitations
Designed for single-device setups
File-based storage (not horizontally scalable)
Basic token-based authentication
⚠️ Disclaimer

This project is provided as-is.

The author is not responsible for:

Hardware damage
Crop loss
Misuse or incorrect deployment

Use responsibly in real-world environments.

⚙️ Requirements
Runtime
Node.js >= 18
npm (comes with Node)
Environment Variables

You must configure the following:

DEVICE_TOKEN=your_secure_token
FIREBASE_KEY=your_firebase_service_account_json
Storage
Persistent file system required
Used for:
devices.json (state)
logs.ndjson (logs)
Hardware (Typical Setup)
ESP32 / NodeMCU
Relay module (for pump control)
Moisture sensor
Lights (optional channels L1–L10)
☁️ Deployment

This backend is platform-independent and can run on any Node.js environment.

🟢 Option 1 — Local / VPS
git clone https://github.com/YOUR_USERNAME/farm-iot-backend.git
cd farm-iot-backend
npm install
mkdir data
npm start
🟡 Option 2 — Render

Steps:

Create a new Web Service
Connect your GitHub repo
Set:
Build Command: npm install
Start Command: npm start
Add Environment Variables:
DEVICE_TOKEN
FIREBASE_KEY
Deploy

👉 Recommended for quick production setup

🔵 Option 3 — Fly.io

Requirements:

Fly CLI installed
Volume for persistent storage

Steps:

fly launch
fly volumes create data_vol --size 1
fly deploy

⚠️ Important:

Mount volume to /data
Ensure logs + state are persistent
🟣 Option 4 — Docker (Optional)
FROM node:18

WORKDIR /app
COPY . .

RUN npm install

CMD ["npm", "start"]

Run:

docker build -t farm-backend .
docker run -p 3000:3000 farm-backend

# 📌 Project Status

This project is currently **Version 1.0 (V1)**.

It is fully functional and stable for single-device use, but ongoing improvements are planned.

Future updates may include:
- Multi-device support
- Improved security (token rotation, per-device auth)
- Scalable storage (database integration)
- Advanced analytics and monitoring

👉 This project will continue evolving to better support real-world deployment scenarios.

# ⚠️ Disclaimer

This project is provided **"AS IS"**, without any warranties or guarantees of any kind.

By using this software, you agree that:

- The author is **not responsible for any hardware damage**
- The author is **not responsible for crop loss, water misuse, or financial loss**
- The author is **not responsible for system failures, bugs, or unexpected behavior**

---

## 🚫 Use at Your Own Risk

This system interacts with **real-world hardware (pumps, electrical systems, irrigation setups)**.

Improper use, misconfiguration, or software failure can result in:

- Overwatering or underwatering
- Pump damage
- Electrical issues
- Crop damage or complete loss

---

## 🧠 Responsibility

You are fully responsible for:

- Testing the system before real deployment  
- Adding proper electrical protection (relays, fuses, fail-safes)  
- Monitoring system behavior in production  

---

👉 If you are not confident in handling real-world IoT systems, **do not deploy this in a live farm environment without supervision**.

👨‍💻 Author

VELAGAPUDI DHANVIN RAJ
