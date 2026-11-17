import { expect, test } from "vitest";
import {
  encodePcm16MonoWav,
  validatePcm16Mono16kWav,
} from "@/infrastructure/transcription/wav";

test("encodes saturated PCM16 mono 16kHz samples in a canonical WAV", () => {
  const bytes = encodePcm16MonoWav(
    new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(
    Array.from({ length: 7 }, (_, index) =>
      view.getInt16(44 + index * 2, true),
    ),
  ).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  expect(validatePcm16Mono16kWav(bytes)?.durationSeconds).toBeCloseTo(
    7 / 16_000,
  );
});

test("rejects malformed or unsupported WAV data", () => {
  const valid = encodePcm16MonoWav(new Float32Array(8_000));
  const stereo = valid.slice();
  new DataView(stereo.buffer).setUint16(22, 2, true);
  const truncated = valid.subarray(0, valid.length - 1);

  expect(validatePcm16Mono16kWav(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(validatePcm16Mono16kWav(stereo)).toBeNull();
  expect(validatePcm16Mono16kWav(truncated)).toBeNull();
});
