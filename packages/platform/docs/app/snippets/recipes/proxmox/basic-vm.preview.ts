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

// create a basic VM with DHCP networking
proxmox.virtualMachine({
  name: "test-vm",
  args: {
    // uses DHCP by default
    ipv4: { type: "dhcp" },
  },
  inputs: {
    proxmoxCluster,
    image,
    vendorData: cloudConfig,
  },
})