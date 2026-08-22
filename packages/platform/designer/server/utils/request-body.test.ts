import { describe, expect, test, vi } from "vitest"
import { readRequestBody } from "./request-body"

describe("readRequestBody", () => {
  test("reads request chunks from the H3 Web stream", async () => {
    const releaseLock = vi.fn()
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([3]) })
      .mockResolvedValueOnce({ done: true, value: undefined })
    const stream = {
      getReader: () => ({ read, releaseLock }),
    } as unknown as ReadableStream<Uint8Array>

    const chunks = await readRequestBody(stream)

    expect(chunks).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])])
    expect(releaseLock).toHaveBeenCalledOnce()
  })

  test("starts reading before the caller awaits the result", async () => {
    let finishReading: (() => void) | undefined
    const releaseLock = vi.fn()
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
      .mockImplementationOnce(
        async () =>
          await new Promise<{ done: true; value: undefined }>(resolve => {
            finishReading = () => resolve({ done: true, value: undefined })
          }),
      )
    const stream = {
      getReader: () => ({ read, releaseLock }),
    } as unknown as ReadableStream<Uint8Array>

    const body = readRequestBody(stream)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    finishReading?.()

    await expect(body).resolves.toEqual([new Uint8Array([1])])
    expect(releaseLock).toHaveBeenCalledOnce()
  })
})
