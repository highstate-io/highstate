export function getNextAvailablePort(portsInUse: number[], startingPort: number = 51820): number {
  let port = startingPort

  while (portsInUse.includes(port)) {
    port++
  }

  return port
}
