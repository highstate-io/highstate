export async function readRequestBody(
  stream: ReadableStream<Uint8Array | string> | undefined,
): Promise<Uint8Array[]> {
  if (!stream) {
    return []
  }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        return chunks
      }

      chunks.push(typeof chunk.value === "string" ? Buffer.from(chunk.value) : chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
}
