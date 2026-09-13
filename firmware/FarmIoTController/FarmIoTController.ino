// Farm IoT Controller — Arduino Uno R4 WiFi
//
// Polls the backend's /state endpoint over HTTPS once a second and drives
// a pump relay + up to 3 grow lights accordingly. Posts a soil moisture
// reading every 10 seconds. See ../../docs/HARDWARE.md for wiring and
// calibration instructions, and ../../docs/ARCHITECTURE.md for why this
// uses HTTP polling rather than MQTT.

#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>

// Real credentials live in arduino_secrets.h, which is gitignored and never
// committed. Copy arduino_secrets.h.example -> arduino_secrets.h in this
// same folder and fill it in before uploading this sketch.
#include "arduino_secrets.h"

// =====================
// WIFI + BACKEND
// =====================
const char* WIFI_SSID = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
const char* DEVICE_TOKEN = SECRET_DEVICE_TOKEN;

const char* BACKEND_HOST = "valiant-celebration-production-9ee8.up.railway.app";
const int BACKEND_PORT = 443;
const char* DEVICE_ID = "Device_1";

WiFiSSLClient wifiClient;
HttpClient http(wifiClient, BACKEND_HOST, BACKEND_PORT);

// =====================
// PINS
// =====================
const int RELAY_PIN = 7;
const int LIGHT_PINS[] = { 8, 9, 10 }; // L1, L2, L3
const int LIGHT_COUNT = 3;

const int LED_STATUS_BAD = 4;  // red
const int LED_STATUS_GOOD = 5; // green

const int RELAY_ON = HIGH;
const int RELAY_OFF = LOW;

// =====================
// TIMING
// =====================
const unsigned long STATE_POLL_INTERVAL_MS = 1000;
const unsigned long MOISTURE_SEND_INTERVAL_MS = 10000;
const unsigned long WIFI_CONNECT_RETRY_DELAY_MS = 500;
const int WIFI_CONNECT_MAX_ATTEMPTS = 20;
const unsigned int HTTP_RESPONSE_TIMEOUT_MS = 5000;

// After this many consecutive failed /state polls, assume the backend is
// unreachable and fail safe (everything off) rather than leave the pump
// stuck in its last commanded state indefinitely.
const int MAX_CONSECUTIVE_FAILURES = 5;

// =====================
// MOISTURE SENSOR CALIBRATION
// =====================
// Raw analogRead() value with the sensor fully dry (in air), and fully wet
// (submerged / in saturated soil). These are per-sensor and per-board —
// see docs/HARDWARE.md for how to measure your own and update these two
// constants. Values here are the ones this project shipped with.
const int MOISTURE_RAW_DRY = 1023;
const int MOISTURE_RAW_WET = 300;

unsigned long lastStatePoll = 0;
unsigned long lastMoistureSend = 0;
int consecutiveFailures = 0;

// =====================
// WIFI
// =====================
void connectWiFi() {
  Serial.print("[WIFI] Connecting");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < WIFI_CONNECT_MAX_ATTEMPTS) {
    delay(WIFI_CONNECT_RETRY_DELAY_MS);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n[WIFI] Connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Connection attempt failed, will retry");
  }
}

// =====================
// BACKEND: SEND MOISTURE
// =====================
void sendMoistureReading(int moisturePercent) {
  Serial.print("[HTTP] Sending moisture: ");
  Serial.println(moisturePercent);

  // Fixed-size buffer instead of String concatenation — avoids heap
  // fragmentation from repeated String allocations over long uptimes,
  // which matters on a memory-constrained microcontroller.
  char body[96];
  int len = snprintf(body, sizeof(body),
                      "{\"device_id\":\"%s\",\"moisture\":%d}",
                      DEVICE_ID, moisturePercent);

  http.beginRequest();
  http.post("/data");
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("Content-Length", len);
  http.sendHeader("x-device-token", DEVICE_TOKEN);
  http.beginBody();
  http.print(body);
  http.endRequest();

  int status = http.responseStatusCode();
  http.responseBody(); // drain the response so the connection can be reused
  http.stop();

  Serial.print("[HTTP] /data status: ");
  Serial.println(status);

  if (status == 200) {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
  }
}

