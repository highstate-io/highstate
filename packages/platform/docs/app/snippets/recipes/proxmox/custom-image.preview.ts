import { proxmox } from "@highstate/library"

const { proxmoxCluster } = proxmox.connection({
  name: "my-proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
  },
})

// upload a custom image from URL
proxmox.image({
  name: "debian-cloud",
  args: {
    url: "https://cloud.debian.org/images/cloud/bullseye/latest/debian-11-genericcloud-amd64.qcow2",
    fileName: "debian-11-cloud.qcow2",
  },
  inputs: {
    proxmoxCluster,
  },
})