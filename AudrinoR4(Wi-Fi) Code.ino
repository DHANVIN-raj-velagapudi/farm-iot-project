#include <WiFiS3.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>

// =====================
// WIFI
// =====================
const char* ssid = "Airtel_Dinesh";
const char* password = "800830dh";

// =====================
// HTTP BACKEND
// =====================
const char* server = "valiant-celebration-production-9ee8.up.railway.app";
WiFiSSLClient wifi;
HttpClient client(wifi, server, 443);

// =====================
// DEVICE
// =====================
const char* DEVICE_ID = "Device_1";
const char* TOKEN = "FARM_SECURE_123";

// =====================
// PINS
// =====================
#define RELAY_PIN 7
#define L1_PIN 8
#define L2_PIN 9
#define L3_PIN 10

#define LED_RED 4
#define LED_GREEN 5

#define RELAY_ON  HIGH
#define RELAY_OFF LOW

// =====================
// TIMERS
// =====================
unsigned long lastMoisture = 0;
unsigned long lastSync = 0;

const unsigned long moistureInterval = 10000;
const unsigned long syncInterval = 1000;

int failCount = 0;

// =====================
// WIFI CONNECT
// =====================
void connectWiFi() {
  Serial.print("[WIFI] Connecting...");
  WiFi.begin(ssid, password);

  int attempts = 0;

  while ((WiFi.status() != WL_CONNECTED || WiFi.localIP() == IPAddress(0,0,0,0)) && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.localIP() != IPAddress(0,0,0,0)) {
    Serial.println("\n[WIFI] Connected!");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] FAILED");
  }
}

// =====================
// SEND MOISTURE
// =====================
void sendMoisture(int value) {
  Serial.print("[HTTP] Sending moisture: ");
  Serial.println(value);

  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"moisture\":" + String(value) + "}";

  client.beginRequest();
  client.post("/data");

  client.sendHeader("Content-Type", "application/json");
  client.sendHeader("Content-Length", body.length()); // 🔥 ADD THIS LINE
  client.sendHeader("x-device-token", TOKEN);

  client.beginBody();
  client.print(body);
  client.endRequest();

  int status = client.responseStatusCode();
  Serial.print("[HTTP] Status: ");
  Serial.println(status);
  client.stop();
}
// =====================
// GET STATE
// =====================
void getState() {

  client.beginRequest();
  client.get("/state");

  client.sendHeader("x-device-token", TOKEN);
  client.sendHeader("x-device-id", DEVICE_ID);
  client.endRequest();

  int status = client.responseStatusCode();
  String response = client.responseBody();
  client.stop();

  if (status != 200) {
    Serial.println("[STATE] HTTP ERROR");
    failCount++;
    return;
  }

  StaticJsonDocument<4096> doc;
  DeserializationError err = deserializeJson(doc, response);

  if (err) {
    Serial.println("[STATE] PARSE ERROR");
    failCount++;
    return;
  }

  if (!doc.containsKey(DEVICE_ID)) {
    Serial.println("[STATE] DEVICE NOT REGISTERED YET");
    failCount++;
    return;
  }

  JsonObject d = doc[DEVICE_ID];

  const char* pump = d["pump"] | "OFF";
  const char* l1 = d["lights"]["L1"] | "OFF";
  const char* l2 = d["lights"]["L2"] | "OFF";
  const char* l3 = d["lights"]["L3"] | "OFF";

  digitalWrite(RELAY_PIN, strcmp(pump, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  digitalWrite(L1_PIN, strcmp(l1, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  digitalWrite(L2_PIN, strcmp(l2, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  digitalWrite(L3_PIN, strcmp(l3, "ON") == 0 ? RELAY_ON : RELAY_OFF);

  Serial.println("[STATE] Updated");

  failCount = 0;
}

// =====================
// SETUP
// =====================
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(L1_PIN, OUTPUT);
  pinMode(L2_PIN, OUTPUT);
  pinMode(L3_PIN, OUTPUT);

  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);

  digitalWrite(RELAY_PIN, RELAY_OFF);
  digitalWrite(L1_PIN, RELAY_OFF);
  digitalWrite(L2_PIN, RELAY_OFF);
  digitalWrite(L3_PIN, RELAY_OFF);

  connectWiFi();
}

// =====================
// LOOP
// =====================
void loop() {

  // WIFI FAIL
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(LED_RED, HIGH);
    digitalWrite(LED_GREEN, LOW);
    connectWiFi();
    return;
  }

  digitalWrite(LED_GREEN, HIGH);

  // =====================
  // STATE FETCH
  // =====================
  if (millis() - lastSync > syncInterval) {
    lastSync = millis();
    getState();
  }

  // =====================
  // MOISTURE SEND
  // =====================
  if (millis() - lastMoisture > moistureInterval) {

    lastMoisture = millis();

    int raw = analogRead(A0);

    Serial.print("[RAW] ");
    Serial.println(raw);

    // safer mapping
    int moisture = map(raw, 1023, 300, 0, 100);

    if (moisture < 0) moisture = 0;
    if (moisture > 100) moisture = 100;

    Serial.print("[MOISTURE CLEAN] ");
    Serial.println(moisture);

    sendMoisture(moisture);
  }

  // =====================
  // FAILSAFE
  // =====================
  if (failCount > 5) {
    Serial.println("[FAILSAFE] Turning OFF all");

    digitalWrite(RELAY_PIN, RELAY_OFF);
    digitalWrite(L1_PIN, RELAY_OFF);
    digitalWrite(L2_PIN, RELAY_OFF);
    digitalWrite(L3_PIN, RELAY_OFF);

    digitalWrite(LED_RED, millis() % 500 < 250);
  }
}
