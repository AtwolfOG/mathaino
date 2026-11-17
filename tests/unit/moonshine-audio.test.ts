import { expect, test, vi } from "vitest";
import {
  decodeMoonshineAudio,
  downmixToMono,
  resampleLinear,
} from "@/infrastructure/transcription/moonshine-audio";

test.each([
  new Uint8Array([1, 2, 3]),
  new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
])(
  "decodes encoded bytes or Blob and prepares mono 16kHz audio",
  async (source) => {
    const close = vi.fn().mockResolvedValue(undefined);
    const decodeAudioData = vi.fn().mockResolvedValue({
      numberOfChannels: 2,
      sampleRate: 8_000,
      getChannelData: (channel: number) =>
        channel === 0 ? new Float32Array([0, 1]) : new Float32Array([1, 0]),
    });

    await expect(
      decodeMoonshineAudio(source, () => ({ decodeAudioData, close })),
    ).resolves.toEqual(new Float32Array([0.5, 0.5, 0.5, 0.5]));
    expect(new Uint8Array(decodeAudioData.mock.calls[0]![0])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(close).toHaveBeenCalledOnce();
  },
);

test("downmixes deterministic channels to mono", () => {
  expect(
    downmixToMono([new Float32Array([1, 0, -1]), new Float32Array([-1, 1, 1])]),
  ).toEqual(new Float32Array([0, 0.5, 0]));
});

test("resamples mono audio to 16kHz using deterministic linear interpolation", () => {
  expect(
    resampleLinear(new Float32Array([0, 1, 0, -1]), 32_000, 16_000),
  ).toEqual(new Float32Array([0, 0]));
  expect(resampleLinear(new Float32Array([0, 1]), 8_000, 16_000)).toEqual(
    new Float32Array([0, 0.5, 1, 1]),
  );
});

test("rejects invalid channel and sample-rate inputs", () => {
  expect(() => downmixToMono([])).toThrow("at least one channel");
  expect(() =>
    downmixToMono([new Float32Array([1]), new Float32Array([1, 2])]),
  ).toThrow("same length");
  expect(() => resampleLinear(new Float32Array([1]), 0, 16_000)).toThrow(
    "positive finite",
  );
});
