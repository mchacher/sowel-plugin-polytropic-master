/**
 * Polytropic Master Inverter — Modbus register map and codecs.
 *
 * Bus: Modbus RTU 9600 8N1, slave 17 (0x11), reachable via a Waveshare
 * RTU-over-TCP gateway. All temperature values use ×10 °C scaling
 * (signed 16-bit). Mode is an enum stored as a raw integer.
 */

export const REG = {
  WATER_TEMPERATURE: 512,
  OUTDOOR_TEMPERATURE: 515,
  MODE: 1000,
  SETPOINT: 1001,
} as const;

export const MODE_VALUES = {
  0: "OFF",
  21: "SMART",
  22: "BOOST",
  23: "ECO",
} as const;

export type ModeName = (typeof MODE_VALUES)[keyof typeof MODE_VALUES];

/**
 * Decode a signed 16-bit Modbus register stored as ×10 °C.
 * The Modbus library returns unsigned 16-bit values, so we sign-extend
 * to support sub-zero outdoor temperatures.
 */
export function decodeTempX10(raw: number): number {
  const signed = raw > 0x7fff ? raw - 0x10000 : raw;
  return signed / 10;
}

/**
 * Encode a temperature setpoint in °C as a Modbus ×10 unsigned register
 * value. Negative values would not make sense for a pool setpoint, but the
 * helper still sign-encodes for robustness.
 */
export function encodeTempX10(value: number): number {
  const scaled = Math.round(value * 10);
  if (scaled < 0) return scaled & 0xffff;
  return scaled;
}

/** Decode the mode enum integer to a stable string name; unknowns become "RAW_<n>". */
export function decodeMode(raw: number): string {
  const known = (MODE_VALUES as Record<number, string>)[raw];
  return known ?? `RAW_${raw}`;
}
