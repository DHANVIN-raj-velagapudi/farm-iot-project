# Farm IoT

A self-hosted controller for a farm/garden irrigation pump and grow
lights, built on an Arduino Uno R4 WiFi and a small Node.js backend. Reads
soil moisture, drives the pump and up to 10 lights per device, and
supports both manual control and a daily on/off schedule.

## Features

- Manual pump/light control, optionally timed (auto-off after N seconds)
- Daily schedule per device, including overnight windows (e.g. 22:00-06:00)
- Soil moisture tracking with a low-moisture hint
- Multi-device support out of the box
- Crash-safe persistence (atomic writes, timers resolved correctly across restarts)
- No hardcoded secrets anywhere in the repo — see [docs/HARDWARE.md](docs/HARDWARE.md)

## Architecture

```
Arduino R4 WiFi ──HTTPS poll /state (1s) + POST /data (10s)──▶ Node.js backend ──▶ data/devices.json
```

The firmware polls the backend for its target pump/light state and reports
moisture readings; all logic (schedules, timers, manual overrides) lives
on the backend. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
full design, including why this uses HTTP polling rather than MQTT.

## Quick start (backend)

```bash
npm install
DEVICE_TOKEN=$(openssl rand -hex 16) npm start
```

The server refuses to start without `DEVICE_TOKEN` set — see
[docs/API.md](docs/API.md) for the full endpoint reference and
[docs/HARDWARE.md](docs/HARDWARE.md) for flashing the Arduino and
deploying the backend.

```bash
npm test   # runs the validation unit tests (node's built-in test runner)
```

## Project layout

```
server.js                          Entry point
src/                                Backend source (see docs/ARCHITECTURE.md)
test/                               Unit tests
firmware/FarmIoTController/         Arduino sketch
docs/                               Architecture, API reference, hardware setup
```

## Security

- A single `DEVICE_TOKEN`, sent as `x-device-token`, authenticates every
  request. Treat it like a password.
- WiFi credentials and the device token live only in
  `firmware/FarmIoTController/arduino_secrets.h`, which is gitignored and
  never committed. See [docs/HARDWARE.md](docs/HARDWARE.md).
- This project previously had real credentials committed to git history.
  That history has since been scrubbed and the credentials rotated — if
  you forked or cloned this repo before that cleanup, discard that copy.

## License

MIT — see [LICENSE](LICENSE).

## Author

Velagapudi Dhanvin Raj
