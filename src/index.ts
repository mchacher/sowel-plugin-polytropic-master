/**
 * Sowel Plugin: Polytropic Master Inverter (Modbus RTU/TCP).
 *
 * Reads water/outdoor temperature, mode, and setpoint from a Polytropic
 * Master Inverter pool heat pump, and lets the user write the temperature
 * setpoint. The Modbus bus is reached over TCP via a Waveshare RS485-to-IP
 * gateway.
 */

import { PolytropicEngine } from "./polytropic-plugin.js";
import type { DeviceManager, Logger } from "./polytropic-plugin.js";

interface SettingsManager {
  get(key: string): string | undefined;
}

interface EventBus {
  emit(event: { type: string; integrationId?: string }): void;
}

interface Device {
  id: string;
  integrationId: string;
  sourceDeviceId: string;
  name: string;
}

interface PluginDeps {
  logger: Logger;
  eventBus: EventBus;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginDir: string;
}

type IntegrationStatus = "connected" | "disconnected" | "not_configured" | "error";

interface IntegrationSettingDef {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean";
  required: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly apiVersion?: number;
  getStatus(): IntegrationStatus;
  isConfigured(): boolean;
  getSettingsSchema(): IntegrationSettingDef[];
  start(options?: { pollOffset?: number }): Promise<void>;
  stop(): Promise<void>;
  executeOrder(
    device: Device,
    orderKeyOrDispatchConfig: string | Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
  refresh?(): Promise<void>;
  getPollingInfo?(): { lastPollAt: string; intervalMs: number } | null;
}

const INTEGRATION_ID = "polytropic_master";
const SETTINGS_PREFIX = `integration.${INTEGRATION_ID}.`;

class PolytropicMasterPlugin implements IntegrationPlugin {
  readonly id = INTEGRATION_ID;
  readonly name = "Polytropic Master Inverter";
  readonly description =
    "Pool heat pump (Polytropic Master Inverter) over Modbus RTU/TCP via a Waveshare gateway";
  readonly icon = "Waves";
  readonly apiVersion = 2;

  private logger: Logger;
  private eventBus: EventBus;
  private settingsManager: SettingsManager;
  private deviceManager: DeviceManager;
  private engine: PolytropicEngine | null = null;
  private status: IntegrationStatus = "disconnected";

  constructor(deps: PluginDeps) {
    this.logger = deps.logger;
    this.eventBus = deps.eventBus;
    this.settingsManager = deps.settingsManager;
    this.deviceManager = deps.deviceManager;
  }

  getStatus(): IntegrationStatus {
    if (!this.isConfigured()) return "not_configured";
    return this.status;
  }

  isConfigured(): boolean {
    return this.getSetting("host") !== undefined;
  }

  getSettingsSchema(): IntegrationSettingDef[] {
    return [
      { key: "host", label: "Modbus gateway host", type: "text", required: true, placeholder: "192.168.0.242" },
      { key: "port", label: "Modbus gateway TCP port", type: "number", required: true, defaultValue: "4196" },
      { key: "slave_id", label: "Modbus slave ID", type: "number", required: true, defaultValue: "17" },
      { key: "poll_interval_sec", label: "Polling interval (seconds)", type: "number", required: true, defaultValue: "60" },
    ];
  }

  async start(): Promise<void> {
    if (!this.isConfigured()) {
      this.status = "not_configured";
      return;
    }
    const host = this.getSetting("host")!;
    const port = parseInt(this.getSetting("port") ?? "4196", 10);
    const slaveId = parseInt(this.getSetting("slave_id") ?? "17", 10);
    const pollIntervalSec = Math.max(5, parseInt(this.getSetting("poll_interval_sec") ?? "60", 10));

    try {
      this.engine = new PolytropicEngine({
        integrationId: INTEGRATION_ID,
        deviceManager: this.deviceManager,
        logger: this.logger,
        modbus: { host, port, slaveId },
        pollIntervalSec,
      });
      await this.engine.start();
      this.status = "connected";
      this.eventBus.emit({ type: "system.integration.connected", integrationId: this.id });
      this.logger.info({ host, port, slaveId, pollIntervalSec }, "Polytropic Master plugin started");
    } catch (err) {
      this.status = "error";
      this.logger.error({ err }, "Failed to start Polytropic Master plugin");
    }
  }

  async stop(): Promise<void> {
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
    this.status = "disconnected";
    this.eventBus.emit({ type: "system.integration.disconnected", integrationId: this.id });
    this.logger.info({}, "Polytropic Master plugin stopped");
  }

  async executeOrder(_device: Device, orderKey: string | Record<string, unknown>, value: unknown): Promise<void> {
    if (!this.engine) throw new Error("Polytropic Master plugin not connected");
    const key = typeof orderKey === "string" ? orderKey : String((orderKey as { key?: string }).key ?? "");
    if (key !== "setpoint") {
      throw new Error(`Unsupported order: ${key}`);
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Invalid setpoint value: ${String(value)}`);
    }
    await this.engine.writeSetpoint(num);
  }

  private getSetting(key: string): string | undefined {
    return this.settingsManager.get(`${SETTINGS_PREFIX}${key}`);
  }
}

export function createPlugin(deps: PluginDeps): IntegrationPlugin {
  return new PolytropicMasterPlugin(deps);
}
