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

// VM with custom resource allocation
proxmox.virtualMachine({
  name: "database-server",
  args: {
    resources: {
      cores: 4,
      sockets: 1,
      memory: 8192,  // 8GB RAM
      diskSize: 100, // 100GB disk
    },
    ipv4: {
      type: "static",
      address: "192.168.1.151",
      prefix: 24,
    },
  },
  inputs: {
    proxmoxCluster,
    image,
    vendorData: cloudConfig,
  },
})