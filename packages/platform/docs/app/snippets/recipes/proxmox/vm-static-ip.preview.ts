import { proxmox, distributions } from "@highstate/library"

const { proxmoxCluster } = proxmox.connection({
  name: "my-proxmox",
  args: {
    endpoint: "https://192.168.1.100:8006",
    insecure: true,
    username: "root@pam",
  },
})

const { image: ubuntuImage, cloudConfig } = distributions.ubuntu({
  name: "ubuntu",
})

const { image } = proxmox.image({
  name: "ubuntu-image",
  inputs: {
    proxmoxCluster,
    file: ubuntuImage,
  },
})

// VM with static IP configuration
proxmox.virtualMachine({
  name: "web-server",
  args: {
    ipv4: {
      type: "static",
      address: "192.168.1.150",
      prefix: 24,
      gateway: "192.168.1.1",
    },
    network: {
      dns: ["8.8.8.8", "8.8.4.4"],
      bridge: "vmbr0",
    },
  },
  inputs: {
    proxmoxCluster,
    image,
    vendorData: cloudConfig,
  },
})