// =====================
// BACKEND: FETCH + APPLY STATE
// =====================
void pollState() {
  http.beginRequest();
  http.get("/state");
  http.sendHeader("x-device-token", DEVICE_TOKEN);
  http.sendHeader("x-device-id", DEVICE_ID);
  http.endRequest();

  int status = http.responseStatusCode();
  String response = http.responseBody();
  http.stop();

  if (status == 404) {
    // Expected for the first few seconds after boot: the backend only
    // creates this device record once the first /data (moisture) call
    // succeeds. Not a real failure yet.
    Serial.println("[STATE] Device not registered with backend yet");
    consecutiveFailures++;
    return;
  }

  if (status != 200) {
    Serial.print("[STATE] Unexpected HTTP status: ");
    Serial.println(status);
    consecutiveFailures++;
    return;
  }

  // Sized generously (this device's own serialized state is a few hundred
  // bytes at most) — the Uno R4 has 32KB of SRAM, so there's no reason to
  // cut this close and risk a silent truncation/parse failure.
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.print("[STATE] JSON parse error: ");
    Serial.println(err.c_str());
    consecutiveFailures++;
    return;
  }

  if (!doc.containsKey(DEVICE_ID)) {
    Serial.println("[STATE] Response did not contain this device's state");
    consecutiveFailures++;
    return;
  }

  JsonObject device = doc[DEVICE_ID];
  applyRelayState(RELAY_PIN, device["pump"] | "OFF");

  JsonObject lights = device["lights"];
  for (int i = 0; i < LIGHT_COUNT; i++) {
    char key[4];
    snprintf(key, sizeof(key), "L%d", i + 1);
    applyRelayState(LIGHT_PINS[i], lights[key] | "OFF");
  }

  consecutiveFailures = 0;
}

void applyRelayState(int pin, const char* desiredState) {
  digitalWrite(pin, strcmp(desiredState, "ON") == 0 ? RELAY_ON : RELAY_OFF);
}

// =====================
// FAILSAFE
// =====================
void enterFailSafe() {
  Serial.println("[FAILSAFE] Too many consecutive failures — forcing everything off");
  digitalWrite(RELAY_PIN, RELAY_OFF);
  for (int i = 0; i < LIGHT_COUNT; i++) {
    digitalWrite(LIGHT_PINS[i], RELAY_OFF);
  }
  digitalWrite(LED_STATUS_BAD, millis() % 500 < 250); // blink
}

// =====================
// MOISTURE READING
// =====================
int readMoisturePercent() {
  int raw = analogRead(A0);
  int percent = map(raw, MOISTURE_RAW_DRY, MOISTURE_RAW_WET, 0, 100);
  percent = constrain(percent, 0, 100);

  Serial.print("[MOISTURE] raw=");
  Serial.print(raw);
  Serial.print(" percent=");
  Serial.println(percent);

  return percent;
}

// =====================
// SETUP
// =====================
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  for (int i = 0; i < LIGHT_COUNT; i++) {
    pinMode(LIGHT_PINS[i], OUTPUT);
    digitalWrite(LIGHT_PINS[i], RELAY_OFF);
  }
  digitalWrite(RELAY_PIN, RELAY_OFF);

  pinMode(LED_STATUS_BAD, OUTPUT);
  pinMode(LED_STATUS_GOOD, OUTPUT);

  http.setHttpResponseTimeout(HTTP_RESPONSE_TIMEOUT_MS);

  connectWiFi();
}

// =====================
// LOOP
// =====================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(LED_STATUS_BAD, HIGH);
    digitalWrite(LED_STATUS_GOOD, LOW);
    connectWiFi();
    return;
  }
  digitalWrite(LED_STATUS_GOOD, HIGH);
  digitalWrite(LED_STATUS_BAD, LOW);

  unsigned long now = millis();

  if (now - lastStatePoll >= STATE_POLL_INTERVAL_MS) {
    lastStatePoll = now;
    pollState();
  }

  if (now - lastMoistureSend >= MOISTURE_SEND_INTERVAL_MS) {
    lastMoistureSend = now;
    sendMoistureReading(readMoisturePercent());
  }

  if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
    enterFailSafe();
  }
}
