const express = require("express");
const store = require("../deviceStore");
const metrics = require("../metrics");
const { deviceAuth } = require("../middleware/auth");
const { validateDuration, validateMoisture, validateOnOff } = require("../validation");

const router = express.Router();

// Wraps a route handler so every thrown Error becomes a consistent
// { error: message } 400 response, instead of five copies of the same
// try/catch.
function handler(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  };
}

router.get(
  "/state",
  deviceAuth,
  handler((req, res) => {
    const requestedId = req.headers["x-device-id"];
    const now = Date.now();

    // A specific device asked for its own state.
    if (requestedId) {
      const device = store.getDevice(requestedId);
      if (!device) {
        return res.status(404).json({ error: "Unknown device_id" });
      }
      return res.json({ [requestedId]: store.serialize(device, now) });
    }

    // No x-device-id header: treat this as a dashboard-style request for
    // every device, each shaped through the same serializer.
    const all = store.getAllDevices();
    const result = {};
    for (const id of Object.keys(all)) {
      result[id] = store.serialize(all[id], now);
    }
    res.json(result);
  })
);

router.post(
  "/ping",
  deviceAuth,
  handler((req, res) => {
    const { device_id } = req.body;
    store.recordPing(device_id);
    res.json({ ok: true });
  })
);

router.post(
  "/control",
  deviceAuth,
  handler((req, res) => {
    const { device_id, action, duration, reason } = req.body;
    validateOnOff(action, "action");
    validateDuration(duration);
    store.setPump(device_id, action, { durationSec: duration, reason });
    res.json({ ok: true });
  })
);

router.post(
  "/lights",
  deviceAuth,
  handler((req, res) => {
    const { device_id, light_id, state, duration, reason } = req.body;
    validateOnOff(state, "state");
    validateDuration(duration);
    store.setLight(device_id, light_id, state, { durationSec: duration, reason });
    res.json({ ok: true });
  })
);

router.post(
  "/data",
  deviceAuth,
  handler((req, res) => {
    const { device_id, moisture } = req.body;
    const value = validateMoisture(moisture);
    const { suggestionCreated } = store.recordMoisture(device_id, value);
    if (suggestionCreated) metrics.record("low_moisture_suggestion");
    res.json({ ok: true });
  })
);

router.post(
  "/schedule",
  deviceAuth,
  handler((req, res) => {
    const { device_id, start_time, end_time, enabled } = req.body;
    const schedule = store.setSchedule(device_id, {
      startTime: start_time,
      endTime: end_time,
      enabled,
    });
    res.json({ ok: true, schedule });
  })
);

router.get(
  "/metrics",
  deviceAuth,
  handler((req, res) => {
    res.json(metrics.summary());
  })
);

module.exports = router;
