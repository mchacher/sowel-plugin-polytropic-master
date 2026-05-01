import { describe, it, expect } from "vitest";
import { decodeMode, decodeTempX10, encodeTempX10 } from "./registers.js";

describe("decodeTempX10", () => {
  it("decodes a positive value", () => {
    expect(decodeTempX10(220)).toBe(22.0);
  });
  it("decodes a fractional value", () => {
    expect(decodeTempX10(255)).toBe(25.5);
  });
  it("decodes a negative (sign-extended) value", () => {
    expect(decodeTempX10(0xffce)).toBe(-5.0); // 0xffce = -50 signed → -5.0 °C
  });
});

describe("encodeTempX10", () => {
  it("rounds the setpoint to nearest 0.1 °C", () => {
    expect(encodeTempX10(25.5)).toBe(255);
    expect(encodeTempX10(25.51)).toBe(255);
    expect(encodeTempX10(25.55)).toBe(256);
  });
});

describe("decodeMode", () => {
  it("maps known values to names", () => {
    expect(decodeMode(0)).toBe("OFF");
    expect(decodeMode(21)).toBe("SMART");
    expect(decodeMode(22)).toBe("BOOST");
    expect(decodeMode(23)).toBe("ECO");
  });
  it("returns RAW_<n> for unknown values", () => {
    expect(decodeMode(99)).toBe("RAW_99");
  });
});
