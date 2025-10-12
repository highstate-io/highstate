import { proxmox } from "@highstate/library"

const { proxmoxCluster } = proxmox.connection({
  name: "my-proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
  },
})

// reference an existing image on Proxmox
proxmox.existingImage({
  name: "existing-ubuntu",
  args: {
    // the ID from Proxmox storage
    id: "local:iso/ubuntu-22.04.3-live-server-amd64.iso",
  },
  inputs: {
    proxmoxCluster,
  },
})