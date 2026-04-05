#include <WiFiS3.h>
#include <PubSubClient.h>
#include <ArduinoHttpClient.h>

// =====================
// WIFI (SAFE PLACEHOLDER)
// =====================
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// =====================
// MQTT (SAFE PLACEHOLDER)
// =====================
const char* mqtt_server = "YOUR_MQTT_SERVER";
const int mqtt_port = 1883;
const char* mqtt_user = "YOUR_MQTT_USER";
const char* mqtt_pass = "YOUR_MQTT_PASSWORD";

// =====================
// HTTP BACKEND (SAFE)
// =====================
const char* server = "your-backend-url.com";
WiFiSSLClient httpWifi;
HttpClient httpClient(httpWifi, server, 80);

// =====================
// DEVICE
// =====================
const char* DEVICE_ID = "Device_1";

// =====================
// PINS
// =====================
#define RELAY_PIN 7
#define L1_PIN 8
#define L2_PIN 9
#define L3_PIN 10

#define LED_RED 4
#define LED_GREEN 5

#define RELAY_ON  LOW
#define RELAY_OFF HIGH

// =====================
// GLOBALS
// =====================
WiFiSSLClient wifiClient;
PubSubClient client(wifiClient);

unsigned long lastReconnect = 0;
unsigned long lastMQTT = 0;
unsigned long lastMoistureTime = 0;

const unsigned long moistureInterval = 30000;

// Topics
char topicPump[50];
char topicL1[50];
char topicL2[50];
char topicL3[50];

// =====================
// WIFI CONNECT
// =====================
void connectWiFi() {
  Serial.println("[WIFI] Connecting...");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }

  Serial.println("\n[WIFI] Connected!");
}

// =====================
// MQTT CALLBACK
// =====================
void callback(char* topic, byte* payload, unsigned int length) {

  if (length > 10) return;

  char msg[10];
  memcpy(msg, payload, length);
  msg[length] = '\0';

  if (strcmp(topic, topicPump) == 0) {
    digitalWrite(RELAY_PIN, strcmp(msg, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  }

  if (strcmp(topic, topicL1) == 0) {
    digitalWrite(L1_PIN, strcmp(msg, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  }

  if (strcmp(topic, topicL2) == 0) {
    digitalWrite(L2_PIN, strcmp(msg, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  }

  if (strcmp(topic, topicL3) == 0) {
    digitalWrite(L3_PIN, strcmp(msg, "ON") == 0 ? RELAY_ON : RELAY_OFF);
  }
}

// =====================
// MQTT CONNECT
// =====================
void connectMQTT() {
  if (millis() - lastReconnect < 3000) return;

  lastReconnect = millis();

  if (client.connect(DEVICE_ID, mqtt_user, mqtt_pass,
                     "Device_1/status", 0, true, "offline")) {

    client.subscribe(topicPump);
    client.subscribe(topicL1);
    client.subscribe(topicL2);
    client.subscribe(topicL3);

    client.publish("Device_1/status", "online", true);
  }
}

// =====================
// SEND MOISTURE
// =====================
void sendMoisture(int value) {

  httpClient.beginRequest();
  httpClient.post("/data");

  httpClient.sendHeader("Content-Type", "application/json");
  httpClient.sendHeader("x-device-token", "YOUR_DEVICE_TOKEN");

  String body = "{\"device_id\":\"Device_1\",\"moisture\":" + String(value) + "}";

  httpClient.beginBody();
  httpClient.print(body);
  httpClient.endRequest();

  httpClient.responseStatusCode();
  httpClient.stop();
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

  snprintf(topicPump, sizeof(topicPump), "%s/pump", DEVICE_ID);
  snprintf(topicL1, sizeof(topicL1), "%s/light/L1", DEVICE_ID);
  snprintf(topicL2, sizeof(topicL2), "%s/light/L2", DEVICE_ID);
  snprintf(topicL3, sizeof(topicL3), "%s/light/L3", DEVICE_ID);

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

// =====================
// LOOP
// =====================
void loop() {

  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(LED_RED, HIGH);
    digitalWrite(LED_GREEN, LOW);
    connectWiFi();
    return;
  }

  if (!client.connected()) {
    connectMQTT();

    digitalWrite(LED_RED, millis() % 500 < 250);
    digitalWrite(LED_GREEN, LOW);

    if (millis() - lastMQTT > 10000) {
      digitalWrite(RELAY_PIN, RELAY_OFF);
      digitalWrite(L1_PIN, RELAY_OFF);
      digitalWrite(L2_PIN, RELAY_OFF);
      digitalWrite(L3_PIN, RELAY_OFF);
    }

  } else {
    client.loop();
    lastMQTT = millis();

    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_RED, LOW);
  }

  if (millis() - lastMoistureTime > moistureInterval) {

    lastMoistureTime = millis();

    int raw = analogRead(A0);

    int dry = 900;
    int wet = 400;

    int moisture = map(raw, dry, wet, 0, 100);
    moisture = constrain(moisture, 0, 100);

    Serial.print("[MOISTURE] ");
    Serial.println(moisture);

    sendMoisture(moisture);
  }
}
