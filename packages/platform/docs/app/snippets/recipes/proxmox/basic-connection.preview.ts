import { proxmox } from "@highstate/library"

// basic connection to Proxmox with username/password
proxmox.connection({
  name: "my-proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
  },
})