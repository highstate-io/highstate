export function int32ToBytes(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4)
  const view = new DataView(buffer)
  view.setInt32(0, value, true) // true for little-endian
  return new Uint8Array(buffer)
}
