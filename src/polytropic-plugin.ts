/**
 * Polytropic Master Inverter plugin engine.
 *
 * Lifecycle:
 *   start()  → connect Modbus, register the (single) device, schedule polling
 *   poll()   → read 4 holding registers, push values to deviceManager
 *   write()  → only the temperature setpoint is writable (reg 1001)
 *   stop()   → cancel timers + close socket
 *
 * The plugin pushes data through the same `deviceManager.updateDeviceData`
 * surface used by every other Sowel integration. After a successful write
 * we trigger an immediate re-poll so the UI sees the new setpoint within ~1s.
 */

import { ModbusClient, type ModbusClientOptions } from "./modbus-client.js";
import { decodeMode, decodeTempX10, encodeTempX10, REG } from "./registers.js";

// ─── Sowel surface (mirrors src/shared/plugin-api.ts) ───────────────────────

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface DeviceData {
  key: string;
  type: "boolean" | "number" | "enum" | "text" | "json";
  category: string;
  value: unknown;
  unit?: string;
  enumValues?: string[];
}

export interface DeviceOrder {
  key: string;
  type: "boolean" | "number" | "enum" | "text" | "json";
  category?: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}

export interface DeviceManager {
  registerDevice(input: {
    integrationId: string;
    sourceDeviceId: string;
    name: string;
    manufacturer?: string;
    model?: string;
    data: DeviceData[];
    orders: DeviceOrder[];
  }): { id: string; integrationId: string; sourceDeviceId: string; name: string };
  updateDeviceData(
    integrationId: string,
    sourceDeviceId: string,
    key: string,
    value: unknown,
  ): void;
  updateDeviceStatus(integrationId: string, sourceDeviceId: string, status: string): void;
}

export interface PollEngineConfig {
  integrationId: string;
  deviceManager: DeviceManager;
  logger: Logger;
  modbus: ModbusClientOptions;
  pollIntervalSec: number;
}

const SOURCE_DEVICE_ID_PREFIX = "polytropic_master_";

export class PolytropicEngine {
  private client: ModbusClient | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private consecutiveFailures = 0;
  private status: "online" | "offline" | "unknown" = "unknown";
  private readonly sourceDeviceId: string;
  private readonly logger: Logger;

  constructor(private readonly cfg: PollEngineConfig) {
    this.sourceDeviceId = `${SOURCE_DEVICE_ID_PREFIX}${cfg.modbus.slaveId}`;
    this.logger = cfg.logger.child({ module: "polytropic-master" });
  }

