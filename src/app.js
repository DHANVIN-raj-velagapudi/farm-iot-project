const express = require("express");
const cors = require("cors");
const { JSON_BODY_LIMIT } = require("./config");
const deviceRoutes = require("./routes/devices");
const logger = require("./logger");

function createApp() {
  const app = express();

  app.use(cors());
  // A single, correctly-sized JSON body parser. (An earlier version of this
  // file registered express.json() twice — once with no size limit and
  // once with a 10kb limit — and since body-parser skips re-parsing an
  // already-parsed body, the size limit never actually applied.)
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Anything that isn't GET must declare a JSON content-type. express.json()
  // silently leaves req.body undefined for a non-JSON content-type instead
  // of erroring, so routes would otherwise fail with a confusing
  // "Cannot destructure ... of undefined" instead of a clear 415.
  app.use((req, res, next) => {
    if (req.method === "GET") return next();
    if (!req.is("application/json")) {
      return res.status(415).json({ error: "Content-Type must be application/json" });
    }
    next();
  });

  // Unauthenticated liveness check for the hosting platform (Railway/Fly)
  // and for humans checking "is it up" without a device token handy.
  app.get("/healthz", (req, res) => {
    res.json({ status: "ok", uptimeSec: Math.round(process.uptime()) });
  });

  app.use(deviceRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Final safety net: anything that throws synchronously past this point
  // (a bug, not a validated user error) still gets a JSON response instead
  // of Express's default HTML error page.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error("Unhandled request error", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
