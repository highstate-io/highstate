export function timestampFromUlid(id: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let timestamp = 0

  for (const character of id.slice(0, 10).toUpperCase()) {
    const value = alphabet.indexOf(character)

    if (value === -1) {
      return id
    }

    timestamp = timestamp * 32 + value
  }

  return new Date(timestamp).toISOString()
}
