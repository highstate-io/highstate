/**
 * Calls the same SuperJSON tRPC HTTP endpoint used by the Designer browser client.
 */
export async function designerCall<T>(
  url: string,
  procedure: string,
  input: unknown,
  mutation = false,
): Promise<T> {
  const encoded = JSON.stringify({ json: input })

  const response = await fetch(
    `${url}/api/${procedure}${mutation ? "" : `?input=${encodeURIComponent(encoded)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: mutation ? encoded : undefined,
      signal: AbortSignal.timeout(180_000),
    },
  )

  const result = (await response.json()) as { result?: { data: { json: T } }; error?: unknown }
  if (!response.ok || !result.result) {
    throw new Error(`Designer procedure "${procedure}" failed: ${JSON.stringify(result.error)}`)
  }

  return result.result.data.json
}
