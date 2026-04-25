import { registerKnownAbbreviations } from "@highstate/contract"

registerKnownAbbreviations([
  "ID",
  "URL",
  "IP",
  "IPs",
  "IPv4",
  "IPv6",
  "DNS",
  "FQDN",
  "SSH",
  "WireGuard",
  "API",
  "k8s",
  "TLS",
  "HTTP",
  "HTTPS",
  "TCP",
  "UDP",
  "CIDR",
  "CPU",
  "RAM",
  "GPU",
  "SSD",
  "HDD",
  "VM",
  "CNI",
  "CSI",
  "MariaDB",
  "MySQL",
  "PostgreSQL",
  "MongoDB",
  "etcd",
  "MAS", // Matrix Authentication Service
  "LC", // Locale
])

export const noop = () => {}
