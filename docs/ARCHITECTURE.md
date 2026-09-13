# Architecture

## Overview

```
                     HTTPS (poll /state every 1s, POST /data every 10s)
Arduino R4 WiFi  ───────────────────────────────────────────────────▶  Node.js backend
(pump + 3 lights                                                       (Express API)
 + moisture sensor)  ◀───────────────────────────────────────────────  │
                          relay/light targets in /state response       │
                                                                        ▼
                                                              data/devices.json
                                                              data/events.ndjson
```

The Arduino is a dumb, poll-driven client: once a second it asks the
backend "what should pump/L1/L2/L3 be right now?" and sets its relays to
match. Separately, every 10 seconds it reports a soil moisture reading.
All actual decision-making — manual commands, schedules, auto-off timers —
happens on the backend; the firmware has no state of its own beyond "what
did the server say last."

## Why HTTP polling instead of MQTT

An earlier version of this project connected the backend to a HiveMQ Cloud
MQTT broker and published control commands to it, but the firmware never
subscribed to anything — it only ever polled `/state` over HTTP. MQTT was
fully wired up on the backend side and did nothing, while adding an extra
external dependency (the broker) that could fail on its own and was a
likely source of noisy connection/auth errors in the server logs.

This version drops MQTT entirely. A 1-second poll interval already gives
control latency in the ~0-1s range, which is more than adequate for a pump
and grow lights — there's no user-perceptible benefit to push-based control
here, and one fewer moving part is one fewer thing that can silently break.

If you later want genuinely instant control (e.g. for a much larger number
of devices where per-device polling load becomes a real cost), the
backend's device store (`src/deviceStore.js`) is decoupled from the HTTP
layer specifically so an MQTT (or WebSocket) transport could be added
alongside `/state` without restructuring the state logic.

## Backend design

```
src/
  config.js          Reads env vars + all tunable constants. No side effects.
  logger.js           Minimal timestamped console logger.
  validation.js        Pure input validators (unit tested).
  metrics.js           In-memory rolling counters for /metrics.
  eventLog.js          Batched, rotated append-only event log (events.ndjson).
  deviceStore.js       The device state machine: create/update devices,
                        apply schedules, expire timers, persist to disk.
  middleware/auth.js    Device-token check (constant-time compare).
  routes/devices.js     HTTP -> deviceStore glue. Thin — no business logic.
  app.js                Express app wiring (middleware, routes, error handling).
  index.js              Process lifecycle: startup, background intervals,
                        graceful shutdown, crash handling.
server.js               One-line entry point (require("./src/index.js")).
```

Each device's **internal** record (timers, lock windows, cooldowns) is
never returned directly by the API — `deviceStore.serialize()` maps it to a
smaller public shape (`status`, `pump`, `lights`, `moisture`, `schedule`,
`lastSuggestion`). This matters for a poll-based firmware client: without
it, `/state` for an unregistered device previously fell back to dumping
*every* device's full internal state to whichever board asked, which both
leaked data across devices and risked overflowing the firmware's small
fixed JSON parse buffer as more devices were added. `/state` for an unknown
`device_id` now returns a plain `404`.

## Persistence

Device state lives in memory and is flushed to `data/devices.json` on a
dirty-flag timer (every 15s) and on clean shutdown, using a write-to-temp
-file + atomic rename so a crash mid-write can't corrupt the state file.
Timers are stored as absolute wall-clock deadlines (`endsAt`), so on
restart any timer that expired while the process was down is resolved
immediately instead of leaving something stuck ON.

Events (device created, pump on/off, schedule changes, crashes) are
appended to `data/events.ndjson`, batched and rotated by size (5 rotated
files kept) so the log can't grow unbounded.

## Security model

A single shared `DEVICE_TOKEN` (sent as the `x-device-token` header) gates
every route except `/healthz`. This is intentionally simple for a
single-household deployment with one or a handful of trusted boards; it is
**not** meant to scale to a multi-tenant service. The server refuses to
start at all if `DEVICE_TOKEN` isn't set — there is no default/fallback
value baked into the code.
