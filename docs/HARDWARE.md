# Hardware Setup

## Bill of materials

- Arduino Uno R4 WiFi
- 4-channel relay module (1 for the pump, 3 for lights)
- Capacitive soil moisture sensor (analog output)
- Pump + grow lights, wired through the relays (mains/12V side is on you —
  follow your relay module's and pump's own safety instructions)
- 2 status LEDs (optional but recommended) + appropriate resistors

## Wiring

| Signal              | Arduino pin |
| ------------------- | ----------- |
| Pump relay          | D7          |
| Light 1 relay (L1)  | D8          |
| Light 2 relay (L2)  | D9          |
| Light 3 relay (L3)  | D10         |
| Status LED — error  | D4          |
| Status LED — OK     | D5          |
| Soil moisture (analog) | A0       |

Relay logic level (`RELAY_ON` / `RELAY_OFF` in the sketch) is set to
active-HIGH. If your relay board is active-LOW, swap those two constants
near the top of `FarmIoTController.ino`.

## Firmware setup

1. Install these libraries via the Arduino IDE Library Manager:
   - `ArduinoHttpClient`
   - `ArduinoJson` (v6.x)
   - `WiFiS3` (bundled with the Uno R4 board package)
2. Open `firmware/FarmIoTController/FarmIoTController.ino` — the *folder*
   must be named `FarmIoTController` too (Arduino requires the sketch
   folder name to match the `.ino` file name).
3. In that same folder, copy the secrets template and fill it in:

   ```bash
   cd firmware/FarmIoTController
   cp arduino_secrets.h.example arduino_secrets.h
   ```

   Edit `arduino_secrets.h` with your real WiFi SSID/password and the
   device token you set as `DEVICE_TOKEN` on the backend. This file is
   gitignored — it will never be committed.
4. Flash the sketch, then open the Serial Monitor at 115200 baud to watch
   connection and polling status.

## Moisture sensor calibration

The raw analog reading needs two reference points to map to a 0-100%
scale: `MOISTURE_RAW_DRY` and `MOISTURE_RAW_WET`, near the top of the
sketch.

1. Flash the sketch and open the Serial Monitor — it prints `[MOISTURE]
   raw=... percent=...` every 10 seconds.
2. With the sensor completely dry (in open air), note the raw value. Set
   `MOISTURE_RAW_DRY` to that.
3. With the sensor fully submerged in water (or saturated soil), note the
   raw value. Set `MOISTURE_RAW_WET` to that.
4. Re-flash. Readings should now track 0% (dry) to 100% (wet) sensibly.

Every sensor and every board's ADC reference voltage differs slightly, so
don't assume the shipped defaults are correct for your hardware — verify
them.

## Backend deployment

The backend is a standard Node.js app (`npm start` runs it). It's been run
successfully on Railway; `fly.toml` is included if you'd rather use
Fly.io. Either way, set these environment variables on the host:

| Variable       | Required | Notes                                   |
| -------------- | -------- | ---------------------------------------- |
| `DEVICE_TOKEN` | Yes      | Must match `SECRET_DEVICE_TOKEN` in `arduino_secrets.h`. The server refuses to start without this. |
| `PORT`         | No       | Defaults to `3000`; most platforms set this for you. |

After deploying, update `BACKEND_HOST` near the top of the `.ino` file to
your deployed hostname (no `https://`, no trailing slash).
