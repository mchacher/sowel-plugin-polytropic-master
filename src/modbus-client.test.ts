import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared spies the mocked ModbusRTU class will close over. Reset per-test in
// beforeEach so each scenario starts from a clean slate.
const spies = {
  connectTcpRTUBuffered: vi.fn<(host: string, opts: { port: number }) => Promise<void>>(),
  setID: vi.fn<(id: number) => void>(),
  setTimeout: vi.fn<(ms: number) => void>(),
  close: vi.fn<(cb: () => void) => void>(),
  readHoldingRegisters: vi.fn<(address: number, count: number) => Promise<{ data: number[] }>>(),
  writeRegister: vi.fn<(address: number, value: number) => Promise<void>>(),
};

vi.mock("modbus-serial", () => {
  class FakeModbusRTU {
    connectTcpRTUBuffered = spies.connectTcpRTUBuffered;
    setID = spies.setID;
    setTimeout = spies.setTimeout;
    close = spies.close;
    readHoldingRegisters = spies.readHoldingRegisters;
    writeRegister = spies.writeRegister;
  }
  return { default: FakeModbusRTU };
});

// Import AFTER vi.mock so the module sees the mocked dependency.
const { ModbusClient } = await import("./modbus-client.js");

beforeEach(() => {
  for (const fn of Object.values(spies)) fn.mockReset();
  spies.connectTcpRTUBuffered.mockResolvedValue();
  spies.close.mockImplementation((cb) => cb());
});

describe("ModbusClient — connection-state recovery on transport errors", () => {
  it("flips isConnected() to false when readHoldingRegisters throws", async () => {
    const client = new ModbusClient({ host: "127.0.0.1", port: 4196, slaveId: 17 });
    await client.connect();
    expect(client.isConnected()).toBe(true);

    spies.readHoldingRegisters.mockRejectedValueOnce(
      Object.assign(new Error("Port Not Open"), { name: "PortNotOpenError" }),
    );

    await expect(client.readHoldingRegisters(512, 4)).rejects.toThrow("Port Not Open");
    expect(client.isConnected()).toBe(false);
  });

  it("flips isConnected() to false when writeRegister throws", async () => {
    const client = new ModbusClient({ host: "127.0.0.1", port: 4196, slaveId: 17 });
    await client.connect();

    spies.writeRegister.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(client.writeRegister(1001, 250)).rejects.toThrow("ECONNRESET");
    expect(client.isConnected()).toBe(false);
  });

  it("keeps isConnected() true when readHoldingRegisters succeeds", async () => {
    const client = new ModbusClient({ host: "127.0.0.1", port: 4196, slaveId: 17 });
    await client.connect();

    spies.readHoldingRegisters.mockResolvedValueOnce({ data: [220, 0, 0, 180] });

    await expect(client.readHoldingRegisters(512, 4)).resolves.toEqual([220, 0, 0, 180]);
    expect(client.isConnected()).toBe(true);
  });
});
