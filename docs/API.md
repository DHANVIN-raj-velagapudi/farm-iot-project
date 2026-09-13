# API Reference

Base URL: wherever the backend is deployed (e.g.
`https://your-app.up.railway.app`).

Every endpoint except `GET /healthz` requires an `x-device-token` header
matching the server's `DEVICE_TOKEN` env var. A missing or wrong token
returns `403 { "error": "Unauthorized" }`.

Every `POST` request must send `Content-Type: application/json`, or the
server returns `415 { "error": "Content-Type must be application/json" }`.

Any validation failure returns `400 { "error": "<reason>" }`.

---

## `GET /healthz`

No auth required. For platform health checks.

```json
{ "status": "ok", "uptimeSec": 4213 }
```

---

## `GET /state`

Headers:
- `x-device-token` (required)
- `x-device-id` (optional) — if present, returns just that device's state.

**With `x-device-id`:**

```json
{
  "Device_1": {
    "status": "online",
    "lastSeen": 1732000000000,
    "pump": "ON",
    "lights": { "L1": "OFF", "L2": "OFF", "...": "..." },
    "moisture": 42,
    "schedule": { "startTime": "06:00", "endTime": "08:00" },
    "lastSuggestion": { "message": "Low moisture detected.", "time": 1732000000000 }
  }
}
```

If `x-device-id` refers to a device the server has never seen, this
returns `404 { "error": "Unknown device_id" }` — it does **not** fall back
to returning every device.

`moisture` is `"OFFLINE"` if no reading has arrived in the last 5 minutes.

**Without `x-device-id`** (used by a dashboard): returns every known
device, each shaped the same way, keyed by device ID.

---

## `POST /ping`

Marks a device as alive without changing anything else. Body:

```json
{ "device_id": "Device_1" }
```

`{ "ok": true }`

---

## `POST /control` — pump

```json
{ "device_id": "Device_1", "action": "ON", "duration": 300, "reason": "manual" }
```

- `action`: `"ON"` or `"OFF"` (required)
- `duration`: seconds, `0`-`3600` (optional). If set with `action: "ON"`,
  the pump auto-turns-off after this many seconds.
- `reason`: free-text, stored in the event log (optional, defaults to `"manual"`)

A manual command locks out the schedule for a short window afterwards (10
minutes after ON, 2 minutes after OFF) so a schedule tick doesn't
immediately override what you just did.

---

## `POST /lights`

```json
{ "device_id": "Device_1", "light_id": "L1", "state": "ON", "duration": 60 }
```

- `light_id`: `"L1"` through `"L10"`
- `state`: `"ON"` or `"OFF"`
- `duration`: seconds (optional) — auto-off after this long if `state: "ON"`

---

## `POST /data` — moisture reading

```json
{ "device_id": "Device_1", "moisture": 45 }
```

`moisture` must be `0`-`100`. If it drops below 30 (and no suggestion has
fired in the last 10 minutes), the device's `lastSuggestion` field is set
to a low-moisture hint, visible via `/state`.

---

## `POST /schedule`

```json
{ "device_id": "Device_1", "start_time": "06:00", "end_time": "08:00" }
```

Times are `"HH:mm"`, 24-hour, evaluated against UTC. `start_time` >
`end_time` is treated as an overnight window (e.g. `22:00`-`06:00`).

To disable: `{ "device_id": "Device_1", "enabled": false }`.

---

## `GET /metrics`

Rolling counters (requests, auth failures, low-moisture suggestions
triggered) for basic operational visibility.

```json
{
  "total": 812,
  "byType": { "request": 800, "auth_failure": 3, "low_moisture_suggestion": 9 },
  "recent": [ { "type": "request", "time": 1732000000000 } ]
}
```