  async start(): Promise<void> {
    this.client = new ModbusClient(this.cfg.modbus);
    try {
      await this.client.connect();
      this.logger.info(
        { host: this.cfg.modbus.host, port: this.cfg.modbus.port, slaveId: this.cfg.modbus.slaveId },
        "Modbus connected",
      );
    } catch (err) {
      this.logger.warn({ err }, "Modbus connect failed — will retry on next poll");
    }
    this.registerDevice();
    this.scheduleNextPoll(0);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.client) {
      try {
        await this.client.close();
      } catch (err) {
        this.logger.warn({ err }, "Modbus close error");
      }
      this.client = null;
    }
  }

  /**
   * Write the temperature setpoint (°C) to register 1001 and trigger an
   * immediate re-poll so the UI reflects the new value quickly.
   */
  async writeSetpoint(value: number): Promise<void> {
    if (!this.client || !this.client.isConnected()) {
      throw new Error("Modbus not connected");
    }
    const raw = encodeTempX10(value);
    await this.client.writeRegister(REG.SETPOINT, raw);
    this.logger.info({ value, raw }, "Setpoint written");
    // Immediate re-poll — re-arms the next regular tick at intervalSec from now.
    this.scheduleNextPoll(0);
  }

  private registerDevice(): void {
    this.cfg.deviceManager.registerDevice({
      integrationId: this.cfg.integrationId,
      sourceDeviceId: this.sourceDeviceId,
      name: "Polytropic Master Inverter",
      manufacturer: "Polytropic",
      model: "Master Inverter",
      data: [
        { key: "water_temperature", type: "number", category: "pool_water_temperature", value: null, unit: "°C" },
        { key: "outdoor_temperature", type: "number", category: "temperature_outdoor", value: null, unit: "°C" },
        {
          key: "mode",
          type: "enum",
          category: "appliance_state",
          value: null,
          enumValues: ["OFF", "SMART", "BOOST", "ECO"],
        },
        { key: "setpoint", type: "number", category: "pool_temperature_setpoint", value: null, unit: "°C" },
      ],
      orders: [
        {
          key: "setpoint",
          type: "number",
          category: "set_pool_temperature_setpoint",
          min: 10,
          max: 30,
          unit: "°C",
        },
      ],
    });
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.logger.error({ err }, "Poll loop error"));
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      // Skip overlapping invocations; the next regular tick will catch up.
      return;
    }
    this.polling = true;
    try {
      if (!this.client || !this.client.isConnected()) {
        await this.tryReconnect();
      }
      if (!this.client || !this.client.isConnected()) {
        this.handleFailure(new Error("Not connected"));
        return;
      }

      // Two contiguous reads — temps then mode/setpoint. Polytropic registers
      // are not contiguous (512/515 vs 1000/1001), so we must split.
      const tempRegs = await this.client.readHoldingRegisters(REG.WATER_TEMPERATURE, 4); // 512..515
      const ctrlRegs = await this.client.readHoldingRegisters(REG.MODE, 2); // 1000..1001

      const water = decodeTempX10(tempRegs[0]);
      const outdoor = decodeTempX10(tempRegs[3]);
      const mode = decodeMode(ctrlRegs[0]);
      const setpoint = decodeTempX10(ctrlRegs[1]);

      this.cfg.deviceManager.updateDeviceData(
        this.cfg.integrationId,
        this.sourceDeviceId,
        "water_temperature",
        water,
      );
      this.cfg.deviceManager.updateDeviceData(
        this.cfg.integrationId,
        this.sourceDeviceId,
        "outdoor_temperature",
        outdoor,
      );
      this.cfg.deviceManager.updateDeviceData(
        this.cfg.integrationId,
        this.sourceDeviceId,
        "mode",
        mode,
      );
      this.cfg.deviceManager.updateDeviceData(
        this.cfg.integrationId,
        this.sourceDeviceId,
        "setpoint",
        setpoint,
      );

      this.consecutiveFailures = 0;
      if (this.status !== "online") {
        this.status = "online";
        this.cfg.deviceManager.updateDeviceStatus(
          this.cfg.integrationId,
          this.sourceDeviceId,
          "online",
        );
      }
    } catch (err) {
      this.handleFailure(err);
    } finally {
      this.polling = false;
      this.scheduleNextPoll(this.cfg.pollIntervalSec * 1000);
    }
  }

  private async tryReconnect(): Promise<void> {
    try {
      if (this.client) {
        try {
          await this.client.close();
        } catch {
          /* ignore */
        }
      }
      this.client = new ModbusClient(this.cfg.modbus);
      await this.client.connect();
      this.logger.info({}, "Modbus reconnected");
    } catch (err) {
      this.logger.warn({ err }, "Modbus reconnect failed");
    }
  }

  private handleFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    this.logger.warn(
      { err, consecutiveFailures: this.consecutiveFailures },
      "Modbus poll failed",
    );
    if (this.consecutiveFailures >= 3 && this.status !== "offline") {
      this.status = "offline";
      this.cfg.deviceManager.updateDeviceStatus(
        this.cfg.integrationId,
        this.sourceDeviceId,
        "offline",
      );
    }
  }

  // Test helpers (not part of the public API)
  /** @internal */ _injectClient(c: ModbusClient): void {
    this.client = c;
  }
  /** @internal */ _runPollOnce(): Promise<void> {
    return this.poll();
  }
  /** @internal */ _failuresCount(): number {
    return this.consecutiveFailures;
  }
}
