const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateDeviceId,
  validateDuration,
  validateMoisture,
  validateOnOff,
  parseTimeToMinutes,
  ValidationError,
} = require("../src/validation");

test("validateDeviceId accepts normal ids", () => {
  assert.doesNotThrow(() => validateDeviceId("Device_1"));
  assert.doesNotThrow(() => validateDeviceId("field-2"));
});

test("validateDeviceId rejects empty, too-long, or invalid characters", () => {
  assert.throws(() => validateDeviceId(""), ValidationError);
  assert.throws(() => validateDeviceId("a".repeat(41)), ValidationError);
  assert.throws(() => validateDeviceId("device 1"), ValidationError);
  assert.throws(() => validateDeviceId("../etc/passwd"), ValidationError);
});

test("validateDuration allows omission but rejects out-of-range values", () => {
  assert.doesNotThrow(() => validateDuration(undefined));
  assert.doesNotThrow(() => validateDuration(60));
  assert.throws(() => validateDuration(-1), ValidationError);
  assert.throws(() => validateDuration(3601), ValidationError);
  assert.throws(() => validateDuration("60"), ValidationError);
});

test("validateMoisture accepts 0-100 and rejects everything else", () => {
  assert.equal(validateMoisture(0), 0);
  assert.equal(validateMoisture("45"), 45);
  assert.throws(() => validateMoisture(-1), ValidationError);
  assert.throws(() => validateMoisture(101), ValidationError);
  assert.throws(() => validateMoisture(undefined), ValidationError);
  assert.throws(() => validateMoisture("not-a-number"), ValidationError);
});

test("validateOnOff only accepts the literal strings ON/OFF", () => {
  assert.doesNotThrow(() => validateOnOff("ON", "state"));
  assert.doesNotThrow(() => validateOnOff("OFF", "state"));
  assert.throws(() => validateOnOff("on", "state"), ValidationError);
  assert.throws(() => validateOnOff(true, "state"), ValidationError);
});

test("parseTimeToMinutes parses valid HH:mm and rejects malformed input", () => {
  assert.equal(parseTimeToMinutes("00:00"), 0);
  assert.equal(parseTimeToMinutes("06:30"), 390);
  assert.equal(parseTimeToMinutes("23:59"), 1439);
  assert.throws(() => parseTimeToMinutes("24:00"), ValidationError);
  assert.throws(() => parseTimeToMinutes("6:30pm"), ValidationError);
  assert.throws(() => parseTimeToMinutes("garbage"), ValidationError);
});
