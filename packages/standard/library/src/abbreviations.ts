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
  "ALB",
  "NLB",
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
  "MAS", // matrix Authentication Service
  "LC", // locale
])

export const noop = () => {}
