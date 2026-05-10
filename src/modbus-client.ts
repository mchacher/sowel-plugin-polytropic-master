/**
 * Modbus client wrapper around `modbus-serial`.
 *
 * Uses RTU-over-TCP (`connectRTUBuffered`) which is the protocol spoken by
 * Waveshare RS485-to-Ethernet gateways: each TCP frame contains a raw RTU
 * payload (slave id + function + data + CRC).
 *
 * Methods are sequential by design — Modbus RTU does not support overlapping
 * transactions on the same line. Callers must await each call.
 */

import * as ModbusModule from "modbus-serial";

// modbus-serial publishes itself via `module.exports = ModbusRTU`, but its
// typings re-export through `export default`. Under NodeNext the default
// import is not callable as a constructor, so we go through the CJS-style
// namespace and cast to `any` once at the boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ModbusRTUClass = (ModbusModule as unknown as { default: any }).default;

interface ModbusRTULike {
  setID(id: number): void;
  setTimeout(ms: number): void;
  connectTcpRTUBuffered(host: string, opts: { port: number }): Promise<void>;
  close(cb: () => void): void;
  readHoldingRegisters(address: number, count: number): Promise<{ data: number[] }>;
  writeRegister(address: number, value: number): Promise<void>;
}

export interface ModbusClientOptions {
  host: string;
  port: number;
  slaveId: number;
  /** Per-request timeout (ms). Defaults to 3000. */
  timeoutMs?: number;
}

export class ModbusClient {
  private readonly client: ModbusRTULike;
  private connected = false;

  constructor(private readonly opts: ModbusClientOptions) {
    this.client = new ModbusRTUClass() as ModbusRTULike;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    await this.client.connectTcpRTUBuffered(this.opts.host, { port: this.opts.port });
    this.client.setID(this.opts.slaveId);
    this.client.setTimeout(this.opts.timeoutMs ?? 3000);
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await new Promise<void>((resolve) => this.client.close(() => resolve()));
    this.connected = false;
  }

  async readHoldingRegisters(address: number, count: number): Promise<number[]> {
    if (!this.connected) throw new Error("Modbus client not connected");
    try {
      const res = await this.client.readHoldingRegisters(address, count);
      return Array.from(res.data as number[]);
    } catch (err) {
      // Transport errors (port closed, timeout, ECONNRESET) leave the underlying
      // socket unusable. Mark dirty so the next caller forces a reconnect
      // instead of looping forever on a dead handle.
      this.connected = false;
      throw err;
    }
  }

  async writeRegister(address: number, value: number): Promise<void> {
    if (!this.connected) throw new Error("Modbus client not connected");
    try {
      await this.client.writeRegister(address, value);
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }
}
