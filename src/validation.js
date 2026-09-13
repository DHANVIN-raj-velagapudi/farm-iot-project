// Pure validation helpers. No I/O, no state — easy to unit test (see
// test/validation.test.js) and safe to reuse anywhere in the codebase.

const { MAX_DEVICE_ID_LENGTH, DEVICE_ID_PATTERN, MAX_CONTROL_DURATION_SEC } = require("./config");

class ValidationError extends Error {}

function validateDeviceId(id) {
  if (
    !id ||
    typeof id !== "string" ||
    id.length > MAX_DEVICE_ID_LENGTH ||
    !DEVICE_ID_PATTERN.test(id)
  ) {
    throw new ValidationError(
      `Invalid device_id (alphanumeric, dash, underscore only, max ${MAX_DEVICE_ID_LENGTH} chars)`
    );
  }
}

function validateDuration(seconds) {
  if (seconds === undefined || seconds === null) return; // optional field
  if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds < 0 || seconds > MAX_CONTROL_DURATION_SEC) {
    throw new ValidationError(`Invalid duration (0-${MAX_CONTROL_DURATION_SEC}s)`);
  }
}

function validateMoisture(value) {
  if (value === undefined || value === null) {
    throw new ValidationError("Moisture value is required");
  }
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || num > 100) {
    throw new ValidationError("Invalid moisture (must be 0-100)");
  }
  return num;
}

function validateOnOff(value, fieldName) {
  if (value !== "ON" && value !== "OFF") {
    throw new ValidationError(`${fieldName} must be "ON" or "OFF"`);
  }
}

// Parses "HH:mm" into minutes-since-midnight. Throws on anything malformed
// instead of silently producing NaN, so callers can't accidentally schedule
// against a broken time.
function parseTimeToMinutes(value) {
  if (typeof value !== "string" || !value.includes(":")) {
    throw new ValidationError('Invalid time format, expected "HH:mm"');
  }
  const [h, m] = value.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new ValidationError("Invalid time range");
  }
  return h * 60 + m;
}

module.exports = {
  ValidationError,
  validateDeviceId,
  validateDuration,
  validateMoisture,
  validateOnOff,
  parseTimeToMinutes,
};
