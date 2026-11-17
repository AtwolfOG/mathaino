export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel("Request body exceeded its size limit.");
      } catch {
        // The size rejection remains authoritative if the source cannot cancel.
      }
      return null;
    }
    chunks.push(value);
  }
  const buffer = new ArrayBuffer(total);
  const output = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
