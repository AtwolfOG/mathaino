import type { RecordedAudioInput } from "../../application/transcription.ts";

interface AudioDecoder {
  decodeAudioData(data: ArrayBuffer): Promise<{
    numberOfChannels: number;
    sampleRate: number;
    getChannelData(channel: number): Float32Array;
  }>;
  close(): Promise<void>;
}

export async function decodeMoonshineAudio(
  source: Blob | Uint8Array,
  createDecoder: () => AudioDecoder = createBrowserAudioDecoder,
): Promise<Float32Array> {
  const encoded =
    source instanceof Blob ? await source.arrayBuffer() : source.slice().buffer;
  if (encoded.byteLength === 0)
    throw new RangeError("Recorded audio is empty.");

  const decoder = createDecoder();
  try {
    const decoded = await decoder.decodeAudioData(encoded);
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    );
    return resampleLinear(downmixToMono(channels), decoded.sampleRate, 16_000);
  } finally {
    await decoder.close();
  }
}

export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) {
    throw new RangeError("Audio must contain at least one channel.");
  }
  const length = channels[0]!.length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError("Audio channels must have the same length.");
  }
  if (channels.length === 1) return channels[0]!.slice();

  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      mono[index] = mono[index]! + channel[index]! / channels.length;
    }
  }
  return mono;
}

export function resampleLinear(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (
    !Number.isFinite(sourceRate) ||
    sourceRate <= 0 ||
    !Number.isFinite(targetRate) ||
    targetRate <= 0
  ) {
    throw new RangeError("Sample rates must be positive finite numbers.");
  }
  if (samples.length === 0 || sourceRate === targetRate) return samples.slice();

  const outputLength = Math.max(
    1,
    Math.round((samples.length * targetRate) / sourceRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.min(Math.floor(position), samples.length - 1);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = position - leftIndex;
    output[index] =
      samples[leftIndex]! +
      (samples[rightIndex]! - samples[leftIndex]!) * fraction;
  }
  return output;
}

export async function prepareMoonshineAudio(
  input: RecordedAudioInput,
): Promise<Float32Array> {
  return decodeMoonshineAudio(input.bytes);
}

function createBrowserAudioDecoder(): AudioDecoder {
  const AudioContextConstructor = globalThis.AudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio decoding is unavailable in this browser.");
  }
  return new AudioContextConstructor();
}
