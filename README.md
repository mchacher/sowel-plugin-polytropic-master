# sowel-plugin-polytropic-master

Sowel plugin for the **Polytropic Master Inverter** pool heat pump, talking
Modbus RTU over a TCP gateway (typical setup: a Waveshare RS485-to-IP bridge).

## Features

- Reads water temperature, outdoor temperature, mode, and setpoint.
- Writes the temperature setpoint (only writable register).
- Per-poll status tracking (online / offline after 3 consecutive failures).
- Immediate re-poll after a successful setpoint write.

## Register map

Modbus RTU 9600 8N1, slave 17 (0x11) by default.

| Reg dec | Reg hex | R/W | Format | Sowel data         |
| ------: | ------: | :-: | :----- | :----------------- |
| 512     | 0x0200  | R   | ×10 °C | water_temperature  |
| 515     | 0x0203  | R   | ×10 °C | outdoor_temperature |
| 1000    | 0x03E8  | R   | enum   | mode               |
| 1001    | 0x03E9  | R/W | ×10 °C | setpoint           |

Mode enum: `0=OFF`, `21=SMART`, `22=BOOST`, `23=ECO`. Unknown values are
exposed as `RAW_<n>`.

## Settings (configured from the Sowel UI)

| Key                  | Default          | Notes                          |
| -------------------- | ---------------- | ------------------------------ |
| `host`               | `192.168.0.242`  | Waveshare gateway IP           |
| `port`               | `4196`           | TCP port                       |
| `slave_id`           | `17`             | Modbus slave ID                |
| `poll_interval_sec`  | `60`             | Polling interval (seconds)     |

## Build / test

```bash
npm install
npm run build
npm test
```
