const crypto = require("crypto");
const { DEVICE_TOKEN } = require("../config");
const metrics = require("../metrics");

// Constant-time comparison so token checks don't leak timing information
// about how many leading characters matched.
function tokensMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function deviceAuth(req, res, next) {
  metrics.record("request");
  const provided = req.headers["x-device-token"];
  if (!provided || !tokensMatch(provided, DEVICE_TOKEN)) {
    metrics.record("auth_failure");
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

module.exports = { deviceAuth };
