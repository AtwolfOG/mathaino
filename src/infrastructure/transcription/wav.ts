export interface ValidatedWav {
  durationSeconds: number;
}

export function encodePcm16MonoWav(_samples: Float32Array): Uint8Array {
  const samples = _samples;
  const dataLength = samples.length * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index]! : 0;
    const pcm = Math.max(
      -32_768,
      Math.min(32_767, Math.round(sample * 32_768)),
    );
    view.setInt16(44 + index * 2, pcm, true);
  }
  return bytes;
}

export function validatePcm16Mono16kWav(
  bytes: Uint8Array,
): ValidatedWav | null {
  if (
    bytes.length < 44 ||
    readAscii(bytes, 0, 4) !== "RIFF" ||
    readAscii(bytes, 8, 4) !== "WAVE"
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.length - 8) return null;

  let offset = 12;
  let validFormat = false;
  let dataLength: number | undefined;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + length > bytes.length) return null;
    if (id === "fmt ") {
      if (
        validFormat ||
        length < 16 ||
        view.getUint16(dataOffset, true) !== 1 ||
        view.getUint16(dataOffset + 2, true) !== 1 ||
        view.getUint32(dataOffset + 4, true) !== 16_000 ||
        view.getUint32(dataOffset + 8, true) !== 32_000 ||
        view.getUint16(dataOffset + 12, true) !== 2 ||
        view.getUint16(dataOffset + 14, true) !== 16
      )
        return null;
      validFormat = true;
    } else if (id === "data") {
      if (dataLength !== undefined || length % 2 !== 0) return null;
      dataLength = length;
    }
    offset = dataOffset + length + (length % 2);
  }
  if (offset !== bytes.length || !validFormat || dataLength === undefined)
    return null;
  return { durationSeconds: dataLength / 32_000 };
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1)
    bytes[offset + index] = value.charCodeAt(index);
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
