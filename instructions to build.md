# 🌱 COMPLETE BACKEND SETUP (BEGINNER GUIDE)

This guide explains **how to take your backend code → host it online → connect it to MQTT → make it work with your Arduino**

---

# 🧠 WHAT YOU ARE BUILDING

```text
Your laptop → GitHub → Railway (cloud server)
                             ↓
                         MQTT broker
                             ↓
                         Arduino
```

---

# 🔥 STEP 1 — CREATE GITHUB REPOSITORY

## 1. Go to:

https://github.com

## 2. Click:

```text
New Repository
```

## 3. Fill:

```text
Name: farm-iot-backend
Public: YES
```

## 4. Click:

```text
Create Repository
```

---

# 🔥 STEP 2 — UPLOAD YOUR CODE

## Option A (Easiest — Drag & Drop)

1. Open your repo
2. Click:

```text
Upload files
```

3. Drag these files:

```text
server.js
package.json
```

4. Click:

```text
Commit changes
```

---

## Option B (Better — Git)

Open terminal:

```bash
git init
git add .
git commit -m "initial backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/farm-iot-backend.git
git push -u origin main
```

---

# 🔥 STEP 3 — CREATE RAILWAY PROJECT

## 1. Go to:

https://railway.app

## 2. Click:

```text
Login with GitHub
```

---

## 3. Click:

```text
New Project → Deploy from GitHub Repo
```

---

## 4. Select your repo:

```text
farm-iot-backend
```

---

👉 Railway will now:

* detect Node.js
* install dependencies
* run your server

---

# 🔥 STEP 4 — FIX PORT (IMPORTANT)

Open your `server.js`

Find:

```js
app.listen(3000);
```

---

Replace with:

```js
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 IOT BACKEND ONLINE ON PORT", PORT);
});
```

---

👉 Why?
Railway gives dynamic port — not always 3000

---

# 🔥 STEP 5 — ADD ENV VARIABLES (VERY IMPORTANT)

In Railway dashboard:

## Go to:

```text
Project → Variables
```

---

## Add:

```text
MQTT_USER = dhanvin_raj
MQTT_PASS = your_password_here
```

---

👉 Why?
Never hardcode passwords in code

---

# 🔥 STEP 6 — GENERATE DOMAIN

In Railway:

Click:

```text
Settings → Networking → Generate Domain
```

---

You will get:

```text
https://your-app-name.up.railway.app
```

---

# 🔥 STEP 7 — TEST BACKEND

Open browser:

```text
https://your-app-name.up.railway.app/state
```

---

👉 If working:

* you see JSON
* server is live

---

# 🔥 STEP 8 — CONNECT MQTT (ALREADY IN YOUR CODE)

Your backend already does:

```js
mqttClient.publish("Device_1/pump", "ON");
```

---

👉 This sends commands instantly to Arduino

---

# 🔥 STEP 9 — HOW DATA FLOWS

## Example 1 (Pump ON)

```text
App → backend → MQTT → Arduino → relay ON
```

---

## Example 2 (Moisture)

```text
Arduino → HTTP (/data) → backend → stored
```

---

## Example 3 (Offline detection)

```text
No moisture for 5 min → backend shows OFFLINE
```

---

# 🔥 COMMON ERRORS (DON’T PANIC)

---

## ❌ Error: build failed

👉 Fix:

```text
Check package.json commas
```

---

## ❌ Error: MQTT not connecting

👉 Fix:

```text
Check username/password in env
```

---

## ❌ Error: app not starting

👉 Fix:

```text
Make sure "start": "node server.js"
```

---

# 💀 BRUTAL TRUTH

If this part is wrong:

```text
Everything else fails
```

Backend = brain of system

---

# 🚀 FINAL RESULT

After this setup:

```text
✔ Backend online 24/7
✔ MQTT connected
✔ Arduino controlled remotely
✔ Moisture data stored
✔ Dashboard works
```

---

# 🔥 NEXT STEP

After this is working:

```text
Connect Arduino → test real-time control
```
